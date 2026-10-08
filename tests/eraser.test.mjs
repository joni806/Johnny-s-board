/* בדיקות למחק החלקי — חיתוך משיכות וצורות לחלקים.
   הרצה:  node tests/eraser.test.mjs                                       */
import * as fabricPkg from 'fabric';
import { createInkStroke } from '../src/utils/ink.js';
import { eraseObjectPartially, buildRecognizedShape, getEraseGeometry } from '../src/utils/canvasUtils.js';
import { erasePolyline, densify } from '../src/utils/eraser.js';

const fabric = fabricPkg.fabric || fabricPkg;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS | ${name}`); }
  else { fail++; console.log(`FAIL | ${name} ${extra}`); }
};

/** משיכת דיו אופקית אמיתית, דרך מנוע הדיו, עם קו האמצע שנשמר איתה */
const makeInk = (x0, x1, y) => {
  const s = createInkStroke({ baseWidth: 4, minRatio: 1, maxRatio: 1, tiltInfluence: 0, taperFloor: 1 });
  for (let x = x0; x <= x1; x += 2) s.push({ x, y, p: 0, tx: 0, ty: 0, t: x, pen: false });
  const obj = new fabric.Path(s.toPathData(), { fill: '#ffffff', stroke: null, strokeWidth: 0 });
  obj.customType = 'ink'; obj.inkFilled = true; obj.penKind = 'ball'; obj.inkNodes = s.nodesFlat();
  return obj;
};

/* ── הליבה הטהורה ── */
{
  const line = densify([{ x: 0, y: 0, h: 1 }, { x: 100, y: 0, h: 1 }], 2);
  const runs = erasePolyline(line, [{ a: { x: 50, y: -20 }, b: { x: 50, y: 20 } }], 5);
  check('קו שנחתך באמצע מתפצל לשני חלקים', runs && runs.length === 2, runs ? runs.length : 'null');
  check('  החלק השמאלי מסתיים בחתך', runs && runs[0].endCut === true && runs[0].startCut === false);
  check('  החלק הימני מתחיל בחתך', runs && runs[1].startCut === true && runs[1].endCut === false);
  check('מחק רחוק לא נוגע', erasePolyline(line, [{ a: { x: 50, y: 40 }, b: { x: 60, y: 40 } }], 5) === null);
  const all = erasePolyline(line, [{ a: { x: -10, y: 0 }, b: { x: 110, y: 0 } }], 5);
  check('מחק לאורך כל הקו מוחק את כולו', all && all.length === 0);
  const ring = densify([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], 2, true);
  const rr = erasePolyline(ring, [{ a: { x: 50, y: 90 }, b: { x: 50, y: 110 } }], 4, { closed: true });
  check('צורה סגורה שנחתכה פעם אחת נשארת חלק אחד רציף', rr && rr.length === 1, rr ? rr.length : 'null');
}

/* ── משיכת דיו אמיתית ── */
{
  const ink = makeInk(0, 200, 100);
  const out = eraseObjectPartially(ink, [{ a: { x: 100, y: 60 }, b: { x: 100, y: 140 } }], 8);
  check('משיכת דיו נחתכת לשני חלקים', Array.isArray(out) && out.length === 2, out ? out.length : String(out));
  if (out && out.length === 2) {
    const [a, b] = out.map((o) => o.getBoundingRect());
    check('  החלקים לא חופפים את אזור המחק', a.left + a.width < 98 && b.left > 102, `${a.left + a.width} ${b.left}`);
    check('  כל חלק נושא קו אמצע משלו', out.every((o) => Array.isArray(o.inkNodes) && o.inkNodes.length >= 6));
    check('  החלקים ממולאים באותו צבע', out.every((o) => o.fill === '#ffffff' && o.inkFilled));
    const again = eraseObjectPartially(out[0], [{ a: { x: 40, y: 60 }, b: { x: 40, y: 140 } }], 6);
    check('  חלק אפשר לחתוך שוב', Array.isArray(again) && again.length === 2);
  }
  check('מחק שלא נגע מחזיר null', eraseObjectPartially(ink, [{ a: { x: 100, y: 300 }, b: { x: 120, y: 300 } }], 8) === null);
  ink.set({ left: ink.left + 500 });
  ink.setCoords();
  const moved = eraseObjectPartially(ink, [{ a: { x: 600, y: 60 }, b: { x: 600, y: 140 } }], 8);
  check('משיכה שהוזזה נחתכת במיקום החדש שלה', Array.isArray(moved) && moved.length === 2);
}

/* ── דיו ישן בלי קו אמצע ── */
{
  const legacy = new fabric.Path('M 0 0 L 10 0 L 10 10 Z', { fill: '#fff' });
  legacy.inkFilled = true; legacy.customType = 'ink';
  check('דיו ישן בלי קו אמצע מסומן כלא ניתן לחיתוך', eraseObjectPartially(legacy, [{ a: { x: 5, y: 0 }, b: { x: 5, y: 10 } }], 4) === undefined);
}

/* ── צורות ── */
{
  const rect = buildRecognizedShape({ type: 'rect', cx: 200, cy: 200, width: 200, height: 100, angle: 0 }, '#fff', 3);
  const out = eraseObjectPartially(rect, [{ a: { x: 200, y: 140 }, b: { x: 200, y: 160 } }], 6);
  check('מלבן שנחתך בצלע העליונה הופך לקו פתוח אחד', Array.isArray(out) && out.length === 1, out ? out.length : String(out));
  const dashed = buildRecognizedShape({ type: 'line', start: { x: 0, y: 0 }, end: { x: 300, y: 0 } }, '#fff', 3);
  dashed.dashStyle = 'dashed'; dashed.set({ strokeDashArray: [9, 7] });
  const dOut = eraseObjectPartially(dashed, [{ a: { x: 150, y: -10 }, b: { x: 150, y: 10 } }], 5);
  check('קו מקווקו נשאר מקווקו אחרי חיתוך', dOut && dOut.length === 2 && dOut.every((o) => Array.isArray(o.strokeDashArray)));
  const group = new fabric.Group([new fabric.Rect({ width: 10, height: 10 })]);
  check('קבוצה אינה ניתנת לחיתוך', getEraseGeometry(group) === null);
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
