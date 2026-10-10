/* =====================================================================
 * scribble.js — זיהוי קישקוש מחיקה
 * ---------------------------------------------------------------------
 * משיכה קצרה וצפופה שהולכת הלוך וחזור שוב ושוב, כמו מי שמקשקש על מילה
 * כדי למחוק אותה. הזיהוי נעשה בפיקסלי מסך, כדי שלא יהיה תלוי בזום.
 * המודול טהור, ללא React וללא Fabric.
 * ===================================================================== */

/**
 * pts הם נקודות המשיכה בפיקסלי מסך. מחזיר { reversals, bbox } כשהמשיכה
 * נראית כמו קישקוש מחיקה, ואחרת null.
 */
export const detectScribble = (pts, opts = {}) => {
    const { minReversals = 4, minRatio = 3.2, minSize = 18, maxSize = 520, step = 7 } = opts;
    if (!pts || pts.length < 10) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, length = 0;
    for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
        if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
        if (i) length += Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y);
    }
    const diag = Math.hypot(maxX - minX, maxY - minY);
    if (diag < minSize || diag > maxSize || length / diag < minRatio) return null;

    // דגימה מחדש לקטעים של כמה פיקסלים, ואז ספירת היפוכי כיוון חדים
    const res = [pts[0]];
    for (const q of pts) {
        const l = res[res.length - 1];
        if (Math.hypot(q.x - l.x, q.y - l.y) >= step) res.push(q);
    }
    // משווים כל קטע לקטע שלפני שניים, כדי שגם פנייה חדה וגם פנייה עם קפיצה
    // קטנה הצידה ייספרו, ודולגים אחרי כל היפוך כדי לא לספור אותו פעמיים
    const vs = [];
    for (let i = 1; i < res.length; i++) vs.push({ x: res[i].x - res[i - 1].x, y: res[i].y - res[i - 1].y });
    let reversals = 0;
    for (let i = 2; i < vs.length; i++) {
        const a = vs[i], b = vs[i - 2];
        if (a.x * b.x + a.y * b.y < -0.5 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) { reversals++; i += 2; }
    }
    if (reversals < minReversals) return null;
    return { reversals, bbox: { left: minX, top: minY, width: maxX - minX, height: maxY - minY } };
};
