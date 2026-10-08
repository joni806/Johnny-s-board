/* בדיקות לפירושים החלופיים של צורה — ריבוע מול מרובע כפי שצויר.
   הרצה:  node tests/variants.test.mjs                                     */
import { recognizeShape, shapeVariants, pickVariant } from '../src/utils/recognition.js';

let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const jitter = (a) => (rnd() - 0.5) * 2 * a;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** הליכה על היקף מצולע עם רעש יד */
function trace(verts, closed = true, per = 40, noise = 2) {
  const list = closed ? [...verts, verts[0]] : verts;
  const out = [];
  for (let i = 1; i < list.length; i++) {
    for (let k = 0; k < per; k++) {
      const p = lerp(list[i - 1], list[i], k / per);
      out.push({ x: p.x + jitter(noise), y: p.y + jitter(noise) });
    }
  }
  out.push({ ...list[list.length - 1] });
  return out;
}

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS | ${name}`); }
  else { fail++; console.log(`FAIL | ${name} ${extra}`); }
};
const describe = (r) => r ? `${r.type}${r.square ? '/square' : ''} [${r.variants?.[r.variantIndex]?.key}]` : 'ink';

/* ── ריבוע מרושל, כמו שאדם מצייר באמת: זוויות של 78 עד 100 ויחס צלעות של 0.9 ── */
const sloppySquare = [{ x: 100, y: 108 }, { x: 318, y: 92 }, { x: 330, y: 300 }, { x: 96, y: 318 }];
{
  const r = recognizeShape(trace(sloppySquare), { scale: 1 });
  check('ריבוע מרושל הופך לריבוע ברמה המאוזנת', r && r.type === 'rect' && r.square, describe(r));
  check('  והוא ישר ולא מוטה', r && Math.abs(r.angle) < 1e-9, r ? `angle=${r.angle}` : '');
  const f = recognizeShape(trace(sloppySquare), { scale: 1, snapLevel: 'faithful' });
  check('אותו ריבוע ברמה הנאמנה נשאר מרובע כפי שצויר', f && f.type === 'polygon' && f.sides === 4, describe(f));
}

/* ── מלבן מרושל ── */
{
  const r = recognizeShape(trace([{ x: 80, y: 100 }, { x: 420, y: 112 }, { x: 410, y: 270 }, { x: 88, y: 258 }]), { scale: 1 });
  check('מלבן מרושל הופך למלבן ולא לריבוע', r && r.type === 'rect' && !r.square, describe(r));
}

/* ── מקבילית מכוונת: זוויות של 60 ו־120 חייבות להישאר מקבילית ── */
{
  const para = [{ x: 150, y: 100 }, { x: 400, y: 100 }, { x: 320, y: 260 }, { x: 70, y: 260 }];
  const r = recognizeShape(trace(para), { scale: 1 });
  check('מקבילית מכוונת לא הופכת למלבן', r && r.type === 'polygon' && r.variants[r.variantIndex].key === 'parallelogram', describe(r));
  const v = r ? r.variants : [];
  check('  מלבן קיים כפירוש חלופי להקשה אחת', v.some((x) => x.key === 'rect'));
  const forced = recognizeShape(trace(para), { scale: 1, forcePerfect: true });
  check('  אצבע שנייה כופה את הפירוש המושלם', forced && forced.type === 'rect', describe(forced));
}

/* ── טרפז מכוון ── */
{
  const r = recognizeShape(trace([{ x: 180, y: 100 }, { x: 330, y: 104 }, { x: 440, y: 300 }, { x: 70, y: 296 }]), { scale: 1 });
  check('טרפז נשאר טרפז ובסיסיו מקבילים', r && r.type === 'polygon' && r.variants[r.variantIndex].key === 'trapezoid', describe(r));
  if (r && r.points) {
    const [a, b, c, d] = r.points;
    const cross = (p, q, s, t) => Math.abs((q.x - p.x) * (t.y - s.y) - (q.y - p.y) * (t.x - s.x)) / (Math.hypot(q.x - p.x, q.y - p.y) * Math.hypot(t.x - s.x, t.y - s.y));
    check('  הבסיסים מקבילים בדיוק', cross(a, b, d, c) < 1e-9 || cross(b, c, a, d) < 1e-9);
  }
}

/* ── משולשים ── */
{
  const r = recognizeShape(trace([{ x: 100, y: 100 }, { x: 104, y: 330 }, { x: 330, y: 322 }]), { scale: 1 });
  check('משולש ישר־זווית מרושל מקבל זווית ישרה', r && r.rightAngle === true, describe(r));
  if (r && r.points) {
    const [a, b, c] = r.points;
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    check('  והניצבים מיושרים לצירים', Math.abs(v1.x) < 1e-6 || Math.abs(v1.y) < 1e-6 || Math.abs(v2.x) < 1e-6 || Math.abs(v2.y) < 1e-6);
  }
  const eq = recognizeShape(trace([{ x: 200, y: 90 }, { x: 330, y: 300 }, { x: 78, y: 296 }]), { scale: 1 });
  check('משולש כמעט שווה צלעות הופך לשווה צלעות', eq && eq.regular === true, describe(eq));
  const scal = recognizeShape(trace([{ x: 100, y: 100 }, { x: 480, y: 140 }, { x: 200, y: 220 }]), { scale: 1 });
  check('משולש שונה צלעות נשאר כפי שצויר', scal && scal.type === 'polygon' && scal.variants[scal.variantIndex].key === 'drawn', describe(scal));
}

/* ── אליפסה רחבה מכוונת לא הופכת למעגל, ומעגל מעט פחוס כן ── */
{
  const circ = [];
  for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2; circ.push({ x: 300 + 130 * Math.cos(a) + jitter(2), y: 300 + 116 * Math.sin(a) + jitter(2) }); }
  const r = recognizeShape(circ, { scale: 1 });
  check('מעגל פחוס במעט הופך למעגל', r && r.type === 'circle', describe(r));
  const ell = [];
  for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2; ell.push({ x: 300 + 200 * Math.cos(a) + jitter(2), y: 300 + 90 * Math.sin(a) + jitter(2) }); }
  const e = recognizeShape(ell, { scale: 1 });
  check('אליפסה רחבה נשארת אליפסה', e && e.type === 'ellipse', describe(e));
  check('  ויש לה פירוש מעגל להקשה אחת', e && e.variants.some((v) => v.key === 'circle'));
}

/* ── שרשרת קטעים כמעט ניצבת — חוט במעגל חשמלי ── */
{
  const r = recognizeShape(trace([{ x: 100, y: 100 }, { x: 300, y: 108 }, { x: 306, y: 300 }], false), { scale: 1 });
  check('שרשרת כמעט ניצבת מתיישרת לצירים', r && r.type === 'polyline' && r.variants[r.variantIndex].key === 'orthogonal', describe(r));
}

/* ── pickVariant עצמה ── */
{
  const vs = shapeVariants({ type: 'polygon', drawnVertices: sloppySquare });
  check('רשימת הפירושים מסתיימת תמיד בכפי שצויר', vs[vs.length - 1].key === 'drawn');
  check('רמה נאמנה בוחרת כפי שצויר', vs[pickVariant(vs, 'faithful')].key === 'drawn');
  check('רמה מושלמת בוחרת ריבוע', vs[pickVariant(vs, 'perfect')].key === 'square');
}

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
