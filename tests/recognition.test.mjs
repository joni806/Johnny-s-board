/* בדיקות למנוע הזיהוי — צורות סינתטיות עם רעש ומהירות כתיבה משתנה.
   הרצה:  node tests/recognition.test.mjs                                  */
import { recognizeShape } from '../src/utils/recognition.js';

/* ── מחולל רעש דטרמיניסטי כדי שהבדיקות יהיו יציבות ── */
let seed = 20260922;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const jitter = (amp) => (rnd() - 0.5) * 2 * amp;

/** דגימה של מסלול פרמטרי עם רעש ועם קצב לא אחיד, כמו יד אנושית */
function sampleCurve(fn, count, noise) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    let t = i / (count - 1);
    // עיוות הקצב — מדמה האטה והאצה תוך כדי הכתיבה
    t = t + 0.06 * Math.sin(t * Math.PI * 3);
    t = Math.max(0, Math.min(1, t));
    const p = fn(t);
    pts.push({ x: p.x + jitter(noise), y: p.y + jitter(noise) });
  }
  return pts;
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** הליכה על היקף מצולע */
function polyPath(verts, closed, count, noise) {
  const list = closed ? [...verts, verts[0]] : verts;
  const segLens = [];
  let total = 0;
  for (let i = 1; i < list.length; i++) {
    const d = Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y);
    segLens.push(d); total += d;
  }
  return sampleCurve((t) => {
    let target = t * total;
    for (let i = 0; i < segLens.length; i++) {
      if (target <= segLens[i] || i === segLens.length - 1) {
        return lerp(list[i], list[i + 1], Math.min(1, target / segLens[i]));
      }
      target -= segLens[i];
    }
    return list[list.length - 1];
  }, count, noise);
}

const regular = (cx, cy, r, k, rot = 0) =>
  Array.from({ length: k }, (_, i) => {
    const a = rot + (2 * Math.PI * i) / k;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

const rectVerts = (cx, cy, w, h, ang = 0) =>
  [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({
    x: cx + x * Math.cos(ang) - y * Math.sin(ang),
    y: cy + x * Math.sin(ang) + y * Math.cos(ang),
  }));

/* ── מקרי הבדיקה ── */
const cases = [];
const add = (name, expect, points, check) => cases.push({ name, expect, points, check });

add('קו אופקי', 'line',
  sampleCurve((t) => ({ x: 120 + 300 * t, y: 200 + 2 * Math.sin(t * 6) }), 80, 1.2));

add('קו אלכסוני', 'line',
  sampleCurve((t) => ({ x: 100 + 260 * t, y: 400 - 190 * t }), 60, 1.5));

add('קו אנכי', 'line',
  sampleCurve((t) => ({ x: 300 + 2 * Math.sin(t * 5), y: 100 + 280 * t }), 70, 1.2));

add('ריבוע ישר', 'rect', polyPath(rectVerts(300, 300, 200, 200), true, 150, 2.0),
  (r) => r.square === true);

add('מלבן', 'rect', polyPath(rectVerts(300, 300, 300, 150), true, 150, 2.0),
  (r) => r.square === false && Math.abs(r.width / r.height - 2) < 0.25);

add('ריבוע מסובב 30 מעלות', 'rect', polyPath(rectVerts(300, 300, 220, 220, Math.PI / 6), true, 160, 2.0),
  (r) => Math.abs(Math.abs(r.angle) - Math.PI / 6) < 0.09);

add('מעגל', 'circle',
  sampleCurve((t) => ({ x: 300 + 120 * Math.cos(t * 2 * Math.PI), y: 300 + 120 * Math.sin(t * 2 * Math.PI) }), 140, 2.0),
  (r) => Math.abs(r.r - 120) < 14);

add('מעגל לא סגור עד הסוף', 'circle',
  sampleCurve((t) => ({ x: 300 + 110 * Math.cos(t * 1.85 * Math.PI), y: 300 + 110 * Math.sin(t * 1.85 * Math.PI) }), 130, 2.0));

add('אליפסה', 'ellipse',
  sampleCurve((t) => ({ x: 300 + 200 * Math.cos(t * 2 * Math.PI), y: 300 + 90 * Math.sin(t * 2 * Math.PI) }), 150, 2.0),
  (r) => Math.abs(r.rx / r.ry - 200 / 90) < 0.5);

add('אליפסה מוטה', 'ellipse',
  sampleCurve((t) => {
    const a = t * 2 * Math.PI, u = 190 * Math.cos(a), v = 80 * Math.sin(a), k = Math.PI / 5;
    return { x: 300 + u * Math.cos(k) - v * Math.sin(k), y: 300 + u * Math.sin(k) + v * Math.cos(k) };
  }, 150, 2.0),
  (r) => Math.abs(Math.abs(r.angle) - Math.PI / 5) < 0.15);

add('משולש שווה צלעות', 'polygon', polyPath(regular(300, 300, 150, 3, -Math.PI / 2), true, 140, 2.0),
  (r) => r.sides === 3 && r.regular === true);

add('משולש ישר זווית', 'polygon',
  polyPath([{ x: 150, y: 150 }, { x: 150, y: 390 }, { x: 400, y: 390 }], true, 150, 2.0),
  (r) => r.sides === 3);

add('מחומש', 'polygon', polyPath(regular(300, 300, 150, 5, -Math.PI / 2), true, 170, 2.0),
  (r) => r.sides === 5 && r.regular === true);

add('משושה', 'polygon', polyPath(regular(300, 300, 150, 6, 0), true, 180, 2.0),
  (r) => r.sides === 6);

add('מעוין', 'rect', polyPath(rectVerts(300, 300, 200, 200, Math.PI / 4), true, 150, 2.0));

add('טרפז', 'polygon',
  polyPath([{ x: 200, y: 180 }, { x: 380, y: 180 }, { x: 450, y: 400 }, { x: 130, y: 400 }], true, 160, 2.0),
  (r) => r.sides === 4);

add('חץ עם פאה אחת', 'arrow', (() => {
  const shaft = sampleCurve((t) => ({ x: 120 + 280 * t, y: 300 }), 70, 1.2);
  const tip = { x: 400, y: 300 };
  const barb = sampleCurve((t) => lerp(tip, { x: 355, y: 262 }, t), 18, 1.2);
  return [...shaft, ...barb];
})(), (r) => Math.abs(r.end.x - 400) < 25);

add('חץ עם שתי פאות', 'arrow', (() => {
  const shaft = sampleCurve((t) => ({ x: 150, y: 400 - 250 * t }), 70, 1.2);
  const tip = { x: 150, y: 150 };
  const b1 = sampleCurve((t) => lerp(tip, { x: 112, y: 196 }, t), 14, 1.2);
  const b2 = sampleCurve((t) => lerp({ x: 112, y: 196 }, tip, t), 10, 1.2);
  const b3 = sampleCurve((t) => lerp(tip, { x: 188, y: 196 }, t), 14, 1.2);
  return [...shaft, ...b1, ...b2, ...b3];
})());

add('חץ אלכסוני', 'arrow', (() => {
  const shaft = sampleCurve((t) => ({ x: 120 + 220 * t, y: 380 - 220 * t }), 70, 1.2);
  const tip = { x: 340, y: 160 };
  const barb = sampleCurve((t) => lerp(tip, { x: 296, y: 172 }, t), 16, 1.2);
  return [...shaft, ...barb];
})());

add('עיקול רדוד', 'curve',
  sampleCurve((t) => ({ x: 120 + 300 * t, y: 300 - 110 * Math.sin(t * Math.PI) }), 90, 1.5));

add('קשת רבע מעגל', 'curve',
  sampleCurve((t) => ({ x: 300 + 150 * Math.cos(t * Math.PI / 2), y: 300 + 150 * Math.sin(t * Math.PI / 2) }), 80, 1.5));

add('קשת רחבה 240 מעלות', 'arc',
  sampleCurve((t) => ({ x: 300 + 140 * Math.cos(t * 4.19), y: 300 + 140 * Math.sin(t * 4.19) }), 120, 1.8));

add('צורת וי', 'polyline',
  polyPath([{ x: 150, y: 150 }, { x: 260, y: 380 }, { x: 370, y: 150 }], false, 110, 1.8),
  (r) => r.points.length === 3);

add('צורת זיגזג', 'polyline',
  polyPath([{ x: 100, y: 300 }, { x: 200, y: 180 }, { x: 300, y: 300 }, { x: 400, y: 180 }], false, 140, 1.8),
  (r) => r.points.length === 4);

add('קשקוש אקראי', null, (() => {
  const pts = [];
  let x = 300, y = 300;
  for (let i = 0; i < 160; i++) {
    x += jitter(22); y += jitter(22);
    pts.push({ x, y });
  }
  return pts;
})());

add('משיכה קצרה מדי', null,
  sampleCurve((t) => ({ x: 300 + 12 * t, y: 300 + 6 * t }), 20, 0.5));

/* ── הרצה ── */
let pass = 0, fail = 0;
const rows = [];
for (const c of cases) {
  const res = recognizeShape(c.points, { scale: 1 });
  const got = res ? res.type : null;
  let ok = got === c.expect;
  let note = '';
  if (ok && c.check && res) {
    const detail = c.check(res);
    if (!detail) { ok = false; note = 'גיאומטריה לא מדויקת'; }
  }
  if (ok) pass++; else fail++;
  rows.push([
    ok ? 'PASS' : 'FAIL',
    c.name,
    `צפוי: ${c.expect ?? 'דיו חופשי'}`,
    `התקבל: ${got ?? 'דיו חופשי'}`,
    res ? `ביטחון ${res.confidence.toFixed(2)} פינות ${res.cornerCount}` : '',
    note,
  ]);
}
const w = [4, 26, 22, 24, 30];
for (const r of rows) {
  console.log(r.map((v, i) => String(v).padEnd(w[i] ?? 0)).join(' | '));
}
console.log(`\n${pass} עברו, ${fail} נכשלו, מתוך ${cases.length}`);
process.exit(fail ? 1 : 0);
