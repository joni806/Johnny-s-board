/* =====================================================================
 * exprEval.js — מפענח ומחשב ביטויים מתמטיים, בלי eval
 * ---------------------------------------------------------------------
 * משמש את כלי הגרפים ואת המחשבון ההנדסי. תומך בכתיבה הטבעית של
 * סטודנט: כפל מרומז (2x, 3sin(x), 2(x+1)), חזקות (x^2), פונקציות
 * טריגונומטריות והיפרבוליות, פונקציית מדרגה u(t), ו־pi ו־e כקבועים.
 *
 * הפענוח בשיטת Pratt, והתוצאה היא פונקציה מהודרת שרצה מהר מספיק כדי
 * לדגום אלפי נקודות לגרף. המודול טהור ונבדק ב־Node.
 * ===================================================================== */

const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
    exp: Math.exp, ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign, sgn: Math.sign,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    /* פונקציות שימושיות באותות ומערכות */
    u: (x) => (x >= 0 ? 1 : 0),
    step: (x) => (x >= 0 ? 1 : 0),
    rect: (x) => (Math.abs(x) <= 0.5 ? 1 : 0),
    tri: (x) => Math.max(0, 1 - Math.abs(x)),
    sinc: (x) => (Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)),
    min: Math.min, max: Math.max, atan2: Math.atan2,
    mod: (a, b) => ((a % b) + b) % b,
};

const CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI };

/** פירוק לאסימונים. מחזיר רשימה של {t: סוג, v: ערך} */
export function tokenize(src) {
    const s = String(src)
        .replace(/\*\*/g, '^')
        .replace(/[×·⋅]/g, '*')
        .replace(/÷/g, '/')
        .replace(/−/g, '-')
        .replace(/√/g, 'sqrt');
    const out = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (/[0-9.]/.test(c)) {
            const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
            if (!m) throw new Error(`מספר לא תקין במקום ${i + 1}`);
            out.push({ t: 'num', v: parseFloat(m[0]) });
            i += m[0].length;
            continue;
        }
        if (/[A-Za-zα-ωΑ-Ωπ_]/.test(c)) {
            const m = /^[A-Za-zα-ωΑ-Ωπ_][A-Za-z0-9_]*/.exec(s.slice(i));
            out.push({ t: 'id', v: m[0] });
            i += m[0].length;
            continue;
        }
        if ('+-*/^(),!|'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
        throw new Error(`תו לא מוכר: ${c}`);
    }
    return out;
}

/**
 * מפרק שם כמו "xsin" או "2pix" לרצף של משתנים, קבועים ופונקציות.
 * כך "xsin(x)" מתפרש כ־x·sin(x), כמו שסטודנט מתכוון כשהוא כותב ביד.
 */
function splitIdentifier(name, vars) {
    if (FUNCS[name] || CONSTS[name] !== undefined || vars.includes(name)) return [name];
    const known = [...Object.keys(FUNCS), ...Object.keys(CONSTS), ...vars].sort((a, b) => b.length - a.length);
    const parts = [];
    let rest = name;
    while (rest.length) {
        const k = known.find((w) => rest.startsWith(w));
        if (!k) return [name];
        parts.push(k);
        rest = rest.slice(k.length);
    }
    return parts;
}

/**
 * מהדר ביטוי לפונקציה. vars הוא רשימת שמות המשתנים, לפי הסדר שבו
 * הפונקציה המהודרת תקבל אותם. שגיאת תחביר נזרקת עם הודעה בעברית.
 */
export function compile(src, vars = ['x']) {
    const raw = tokenize(src);
    /* פירוק שמות מודבקים והוספת כפל מרומז */
    const toks = [];
    for (const tk of raw) {
        if (tk.t === 'id') for (const p of splitIdentifier(tk.v, vars)) toks.push({ t: 'id', v: p });
        else toks.push(tk);
    }
    const withMul = [];
    const endsValue = (tk) => tk && (tk.t === 'num' || (tk.t === 'id' && !FUNCS[tk.v]) || (tk.t === 'op' && (tk.v === ')' || tk.v === '!')));
    const startsValue = (tk) => tk && (tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && tk.v === '('));
    for (let i = 0; i < toks.length; i++) {
        if (i > 0 && endsValue(toks[i - 1]) && startsValue(toks[i])) withMul.push({ t: 'op', v: '*' });
        withMul.push(toks[i]);
    }

    let pos = 0;
    const peek = () => withMul[pos];
    const next = () => withMul[pos++];
    const expect = (v) => {
        const tk = next();
        if (!tk || tk.v !== v) throw new Error(`חסר "${v}"`);
    };

    const BP = { '+': 10, '-': 10, '*': 20, '/': 20, '^': 30, '!': 40 };

    const nud = (tk) => {
        if (!tk) throw new Error('הביטוי נגמר באמצע');
        if (tk.t === 'num') { const v = tk.v; return () => v; }
        if (tk.t === 'op' && tk.v === '(') { const e = expr(0); expect(')'); return e; }
        if (tk.t === 'op' && tk.v === '|') { const e = expr(0); expect('|'); return (s) => Math.abs(e(s)); }
        if (tk.t === 'op' && tk.v === '-') { const e = expr(25); return (s) => -e(s); }
        if (tk.t === 'op' && tk.v === '+') return expr(25);
        if (tk.t === 'id') {
            const name = tk.v;
            if (FUNCS[name]) {
                const f = FUNCS[name];
                const args = [];
                if (peek() && peek().v === '(') {
                    next();
                    if (peek() && peek().v !== ')') {
                        args.push(expr(0));
                        while (peek() && peek().v === ',') { next(); args.push(expr(0)); }
                    }
                    expect(')');
                } else {
                    /* sin x בלי סוגריים — הארגומנט הוא הגורם הבא בלבד */
                    args.push(expr(25));
                }
                if (args.length === 1) { const a = args[0]; return (s) => f(a(s)); }
                return (s) => f(...args.map((a) => a(s)));
            }
            const vi = vars.indexOf(name);
            if (vi >= 0) return (s) => s[vi];
            if (CONSTS[name] !== undefined) { const v = CONSTS[name]; return () => v; }
            throw new Error(`שם לא מוכר: ${name}`);
        }
        throw new Error(`לא צפוי: ${tk.v}`);
    };

    const fact = (n) => {
        if (n < 0 || !Number.isFinite(n)) return NaN;
        if (Math.abs(n - Math.round(n)) > 1e-9) return NaN;
        let r = 1;
        for (let k = 2; k <= Math.round(n); k++) r *= k;
        return r;
    };

    const led = (left, tk) => {
        const op = tk.v;
        if (op === '!') return (s) => fact(left(s));
        if (op === '^') { const r = expr(BP['^'] - 1); return (s) => Math.pow(left(s), r(s)); }
        const r = expr(BP[op]);
        if (op === '+') return (s) => left(s) + r(s);
        if (op === '-') return (s) => left(s) - r(s);
        if (op === '*') return (s) => left(s) * r(s);
        if (op === '/') return (s) => left(s) / r(s);
        throw new Error(`אופרטור לא מוכר: ${op}`);
    };

    function expr(rbp) {
        let left = nud(next());
        while (peek() && peek().t === 'op' && BP[peek().v] !== undefined && BP[peek().v] > rbp) {
            left = led(left, next());
        }
        return left;
    }

    if (withMul.length === 0) throw new Error('הביטוי ריק');
    const root = expr(0);
    if (pos < withMul.length) throw new Error(`תוכן מיותר בסוף: ${withMul[pos].v}`);
    return (...args) => root(args);
}

/** חישוב חד־פעמי של ביטוי בלי משתנים */
export function evaluate(src) {
    return compile(src, [])();
}
