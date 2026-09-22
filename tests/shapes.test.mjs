/* בדיקות זמן ריצה לשכבת ה-Fabric: בניית הצורות המזוהות ובדיקת פגיעת המחק.
   הרצה:  node tests/shapes.test.mjs                                        */
import { buildRecognizedShape, getOutlineSegments, isObjectNearPoint, arcToPathData } from '../src/utils/canvasUtils.js';
import { recognizeShape } from '../src/utils/recognition.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS | ${name}`); }
  else { fail++; console.log(`FAIL | ${name} ${extra}`); }
};

const COLOR = '#f5f5f5';
const SW = 3;

/* ── כל סוג תוצאה חייב להיבנות לאובייקט Fabric תקין ── */
const specs = [
  ['line', { type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 50 } }, 'line'],
  ['arrow', { type: 'arrow', start: { x: 0, y: 0 }, end: { x: 200, y: 0 }, headLength: 30 }, 'arrow'],
  ['curve', { type: 'curve', start: { x: 0, y: 0 }, cp: { x: 50, y: -80 }, end: { x: 100, y: 0 } }, 'curve'],
  ['arc', { type: 'arc', cx: 100, cy: 100, r: 60, startAngle: 0, sweep: 4.2 }, 'arc'],
  ['circle', { type: 'circle', cx: 100, cy: 100, r: 60 }, 'ellipse'],
  ['ellipse', { type: 'ellipse', cx: 100, cy: 100, rx: 90, ry: 40, angle: 0.5 }, 'ellipse'],
  ['rect ישר', { type: 'rect', cx: 100, cy: 100, width: 120, height: 80, angle: 0 }, 'rect'],
  ['rect מסובב', { type: 'rect', cx: 100, cy: 100, width: 120, height: 80, angle: 0.4 }, 'polygon'],
  ['polygon', { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 90 }] }, 'polygon'],
  ['polyline', { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 60, y: 80 }, { x: 120, y: 0 }] }, 'polyline'],
];

for (const [name, spec, expectedCustom] of specs) {
  let obj = null, err = '';
  try { obj = buildRecognizedShape(spec, COLOR, SW); } catch (e) { err = e.message; }
  check(`בניית ${name}`, !!obj && obj.customType === expectedCustom,
    err || (obj ? `customType=${obj.customType}` : 'לא נבנה'));
  if (obj) {
    check(`  ${name} — תיבה תוחמת סבירה`, (() => {
      try {
        const b = obj.getBoundingRect(true);
        return Number.isFinite(b.left) && Number.isFinite(b.width) && b.width > 0 && b.height >= 0;
      } catch { return false; }
    })());
  }
}

/* ── המרת קשת לעקומות חייבת להישאר על המעגל ── */
{
  const d = arcToPathData(0, 0, 100, 0, Math.PI);
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  check('קשת — נקודת הסיום על המעגל',
    Math.abs(Math.hypot(nums[nums.length - 2], nums[nums.length - 1]) - 100) < 1);
}

/* ── מתאר מצולע: חייב לשחזר בדיוק את הקודקודים שהוזנו ── */
{
  const verts = [{ x: 10, y: 20 }, { x: 210, y: 20 }, { x: 210, y: 160 }, { x: 10, y: 160 }];
  const obj = buildRecognizedShape({ type: 'polygon', points: verts }, COLOR, SW);
  const segs = getOutlineSegments(obj);
  const ok = segs && segs.length === 4 && verts.every((v) =>
    segs.some(([a]) => Math.hypot(a.x - v.x, a.y - v.y) < 0.6));
  check('מתאר מצולע משחזר את הקודקודים', ok, segs ? `segs=${segs.length}` : 'אין מתאר');
}

/* ── מחק: הבדיקה המרכזית שנשברה בגרסה הקודמת ── */
{
  // משולש ישר זווית. הפינה הרחוקה של התיבה התוחמת ריקה לגמרי מצורה.
  const tri = buildRecognizedShape(
    { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 0, y: 300 }] }, COLOR, SW);

  check('מחק לא מוחק בפינה ריקה של התיבה התוחמת',
    isObjectNearPoint(tri, { x: 285, y: 285 }, 20) === false);
  check('מחק פוגע על היתר', isObjectNearPoint(tri, { x: 150, y: 150 }, 8) === true);
  check('מחק פוגע על הניצב התחתון', isObjectNearPoint(tri, { x: 160, y: 3 }, 8) === true);
  check('מחק לא פוגע הרחק מחוץ לצורה',
    isObjectNearPoint(tri, { x: 900, y: 900 }, 20) === false);

  const circ = buildRecognizedShape({ type: 'circle', cx: 200, cy: 200, r: 100 }, COLOR, SW);
  check('מחק לא פוגע במרכז מעגל ריק', isObjectNearPoint(circ, { x: 200, y: 200 }, 10) === false);
  check('מחק פוגע בהיקף המעגל', isObjectNearPoint(circ, { x: 300, y: 200 }, 10) === true);
}

/* ── מסלול מלא: משיכה מצוירת → זיהוי → אובייקט Fabric ── */
{
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pts = [];
  const corners = [[100, 100], [340, 100], [340, 340], [100, 340], [100, 100]];
  for (let i = 1; i < corners.length; i++) {
    for (let t = 0; t <= 1; t += 0.025) {
      pts.push({
        x: corners[i - 1][0] + (corners[i][0] - corners[i - 1][0]) * t + (rnd() - 0.5) * 4,
        y: corners[i - 1][1] + (corners[i][1] - corners[i - 1][1]) * t + (rnd() - 0.5) * 4,
      });
    }
  }
  const res = recognizeShape(pts, { scale: 1 });
  check('מסלול מלא — ריבוע מזוהה כמלבן', res && res.type === 'rect', res ? res.type : 'null');
  if (res && res.type === 'rect') {
    check('  מידות נכונות', Math.abs(res.width - 240) < 18 && Math.abs(res.height - 240) < 18,
      `${res.width.toFixed(0)}x${res.height.toFixed(0)}`);
    check('  זוהה כריבוע', res.square === true);
    const obj = buildRecognizedShape(res, COLOR, SW);
    check('  נבנה כ-Rect של Fabric', obj && obj.type === 'rect');
  }
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
