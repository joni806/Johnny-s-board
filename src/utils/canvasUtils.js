import * as fabricPkg from 'fabric';
import { densify, erasePolyline } from './eraser.js';
import { outlinePath, unflattenNodes, flattenNodes } from './ink.js';
import { PEN_KINDS, dashArrayFor } from './pens.js';
const fabric = fabricPkg.fabric || fabricPkg;

/**
 * המאפיינים הנוספים שכל אובייקט נושא מעבר לשל Fabric. הרשימה משמשת גם
 * לשמירה וגם להעתקה — בלי זה עותק של משיכה היה מאבד את קו האמצע שלו,
 * ומחק חלקי לא היה עובד עליו.
 */
export const EXTRA_PROPS = [
    'customType', 'inkFilled', 'inkNodes', 'penKind', 'mathInk', 'recTime', 'recId',
    'stampId', 'headLength', 'wire', 'plotSpec', 'dashStyle',
];

/** סוג האובייקט באותיות קטנות. ב־Fabric 7 השם בזמן ריצה הוא באותיות קטנות, ובקובץ השמור — לא */
export const typeOf = (obj) => String(obj?.type || '').toLowerCase();

export const createGridGroup = (cols, rows, color) => {
    const cellSize = 40;
    const width = cols * cellSize;
    const height = rows * cellSize;
    const objects = [];

    for (let i = 0; i <= cols; i++) objects.push(new fabric.Line([i * cellSize, 0, i * cellSize, height], { stroke: 'rgba(255,255,255,0.1)', selectable: false }));
    for (let i = 0; i <= rows; i++) objects.push(new fabric.Line([0, i * cellSize, width, i * cellSize], { stroke: 'rgba(255,255,255,0.1)', selectable: false }));

    const centerX = Math.floor(cols / 2) * cellSize;
    const centerY = Math.floor(rows / 2) * cellSize;

    const xAxis = new fabric.Line([0, centerY, width, centerY], { stroke: color, strokeWidth: 2, selectable: false });
    const yAxis = new fabric.Line([centerX, 0, centerX, height], { stroke: color, strokeWidth: 2, selectable: false });
    objects.push(xAxis, yAxis);

    const arrowSize = 10;
    const xArrow = new fabric.Path(`M ${width} ${centerY} L ${width-arrowSize} ${centerY-arrowSize} M ${width} ${centerY} L ${width-arrowSize} ${centerY+arrowSize}`, { stroke: color, strokeWidth: 2, fill: '', selectable: false });
    const yArrow = new fabric.Path(`M ${centerX} 0 L ${centerX-arrowSize} ${arrowSize} M ${centerX} 0 L ${centerX+arrowSize} ${arrowSize}`, { stroke: color, strokeWidth: 2, fill: '', selectable: false });
    
    objects.push(xArrow, yArrow);
    return new fabric.Group(objects, { selectable: true });
};

const createRegularPolygon = (sides, radius) => {
    const points = [];
    for (let i = 0; i < sides; i++) {
        const angle = (i * 2 * Math.PI / sides) - (Math.PI / 2);
        points.push({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
    }
    return points;
};

const createStarPolygon = (pointsNum, outerRadius, innerRadius) => {
    const points = [];
    for (let i = 0; i < pointsNum * 2; i++) {
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const angle = (i * Math.PI / pointsNum) - (Math.PI / 2);
        points.push({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
    }
    return points;
};

export const createShape = (type, color, center, strokeWidth = 3) => {
    let obj = null;
    const commonProps = { fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: strokeWidth, originX: 'center', originY: 'center', left: center.x, top: center.y };
    const pathProps = { ...commonProps, fill: 'transparent' };

    switch(type) {
        case 'rect': obj = new fabric.Rect({ ...commonProps, width: 100, height: 100 }); break;
        case 'circle': obj = new fabric.Circle({ ...commonProps, radius: 50 }); break;
        case 'ellipse': obj = new fabric.Ellipse({ ...commonProps, rx: 70, ry: 40 }); break;
        case 'half-circle': obj = new fabric.Path("M 0 50 A 50 50 0 0 1 100 50 Z", commonProps); break;
        
        case 'triangle': obj = new fabric.Polygon([{x:50,y:0},{x:100,y:100},{x:0,y:100}], commonProps); break;
        case 'right-triangle': obj = new fabric.Polygon([{x:0,y:0},{x:0,y:100},{x:100,y:100}], commonProps); break;
        case 'diamond': obj = new fabric.Polygon([{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:0,y:50}], commonProps); break;
        case 'pentagon': obj = new fabric.Polygon(createRegularPolygon(5, 50), commonProps); break;
        case 'hexagon': obj = new fabric.Polygon(createRegularPolygon(6, 50), commonProps); break;
        case 'heptagon': obj = new fabric.Polygon(createRegularPolygon(7, 50), commonProps); break;
        case 'octagon': obj = new fabric.Polygon(createRegularPolygon(8, 50), commonProps); break;
        case 'decagon': obj = new fabric.Polygon(createRegularPolygon(10, 50), commonProps); break;
        case 'parallelogram': obj = new fabric.Polygon([{x:25,y:0},{x:100,y:0},{x:75,y:100},{x:0,y:100}], commonProps); break;
        case 'trapezoid': obj = new fabric.Polygon([{x:25,y:0},{x:75,y:0},{x:100,y:100},{x:0,y:100}], commonProps); break;
        
        case 'star-4': obj = new fabric.Polygon(createStarPolygon(4, 50, 20), commonProps); break;
        case 'star-5': obj = new fabric.Polygon(createStarPolygon(5, 50, 20), commonProps); break;
        case 'star-6': obj = new fabric.Polygon(createStarPolygon(6, 50, 25), commonProps); break;

        case 'arrow-right': obj = new fabric.Polygon([{x:0,y:33},{x:50,y:33},{x:50,y:0},{x:100,y:50},{x:50,y:100},{x:50,y:66},{x:0,y:66}], commonProps); break;
        case 'arrow-left': obj = new fabric.Polygon([{x:100,y:33},{x:50,y:33},{x:50,y:0},{x:0,y:50},{x:50,y:100},{x:50,y:66},{x:100,y:66}], commonProps); break;
        case 'arrow-up': obj = new fabric.Polygon([{x:33,y:100},{x:33,y:50},{x:0,y:50},{x:50,y:0},{x:100,y:50},{x:66,y:50},{x:66,y:100}], commonProps); break;
        case 'arrow-down': obj = new fabric.Polygon([{x:33,y:0},{x:33,y:50},{x:0,y:50},{x:50,y:100},{x:100,y:50},{x:66,y:50},{x:66,y:0}], commonProps); break;
        
        case 'math-plus': obj = new fabric.Polygon([{x:35,y:0},{x:65,y:0},{x:65,y:35},{x:100,y:35},{x:100,y:65},{x:65,y:65},{x:65,y:100},{x:35,y:100},{x:35,y:65},{x:0,y:65},{x:0,y:35},{x:35,y:35}], commonProps); break;
        case 'math-minus': obj = new fabric.Rect({ ...commonProps, width: 100, height: 30 }); break;
        case 'math-multiply': obj = new fabric.Polygon([{x:20,y:0},{x:50,y:30},{x:80,y:0},{x:100,y:20},{x:70,y:50},{x:100,y:80},{x:80,y:100},{x:50,y:70},{x:20,y:100},{x:0,y:80},{x:30,y:50},{x:0,y:20}], commonProps); break;

        case 'heart': obj = new fabric.Path("M 50 30 A 20 20 0 0 1 90 30 Q 90 60 50 90 Q 10 60 10 30 A 20 20 0 0 1 50 30 z", commonProps); break;
        case 'cylinder': obj = new fabric.Path("M 0 20 A 50 20 0 0 0 100 20 A 50 20 0 0 0 0 20 M 0 20 L 0 80 A 50 20 0 0 0 100 80 L 100 20", pathProps); break;
        case 'cube': obj = new fabric.Path("M 0 30 L 70 30 L 100 0 L 30 0 Z M 70 30 L 70 100 L 100 70 L 100 0 Z M 0 30 L 0 100 L 70 100 L 70 30 Z", pathProps); break;
        case 'lightning': obj = new fabric.Polygon([{x:60,y:0},{x:10,y:60},{x:50,y:60},{x:30,y:100},{x:90,y:40},{x:50,y:40}], commonProps); break;
        case 'moon': obj = new fabric.Path("M 50 0 A 50 50 0 1 0 100 50 A 40 40 0 1 1 50 0 Z", commonProps); break;
        case 'cloud': obj = new fabric.Path("M 25 60 A 20 20 0 0 1 25 20 A 25 25 0 0 1 75 20 A 20 20 0 0 1 75 60 Z", commonProps); break;
        case 'speech-bubble': obj = new fabric.Polygon([{x:0,y:0},{x:100,y:0},{x:100,y:70},{x:70,y:70},{x:30,y:100},{x:30,y:70},{x:0,y:70}], commonProps); break;

        default: break;
    }

    if (obj) {
        obj.customType = type; 
        obj.scale(1.5);
    }
    return obj;
};
/* =====================================================================
 * בניית אובייקטי Fabric מתוצאות מנוע הזיהוי, ובדיקת פגיעה מדויקת למחק
 * ===================================================================== */

/** מילוי כמעט שקוף בצורות סגורות, כדי שאפשר יהיה ללחוץ עליהן מבפנים */
export const SHAPE_FILL = 'rgba(255, 255, 255, 0.01)';

const rnd2 = (v) => Math.round(v * 100) / 100;

/** קשת כשרשרת עקומות בזייה מעוקבות — עד תשעים מעלות לכל מקטע */
export const arcToPathData = (cx, cy, r, startAngle, sweep) => {
    const segments = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
    const step = sweep / segments;
    const at = (a) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    let a0 = startAngle;
    const p0 = at(a0);
    let d = `M ${rnd2(p0.x)} ${rnd2(p0.y)}`;
    for (let i = 0; i < segments; i++) {
        const a1 = a0 + step;
        const k = (4 / 3) * Math.tan((a1 - a0) / 4);
        const s = at(a0);
        const e = at(a1);
        const c1 = { x: s.x - k * r * Math.sin(a0), y: s.y + k * r * Math.cos(a0) };
        const c2 = { x: e.x + k * r * Math.sin(a1), y: e.y - k * r * Math.cos(a1) };
        d += ` C ${rnd2(c1.x)} ${rnd2(c1.y)} ${rnd2(c2.x)} ${rnd2(c2.y)} ${rnd2(e.x)} ${rnd2(e.y)}`;
        a0 = a1;
    }
    return d;
};

/** חץ — מבנה הנתיב נשמר זהה לגרסה הקודמת כדי שעריכת הקודקודים תמשיך לעבוד */
export const buildArrowObject = (start, end, color, strokeWidth, headLength) => {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const shaft = Math.hypot(end.x - start.x, end.y - start.y);
    const head = Math.max(8, Math.min(headLength || shaft * 0.22, shaft * 0.45));
    const d =
        `M ${start.x} ${start.y} L ${end.x} ${end.y}` +
        ` L ${end.x - head * Math.cos(angle - Math.PI / 6)} ${end.y - head * Math.sin(angle - Math.PI / 6)}` +
        ` M ${end.x} ${end.y}` +
        ` L ${end.x - head * Math.cos(angle + Math.PI / 6)} ${end.y - head * Math.sin(angle + Math.PI / 6)}`;
    const obj = new fabric.Path(d, {
        fill: 'transparent', stroke: color, strokeWidth,
        strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true,
    });
    obj.customType = 'arrow';
    obj.headLength = head;
    return obj;
};

/**
 * הופך תוצאת זיהוי לאובייקט Fabric.
 * מלבן מסובב ומצולע נבנים שניהם כ-Polygon, ולכן עריכת הקודקודים הקיימת
 * עובדת עליהם מיד ובלי קוד ייעודי.
 */
export const buildRecognizedShape = (result, color, strokeWidth) => {
    const stroke = {
        stroke: color, strokeWidth,
        strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true,
    };
    let obj;

    switch (result.type) {
        case 'line':
            obj = new fabric.Line(
                [result.start.x, result.start.y, result.end.x, result.end.y],
                { ...stroke, hasControls: true }
            );
            obj.customType = 'line';
            break;

        case 'arrow':
            obj = buildArrowObject(result.start, result.end, color, strokeWidth, result.headLength);
            break;

        case 'curve':
            obj = new fabric.Path(
                `M ${result.start.x} ${result.start.y} Q ${result.cp.x} ${result.cp.y} ${result.end.x} ${result.end.y}`,
                { ...stroke, fill: 'transparent' }
            );
            obj.customType = 'curve';
            break;

        case 'arc':
            obj = new fabric.Path(
                arcToPathData(result.cx, result.cy, result.r, result.startAngle, result.sweep),
                { ...stroke, fill: 'transparent' }
            );
            obj.customType = 'arc';
            break;

        case 'circle':
            obj = new fabric.Ellipse({
                ...stroke, fill: SHAPE_FILL, originX: 'center', originY: 'center',
                left: result.cx, top: result.cy, rx: result.r, ry: result.r,
            });
            obj.customType = 'ellipse';
            break;

        case 'ellipse':
            obj = new fabric.Ellipse({
                ...stroke, fill: SHAPE_FILL, originX: 'center', originY: 'center',
                left: result.cx, top: result.cy, rx: result.rx, ry: result.ry,
                angle: (result.angle || 0) * 180 / Math.PI,
            });
            obj.customType = 'ellipse';
            break;

        case 'rect': {
            if (Math.abs(result.angle || 0) < 1e-6) {
                obj = new fabric.Rect({
                    ...stroke, fill: SHAPE_FILL, originX: 'center', originY: 'center',
                    left: result.cx, top: result.cy, width: result.width, height: result.height,
                });
                obj.customType = 'rect';
            } else {
                const ang = result.angle;
                const hw = result.width / 2, hh = result.height / 2;
                const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({
                    x: result.cx + x * Math.cos(ang) - y * Math.sin(ang),
                    y: result.cy + x * Math.sin(ang) + y * Math.cos(ang),
                }));
                obj = new fabric.Polygon(pts, { ...stroke, fill: SHAPE_FILL });
                obj.customType = 'polygon';
            }
            break;
        }

        case 'polygon':
            obj = new fabric.Polygon(result.points.map((p) => ({ x: p.x, y: p.y })), {
                ...stroke, fill: SHAPE_FILL,
            });
            obj.customType = 'polygon';
            break;

        case 'polyline':
            obj = new fabric.Polyline(result.points.map((p) => ({ x: p.x, y: p.y })), {
                ...stroke, fill: 'transparent',
            });
            obj.customType = 'polyline';
            break;

        default:
            return null;
    }
    return obj;
};

/* ── בדיקת פגיעה מדויקת עבור המחק ─────────────────────────────────── */

const sampleCubic = (p0, c1, c2, p1, steps, out) => {
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        out.push({
            x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
            y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
        });
    }
};

const sampleQuad = (p0, c, p1, steps, out) => {
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, u = 1 - t;
        out.push({
            x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
            y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
        });
    }
};

/** פריסת נתיב Fabric לתתי־מסלולים של נקודות, במרחב המקומי של האובייקט */
const flattenPathParts = (path) => {
    const parts = [];
    let out = null;
    let cur = { x: 0, y: 0 };
    let startPt = { x: 0, y: 0 };
    for (const cmd of path) {
        const op = cmd[0];
        if (op === 'M') {
            if (out && out.length) parts.push(out);
            out = [];
            cur = { x: cmd[1], y: cmd[2] }; startPt = cur; out.push(cur);
            continue;
        }
        if (!out) out = [cur];
        if (op === 'L') { cur = { x: cmd[1], y: cmd[2] }; out.push(cur); }
        else if (op === 'Q') {
            const p1 = { x: cmd[3], y: cmd[4] };
            sampleQuad(cur, { x: cmd[1], y: cmd[2] }, p1, 10, out);
            cur = p1;
        } else if (op === 'C') {
            const p1 = { x: cmd[5], y: cmd[6] };
            sampleCubic(cur, { x: cmd[1], y: cmd[2] }, { x: cmd[3], y: cmd[4] }, p1, 10, out);
            cur = p1;
        } else if (op === 'Z' || op === 'z') {
            out.push(startPt);
            cur = startPt;
        }
    }
    if (out && out.length) parts.push(out);
    return parts;
};

/**
 * קווי המתאר של אובייקט בקואורדינטות הלוח, כרשימה של קווים שבורים.
 * נתיב עם כמה תתי־מסלולים, כמו חץ, מחזיר קו לכל תת־מסלול, כדי שלא
 * ייווצר קטע מדומה בין סוף אחד לתחילת הבא.
 */
export const getOutlinePolylines = (obj) => {
    const m = obj.calcTransformMatrix();
    const off = obj.pathOffset || { x: 0, y: 0 };
    const toAbs = (p) => fabric.util.transformPoint(new fabric.Point(p.x - off.x, p.y - off.y), m);
    const t = typeOf(obj);

    if (t === 'polygon' || t === 'polyline' || obj.points) {
        const closed = t === 'polygon' || obj.customType === 'polygon';
        return [{ points: obj.points.map(toAbs), closed }];
    }
    if (t === 'path' && Array.isArray(obj.path)) {
        return flattenPathParts(obj.path).filter((pt) => pt.length > 0).map((pt) => ({ points: pt.map(toAbs), closed: false }));
    }
    if (t === 'line') {
        const lp = obj.calcLinePoints();
        return [{
            points: [
                fabric.util.transformPoint(new fabric.Point(lp.x1, lp.y1), m),
                fabric.util.transformPoint(new fabric.Point(lp.x2, lp.y2), m),
            ],
            closed: false,
        }];
    }
    if (t === 'rect') {
        const w = obj.width / 2, h = obj.height / 2;
        return [{ points: [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }].map((p) => fabric.util.transformPoint(new fabric.Point(p.x, p.y), m)), closed: true }];
    }
    if (t === 'ellipse' || t === 'circle') {
        const rx = obj.rx !== undefined ? obj.rx : obj.radius;
        const ry = obj.ry !== undefined ? obj.ry : obj.radius;
        const local = [];
        for (let i = 0; i < 64; i++) {
            const a = (i / 64) * Math.PI * 2;
            local.push(fabric.util.transformPoint(new fabric.Point(rx * Math.cos(a), ry * Math.sin(a)), m));
        }
        return [{ points: local, closed: true }];
    }
    return null;   // תמונות וקבוצות
};

/**
 * מתאר האובייקט בקואורדינטות הלוח. מוחזר כרשימת קטעים ולא כענן נקודות,
 * כדי שבדיקת המרחק תהיה מדויקת גם בצלע ארוכה שאין בה נקודות דגימה.
 */
export const getOutlineSegments = (obj) => {
    const lines = getOutlinePolylines(obj);
    if (!lines) return null;
    const segs = [];
    for (const { points, closed } of lines) {
        if (points.length === 1) segs.push([points[0], points[0]]);
        for (let i = 1; i < points.length; i++) segs.push([points[i - 1], points[i]]);
        if (closed && points.length > 2) segs.push([points[points.length - 1], points[0]]);
    }
    return segs.length ? segs : null;
};

const pointSegDist = (p, a, b) => {
    const abx = b.x - a.x, aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
};

/**
 * האם המחק נגע באובייקט.
 * הגרסה הקודמת בדקה חפיפה של תיבות תוחמות, ולכן מחיקה בפינה ריקה של משולש
 * גדול הייתה מוחקת את כל המשולש. כאן נבדק המרחק מקו המתאר עצמו.
 */
export const isObjectNearPoint = (obj, point, radius) => {
    const bounds = obj.getBoundingRect(true);
    if (point.x + radius < bounds.left || point.x - radius > bounds.left + bounds.width ||
        point.y + radius < bounds.top || point.y - radius > bounds.top + bounds.height) {
        return false;
    }
    const segs = getOutlineSegments(obj);
    if (!segs) return true;        // תמונה או קבוצה — התיבה התוחמת היא הקובעת
    const reach = radius + (obj.strokeWidth || 1) / 2;
    for (const [a, b] of segs) {
        if (pointSegDist(point, a, b) <= reach) return true;
    }
    return false;
};

/* ── מחק חלקי ─────────────────────────────────────────────────────── */

/** גורם קנה המידה של מטריצת הטרנספורם — כמה יחידת אורך מקומית שווה בלוח */
const matrixScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

/**
 * הגיאומטריה שהמחק החלקי עובד עליה: קו אמצע עם חצי רוחב לכל נקודה,
 * בקואורדינטות הלוח. מחזיר null לאובייקטים שאין להם קו אמצע —
 * תמונות, קבוצות, ודיו ישן שנשמר לפני שנשמר איתו קו האמצע.
 */
export const getEraseGeometry = (obj) => {
    if (!obj || obj.isEditHelper) return null;
    const t = typeOf(obj);
    if (t === 'group' || t === 'image' || t === 'activeselection' || t.includes('text')) return null;
    const m = obj.calcTransformMatrix();
    const k = matrixScale(m);

    if (obj.inkFilled) {
        const nodes = unflattenNodes(obj.inkNodes);
        if (nodes.length < 1) return null;
        const off = obj.pathOffset || { x: 0, y: 0 };
        const pts = nodes.map((n) => {
            const q = fabric.util.transformPoint(new fabric.Point(n.x - off.x, n.y - off.y), m);
            return { x: q.x, y: q.y, h: n.h * k };
        });
        return { mode: 'filled', lines: [{ points: pts, closed: false }], scale: k };
    }

    const lines = getOutlinePolylines(obj);
    if (!lines) return null;
    const h = ((obj.strokeWidth || 1) * k) / 2;
    return {
        mode: 'stroke',
        scale: k,
        lines: lines.map((l) => ({ points: l.points.map((p) => ({ x: p.x, y: p.y, h })), closed: l.closed })),
    };
};

/** קו שבור ישר כנתיב SVG */
const polyPathData = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${rnd2(p.x)} ${rnd2(p.y)}`).join(' ');

/**
 * בונה אובייקט Fabric לחלק אחד ששרד את המחק. החלק יורש את המראה של
 * המקור — צבע, אטימות, קווקוו, סוג העט — כדי שלא ייראה שונה מהשכן שלו.
 */
export const buildEraseFragment = (src, geom, run) => {
    if (geom.mode === 'filled') {
        const LEGACY_KIND = { fountain: 'pen', brush: 'pen', ball: 'lord' };   // לוחות ישנים
        const kind = PEN_KINDS[src.penKind] ? src.penKind : (LEGACY_KIND[src.penKind] || 'pen');
        const inkCfg = { ...(PEN_KINDS[kind].ink || {}) };
        const d = outlinePath(run.points, inkCfg, {
            taperStart: !run.startCut, taperEnd: !run.endCut,
            minHalf: Math.min(...run.points.map((p) => p.h)) * 0.8,
        });
        if (!d) return null;
        const obj = new fabric.Path(d, {
            fill: src.fill, stroke: null, strokeWidth: 0, opacity: src.opacity ?? 1,
            strokeLineJoin: 'round', selectable: true, objectCaching: false,
        });
        obj.customType = 'ink';
        obj.inkFilled = true;
        obj.penKind = src.penKind;
        obj.inkNodes = flattenNodes(run.points);
        if (src.recTime !== undefined) { obj.recTime = src.recTime; obj.recId = src.recId; }
        return obj;
    }
    const sw = (src.strokeWidth || 1) * geom.scale;
    const obj = new fabric.Path(polyPathData(run.points), {
        fill: '', stroke: src.stroke, strokeWidth: sw, opacity: src.opacity ?? 1,
        strokeLineCap: src.strokeLineCap || 'round', strokeLineJoin: 'round',
        strokeDashArray: src.dashStyle ? dashArrayFor(src.dashStyle, sw) : (src.strokeDashArray ? src.strokeDashArray.map((v) => v * geom.scale) : null),
        selectable: true, objectCaching: false,
    });
    obj.customType = 'ink';
    obj.penKind = src.penKind;
    obj.dashStyle = src.dashStyle;
    if (src.recTime !== undefined) { obj.recTime = src.recTime; obj.recId = src.recId; }
    return obj;
};

/**
 * מעביר אובייקט אחד במחק החלקי.
 * מחזיר null כשהמחק לא נגע בו, ואחרת רשימה של אובייקטים חדשים שמחליפים
 * אותו — ריקה אם כולו נמחק. eraser הוא רשימת קטעים {a, b} בקואורדינטות הלוח.
 */
export const eraseObjectPartially = (obj, eraser, radius) => {
    const geom = getEraseGeometry(obj);
    if (!geom) return undefined;      // אין קו אמצע — הקורא מחליט מה לעשות
    const step = Math.max(0.6, radius / 3);
    const pieces = [];
    let touched = false;
    for (const line of geom.lines) {
        const dense = densify(line.points, step, line.closed);
        const runs = erasePolyline(dense, eraser, radius, { closed: line.closed, minRunLength: Math.max(1, radius * 0.25) });
        if (runs === null) {
            pieces.push({ untouched: true, line, dense });
            continue;
        }
        touched = true;
        for (const run of runs) pieces.push({ run });
    }
    if (!touched) return null;
    const out = [];
    for (const p of pieces) {
        const run = p.run || { points: p.dense, startCut: false, endCut: false };
        if (p.untouched && p.line.closed) run.points = [...p.dense, p.dense[0]];
        const frag = buildEraseFragment(obj, geom, run);
        if (frag) out.push(frag);
    }
    return out;
};

/* ── סמלים מהספרייה ───────────────────────────────────────────────── */

/**
 * בונה סמל כקבוצה אחת: קווים בצבע העט, חלקים מלאים, ותוויות. קבוצה כדי
 * שהסמל יזוז, יסתובב ויימחק כיחידה אחת, כמו רכיב אמיתי.
 */
export const buildStamp = (stamp, color, strokeWidth = 2.2) => {
    const objs = stamp.parts.map((p) => {
        if (p.text) {
            return new fabric.Text(p.text, {
                left: p.x, top: p.y, originX: 'center', originY: 'center',
                fontSize: p.size || 18, fill: color, fontFamily: 'Cambria Math, Times New Roman, serif', fontStyle: 'italic',
            });
        }
        return new fabric.Path(p.d, {
            fill: p.fill ? color : '', stroke: color, strokeWidth: p.fill ? 0.6 : strokeWidth,
            strokeLineCap: 'round', strokeLineJoin: 'round', objectCaching: false,
        });
    });
    const g = new fabric.Group(objs, { subTargetCheck: false, objectCaching: false });
    g.customType = 'stamp';
    g.stampId = stamp.id;
    return g;
};

/* ── גרף פונקציה וקטורי ───────────────────────────────────────────── */

export const PLOT_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#c084fc', '#fb923c'];

/**
 * בונה גרף מתוצאת samplePlot. הגרף הוא קבוצה של קווים וטקסטים רגילים,
 * כדי שיישמר, יוזז וישוכפל כמו כל אובייקט אחר בלוח.
 */
export const buildPlotGroup = (sampled, spec, color, { width = 520, height = 340, ticks } = {}) => {
    const { xmin, xmax, ymin, ymax, logX, segments } = sampled;
    const lx = (x) => (logX ? Math.log10(x) : x);
    const X = (x) => ((lx(x) - lx(xmin)) / (lx(xmax) - lx(xmin))) * width;
    const Y = (y) => height - ((y - ymin) / (ymax - ymin)) * height;
    const objs = [];
    const faint = { stroke: color, strokeWidth: 0.6, opacity: 0.22, selectable: false, objectCaching: false };
    /* ב־Fabric 7 נקודת העוגן ברירת המחדל היא המרכז, ולכן היא נקבעת כאן במפורש */
    const label = (text, left, top, opts = {}) => new fabric.Text(text, {
        left, top, originX: 'left', originY: 'top', fontSize: 13, fill: color, fontFamily: 'Assistant, Arial, sans-serif', opacity: 0.85, objectCaching: false, ...opts,
    });

    /* רשת ושנתות */
    for (const v of ticks.x) {
        const px = X(v);
        if (px < -0.5 || px > width + 0.5) continue;
        objs.push(new fabric.Line([px, 0, px, height], faint));
        objs.push(label(ticks.xLabel(v), px, height + 6, { originX: 'center' }));
    }
    for (const v of ticks.y) {
        const py = Y(v);
        if (py < -0.5 || py > height + 0.5) continue;
        objs.push(new fabric.Line([0, py, width, py], faint));
        objs.push(label(ticks.yLabel(v), -8, py, { originX: 'right', originY: 'center' }));
    }
    objs.push(new fabric.Rect({ left: 0, top: 0, originX: 'left', originY: 'top', width, height, fill: '', stroke: color, strokeWidth: 1, opacity: 0.45, objectCaching: false }));

    /* צירי האפס, כשהם בתוך התחום */
    const axis = { stroke: color, strokeWidth: 1.6, opacity: 0.9, objectCaching: false };
    if (ymin < 0 && ymax > 0) objs.push(new fabric.Line([0, Y(0), width, Y(0)], axis));
    if (!logX && xmin < 0 && xmax > 0) objs.push(new fabric.Line([X(0), 0, X(0), height], axis));

    /* העקומות */
    segments.forEach((segs, i) => {
        const c = PLOT_COLORS[i % PLOT_COLORS.length];
        for (const seg of segs) {
            const pts = seg.map((p) => ({ x: X(p.x), y: Math.max(-4, Math.min(height + 4, Y(p.y))) }));
            objs.push(new fabric.Polyline(pts, { fill: '', stroke: c, strokeWidth: 2.4, strokeLineJoin: 'round', strokeLineCap: 'round', objectCaching: false }));
        }
        objs.push(label(`${spec.yName || 'y'} = ${spec.fns[i]}`, 10, 8 + i * 19, { fill: c, opacity: 1, fontSize: 14, direction: 'ltr' }));
    });
    if (spec.xName) objs.push(label(spec.xName, width + 10, height - 8, { fontStyle: 'italic', fontSize: 15 }));

    const g = new fabric.Group(objs, { subTargetCheck: false, objectCaching: false });
    g.customType = 'plot';
    g.plotSpec = JSON.stringify(spec);
    return g;
};

/* ── סריאליזציה מצטברת ───────────────────────────────────────────────
   כל משיכה שמורה להיסטוריה וגם לדיסק. סריאליזציה מלאה של כל הלוח אחרי כל
   משיכה לוקחת זמן שגדל עם כמות הכתב, ולכן אחרי כמה מאות משיכות הלוח נתקע
   בכל פעם שהעט נוגע במסך. משיכת דיו כמעט אף פעם לא משתנה אחרי שנוצרה, ולכן
   התוצאה שלה נשמרת בצד ונבנית מחדש רק כשאחד מהמאפיינים שלה זז. */
const inkCache = new WeakMap();

const isCacheableInk = (obj) => typeOf(obj) === 'path' && obj.customType === 'ink' && !obj.group;

const inkSignature = (o) => [
    o.left, o.top, o.scaleX, o.scaleY, o.angle, o.flipX, o.flipY, o.skewX, o.skewY, o.width, o.height,
    o.opacity, o.fill, o.stroke, o.strokeWidth, o.originX, o.originY, o.penKind, o.recTime, o.recId,
    o.globalCompositeOperation, o.strokeLineCap, o.strokeLineJoin, o.visible,
    o.strokeDashArray ? o.strokeDashArray.join(',') : '', o.pathOffset ? o.pathOffset.x + ',' + o.pathOffset.y : '',
].join('|');

/**
 * מצב הקנבס כחלקי JSON: { prefix, strs, tail }. החיבור prefix + strs.join(',') + tail
 * הוא מחרוזת ה־JSON של הלוח. המחרוזות של משיכות שלא השתנו הן אותן מחרוזות בדיוק
 * בין צילום לצילום, ולכן כל צעד היסטוריה עולה רק את מה ששונה בו.
 * `skip` הוא אובייקט שמצבו הזמני לא אמור להישמר מהמטמון, למשל צורה בעריכה.
 */
export const serializeCanvas = (canvas, extraProps, skip = null) => {
    const live = canvas.getObjects().filter((o) => !o.excludeFromExport);
    const patched = [];
    const strs = new Array(live.length);
    const NOOP = () => ({});
    live.forEach((o, i) => {
        if (o === skip || !isCacheableInk(o)) return;
        const sig = inkSignature(o);
        let hit = inkCache.get(o);
        if (!hit || hit.sig !== sig || hit.path !== o.path || hit.nodes !== o.inkNodes) {
            hit = { sig, path: o.path, nodes: o.inkNodes, str: JSON.stringify(o.toObject(extraProps)) };
            inkCache.set(o, hit);
        }
        strs[i] = hit.str;
        o.toObject = NOOP;      // Fabric לא צריך לבנות שוב אובייקט שכבר יש לו מחרוזת
        patched.push(o);
    });
    let full;
    try { full = canvas.toObject(extraProps); }
    finally { for (const o of patched) delete o.toObject; }
    // full.objects תואם ל־live לפי הסדר, כי שניהם מסוננים באותו אופן
    for (let i = 0; i < live.length; i++) if (strs[i] === undefined) strs[i] = JSON.stringify(full.objects[i]);
    const head = JSON.stringify({ ...full, objects: [] });
    const at = head.indexOf('"objects":[]');
    if (at < 0) return { prefix: '{"objects":[', strs: [], tail: ']}', whole: JSON.stringify(full) };
    return { prefix: head.slice(0, at) + '"objects":[', strs, tail: ']' + head.slice(at + 12) };
};

/** מחרוזת ה־JSON המלאה של הלוח, מחלקים שחזר serializeCanvas */
export const joinSerialized = (ser) => ser.whole ?? (ser.prefix + ser.strs.join(',') + ser.tail);
