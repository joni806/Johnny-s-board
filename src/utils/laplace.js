/* =====================================================================
 * laplace.js — התמרת לפלס הפוכה לפונקציות רציונליות, בדרך המספרית
 * ---------------------------------------------------------------------
 * מנוע הסימבוליקה של האפליקציה מחזיר תשובות שגויות להתמרה הפוכה כבר
 * בדוגמאות של קורס מעגלים, למשל 3/((s+2)^2+9). כאן ההתמרה נעשית כמו
 * שמלמדים אותה: מוצאים את הקטבים, מפרקים לשברים חלקיים, וכל שבר הופך
 * לאיבר מוכר בזמן — e^{at}, t^k e^{at}, ו־e^{σt}cos/sin ωt לזוג קטבים
 * צמודים. הכול מספרי ומדויק לכמה עשרות ספרות.
 *
 * פולינום מיוצג כמערך מקדמים מהחזקה הגבוהה לנמוכה: s^2+3s+2 → [1, 3, 2].
 * ===================================================================== */

const C = (re, im = 0) => ({ re, im });
const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
const csub = (a, b) => C(a.re - b.re, a.im - b.im);
const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cabs = (a) => Math.hypot(a.re, a.im);

/** הערכת פולינום במספר מרוכב, בשיטת הורנר */
export const polyEval = (coeffs, z) => {
    let acc = C(0);
    for (const c of coeffs) acc = cadd(cmul(acc, z), typeof c === 'number' ? C(c) : c);
    return acc;
};

const trimLeading = (p) => {
    let i = 0;
    while (i < p.length - 1 && Math.abs(p[i]) < 1e-14 * Math.max(1, ...p.map(Math.abs))) i++;
    return p.slice(i);
};

/** שורשי פולינום בשיטת דוראנד־קרנר, עם ליטוש ניוטון על הפולינום המקורי */
export function polyRoots(coeffsIn) {
    const p = trimLeading(coeffsIn);
    const n = p.length - 1;
    if (n < 1) return [];
    const lead = p[0];
    const a = p.map((c) => c / lead);
    const R = 1 + Math.max(...a.slice(1).map(Math.abs));
    let z = Array.from({ length: n }, (_, k) => {
        const ang = (2 * Math.PI * k) / n + 0.4;
        return C(R * 0.9 * Math.cos(ang), R * 0.9 * Math.sin(ang));
    });
    for (let iter = 0; iter < 2000; iter++) {
        let delta = 0;
        z = z.map((zi, i) => {
            let den = C(1);
            for (let j = 0; j < n; j++) if (j !== i) den = cmul(den, csub(zi, z[j]));
            const step = cdiv(polyEval(a, zi), den);
            delta = Math.max(delta, cabs(step));
            return csub(zi, step);
        });
        if (delta < 1e-15 * R) break;
    }
    /* ליטוש ניוטון על כל שורש בנפרד */
    const der = a.slice(0, -1).map((c, i) => c * (n - i));
    z = z.map((zi) => {
        let x = zi;
        for (let k = 0; k < 6; k++) {
            const d = polyEval(der, x);
            if (cabs(d) < 1e-300) break;
            const step = cdiv(polyEval(a, x), d);
            if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) break;
            x = csub(x, step);
        }
        return x;
    });
    return z.map((r) => C(Math.abs(r.re) < 1e-11 * R ? 0 : r.re, Math.abs(r.im) < 1e-9 * R ? 0 : r.im));
}

/** נגזרת פולינום ממשי */
const polyDeriv = (p) => p.slice(0, -1).map((c, i) => c * (p.length - 1 - i));

/**
 * קיבוץ שורשים קרובים לקוטב אחד עם ריבוי. שורש מרובה מתכנס רק לדיוק
 * חלקי, ולכן הוא מלוטש בניוטון על הנגזרת ה־(m-1), שבה הוא שורש פשוט.
 */
function groupRoots(roots, poly) {
    const scale = Math.max(1, ...roots.map(cabs));
    const tol = 2e-4 * scale;
    const groups = [];
    for (const r of roots) {
        const g = groups.find((q) => cabs(csub(C(q.sum.re / q.m, q.sum.im / q.m), r)) < tol);
        if (g) { g.sum = cadd(g.sum, r); g.m += 1; }
        else groups.push({ sum: r, m: 1 });
    }
    return groups.map((g) => {
        let p = C(g.sum.re / g.m, g.sum.im / g.m);
        if (g.m > 1 && poly) {
            let d = poly;
            for (let k = 1; k < g.m; k++) d = polyDeriv(d);
            const dd = polyDeriv(d);
            for (let it = 0; it < 30; it++) {
                const den = polyEval(dd, p);
                if (cabs(den) < 1e-300) break;
                const step = cdiv(polyEval(d, p), den);
                p = csub(p, step);
                if (cabs(step) < 1e-15 * scale) break;
            }
        }
        const imTol = (g.m > 1 ? 1e-6 : 1e-8) * scale;
        return { p: C(Math.abs(p.re) < 1e-10 * scale ? 0 : p.re, Math.abs(p.im) < imTol ? 0 : p.im), m: g.m };
    });
}

/** חילוק ארוך של פולינומים ממשיים: מנה ושארית */
export function polyDivide(num, den) {
    const n = trimLeading(num), d = trimLeading(den);
    if (n.length < d.length) return { q: [0], r: n };
    const q = new Array(n.length - d.length + 1).fill(0);
    const r = [...n];
    for (let i = 0; i < q.length; i++) {
        const f = r[i] / d[0];
        q[i] = f;
        for (let j = 0; j < d.length; j++) r[i + j] -= f * d[j];
    }
    return { q, r: trimLeading(r.slice(q.length)) };
}

/** מקדמי טיילור של פולינום סביב נקודה מרוכבת: P(p+t) = Σ c_k t^k */
function taylorShift(coeffs, p) {
    let cur = coeffs.map((c) => (typeof c === 'number' ? C(c) : c));
    const out = [];
    while (cur.length) {
        /* חילוק סינתטי ב־(s-p): השארית היא המקדם הבא, המנה ממשיכה */
        const q = [];
        let acc = C(0);
        for (const c of cur) { acc = cadd(cmul(acc, p), c); q.push(acc); }
        out.push(q.pop());
        cur = q;
    }
    return out;
}

/** פולינום ממכפלת גורמים (s-q)^m, עם מקדם מוביל */
function polyFromRoots(lead, groups) {
    let poly = [C(lead)];
    for (const { p, m } of groups) {
        for (let k = 0; k < m; k++) {
            const next = new Array(poly.length + 1).fill(null).map(() => C(0));
            for (let i = 0; i < poly.length; i++) {
                next[i] = cadd(next[i], poly[i]);
                next[i + 1] = csub(next[i + 1], cmul(poly[i], p));
            }
            poly = next;
        }
    }
    return poly;
}

/**
 * פירוק לשברים חלקיים של num/den.
 * מחזיר { poly, poles: [{ p, m, A: [A1..Am] }] } כש־A_j הוא המקדם של 1/(s-p)^j.
 */
export function partialFractions(num, den) {
    const d = trimLeading(den);
    if (d.length < 2) throw new Error('המכנה חייב להיות פולינום ממעלה ראשונה לפחות');
    const { q: poly, r } = polyDivide(num, d);
    const groups = groupRoots(polyRoots(d), d);
    const poles = groups.map((g, gi) => {
        const others = groups.filter((_, j) => j !== gi);
        const Q = polyFromRoots(d[0], others);
        const nT = taylorShift(r, g.p);
        const qT = taylorShift(Q, g.p);
        const gser = [];
        for (let k = 0; k < g.m; k++) {
            let acc = nT[k] || C(0);
            for (let i = 1; i <= k; i++) acc = csub(acc, cmul(qT[i] || C(0), gser[k - i]));
            gser.push(cdiv(acc, qT[0]));
        }
        /* g_k הוא המקדם של 1/(s-p)^(m-k) */
        const A = new Array(g.m);
        for (let k = 0; k < g.m; k++) A[g.m - k - 1] = gser[k];
        return { p: g.p, m: g.m, A };
    });
    return { poly: polyDivide(num, d).q, poles, hasPoly: poly.some((c) => Math.abs(c) > 1e-12) };
}

/* ── עיצוב מספרים ל־LaTeX ────────────────────────────────────────── */

/** מספר יפה: שלם, שבר פשוט עם מכנה עד 24, או ארבע ספרות משמעותיות */
export function niceNumber(x) {
    if (!Number.isFinite(x)) return String(x);
    if (Math.abs(x) < 1e-12) return '0';
    const sign = x < 0 ? '-' : '';
    const a = Math.abs(x);
    if (Math.abs(a - Math.round(a)) < 1e-9 * Math.max(1, a)) return sign + String(Math.round(a));
    for (let den = 2; den <= 24; den++) {
        const num = a * den;
        if (Math.abs(num - Math.round(num)) < 1e-8 * Math.max(1, num)) return `${sign}\\frac{${Math.round(num)}}{${den}}`;
    }
    return sign + String(Number(a.toPrecision(4)));
}

/** מקדם לפני ביטוי: 1 נעלם, ‎-1 הופך למינוס בלבד */
const coefTex = (x) => {
    const n = niceNumber(x);
    if (n === '1') return '';
    if (n === '-1') return '-';
    return n.startsWith('\\frac') || n.startsWith('-\\frac') ? `${n}\\,` : n;
};

const expTex = (sigma, v) => {
    if (Math.abs(sigma) < 1e-12) return '';
    const c = niceNumber(sigma);
    const body = c === '1' ? v : c === '-1' ? `-${v}` : `${c}${v}`;
    return `e^{${body}}`;
};

const joinTerms = (terms) => {
    if (!terms.length) return '0';
    return terms.map((t, i) => {
        const s = t.trim();
        if (i === 0) return s;
        return s.startsWith('-') ? ` - ${s.slice(1)}` : ` + ${s}`;
    }).join('');
};

/** שבר חלקי עם הסימן בחוץ: ‎-\frac{1}{s+2} ולא \frac{-1}{(s+2)} */
const fracTerm = (coef, den) => {
    const sign = coef < 0 ? '-' : '';
    const n = niceNumber(Math.abs(coef));
    if (n.startsWith('\\frac')) return `${sign}${n}\\,\\frac{1}{${den}}`;
    return `${sign}\\frac{${n}}{${den}}`;
};

const factorialOf = (k) => { let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; };

/**
 * התמרת לפלס הפוכה של num(s)/den(s), כ־LaTeX של f(t).
 * מחזירה גם את הפירוק לשברים חלקיים, שמוצג לסטודנט כצעד הביניים.
 */
export function inverseLaplace(num, den, v = 't') {
    const pf = partialFractions(num, den);
    const timeTerms = [];
    const sTerms = [];

    /* חלק פולינומי — דלתא של דיראק ונגזרותיה */
    const k = pf.poly.length - 1;
    pf.poly.forEach((c, i) => {
        if (Math.abs(c) < 1e-12) return;
        const order = k - i;
        timeTerms.push(`${coefTex(c)}\\delta${order ? `^{(${order})}` : ''}(${v})`);
        sTerms.push(order ? `${coefTex(c)}s${order > 1 ? `^{${order}}` : ''}` : niceNumber(c));
    });

    for (const { p, m, A } of pf.poles) {
        if (p.im < -1e-12) continue;           // הצמוד מטופל יחד עם בן הזוג שלו
        for (let j = 1; j <= m; j++) {
            const a = A[j - 1];
            const tPow = j - 1;
            const tPart = tPow === 0 ? '' : tPow === 1 ? v : `${v}^{${tPow}}`;
            const fact = factorialOf(tPow);
            if (Math.abs(p.im) < 1e-12) {
                const coef = a.re / fact;
                if (Math.abs(coef) < 1e-12) continue;
                const body = [tPart, expTex(p.re, v)].filter(Boolean).join(' ');
                timeTerms.push(body ? `${coefTex(coef)}${body}` : niceNumber(coef));
                const sp = Math.abs(p.re) < 1e-12 ? 's' : `s ${p.re < 0 ? '+' : '-'} ${niceNumber(Math.abs(p.re))}`;
                const den = j > 1 ? (sp === 's' ? `s^{${j}}` : `(${sp})^{${j}}`) : sp;
                sTerms.push(fracTerm(a.re, den));
            } else {
                /* זוג צמוד: 2e^{σt}[Re(A)cos ωt − Im(A)sin ωt] · t^{j-1}/(j-1)! */
                const w = niceNumber(p.im);
                const wv = w === '1' ? v : `${w}${v}`;
                const cosC = (2 * a.re) / fact, sinC = (-2 * a.im) / fact;
                const pre = [tPart, expTex(p.re, v)].filter(Boolean).join(' ');
                const parts = [];
                if (Math.abs(cosC) > 1e-12) parts.push(`${coefTex(cosC)}\\cos(${wv})`);
                if (Math.abs(sinC) > 1e-12) parts.push(`${coefTex(sinC)}\\sin(${wv})`);
                if (!parts.length) continue;
                if (pre) timeTerms.push(parts.length > 1 ? `${pre}\\left(${joinTerms(parts)}\\right)` : `${parts[0].startsWith('-') ? '-' : ''}${pre}\\,${parts[0].replace(/^-/, '')}`);
                else timeTerms.push(...parts);
                if (j === 1) {
                    /* (Bs + C)/((s-σ)^2 + ω^2) */
                    const B = 2 * a.re;
                    const Cc = -2 * (a.re * p.re + a.im * p.im);
                    const numer = joinTerms([Math.abs(B) > 1e-12 ? `${coefTex(B)}s` : '', Math.abs(Cc) > 1e-12 ? niceNumber(Cc) : ''].filter(Boolean));
                    const shift = Math.abs(p.re) < 1e-12 ? 's^{2}' : `(s ${p.re < 0 ? '+' : '-'} ${niceNumber(Math.abs(p.re))})^{2}`;
                    sTerms.push(`\\frac{${numer}}{${shift} + ${niceNumber(p.im * p.im)}}`);
                }
            }
        }
    }
    const step = pf.poly.some((c) => Math.abs(c) > 1e-12) ? '' : `\\quad (${v} \\ge 0)`;
    return {
        latex: `${joinTerms(timeTerms)}${step}`,
        partialLatex: joinTerms(sTerms),
        poles: pf.poles.map(({ p, m }) => ({ re: p.re, im: p.im, m })),
        /** f(t) כפונקציה מספרית — לבדיקה ולציור גרף */
        evaluate: (t) => {
            let sum = 0;
            for (const { p, m, A } of pf.poles) {
                for (let j = 1; j <= m; j++) {
                    const a = A[j - 1];
                    const tp = Math.pow(t, j - 1) / factorialOf(j - 1);
                    const e = Math.exp(p.re * t);
                    sum += tp * e * (a.re * Math.cos(p.im * t) - a.im * Math.sin(p.im * t));
                }
            }
            return sum;
        },
    };
}

/* ── שחזור פונקציה רציונלית מדגימות ───────────────────────────────── */

/** פתרון מערכת לינארית בשיטת גאוס עם ציר חלקי. מחזיר null למטריצה סינגולרית */
function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (Math.abs(M[piv][c]) < 1e-13) return null;
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}

/**
 * מוצא N(s)/D(s) בדרגה הנמוכה ביותר שמתאימה לפונקציה f בדיוק מלא.
 * nerdamer מחזיר התמרות לפלס נכונות אבל בצורה מקוננת ובלתי קריאה, כמו
 * 3/((s+2)^2·(1+9/(s+2)^2)). כאן הן מוחזרות לשבר עם מכנה פרוש לפולינום,
 * שממנו רואים מיד את הקטבים. מחזיר { num, den } מהחזקה הגבוהה, או null.
 */
export function fitRational(f, maxDeg = 6) {
    const pts = [0.37, 0.71, 1.13, 1.61, 2.27, 2.93, 3.71, 4.39, 5.17, 6.03, 7.11, 8.27, 9.43, 10.9, 12.3];
    const check = [0.53, 1.87, 3.29, 6.61, 11.7];
    const fv = (s) => { try { return f(s); } catch { return NaN; } };
    for (let D = 0; D <= maxDeg; D++) {
        for (let Nn = 0; Nn <= D + 1; Nn++) {
            const unknowns = Nn + 1 + D;
            if (unknowns > pts.length) continue;
            const A = [], b = [];
            let bad = false;
            for (let k = 0; k < unknowns; k++) {
                const s = pts[k], F = fv(s);
                if (!Number.isFinite(F)) { bad = true; break; }
                const row = [];
                for (let i = 0; i <= Nn; i++) row.push(Math.pow(s, i));
                for (let j = 0; j < D; j++) row.push(-F * Math.pow(s, j));
                A.push(row);
                b.push(F * Math.pow(s, D));
            }
            if (bad) continue;
            const x = solveLinear(A, b);
            if (!x) continue;
            const num = x.slice(0, Nn + 1).reverse();
            const den = [1, ...x.slice(Nn + 1).reverse()];
            const ok = check.every((s) => {
                const F = fv(s);
                if (!Number.isFinite(F)) return true;
                const val = polyEval(num, C(s)).re / polyEval(den, C(s)).re;
                return Math.abs(val - F) <= 1e-7 * Math.max(1, Math.abs(F));
            });
            if (ok) return { num: trimLeading(num.map((c) => (Math.abs(c) < 1e-10 ? 0 : c))), den };
        }
    }
    return null;
}

/** פולינום כ־LaTeX: [1, 4, 13] → s^{2} + 4s + 13 */
export function polyTex(coeffs, v = 's') {
    const n = coeffs.length - 1;
    const terms = [];
    coeffs.forEach((c, i) => {
        if (Math.abs(c) < 1e-12) return;
        const pow = n - i;
        const vp = pow === 0 ? '' : pow === 1 ? v : `${v}^{${pow}}`;
        if (!vp) terms.push(niceNumber(c));
        else terms.push(`${coefTex(c)}${vp}`);
    });
    return joinTerms(terms);
}

/** שבר רציונלי כ־LaTeX, או רק המונה כשהמכנה הוא 1 */
export function rationalTex(num, den, v = 's') {
    if (den.length === 1 && Math.abs(den[0] - 1) < 1e-12) return polyTex(num, v);
    return `\\frac{${polyTex(num, v)}}{${polyTex(den, v)}}`;
}
