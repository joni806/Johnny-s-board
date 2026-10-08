import nerdamer from 'nerdamer';
import 'nerdamer/Algebra.js';
import 'nerdamer/Calculus.js';
import 'nerdamer/Solve.js';
import 'nerdamer/Extra.js';
import { inverseLaplace, niceNumber, fitRational, rationalTex } from './laplace.js';

/**
 * פתרון סימבולי של ביטוי ב־ascii-math.
 *
 * המודול טהור ואינו נוגע ב־DOM, כדי שיוכל לרוץ גם בתוך Web Worker וגם
 * בחוט הראשי כנפילה לאחור. הפרדה זו חשובה כי nerdamer עלול לרוץ שניות
 * ארוכות על ביטוי כבד, ואז הלוח קופא באמצע כתיבה.
 *
 * מחזיר { ok, resultLatex } או { ok: false, error }.
 */
export function solveAsciiMath(plainMath) {
    try {
        const parsed = nerdamer(plainMath);
        const vars = parsed.variables();
        let resultLatex;

        if (plainMath.includes('=')) {
            const targetVar = vars.length > 0 ? vars[0] : 'x';
            const solutions = nerdamer.solve(plainMath, targetVar);
            resultLatex = `\\Rightarrow ${targetVar} = ${solutions.toTeX()}`;
        } else if (vars.length > 0) {
            const targetVar = vars[0];
            const simplified = parsed.simplify().toTeX();
            const solutions = nerdamer.solve(plainMath, targetVar).toTeX();
            resultLatex = `= ${simplified} \\quad \\Rightarrow ${targetVar} = ${solutions}`;
        } else {
            resultLatex = `= ${parsed.evaluate().toTeX()}`;
        }
        return { ok: true, resultLatex };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
}

/* ── פעולות CAS על תיבת נוסחה ─────────────────────────────────────── */

/** המשתנה שהפעולה תפעל עליו: מועדף לפי סדר, ואחרת הראשון שנמצא */
const pickVar = (vars, prefer) => prefer.find((v) => vars.includes(v)) || vars[0] || prefer[0];

/** מטריצה בכתיב של MathLive, ((1,2),(3,4)), לכתיב של nerdamer */
export const asciiMatrixToNerdamer = (ascii) => {
    const s = ascii.replace(/\s+/g, '');
    if (!/^\(\(.*\)\)$/.test(s)) return null;
    const rows = s.slice(1, -1).split(/\),\(/).map((r) => r.replace(/^\(|\)$/g, ''));
    if (rows.length < 1) return null;
    const cols = rows.map((r) => r.split(',').length);
    if (cols.some((c) => c !== cols[0])) return null;
    return `matrix(${rows.map((r) => `[${r}]`).join(',')})`;
};

/**
 * ה־LaTeX של nerdamer נכון אבל מסורבל: \mathrm{sin} במקום \sin, ו־2·x
 * במקום 2x. כאן הוא מנוקה לכתיב שסטודנט מכיר מהספר.
 */
export const prettifyTex = (t) => String(t)
    .replace(/\\mathrm\{(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|ln|log|exp|det)\}/g, '\\$1')
    .replace(/\\mathrm\{(asin|acos|atan)\}/g, (_, f) => `\\arc${f.slice(1)}`)
    .replace(/(\d) \\cdot (?=[a-zA-Z\\(])/g, '$1')
    .replace(/\\cr/g, '\\\\');

const tex = (expr) => prettifyTex(nerdamer(expr).toTeX());

/** ascii-math של MathLive כותב "sin (x)" עם רווח, ו־nerdamer קורא את זה לא נכון בתוך פונקציה */
export const normalizeAscii = (a) => String(a || '')
    .replace(/([A-Za-z]+)\s+\(/g, '$1(')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * מקדמי פולינום במשתנה v, מהחזקה הגבוהה לנמוכה. מחזיר null אם אחד
 * המקדמים אינו מספר — ואז ההתמרה ההפוכה נופלת למנוע הסימבולי.
 */
const numericCoeffs = (expr, v) => {
    const c = nerdamer.coeffs(nerdamer(`expand(${expr})`).toString(), v);
    const list = c.toString().replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter((x) => x.length);
    const nums = list.map((x) => Number(nerdamer(x).evaluate().text('decimals')));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    return nums.reverse();
};

/**
 * פירוק ביטוי לאיברים ברמה העליונה: "sin(2t) - 3t + 4" → שלושה איברים
 * עם סימנים. מינוס אחרי ^, *, / או סוגר פותח הוא סימן של מספר ולא חיבור.
 */
export const splitTerms = (expr) => {
    const out = [];
    let depth = 0, cur = '', sign = 1;
    const s = String(expr).trim();
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (depth === 0 && (c === '+' || c === '-')) {
            const t = cur.trim();
            /* סימן אונרי: בתחילת ביטוי, אחרי אופרטור, או מעריך של כתיב מדעי כמו 1e-3 */
            const unary = t === '' || /[\^*/(]$/.test(t) || /\d[eE]$/.test(t);
            if (!unary) {
                out.push({ sign, text: t });
                cur = '';
                sign = c === '-' ? -1 : 1;
                continue;
            }
            if (cur.trim() === '') { sign *= c === '-' ? -1 : 1; continue; }
        }
        cur += c;
    }
    if (cur.trim()) out.push({ sign, text: cur.trim() });
    return out.filter((t) => t.text.length);
};

/**
 * מריץ פעולה על ביטוי. ascii הוא הביטוי בכתיב ascii-math של MathLive,
 * ו־latex הוא אותו ביטוי כפי שהוצג — לבניית צד שמאל של השורה החדשה.
 * מחזיר { ok, latex } — שורה שלמה להוספה מתחת לנוסחה המקורית.
 */
export function runCas(action, ascii, latex = '') {
    try {
        const src = normalizeAscii(ascii);
        if (!src) return { ok: false, error: 'empty' };
        if (action === 'solve') {
            const r = solveAsciiMath(src);
            return r.ok ? { ok: true, latex: `${latex} ${r.resultLatex}`, inline: true } : r;
        }

        const matrix = asciiMatrixToNerdamer(src);
        if (matrix) {
            if (action === 'det') return { ok: true, latex: `\\det ${latex} = ${tex(`determinant(${matrix})`)}` };
            if (action === 'inv') return { ok: true, latex: `${latex}^{-1} = ${tex(`invert(${matrix})`).replace(/vmatrix/g, 'pmatrix')}` };
            if (action === 'transpose') return { ok: true, latex: `${latex}^{T} = ${tex(`transpose(${matrix})`).replace(/vmatrix/g, 'pmatrix')}` };
        }
        if (['det', 'inv', 'transpose'].includes(action)) return { ok: false, error: 'not-matrix' };

        const parsed = nerdamer(src);
        const vars = parsed.variables();
        const lhs = latex || parsed.toTeX();

        switch (action) {
            case 'simplify': return { ok: true, latex: `${lhs} = ${tex(`simplify(${src})`)}` };
            case 'expand': return { ok: true, latex: `${lhs} = ${tex(`expand(${src})`)}` };
            case 'factor': return { ok: true, latex: `${lhs} = ${tex(`factor(${src})`)}` };
            case 'evaluate': {
                const v = Number(parsed.evaluate().text('decimals'));
                if (!Number.isFinite(v)) return { ok: true, latex: `${lhs} \\approx ${parsed.evaluate().toTeX()}` };
                return { ok: true, latex: `${lhs} \\approx ${Number(v.toPrecision(6))}` };
            }
            case 'diff': {
                const v = pickVar(vars, ['x', 't', 's', 'y']);
                return { ok: true, latex: `\\frac{d}{d${v}}\\left(${lhs}\\right) = ${tex(`diff(${src},${v})`)}` };
            }
            case 'integrate': {
                const v = pickVar(vars, ['x', 't', 's', 'y']);
                return { ok: true, latex: `\\int ${lhs}\\,d${v} = ${tex(`integrate(${src},${v})`)} + C` };
            }
            case 'laplace': {
                const v = pickVar(vars.filter((x) => x !== 'u'), ['t', 'x']);
                /* התמרה חד־צדדית: u(t) שווה 1 בכל התחום שבו ההתמרה מוגדרת */
                const body = src.replace(new RegExp(`(?<![A-Za-z])(u|heaviside)\\(\\s*${v}\\s*\\)`, 'g'), '(1)');
                /* לינאריות: כל איבר מותמר בנפרד. nerdamer מכפיל סכומים בטעות —
                   laplace(sin(2t)+3) יוצא אצלו פי שלושה מהנכון */
                const terms = splitTerms(body).map(({ sign, text }) => ({ sign, L: nerdamer(`laplace((${text}),${v},s)`) }));
                if (terms.every((t) => t.L.variables().every((x) => x === 's'))) {
                    const fns = terms.map((t) => ({ sign: t.sign, f: t.L.buildFunction(['s']) }));
                    const fit = fitRational((x) => fns.reduce((acc, t) => acc + t.sign * t.f(x), 0));
                    if (fit) return { ok: true, latex: `\\mathcal{L}\\left\\{${lhs}\\right\\} = ${rationalTex(fit.num, fit.den, 's')}` };
                }
                const texTerms = terms.map((t, i) => {
                    const body2 = prettifyTex(t.L.toTeX());
                    if (i === 0) return t.sign < 0 ? `-${body2}` : body2;
                    return t.sign < 0 ? ` - ${body2}` : ` + ${body2}`;
                }).join('');
                return { ok: true, latex: `\\mathcal{L}\\left\\{${lhs}\\right\\} = ${texTerms}` };
            }
            case 'ilaplace':
            case 'partfrac': {
                const v = pickVar(vars, ['s', 'x']);
                /* בלי simplify: ב־nerdamer הוא שובר שברים רציונליים פשוטים */
                const e = nerdamer(src);
                const num = numericCoeffs(e.numerator().toString(), v);
                const den = numericCoeffs(e.denominator().toString(), v);
                if (num && den && den.length > 1) {
                    const r = inverseLaplace(num, den, 't');
                    if (action === 'partfrac') return { ok: true, latex: `${lhs} = ${r.partialLatex.replace(/\(s/g, `(${v}`).replace(/\{s/g, `{${v}`)}` };
                    return { ok: true, latex: `\\mathcal{L}^{-1}\\left\\{${lhs}\\right\\} = ${r.latex}` };
                }
                if (action === 'partfrac') return { ok: true, latex: `${lhs} = ${tex(`partfrac(${src},${v})`)}` };
                return { ok: true, latex: `\\mathcal{L}^{-1}\\left\\{${lhs}\\right\\} = ${tex(`ilt(${src},${v},t)`)}` };
            }
            default:
                return { ok: false, error: 'unknown-action' };
        }
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
}

export { niceNumber };
