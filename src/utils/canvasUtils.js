import * as fabricPkg from 'fabric';
const fabric = fabricPkg.fabric || fabricPkg;

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

/** פריסת נתיב Fabric לרשימת נקודות במרחב המקומי של האובייקט */
const flattenPath = (path) => {
    const out = [];
    let cur = { x: 0, y: 0 };
    let startPt = { x: 0, y: 0 };
    for (const cmd of path) {
        const op = cmd[0];
        if (op === 'M') { cur = { x: cmd[1], y: cmd[2] }; startPt = cur; out.push(cur); }
        else if (op === 'L') { cur = { x: cmd[1], y: cmd[2] }; out.push(cur); }
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
    return out;
};

/**
 * מתאר האובייקט בקואורדינטות הלוח. מוחזר כרשימת קטעים ולא כענן נקודות,
 * כדי שבדיקת המרחק תהיה מדויקת גם בצלע ארוכה שאין בה נקודות דגימה.
 */
export const getOutlineSegments = (obj) => {
    const m = obj.calcTransformMatrix();
    const off = obj.pathOffset || { x: 0, y: 0 };
    const toAbs = (p) => fabric.util.transformPoint(
        new fabric.Point(p.x - off.x, p.y - off.y), m
    );
    let local;
    let closed = false;

    if (obj.type === 'polygon' || obj.type === 'polyline' || obj.points) {
        local = obj.points.map((p) => ({ x: p.x, y: p.y }));
        closed = obj.type === 'polygon' || obj.customType === 'polygon';
    } else if (obj.type === 'path' && Array.isArray(obj.path)) {
        local = flattenPath(obj.path);
    } else if (obj.type === 'line') {
        const lp = obj.calcLinePoints();
        return [[
            fabric.util.transformPoint(new fabric.Point(lp.x1, lp.y1), m),
            fabric.util.transformPoint(new fabric.Point(lp.x2, lp.y2), m),
        ]];
    } else if (obj.type === 'rect') {
        const w = obj.width / 2, h = obj.height / 2;
        local = [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }];
        closed = true;
    } else if (obj.type === 'ellipse' || obj.type === 'circle') {
        const rx = obj.rx !== undefined ? obj.rx : obj.radius;
        const ry = obj.ry !== undefined ? obj.ry : obj.radius;
        local = [];
        for (let i = 0; i < 48; i++) {
            const a = (i / 48) * Math.PI * 2;
            local.push({ x: rx * Math.cos(a), y: ry * Math.sin(a) });
        }
        closed = true;
    } else {
        return null;   // תמונות וקבוצות — נבדקות לפי התיבה התוחמת
    }

    if (!local || local.length < 2) return null;
    const abs = local.map(toAbs);
    const segs = [];
    for (let i = 1; i < abs.length; i++) segs.push([abs[i - 1], abs[i]]);
    if (closed) segs.push([abs[abs.length - 1], abs[0]]);
    return segs;
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
