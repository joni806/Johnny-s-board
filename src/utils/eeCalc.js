/* =====================================================================
 * eeCalc.js — חישובים הנדסיים מהירים להנדסת חשמל
 * ---------------------------------------------------------------------
 * קליטה ופלט בקידומות SI כמו שמהנדס כותב: 4.7k, 100n, 2.2µ, וגם הכתיב
 * האירופי 4k7. כל הפונקציות טהורות ונבדקות ב־Node.
 * ===================================================================== */

export const SI_PREFIXES = [
    { p: 'T', e: 12 }, { p: 'G', e: 9 }, { p: 'M', e: 6 }, { p: 'k', e: 3 },
    { p: '', e: 0 }, { p: 'm', e: -3 }, { p: 'µ', e: -6 }, { p: 'n', e: -9 }, { p: 'p', e: -12 }, { p: 'f', e: -15 },
];

const PREFIX_MUL = {
    T: 1e12, G: 1e9, M: 1e6, meg: 1e6, k: 1e3, K: 1e3, '': 1,
    m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

/**
 * ממיר טקסט עם קידומת SI למספר. מחזיר NaN כשהקלט לא מובן.
 * דוגמאות: "4.7k" → 4700, "4k7" → 4700, "100nF" → 1e-7, "2.2 µH" → 2.2e-6
 */
export function parseSI(input) {
    if (typeof input === 'number') return input;
    let s = String(input ?? '').trim().replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return NaN;
    /* הסרת יחידה בסוף. Ω ואוהם תמיד יחידה; אותיות שעלולות להיות קידומת נשארות */
    s = s.replace(/(ohms?|Ω|Ohm|Hz|hz|V|A|W|F|H|s|°)$/u, '');
    /* כתיב אירופי: 4k7 = 4.7k */
    let m = /^([+-]?\d+)(meg|[TGMkKmuµμnpf])(\d+)$/u.exec(s);
    if (m) return parseFloat(`${m[1]}.${m[3]}`) * PREFIX_MUL[m[2]];
    m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|[TGMkKmuµμnpf])?$/iu.exec(s);
    if (!m) return NaN;
    const num = parseFloat(m[1]);
    let pre = m[2] || '';
    /* בגלל הדגל i, M ו-m נבלעים יחד — מחזירים את האות המקורית */
    if (pre && pre.toLowerCase() !== 'meg') pre = s.slice(m[1].length, m[1].length + 1);
    return num * (PREFIX_MUL[pre] ?? 1);
}

/** מספר לתצוגה עם קידומת SI ו־digits ספרות משמעותיות */
export function formatSI(value, unit = '', digits = 3) {
    if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '−∞' : '—';
    if (value === 0) return `0 ${unit}`.trim();
    const abs = Math.abs(value);
    let chosen = SI_PREFIXES[SI_PREFIXES.length - 1];
    for (const pr of SI_PREFIXES) {
        if (abs >= Math.pow(10, pr.e) * 0.9995) { chosen = pr; break; }
    }
    const scaled = value / Math.pow(10, chosen.e);
    const txt = Number(scaled.toPrecision(digits)).toString();
    return `${txt} ${chosen.p}${unit}`.trim();
}

/** אותו מספר כ־LaTeX, לשתילה בשדה נוסחה על הלוח */
export function formatSILatex(value, unit = '', digits = 3) {
    const t = formatSI(value, unit, digits).replace('µ', '\\mu ').replace('Ω', '\\Omega').replace('−', '-');
    const [num, rest = ''] = t.split(' ');
    return rest ? `${num}\\,\\mathrm{${rest}}` : num;
}

/* ── נגדים ופסיביים ─────────────────────────────────────────────── */

export const series = (vals) => vals.reduce((a, b) => a + b, 0);
export const parallel = (vals) => {
    if (vals.some((v) => v === 0)) return 0;
    return 1 / vals.reduce((a, b) => a + 1 / b, 0);
};
export const divider = (vin, r1, r2) => (vin * r2) / (r1 + r2);

export const tauRC = (r, c) => r * c;
export const tauRL = (r, l) => l / r;
export const cutoffRC = (r, c) => 1 / (2 * Math.PI * r * c);
export const cutoffRL = (r, l) => r / (2 * Math.PI * l);
export const resonanceLC = (l, c) => 1 / (2 * Math.PI * Math.sqrt(l * c));
export const reactanceL = (f, l) => 2 * Math.PI * f * l;
export const reactanceC = (f, c) => 1 / (2 * Math.PI * f * c);

/** עכבת RLC טורי בתדר f. מחזיר רכיבים, גודל, זווית במעלות, Q ורוחב פס */
export function seriesRLC(r, l, c, f) {
    const w = 2 * Math.PI * f;
    const xl = l > 0 ? w * l : 0;
    const xc = c > 0 ? 1 / (w * c) : 0;
    const im = xl - xc;
    const f0 = l > 0 && c > 0 ? resonanceLC(l, c) : NaN;
    const q = r > 0 && l > 0 && c > 0 ? Math.sqrt(l / c) / r : NaN;
    return { re: r, im, mag: Math.hypot(r, im), deg: (Math.atan2(im, r) * 180) / Math.PI, f0, q, bw: f0 / q };
}

/* ── דציבלים ופאזורים ───────────────────────────────────────────── */

export const dbPower = (ratio) => 10 * Math.log10(ratio);
export const dbAmplitude = (ratio) => 20 * Math.log10(ratio);
export const fromDbPower = (db) => Math.pow(10, db / 10);
export const fromDbAmplitude = (db) => Math.pow(10, db / 20);

export const toPolar = (re, im) => ({ mag: Math.hypot(re, im), deg: (Math.atan2(im, re) * 180) / Math.PI });
export const toRect = (mag, deg) => ({ re: mag * Math.cos((deg * Math.PI) / 180), im: mag * Math.sin((deg * Math.PI) / 180) });

/* ── קוד צבעים לנגדים ───────────────────────────────────────────── */

export const BAND_COLORS = [
    { name: 'שחור', hex: '#111111', digit: 0, mul: 1 },
    { name: 'חום', hex: '#7c3f12', digit: 1, mul: 10, tol: 1 },
    { name: 'אדום', hex: '#dc2626', digit: 2, mul: 100, tol: 2 },
    { name: 'כתום', hex: '#f97316', digit: 3, mul: 1e3 },
    { name: 'צהוב', hex: '#facc15', digit: 4, mul: 1e4 },
    { name: 'ירוק', hex: '#16a34a', digit: 5, mul: 1e5, tol: 0.5 },
    { name: 'כחול', hex: '#2563eb', digit: 6, mul: 1e6, tol: 0.25 },
    { name: 'סגול', hex: '#7c3aed', digit: 7, mul: 1e7, tol: 0.1 },
    { name: 'אפור', hex: '#6b7280', digit: 8, mul: 1e8, tol: 0.05 },
    { name: 'לבן', hex: '#f5f5f5', digit: 9, mul: 1e9 },
    { name: 'זהב', hex: '#c8a43a', mul: 0.1, tol: 5 },
    { name: 'כסף', hex: '#b8bcc4', mul: 0.01, tol: 10 },
];

/**
 * מפענח פסי צבע. bands הוא מערך של אינדקסים לטבלת הצבעים: ארבעה פסים —
 * שתי ספרות, מכפיל וסבילות; חמישה פסים — שלוש ספרות, מכפיל וסבילות.
 */
export function decodeBands(bands) {
    const n = bands.length;
    if (n !== 4 && n !== 5) return null;
    const digits = bands.slice(0, n - 2).map((i) => BAND_COLORS[i]?.digit);
    if (digits.some((d) => d === undefined)) return null;
    const mul = BAND_COLORS[bands[n - 2]]?.mul;
    const tol = BAND_COLORS[bands[n - 1]]?.tol;
    if (mul === undefined) return null;
    const base = digits.reduce((a, d) => a * 10 + d, 0);
    return { ohms: base * mul, tol: tol ?? null };
}

/** הפוך: ערך ← פסי צבע. מעגל לספרות המשמעותיות שמספר הפסים מאפשר */
export function encodeBands(ohms, count = 4, tolIndex = 10) {
    if (!(ohms > 0)) return null;
    const sig = count === 5 ? 3 : 2;
    let exp = Math.floor(Math.log10(ohms)) - (sig - 1);
    let base = Math.round(ohms / Math.pow(10, exp));
    if (base >= Math.pow(10, sig)) { base /= 10; exp += 1; }
    const mulIdx = BAND_COLORS.findIndex((c) => c.mul !== undefined && Math.abs(Math.log10(c.mul) - exp) < 1e-9);
    if (mulIdx < 0) return null;
    const digits = String(base).padStart(sig, '0').split('').map(Number);
    return [...digits.map((d) => BAND_COLORS.findIndex((c) => c.digit === d)), mulIdx, tolIndex];
}

const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

/** הערך התקני הקרוב ביותר בסדרה E12 או E24 — מה שאפשר באמת לקנות */
export function nearestStandard(value, series = 'E24') {
    if (!(value > 0)) return NaN;
    const table = series === 'E12' ? E12 : E24;
    const dec = Math.floor(Math.log10(value));
    let best = NaN, err = Infinity;
    for (const d of [dec - 1, dec, dec + 1]) {
        for (const b of table) {
            const v = b * Math.pow(10, d);
            const e = Math.abs(Math.log(v / value));
            if (e < err) { err = e; best = v; }
        }
    }
    return Number(best.toPrecision(3));
}
