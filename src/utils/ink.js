/**
 * מנוע דיו רגיש ללחץ ולהטיה.
 *
 * Fabric מצייר נתיב ברוחב קו אחיד, ולכן דיו בעל אופי אמיתי לא יכול להיבנות
 * כ־stroke. במקום זה נבנה כאן מתאר סגור — רצועה שרוחבה משתנה לאורך המשיכה —
 * וממלאים אותו בצבע. כך מתקבל עיבוי בלחיצה חזקה ודילול בהרמה, בדיוק כמו עט.
 *
 * המודול טהור: אין בו React, אין Fabric, ואפשר לבדוק אותו ב־Node.
 *
 * זרימת העבודה:
 *   const stroke = createInkStroke({ baseWidth: 3 });
 *   stroke.push(samplePointer(e, x, y));   // בכל pointermove
 *   stroke.toPathData();                   // בהרמה, לבניית fabric.Path
 *
 * push מחזיר את המצולע הקטן שנוסף בצעד האחרון, כדי שהתצוגה החיה תצייר
 * רק אותו במקום לחשב מחדש את כל המשיכה בכל תזוזה.
 */

export const INK_DEFAULTS = {
    baseWidth: 3,
    minRatio: 0.38,        // רוחב מזערי ביחס לרוחב הבסיס
    maxRatio: 1.60,        // רוחב מרבי ביחס לרוחב הבסיס
    smoothing: 0.28,       // מקדם ממוצע נע מעריכי על אות הלחץ
    posSmoothing: 0.45,    // החלקת מיקום קלה נגד רעידות יד
    maxWidthDelta: 0.20,   // שינוי רוחב מרבי בין דגימות, ביחס לרוחב הבסיס
    tiltInfluence: 0.40,   // כמה הטיית העט מרחיבה את הקו
    velocityRef: 2.2,      // מהירות במרחב הקנבס שמעליה הקו מידלדל
    taperLength: 7,        // אורך הדעיכה בקצוות
    taperFloor: 0.28,      // הרוחב היחסי בקצה ממש
    minDist: 0.55,         // מרחק מזערי בין דגימות שנשמרות
    capSamples: 7,         // דגימות בכל קצה מעוגל
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (v) => Math.round(v * 100) / 100;

/**
 * ממיר אירוע מצביע לדגימת דיו. x ו־y הם כבר במרחב הקנבס.
 * שומרים גם לחץ, הטיה, זמן וסוג מצביע, כי הרוחב נגזר מכולם.
 */
export const samplePointer = (e, x, y) => ({
    x,
    y,
    p: typeof e?.pressure === 'number' ? e.pressure : 0,
    tx: typeof e?.tiltX === 'number' ? e.tiltX : 0,
    ty: typeof e?.tiltY === 'number' ? e.tiltY : 0,
    t: typeof e?.timeStamp === 'number' ? e.timeStamp : Date.now(),
    pen: e?.pointerType === 'pen',
});

/**
 * האם הדגימה נושאת לחץ אמיתי.
 * עכבר מדווח בדיוק 0.5 כל עוד הכפתור לחוץ, ומגע מדווח 0 או 1 קבוע, ולכן
 * רק עט עם ערך שאינו אחד משני אלה נחשב מקור לחץ.
 */
const hasRealPressure = (pt) => pt.pen && pt.p > 0.001 && Math.abs(pt.p - 0.5) > 0.004 && pt.p < 0.999;

/**
 * הטיית העט מרחיבה את הקו, כמו חוד רחב שנשכב על הנייר.
 * hypot של שתי ההטיות נותן את הסטייה מהניצב במעלות.
 */
const tiltFactor = (pt, influence) => {
    const mag = Math.min(90, Math.hypot(pt.tx || 0, pt.ty || 0));
    if (mag < 1) return 1;
    return 1 + influence * Math.pow(mag / 90, 1.5);
};

/**
 * משיכת דיו חיה. צוברת דגימות, מחליקה אותן, וגוזרת חצי־רוחב לכל נקודה.
 * כל החישוב סיבתי — נשען רק על העבר — כדי שהתצוגה החיה והנתיב הסופי
 * ייראו זהים לחלוטין.
 */
export const createInkStroke = (options = {}) => {
    const cfg = { ...INK_DEFAULTS, ...options };
    const half = cfg.baseWidth / 2;
    const minHalf = half * cfg.minRatio;
    const maxHalf = half * cfg.maxRatio;
    const maxStep = half * cfg.maxWidthDelta;

    /** נקודות מוחלקות עם חצי־רוחב לכל אחת */
    const pts = [];
    /** הנקודות הגולמיות, לשימוש מנוע זיהוי הצורות */
    const raw = [];

    let prevRaw = null;
    let force = null;       // אות הלחץ המוחלק, 0..1
    let lastHalf = null;
    let length = 0;

    /** גוזר ערך לחץ 0..1 מדגימה בודדת, עם נפילה למהירות כשאין חיישן */
    const rawForce = (pt) => {
        if (hasRealPressure(pt)) return clamp(pt.p, 0.02, 1);
        if (!prevRaw) return 0.62;
        const dist = Math.hypot(pt.x - prevRaw.x, pt.y - prevRaw.y);
        const dt = Math.max(1, (pt.t || 0) - (prevRaw.t || 0));
        // כשחותמות הזמן חסרות או זהות, המרחק לדגימה משמש כמדד מהירות
        const speed = dt > 1 ? dist / dt : dist / 8;
        return clamp(1 - Math.pow(clamp(speed / cfg.velocityRef, 0, 1), 0.8), 0.18, 1) * 0.92;
    };

    const push = (pt) => {
        raw.push(pt);

        // דילול דגימות צפופות מדי, שרק מוסיפות רעש לנורמל
        if (prevRaw) {
            const d = Math.hypot(pt.x - prevRaw.x, pt.y - prevRaw.y);
            if (d < cfg.minDist && pts.length > 1) return null;
            length += d;
        }

        const f = rawForce(pt);
        force = force === null ? f : force + (f - force) * cfg.smoothing;
        prevRaw = pt;

        // החלקת מיקום קלה — מוציאה רעידת יד בלי לטשטש פינות של כתב יד
        const last = pts[pts.length - 1];
        const x = last ? last.x + (pt.x - last.x) * (1 - cfg.posSmoothing * 0.5) : pt.x;
        const y = last ? last.y + (pt.y - last.y) * (1 - cfg.posSmoothing * 0.5) : pt.y;

        let h = clamp(minHalf + (maxHalf - minHalf) * force, minHalf, maxHalf) * tiltFactor(pt, cfg.tiltInfluence);
        // הגבלת קצב שינוי — מונעת קפיצות רוחב כשחיישן הלחץ רועש
        if (lastHalf !== null) h = clamp(h, lastHalf - maxStep, lastHalf + maxStep);
        lastHalf = h;

        const node = { x, y, h, d: length };
        pts.push(node);

        if (pts.length < 2) return null;
        const a = pts[pts.length - 2];
        const off = offsets(a, node);
        return off ? { quad: off, tip: { x: node.x, y: node.y, r: node.h } } : null;
    };

    /** ארבע פינות הרצועה בין שתי נקודות עוקבות */
    const offsets = (a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return null;
        const nx = -dy / len, ny = dx / len;
        return [
            { x: a.x + nx * a.h, y: a.y + ny * a.h },
            { x: b.x + nx * b.h, y: b.y + ny * b.h },
            { x: b.x - nx * b.h, y: b.y - ny * b.h },
            { x: a.x - nx * a.h, y: a.y - ny * a.h },
        ];
    };

    /**
     * דעיכה בקצוות — הקו נכנס ויוצא דק, כמו חוד שנוגע ועוזב את הנייר.
     * מוחלת רק בבנייה הסופית, כדי שהתצוגה החיה לא תשנה רוחב לאחור.
     */
    const tapered = () => {
        const total = pts[pts.length - 1].d || 0;
        if (total <= 0) return pts;
        return pts.map((n) => {
            const dStart = n.d;
            const dEnd = total - n.d;
            const near = Math.min(dStart, dEnd);
            if (near >= cfg.taperLength) return n;
            const k = cfg.taperFloor + (1 - cfg.taperFloor) * Math.pow(near / cfg.taperLength, 0.55);
            return { ...n, h: n.h * k };
        });
    };

    /** נורמל מוחלק לכל נקודה, מהפרש מרכזי — נותן מתאר רציף בפינות */
    const normals = (nodes) => nodes.map((n, i) => {
        const a = nodes[Math.max(0, i - 1)];
        const b = nodes[Math.min(nodes.length - 1, i + 1)];
        let dx = b.x - a.x, dy = b.y - a.y;
        let len = Math.hypot(dx, dy);
        if (len < 1e-6) {
            const c = nodes[Math.min(nodes.length - 1, i + 2)] || b;
            dx = c.x - n.x; dy = c.y - n.y; len = Math.hypot(dx, dy) || 1;
        }
        return { x: -dy / len, y: dx / len };
    });

    const toPathData = () => {
        if (pts.length === 0) return '';
        if (pts.length === 1 || (pts[pts.length - 1].d || 0) < cfg.minDist) {
            // נקירה קצרה — נקודה עגולה, לא רצועה
            const n = pts[0];
            return dotPath(n.x, n.y, Math.max(minHalf, n.h * 0.9));
        }

        const nodes = tapered();
        const nrm = normals(nodes);
        const left = nodes.map((n, i) => ({ x: n.x + nrm[i].x * n.h, y: n.y + nrm[i].y * n.h }));
        const right = nodes.map((n, i) => ({ x: n.x - nrm[i].x * n.h, y: n.y - nrm[i].y * n.h }));

        const last = nodes[nodes.length - 1];
        const first = nodes[0];
        const outline = [
            ...left,
            ...capArc(last, nrm[nrm.length - 1], cfg.capSamples),
            ...right.reverse(),
            ...capArc(first, { x: -nrm[0].x, y: -nrm[0].y }, cfg.capSamples),
        ];

        return closedSmoothPath(outline);
    };

    return {
        push,
        toPathData,
        get rawPoints() { return raw; },
        get nodes() { return pts; },
        get length() { return length; },
        get count() { return pts.length; },
        get isEmpty() { return pts.length === 0; },
    };
};

/** חצי מעגל סביב קצה המשיכה, מהצד השמאלי אל הימני */
const capArc = (node, n, samples) => {
    const out = [];
    const start = Math.atan2(n.y, n.x);
    for (let i = 1; i < samples; i++) {
        const a = start - (Math.PI * i) / samples;
        out.push({ x: node.x + Math.cos(a) * node.h, y: node.y + Math.sin(a) * node.h });
    }
    return out;
};

/** נקודת דיו בודדת, כשהעט רק נקר במסך */
export const dotPath = (x, y, r) => {
    const k = r * 0.5523;
    return `M ${rnd(x - r)} ${rnd(y)} `
        + `C ${rnd(x - r)} ${rnd(y - k)} ${rnd(x - k)} ${rnd(y - r)} ${rnd(x)} ${rnd(y - r)} `
        + `C ${rnd(x + k)} ${rnd(y - r)} ${rnd(x + r)} ${rnd(y - k)} ${rnd(x + r)} ${rnd(y)} `
        + `C ${rnd(x + r)} ${rnd(y + k)} ${rnd(x + k)} ${rnd(y + r)} ${rnd(x)} ${rnd(y + r)} `
        + `C ${rnd(x - k)} ${rnd(y + r)} ${rnd(x - r)} ${rnd(y + k)} ${rnd(x - r)} ${rnd(y)} Z`;
};

/**
 * מתאר סגור כעקומות בזייה, בשיטת Catmull-Rom.
 * הפלט קצר בהרבה מרצף קטעים ישרים, ונראה חלק בכל רמת זום.
 */
export const closedSmoothPath = (points) => {
    const p = dedupeRing(points);
    const n = p.length;
    if (n < 3) return '';
    let d = `M ${rnd(p[0].x)} ${rnd(p[0].y)}`;
    for (let i = 0; i < n; i++) {
        const p0 = p[(i - 1 + n) % n];
        const p1 = p[i];
        const p2 = p[(i + 1) % n];
        const p3 = p[(i + 2) % n];
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${rnd(c1x)} ${rnd(c1y)} ${rnd(c2x)} ${rnd(c2y)} ${rnd(p2.x)} ${rnd(p2.y)}`;
    }
    return d + ' Z';
};

const dedupeRing = (points) => {
    const out = [];
    for (const q of points) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 0.12) out.push(q);
    }
    while (out.length > 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 0.12) out.pop();
    return out;
};

/**
 * בונה נתיב דיו שלם מרשימת דגימות, בלי מצב ביניים.
 * משמש בטעינת קבצים ישנים ובבדיקות.
 */
export const buildPressurePath = (samples, options = {}) => {
    const stroke = createInkStroke(options);
    for (const s of samples) stroke.push(s.p !== undefined ? s : { ...s, p: 0, tx: 0, ty: 0, t: 0, pen: false });
    return stroke.toPathData();
};

/**
 * מצייר את הקטע האחרון של המשיכה על קנבס התצוגה החיה.
 * step הוא הערך ש־push החזיר, toScreen ממיר ממרחב הקנבס למרחב המסך,
 * ו־zoom נחוץ כדי לתרגם גם את הרדיוס ולא רק את המיקום.
 */
export const paintInkStep = (ctx, step, toScreen, color, zoom = 1) => {
    if (!step) return;
    const q = step.quad.map(toScreen);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    ctx.fill();
    // עיגול המפרק, כדי שלא ייווצרו חריצים בין קטעים בזווית חדה
    const tip = toScreen(step.tip);
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, Math.max(0.3, step.tip.r * zoom), 0, Math.PI * 2);
    ctx.fill();
};
