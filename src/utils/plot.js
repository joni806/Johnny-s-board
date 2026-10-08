/* =====================================================================
 * plot.js — דגימת פונקציות לגרף וקטורי על הלוח
 * ---------------------------------------------------------------------
 * הגרף נבנה כאובייקטים וקטוריים רגילים של הלוח ולא כתמונה, ולכן אפשר
 * לכתוב עליו, לסמן עליו נקודות ולהזיז אותו כמו כל ציור אחר. הדגימה
 * מזהה אסימפטוטות וקפיצות, ומפצלת את העקומה שם במקום למתוח קו אנכי
 * מזויף — הבעיה הקלאסית של tan(x) בכלי גרפים פשוטים.
 *
 * המודול טהור ונבדק ב־Node.
 * ===================================================================== */

import { compile } from './exprEval.js';

/** צעד "יפה" לשנתות: 1, 2 או 5 כפול חזקה של עשר */
export function niceStep(range, target = 6) {
    if (!(range > 0)) return 1;
    const raw = range / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const m = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return m * p;
}

export function niceTicks(min, max, target = 6) {
    const step = niceStep(max - min, target);
    const out = [];
    const start = Math.ceil(min / step - 1e-9) * step;
    for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    return { step, ticks: out };
}

/** שנתות לציר לוגריתמי: כל עשור, עם תוויות 10^k */
export function logTicks(min, max) {
    const out = [];
    for (let k = Math.floor(Math.log10(min)); k <= Math.ceil(Math.log10(max)); k++) {
        const v = Math.pow(10, k);
        if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
    }
    return out;
}

/** תווית קצרה לשנתה */
export function tickLabel(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) {
        const e = Math.floor(Math.log10(a));
        const m = v / Math.pow(10, e);
        return Math.abs(m - 1) < 1e-9 ? `10^${e}` : `${Number(m.toPrecision(3))}e${e}`;
    }
    return String(Number(v.toPrecision(6)));
}

/** רבעון של מערך ממוין — להתעלמות מקפיצות קיצוניות בטווח האוטומטי */
const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * דוגם רשימת פונקציות בטווח. מחזיר לכל פונקציה רשימת מקטעים רציפים,
 * ואת טווח ה־y שמתאים להציג — אוטומטי אם לא נקבע.
 */
export function samplePlot({ fns, xmin, xmax, ymin, ymax, logX = false, samples = 600, variable = 'x' }) {
    if (!(xmax > xmin)) throw new Error('טווח x לא תקין');
    if (logX && !(xmin > 0)) throw new Error('בציר לוגריתמי x חייב להיות חיובי');
    const compiled = fns.map((src) => compile(src, [variable]));
    const xs = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        xs.push(logX ? Math.pow(10, Math.log10(xmin) + t * (Math.log10(xmax) - Math.log10(xmin))) : xmin + t * (xmax - xmin));
    }
    const series = compiled.map((f) => xs.map((x) => { const y = f(x); return Number.isFinite(y) ? y : NaN; }));

    let lo = ymin, hi = ymax;
    if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)) {
        const all = series.flat().filter(Number.isFinite).sort((a, b) => a - b);
        if (!all.length) { lo = -1; hi = 1; }
        else {
            lo = quantile(all, 0.02); hi = quantile(all, 0.98);
            const full = [all[0], all[all.length - 1]];
            /* אם אין זנבות קיצוניים, מציגים את הטווח המלא */
            if (full[1] - full[0] < (hi - lo) * 3) { lo = full[0]; hi = full[1]; }
            if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
            const pad = (hi - lo) * 0.08;
            lo -= pad; hi += pad;
        }
    }
    const span = hi - lo;

    /* פיצול במקומות שבהם הפונקציה לא מוגדרת, או קופצת יותר מגובה הגרף */
    const segments = series.map((ys) => {
        const segs = [];
        let cur = [];
        for (let i = 0; i < xs.length; i++) {
            const y = ys[i];
            const prev = i > 0 ? ys[i - 1] : NaN;
            const jump = Number.isFinite(prev) && Number.isFinite(y) && Math.abs(y - prev) > span * 1.2;
            if (!Number.isFinite(y) || jump) {
                if (cur.length > 1) segs.push(cur);
                cur = Number.isFinite(y) ? [{ x: xs[i], y }] : [];
                continue;
            }
            cur.push({ x: xs[i], y });
        }
        if (cur.length > 1) segs.push(cur);
        return segs;
    });
    return { xmin, xmax, ymin: lo, ymax: hi, logX, segments };
}
