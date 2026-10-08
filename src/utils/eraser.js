/* =====================================================================
 * eraser.js — הגיאומטריה של מחק חלקי
 * ---------------------------------------------------------------------
 * מחק "פיקסלים" על לוח וקטורי לא באמת מוחק פיקסלים: הוא חותך את קו
 * האמצע של כל משיכה שהוא עובר עליה, ומחזיר את החלקים שנשארו. כל חלק
 * נבנה מחדש כאובייקט נפרד, כך שהתוצאה נשארת וקטורית, חדה בכל זום,
 * וניתנת לבחירה ולהזזה כמו כל משיכה אחרת.
 *
 * המודול טהור, בלי Fabric, ולכן נבדק ב־Node.
 * ===================================================================== */

const segDist = (p, a, b) => {
    const abx = b.x - a.x, aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
};

/**
 * צפיפות נקודות מספקת לחיתוך מדויק. צלע של מלבן היא שתי נקודות בלבד,
 * ובלי ציפוף המחק היה מוחק את כולה או לא נוגע בה בכלל.
 */
export function densify(points, step, closed = false) {
    if (!points || points.length < 2 || !(step > 0)) return points ? points.map((p) => ({ ...p })) : [];
    const src = closed ? [...points, points[0]] : points;
    const out = [{ ...src[0] }];
    for (let i = 1; i < src.length; i++) {
        const a = src[i - 1], b = src[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(len / step));
        for (let k = 1; k <= n; k++) {
            const t = k / n;
            out.push({
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                h: a.h !== undefined && b.h !== undefined ? a.h + (b.h - a.h) * t : (a.h ?? b.h),
            });
        }
    }
    if (closed) out.pop();
    return out;
}

const runLength = (pts) => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
};

/**
 * חותך קו אמצע לפי מסלול המחק.
 *
 * points    — נקודות קו האמצע, כל אחת עם h אופציונלי (חצי רוחב הקו)
 * eraser    — קטעי תנועת המחק, [{a, b}]
 * radius    — רדיוס המחק, באותן יחידות
 *
 * מחזיר null אם המחק לא נגע בקו כלל. אחרת מחזיר את רשימת החלקים
 * ששרדו; כל חלק יודע אם כל אחד מקצותיו הוא חתך או קצה מקורי, כדי
 * שהבנייה מחדש תדע איפה לשים דעיכה ואיפה לחתוך ישר.
 */
export function erasePolyline(points, eraser, radius, opts = {}) {
    const { closed = false, minRunLength = 0, widthFactor = 0.6 } = opts;
    const n = points.length;
    if (n === 0 || !eraser || eraser.length === 0) return null;

    const hit = new Array(n).fill(false);
    let any = false;
    for (let i = 0; i < n; i++) {
        const p = points[i];
        const reach = radius + (p.h || 0) * widthFactor;
        for (const s of eraser) {
            if (segDist(p, s.a, s.b) <= reach) { hit[i] = true; any = true; break; }
        }
    }
    if (!any) return null;

    let runs = [];
    let cur = null;
    for (let i = 0; i < n; i++) {
        if (!hit[i]) {
            if (!cur) cur = { points: [], startCut: i > 0, endCut: false, startIndex: i };
            cur.points.push(points[i]);
        } else if (cur) {
            cur.endCut = true;
            runs.push(cur);
            cur = null;
        }
    }
    if (cur) { cur.endCut = false; runs.push(cur); }

    /* בצורה סגורה החלק האחרון והראשון הם בעצם חלק אחד שעובר דרך נקודת ההתחלה */
    if (closed && runs.length > 1 && !hit[0] && !hit[n - 1]) {
        const last = runs.pop();
        const first = runs.shift();
        runs.unshift({ points: [...last.points, ...first.points], startCut: true, endCut: true, startIndex: last.startIndex });
    } else if (closed) {
        for (const r of runs) { r.startCut = true; r.endCut = true; }
    }

    runs = runs.filter((r) => r.points.length >= 2 && runLength(r.points) >= minRunLength);
    return runs;
}

/** תיבה תוחמת של קטעי מחק, מורחבת ברדיוס — סינון זול לפני הבדיקה המדויקת */
export function eraserBounds(eraser, radius) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of eraser) {
        for (const p of [s.a, s.b]) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
    }
    return { left: minX - radius, top: minY - radius, right: maxX + radius, bottom: maxY + radius };
}
