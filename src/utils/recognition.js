/* =====================================================================
 * recognition.js — מנוע זיהוי צורות מכתב־יד
 * ---------------------------------------------------------------------
 * צינור העיבוד:
 *   1. ניקוי כפילויות ודגימה מחדש במרווחים אחידים.
 *      זה הצעד הקריטי: בלעדיו כל המדדים תלויים במהירות הכתיבה, כי משיכה
 *      איטית מייצרת מאות נקודות ומשיכה מהירה מייצרת עשרות.
 *   2. זיהוי פינות לפי יחס מיתר/קשת. מדד חסר יחידות ובלתי תלוי בקנה מידה
 *      או בצפיפות הדגימה: בקו ישר הוא 1, בעיקול חלק הוא 0.98, בזווית ישרה
 *      הוא 0.707. כך אפשר להבחין בין פינה אמיתית לבין עקמומיות רציפה.
 *   3. התאמת פרימיטיבים — קו, מעגל, אליפסה, מצולע, קשת, חץ — כל אחד עם
 *      שגיאה מנורמלת שמשמשת כניקוד ביטחון.
 *   4. בחירה לפי סדר עדיפות עם ספי קבלה מפורשים.
 *   5. ייפוי — הצמדת זוויות, ריבוע, מעגל, מצולע משוכלל וזווית ישרה.
 *
 * המודול טהור: אין בו תלות ב-Fabric, ב-React או ב-DOM, ולכן הוא ניתן
 * לבדיקה אוטומטית בנפרד מהאפליקציה.
 * ===================================================================== */

const EPS = 1e-9;

/* ── סוג ברירת מחדל לספים. חשיפה החוצה מאפשרת כיוונון בלי לגעת בקוד ── */
export const DEFAULTS = {
  samples: 64,          // מספר הנקודות אחרי דגימה מחדש
  cornerWindow: 3,      // חצי חלון לחישוב יחס מיתר/קשת
  cornerRatio: 0.93,    // מתחת לזה נחשב פינה. 0.93 תופס זוויות חדות מ-45 מעלות
  minStrokeLength: 45,  // אורך מסלול מינימלי בפיקסלי מסך
  minSpan: 30,          // אלכסון תיבה תוחמת מינימלי בפיקסלי מסך
  fitTol: 0.045,        // סטייה ממוצעת מותרת, כחלק מאלכסון התיבה התוחמת
  edgeTol: 0.1,         // כמה "לא ישרה" מותר שתהיה צלע בשרשרת קטעים
  minConfidence: 0.62,  // מתחת לזה עדיף להשאיר דיו חופשי
  closedGapRatio: 0.25, // מרווח בין ההתחלה לסוף חלקי אורך המסלול
  angleSnapDeg: 5,      // סבילות הצמדת זווית לקווים
  squareTol: 0.13,      // כמה קרוב צריך להיות יחס הצלעות כדי להפוך לריבוע
  rightAngleTolDeg: 10, // סבילות להצמדת זווית ישרה במשולש
  regularTol: 0.2,      // סבילות לזיהוי מצולע משוכלל
};

/* ── עזרי וקטורים ─────────────────────────────────────────────────── */
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const vlen = (a) => Math.hypot(a.x, a.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

/* פתרון מערכת 3x3 באלימינציה גאוסית עם ציר חלקי */
function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    const tmp = m[col]; m[col] = m[piv]; m[piv] = tmp;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/* ── עיבוד מקדים ──────────────────────────────────────────────────── */

export function dedupe(points, minDist = 0.8) {
  const out = [];
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (!out.length || dist(out[out.length - 1], p) >= minDist) out.push({ x: p.x, y: p.y });
  }
  if (out.length < 2 && points.length >= 2) {
    const a = points[0];
    const b = points[points.length - 1];
    return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  }
  return out;
}

export function pathLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/**
 * דגימה מחדש למרווחים אחידים. זו הסיבה המרכזית לכך שכל שאר המדדים
 * יציבים — אחרי הצעד הזה צפיפות הנקודות כבר לא מספרת על המהירות.
 */
export function resample(points, n = DEFAULTS.samples) {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const total = pathLength(pts);
  if (pts.length < 2 || total < EPS) return pts;
  const interval = total / (n - 1);
  let acc = 0;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (d < EPS) continue;
    if (acc + d >= interval) {
      const t = (interval - acc) / d;
      const q = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
      };
      out.push(q);
      pts.splice(i, 0, q);
      acc = 0;
    } else {
      acc += d;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}

export function boundingBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return { minX, minY, maxX, maxY, width, height, diag: Math.hypot(width, height) };
}

export function centroidOf(pts) {
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

/* ── זיהוי פינות ──────────────────────────────────────────────────── */

/**
 * יחס מיתר/קשת סביב כל נקודה.
 * קו ישר נותן 1, עיקול חלק של מעגל נותן כ-0.98, זווית של 90 מעלות נותנת
 * 0.707, וזווית של 45 מעלות נותנת 0.924. המדד חסר יחידות ולכן עובד זהה
 * בכל קנה מידה וברמת זום כלשהי.
 */
function chordArcRatios(pts, W) {
  const n = pts.length;
  const cum = new Array(n).fill(0);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + dist(pts[i - 1], pts[i]);
  const ratios = new Array(n).fill(1);
  for (let i = W; i < n - W; i++) {
    const arc = cum[i + W] - cum[i - W];
    if (arc < EPS) continue;
    ratios[i] = dist(pts[i - W], pts[i + W]) / arc;
  }
  return ratios;
}

/**
 * מחזיר רשימת פינות, כל אחת עם החדות שלה. בצורה סגורה הבדיקה מעגלית,
 * כך שפינה שנפלה בדיוק בנקודת ההתחלה של המשיכה לא הולכת לאיבוד.
 */
export function detectCorners(pts, opts = {}) {
  const { closed = false } = opts;
  const W = opts.cornerWindow || DEFAULTS.cornerWindow;
  const threshold = opts.cornerRatio || DEFAULTS.cornerRatio;
  const n = pts.length;
  if (n < 2 * W + 3) return [];

  let work, offset;
  if (closed) {
    work = [...pts.slice(n - W), ...pts, ...pts.slice(0, W)];
    offset = W;
  } else {
    work = pts;
    offset = 0;
  }

  const ratios = chordArcRatios(work, W);
  const found = [];
  for (let i = W; i < work.length - W; i++) {
    if (ratios[i] >= threshold) continue;
    let bestIdx = i, bestVal = ratios[i];
    while (i < work.length - W && ratios[i] < threshold) {
      if (ratios[i] < bestVal) { bestVal = ratios[i]; bestIdx = i; }
      i++;
    }
    const idx = bestIdx - offset;
    found.push({ index: ((idx % n) + n) % n, ratio: bestVal });
  }

  found.sort((a, b) => a.index - b.index);

  /* מיזוג פינות סמוכות מדי — רועד יד מייצר לעיתים שתי פינות באותו קודקוד */
  const minGap = Math.max(2, Math.round(n * 0.07));
  const merged = [];
  for (const c of found) {
    const prev = merged[merged.length - 1];
    if (prev && c.index - prev.index < minGap) {
      if (c.ratio < prev.ratio) merged[merged.length - 1] = c;
    } else {
      merged.push(c);
    }
  }
  if (closed && merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (n - last.index + first.index < minGap) {
      if (last.ratio < first.ratio) merged.shift();
      else merged.pop();
    }
  }
  return merged;
}

/* ── התאמת פרימיטיבים ─────────────────────────────────────────────── */

/**
 * התאמת קו בריבועים פחותים כוללים, דרך הרכיב הראשי של מטריצת השונויות.
 * בשונה מרגרסיה רגילה זה לא מעדיף את ציר ה-X, ולכן קו אנכי מטופל נכון.
 */
export function fitLine(pts) {
  const n = pts.length;
  const c = centroidOf(pts);
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  sxx /= n; sxy /= n; syy /= n;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dir = { x: Math.cos(theta), y: Math.sin(theta) };
  const nrm = { x: -dir.y, y: dir.x };
  let minT = Infinity, maxT = -Infinity, sse = 0;
  for (const p of pts) {
    const v = sub(p, c);
    const t = dot(v, dir);
    const d = dot(v, nrm);
    sse += d * d;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const rms = Math.sqrt(sse / n);
  const span = maxT - minT;
  const a = { x: c.x + dir.x * minT, y: c.y + dir.y * minT };
  const b = { x: c.x + dir.x * maxT, y: c.y + dir.y * maxT };
  /* שמירה על כיוון הציור: ההתחלה היא הקצה הקרוב לנקודה הראשונה */
  const forward = dist(pts[0], a) <= dist(pts[0], b);
  return {
    start: forward ? a : b,
    end: forward ? b : a,
    point: c,
    dir,
    span,
    rms,
    error: span > EPS ? rms / span : 1,
  };
}

/** התאמת מעגל בשיטת Kasa — פתרון לינארי סגור, ללא איטרציות */
export function fitCircle(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  const sol = solve3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], [-sxz, -syz, -sz]);
  if (!sol) return null;
  const [D, E, F] = sol;
  const cx = -D / 2, cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let sse = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r;
    sse += d * d;
  }
  const rms = Math.sqrt(sse / n);
  return { cx, cy, r, rms, error: r > EPS ? rms / r : 1 };
}

/**
 * התאמת אליפסה: הרכיבים הראשיים נותנים את הצירים והזווית, ואז שני רדיוסים
 * מתכווננים באיטרציות קצרות כדי למזער את הסטייה ממשוואת האליפסה.
 */
export function fitEllipse(pts) {
  const n = pts.length;
  if (n < 5) return null;
  const c = centroidOf(pts);
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - c.x, dy = p.y - c.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  sxx /= n; sxy /= n; syy /= n;
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u = { x: Math.cos(angle), y: Math.sin(angle) };
  let v = { x: -Math.sin(angle), y: Math.cos(angle) };

  const A = [], B = [];
  for (const p of pts) {
    const d = sub(p, c);
    A.push(dot(d, u));
    B.push(dot(d, v));
  }
  let rx = Math.max(...A.map(Math.abs));
  let ry = Math.max(...B.map(Math.abs));
  if (rx < EPS || ry < EPS) return null;

  /* כיוונון עדין — מרכז את השגיאה סביב האפס במקום להישען על הקיצון בלבד */
  for (let iter = 0; iter < 4; iter++) {
    let sa = 0, sb = 0, wa = 0, wb = 0;
    for (let i = 0; i < n; i++) {
      const f = Math.hypot(A[i] / rx, B[i] / ry);
      if (f < EPS) continue;
      const wA = (A[i] / rx) ** 2;
      const wB = (B[i] / ry) ** 2;
      sa += wA * (rx * f); wa += wA;
      sb += wB * (ry * f); wb += wB;
    }
    if (wa > EPS) rx = sa / wa;
    if (wb > EPS) ry = sb / wb;
  }

  if (rx < ry) {
    const t = rx; rx = ry; ry = t;
    angle += Math.PI / 2;
    const tu = u; u = v; v = { x: -tu.x, y: -tu.y };
  }

  let sse = 0, sseAbs = 0;
  for (let i = 0; i < n; i++) {
    const d = sub(pts[i], c);
    const f = Math.hypot(dot(d, u) / rx, dot(d, v) / ry);
    sse += (f - 1) * (f - 1);
    /* קירוב המרחק בפועל: כמה צריך להזיז את הנקודה לאורך הקרן מהמרכז */
    if (f > EPS) {
      const e = vlen(d) * (1 - 1 / f);
      sseAbs += e * e;
    }
  }
  const error = Math.sqrt(sse / n);
  const rms = Math.sqrt(sseAbs / n);
  while (angle > Math.PI / 2) angle -= Math.PI;
  while (angle < -Math.PI / 2) angle += Math.PI;
  return { cx: c.x, cy: c.y, rx, ry, angle, error, rms };
}

/** חיתוך שני קווים אינסופיים שמוגדרים כנקודה וכיוון */
function intersectLines(l1, l2) {
  const d1 = l1.dir, d2 = l2.dir;
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 0.12) return null;  // כמעט מקבילים — חיתוך לא יציב
  const p = sub(l2.point, l1.point);
  const t = (p.x * d2.y - p.y * d2.x) / den;
  return { x: l1.point.x + d1.x * t, y: l1.point.y + d1.y * t };
}

/** מרחק נקודה מקטע */
function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return dist(p, a);
  let t = dot(sub(p, a), ab) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

/** שגיאת התאמה ממוצעת של קבוצת נקודות למצולע, מנורמלת באלכסון התיבה */
function polygonError(pts, vertices, closed) {
  const k = vertices.length;
  if (k < 2) return 1;
  let sse = 0;
  for (const p of pts) {
    let best = Infinity;
    const last = closed ? k : k - 1;
    for (let i = 0; i < last; i++) {
      const d = distToSegment(p, vertices[i], vertices[(i + 1) % k]);
      if (d < best) best = d;
    }
    sse += best * best;
  }
  const rms = Math.sqrt(sse / pts.length);
  const diag = boundingBox(pts).diag;
  return { rms, error: diag > EPS ? rms / diag : 1 };
}

/**
 * בניית מצולע מתוך אינדקסי הפינות. כל צלע מותאמת כקו על הנקודות שבין שתי
 * פינות, כשהקצוות נחתכים כדי לא לתת לעיגול הפינה להטות את הכיוון. הקודקוד
 * הסופי הוא חיתוך שני הקווים השכנים — הרבה יותר מדויק מהנקודה הגולמית.
 */
export function fitPolygon(pts, cornerIdx, closed) {
  const n = pts.length;
  const k = cornerIdx.length;
  const edgeCount = closed ? k : k - 1;
  if (edgeCount < 1) return null;

  const lines = [];
  for (let j = 0; j < edgeCount; j++) {
    const a = cornerIdx[j];
    const b = cornerIdx[(j + 1) % k];
    const count = closed ? ((b - a + n) % n) : (b - a);
    if (count < 2) return null;
    const seg = [];
    for (let s = 0; s <= count; s++) seg.push(pts[(a + s) % n]);
    const trim = Math.floor(seg.length * 0.18);
    const core = seg.length - 2 * trim >= 3 ? seg.slice(trim, seg.length - trim) : seg;
    const lf = fitLine(core);
    lines.push({ fit: lf, straight: lf.error });
  }

  const vertices = [];
  if (closed) {
    for (let j = 0; j < k; j++) {
      const prev = lines[(j - 1 + k) % k].fit;
      const cur = lines[j].fit;
      const x = intersectLines(prev, cur);
      vertices.push(x || { ...pts[cornerIdx[j]] });
    }
  } else {
    vertices.push({ ...pts[cornerIdx[0]] });
    for (let j = 1; j < k - 1; j++) {
      const x = intersectLines(lines[j - 1].fit, lines[j].fit);
      vertices.push(x || { ...pts[cornerIdx[j]] });
    }
    vertices.push({ ...pts[cornerIdx[k - 1]] });
  }

  const pe = polygonError(pts, vertices, closed);
  return {
    vertices,
    edgeError: Math.max(...lines.map((l) => l.straight)),
    rms: pe.rms,
    error: pe.error,
  };
}

/* ── ייפוי ────────────────────────────────────────────────────────── */

/** הצמדת זווית קו לכפולות של 15 מעלות, עם סבילות רחבה יותר לצירים הראשיים */
export function snapLineAngle(start, end, tolDeg = DEFAULTS.angleSnapDeg) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const L = Math.hypot(dx, dy);
  if (L < EPS) return { start: { ...start }, end: { ...end }, snapped: false };
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 12;
  const target = Math.round(ang / step) * step;
  let diff = Math.abs(ang - target);
  while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
  const cardinal = Math.abs(target % (Math.PI / 2)) < 1e-6;
  const tol = rad(cardinal ? tolDeg + 3 : tolDeg);
  if (diff <= tol) {
    return {
      start: { ...start },
      end: { x: start.x + Math.cos(target) * L, y: start.y + Math.sin(target) * L },
      snapped: true,
    };
  }
  return { start: { ...start }, end: { ...end }, snapped: false };
}

const rotate = (v, a) => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

/** מלבן מיטבי בזווית נתונה: סיבוב הנקודות אחורה, תיבה תוחמת, סיבוב בחזרה */
function bestFitRect(pts, theta) {
  const c = centroidOf(pts);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const l = rotate(sub(p, c), -theta);
    if (l.x < minX) minX = l.x;
    if (l.x > maxX) maxX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.y > maxY) maxY = l.y;
  }
  const localCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const back = rotate(localCenter, theta);
  return {
    cx: c.x + back.x,
    cy: c.y + back.y,
    width: maxX - minX,
    height: maxY - minY,
    angle: theta,
  };
}

export function rectVertices(r) {
  const hw = r.width / 2, hh = r.height / 2;
  return [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ].map((v) => {
    const p = rotate(v, r.angle);
    return { x: r.cx + p.x, y: r.cy + p.y };
  });
}

/** זוויות פנימיות של מצולע סגור, ברדיאנים */
function interiorAngles(vertices) {
  const k = vertices.length;
  const out = [];
  for (let i = 0; i < k; i++) {
    const prev = vertices[(i - 1 + k) % k];
    const cur = vertices[i];
    const next = vertices[(i + 1) % k];
    const v1 = sub(prev, cur), v2 = sub(next, cur);
    const l1 = vlen(v1), l2 = vlen(v2);
    out.push(l1 < EPS || l2 < EPS ? 0 : Math.acos(clamp(dot(v1, v2) / (l1 * l2), -1, 1)));
  }
  return out;
}

function sideLengths(vertices) {
  const k = vertices.length;
  const out = [];
  for (let i = 0; i < k; i++) out.push(dist(vertices[i], vertices[(i + 1) % k]));
  return out;
}

/** בניית מצולע משוכלל מדויק סביב אותו מרכז ואותו רדיוס ממוצע */
function makeRegular(vertices) {
  const k = vertices.length;
  const c = centroidOf(vertices);
  const R = mean(vertices.map((v) => dist(c, v)));
  let a0 = Math.atan2(vertices[0].y - c.y, vertices[0].x - c.x);
  const step = rad(15);
  const snapped = Math.round(a0 / step) * step;
  if (Math.abs(a0 - snapped) < rad(7)) a0 = snapped;
  const out = [];
  for (let i = 0; i < k; i++) {
    const a = a0 + (2 * Math.PI * i) / k;
    out.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
  }
  return out;
}

/** הצמדת משולש לזווית ישרה מדויקת כשאחת מזוויותיו קרובה ל-90 מעלות */
function snapRightTriangle(vertices, tolDeg) {
  const angles = interiorAngles(vertices);
  let bi = -1, bd = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(deg(angles[i]) - 90);
    if (d < bd) { bd = d; bi = i; }
  }
  if (bd > tolDeg) return null;
  const C = vertices[bi];
  const A = vertices[(bi + 2) % 3];
  const B = vertices[(bi + 1) % 3];
  const v1 = sub(A, C), v2 = sub(B, C);
  const signed = Math.atan2(v1.x * v2.y - v1.y * v2.x, dot(v1, v2));
  const target = (signed >= 0 ? 1 : -1) * (Math.PI / 2);
  const delta = target - signed;
  const nA = rotate(v1, -delta / 2);
  const nB = rotate(v2, delta / 2);
  const out = new Array(3);
  out[bi] = { ...C };
  out[(bi + 2) % 3] = { x: C.x + nA.x, y: C.y + nA.y };
  out[(bi + 1) % 3] = { x: C.x + nB.x, y: C.y + nB.y };
  return out;
}

/**
 * הופך מצולע גולמי לצורה נקייה: מלבן או ריבוע כשכל הזוויות ישרות, מצולע
 * משוכלל כשכל הצלעות והזוויות שוות, ומשולש ישר־זווית כשיש זווית של 90.
 */
function regularizePolygon(vertices, srcPts, cfg, quadRms) {
  const k = vertices.length;
  const angles = interiorAngles(vertices).map(deg);
  const sides = sideLengths(vertices);
  const meanSide = mean(sides);
  const sideSpread = meanSide > EPS ? Math.max(...sides.map((s) => Math.abs(s - meanSide))) / meanSide : 1;
  const expected = 180 - 360 / k;
  const angleSpread = Math.max(...angles.map((a) => Math.abs(a - expected)));

  if (k === 4) {
    /* כיוון הצלע הדומיננטי — ממוצע מעגלי על פי ארבע כדי לאחד את ארבעת הכיוונים */
    let sx = 0, sy = 0;
    for (let i = 0; i < 4; i++) {
      const d = sub(vertices[(i + 1) % 4], vertices[i]);
      const a = Math.atan2(d.y, d.x);
      sx += Math.cos(4 * a); sy += Math.sin(4 * a);
    }
    let theta = Math.atan2(sy, sx) / 4;
    if (Math.abs(theta) < rad(5)) theta = 0;
    const rect = bestFitRect(srcPts, theta);
    /* מלבן נבחר רק אם הוא כמעט לא מרע את ההתאמה מול המרובע הגולמי. זה
       מדויק יותר מסף זווית קבוע, ומחזיק גם כשהיד רעדה בפינה אחת. */
    const diag = boundingBox(srcPts).diag;
    const rectRms = polygonError(srcPts, rectVertices(rect), true).rms;
    if (rectRms <= quadRms * 1.45 + 0.004 * diag) {
      const long = Math.max(rect.width, rect.height);
      if (long > EPS && Math.abs(rect.width - rect.height) / long <= cfg.squareTol) {
        const s = (rect.width + rect.height) / 2;
        rect.width = s; rect.height = s;
        return { kind: 'rect', rect, square: true };
      }
      return { kind: 'rect', rect, square: false };
    }
  }

  if (k === 3) {
    if (sideSpread <= 0.12) return { kind: 'polygon', vertices: makeRegular(vertices), regular: true };
    const right = snapRightTriangle(vertices, cfg.rightAngleTolDeg);
    if (right) return { kind: 'polygon', vertices: right, regular: false, rightAngle: true };
    return { kind: 'polygon', vertices, regular: false };
  }

  if (k >= 5 && sideSpread <= cfg.regularTol && angleSpread <= expected * cfg.regularTol) {
    return { kind: 'polygon', vertices: makeRegular(vertices), regular: true };
  }

  return { kind: 'polygon', vertices, regular: false };
}

/* ── חץ ───────────────────────────────────────────────────────────── */

/**
 * חץ נמצא כשיש גוף ישר שמגיע לקצה רחוק, ואחריו זנב קצר שמקפל אחורה לכיוון
 * ההתחלה. זה תופס גם חץ עם פאה אחת וגם חץ עם שתי פאות, ודוחה סימני וי,
 * וו וזווית — שבהם הנקודה הרחוקה ביותר היא סוף המשיכה עצמה.
 */
export function detectArrow(rs, cfg) {
  const n = rs.length;
  if (n < 16) return null;
  let tipIdx = 0, shaft = 0;
  for (let i = 1; i < n; i++) {
    const d = dist(rs[0], rs[i]);
    if (d > shaft) { shaft = d; tipIdx = i; }
  }
  if (shaft < EPS) return null;
  if (tipIdx < n * 0.4 || tipIdx > n - 5) return null;

  const shaftFit = fitLine(rs.slice(0, tipIdx + 1));
  if (shaftFit.error > 0.065) return null;

  const tip = rs[tipIdx];
  const tail = rs.slice(tipIdx);
  let head = 0;
  for (const p of tail) head = Math.max(head, dist(tip, p));
  if (head > 0.55 * shaft || head < 0.07 * shaft) return null;

  const back = sub(rs[0], tip);
  const tailDir = sub(rs[n - 1], tip);
  const bl = vlen(back), tl = vlen(tailDir);
  if (bl < EPS || tl < EPS) return null;
  const cos = dot(back, tailDir) / (bl * tl);
  if (cos < 0.15) return null;                      // הזנב לא מקפל אחורה
  if (Math.acos(clamp(cos, -1, 1)) > rad(75)) return null;

  const line = snapLineAngle(rs[0], tip, cfg.angleSnapDeg);
  return {
    type: 'arrow',
    confidence: clamp01(1 - shaftFit.error / 0.065) * 0.45 + 0.55,
    start: line.start,
    end: line.end,
    headLength: head,
  };
}

/* ── קשת ──────────────────────────────────────────────────────────── */

/** הזווית הכוללת שהמסלול סוחף סביב מרכז נתון, עם סימן שמעיד על כיוון */
export function sweepAround(pts, cx, cy) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1].y - cy, pts[i - 1].x - cx);
    const a2 = Math.atan2(pts[i].y - cy, pts[i].x - cx);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return total;
}

/**
 * הסרת פינות מדומות. יד רועדת מייצרת לעיתים קודקוד נוסף באמצע צלע ישרה,
 * ואז ריבוע הופך למחומש. כאן נבדקת הזווית בפועל בין שתי הצלעות השכנות
 * אחרי ההתאמה, והקודקוד השטוח ביותר מוסר כל עוד הוא כמעט ישר.
 */
export function pruneCollinearCorners(pts, idx, closed, minTurnDeg = 14) {
  let cur = [...idx];
  while (cur.length > 3) {
    const poly = fitPolygon(pts, cur, closed);
    if (!poly) break;
    const verts = poly.vertices;
    const k = verts.length;
    let worst = -1, worstTurn = Infinity;
    for (let i = 0; i < k; i++) {
      if (!closed && (i === 0 || i === k - 1)) continue;
      const prev = verts[(i - 1 + k) % k];
      const cu = verts[i];
      const nx = verts[(i + 1) % k];
      const v1 = sub(cu, prev), v2 = sub(nx, cu);
      const l1 = vlen(v1), l2 = vlen(v2);
      if (l1 < EPS || l2 < EPS) continue;
      const turn = deg(Math.acos(clamp(dot(v1, v2) / (l1 * l2), -1, 1)));
      if (turn < worstTurn) { worstTurn = turn; worst = i; }
    }
    if (worst < 0 || worstTurn >= minTurnDeg) break;
    cur.splice(worst, 1);
  }
  return cur;
}

/* ── סיווג ────────────────────────────────────────────────────────── */

/*
 * במקום שרשרת תנאים לפי סדר, כל מודל מתחרה על אותו סולם אחד: שורש ממוצע
 * ריבועי המרחק בין הנקודות שצוירו לבין הצורה המותאמת, חלקי אלכסון התיבה
 * התוחמת. כלומר "כמה אחוז מגודל הצורה המשתמש פספס בממוצע". מודל עשיר
 * בפרמטרים תמיד יכול להתאים טוב יותר, ולכן הוא סופג קנס מורכבות — כך
 * שמצולע בן שמונה צלעות לא ינצח מעגל רק מפני שיש לו יותר דרגות חופש.
 */

function uniqueSorted(arr) {
  return [...new Set(arr)].sort((a, b) => a - b);
}

function pickBest(candidates, cfg) {
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (best.raw > cfg.fitTol) return null;
  const result = best.make();
  if (!result) return null;
  result.confidence = clamp01(1 - best.raw / cfg.fitTol) * 0.35 + 0.62;
  result.fitError = best.raw;
  return result;
}

function recognizeOpen(rs, corners, total, cfg) {
  const n = rs.length;

  /* חץ הוא זיהוי מבני ולא התאמת עקומה, ולכן הוא נבדק בנפרד ולפני כולם */
  const arrow = detectArrow(rs, cfg);
  if (arrow) return arrow;

  const diag = boundingBox(rs).diag;
  if (diag < EPS) return null;
  const candidates = [];

  /* קו ישר */
  const lf = fitLine(rs);
  /* נמדד מול המוטה על הקו המותאם ולא מול אורך המסלול, שרעש היד מנפח.
     המטרה היא לפסול משיכה שהלכה וחזרה, ושם המיתר קטן אבל המוטה גדול. */
  const straightness = lf.span > EPS ? dist(rs[0], rs[n - 1]) / lf.span : 0;
  if (straightness > 0.82) {
    candidates.push({
      raw: lf.rms / diag,
      score: lf.rms / diag,
      make: () => {
        const s = snapLineAngle(lf.start, lf.end, cfg.angleSnapDeg);
        return { type: 'line', start: s.start, end: s.end, snappedAngle: s.snapped };
      },
    });
  }

  /* קשת או עיקול. בדיקת הסחיפה מונעת מקו כמעט ישר להתחזות לקשת של מעגל
     ענק, שבו השגיאה היחסית תמיד זעירה אבל הסחיפה אפסית. */
  const cf = fitCircle(rs);
  if (cf) {
    const sweep = sweepAround(rs, cf.cx, cf.cy);
    const abs = Math.abs(sweep);
    if (abs >= rad(30) && abs <= rad(340)) {
      candidates.push({
        raw: cf.rms / diag,
        score: (cf.rms / diag) * 1.15,
        make: () => {
          if (abs <= rad(160)) {
            const mid = rs[Math.floor(n / 2)];
            return {
              type: 'curve',
              start: { ...rs[0] },
              end: { ...rs[n - 1] },
              cp: {
                x: 2 * mid.x - 0.5 * rs[0].x - 0.5 * rs[n - 1].x,
                y: 2 * mid.y - 0.5 * rs[0].y - 0.5 * rs[n - 1].y,
              },
            };
          }
          return {
            type: 'arc',
            cx: cf.cx, cy: cf.cy, r: cf.r,
            startAngle: Math.atan2(rs[0].y - cf.cy, rs[0].x - cf.cx),
            sweep,
          };
        },
      });
    }
  }

  /* שרשרת קטעים ישרים */
  if (corners.length >= 1 && corners.length <= 5) {
    const idx = uniqueSorted([
      0,
      ...corners.map((c) => c.index).filter((i) => i > 2 && i < n - 3),
      n - 1,
    ]);
    if (idx.length >= 3) {
      const pruned = pruneCollinearCorners(rs, idx, false);
      const poly = fitPolygon(rs, pruned, false);
      if (poly && poly.edgeError <= cfg.edgeTol) {
        candidates.push({
          raw: poly.rms / diag,
          score: (poly.rms / diag) * (1 + 0.04 * (pruned.length - 2)) + 0.0025,
          make: () => ({ type: 'polyline', points: poly.vertices }),
        });
      }
    }
  }

  return pickBest(candidates, cfg);
}

function recognizeClosed(rs, corners, cfg) {
  const diag = boundingBox(rs).diag;
  if (diag < EPS) return null;
  const sharp = corners.length;
  const candidates = [];

  const cf = fitCircle(rs);
  if (cf) {
    candidates.push({
      raw: cf.rms / diag,
      score: cf.rms / diag,
      make: () => ({ type: 'circle', cx: cf.cx, cy: cf.cy, r: cf.r }),
    });
  }

  const ef = fitEllipse(rs);
  if (ef) {
    candidates.push({
      raw: ef.rms / diag,
      score: (ef.rms / diag) * 1.15,
      make: () => {
        if (ef.ry > EPS && ef.rx / ef.ry <= 1.12) {
          return { type: 'circle', cx: ef.cx, cy: ef.cy, r: (ef.rx + ef.ry) / 2 };
        }
        let angle = ef.angle;
        if (Math.abs(angle) < rad(8)) angle = 0;
        return { type: 'ellipse', cx: ef.cx, cy: ef.cy, rx: ef.rx, ry: ef.ry, angle };
      },
    });
  }

  if (sharp >= 3 && sharp <= 10) {
    const pruned = pruneCollinearCorners(rs, corners.map((c) => c.index), true);
    const poly = fitPolygon(rs, pruned, true);
    if (poly && pruned.length <= 8) {
      candidates.push({
        raw: poly.rms / diag,
        score: (poly.rms / diag) * (1 + 0.04 * (pruned.length - 3)) + 0.0025,
        make: () => {
          const reg = regularizePolygon(poly.vertices, rs, cfg, poly.rms);
          if (reg.kind === 'rect') {
            return { type: 'rect', ...reg.rect, square: reg.square };
          }
          return {
            type: 'polygon',
            points: reg.vertices,
            regular: !!reg.regular,
            rightAngle: !!reg.rightAngle,
            sides: reg.vertices.length,
          };
        },
      });
    }
  }

  return pickBest(candidates, cfg);
}

/**
 * הפונקציה הראשית. מקבלת נקודות במרחב הלוח ומחזירה תיאור גיאומטרי נקי,
 * או null כשאין התאמה משכנעת — ואז הקורא משאיר את הדיו החופשי כמו שהוא.
 *
 * options.scale הוא יחידות לוח לפיקסל מסך, כלומר אחד חלקי הזום. כל הספים
 * שמוגדרים בפיקסלי מסך מוכפלים בו, כדי שהזיהוי יתנהג זהה בכל רמת זום.
 */
export function recognizeShape(rawPoints, options = {}) {
  if (!rawPoints || rawPoints.length < 4) return null;
  const cfg = { ...DEFAULTS, ...options };
  const scale = options.scale || 1;

  const pts = dedupe(rawPoints, 0.6 * scale);
  if (pts.length < 5) return null;

  const total = pathLength(pts);
  if (total < cfg.minStrokeLength * scale) return null;
  const bb = boundingBox(pts);
  if (bb.diag < cfg.minSpan * scale) return null;

  const rs = resample(pts, cfg.samples);
  const gap = dist(rs[0], rs[rs.length - 1]);
  const closed = gap < cfg.closedGapRatio * total && gap < 0.45 * boundingBox(rs).diag;

  const corners = detectCorners(rs, {
    closed,
    cornerWindow: cfg.cornerWindow,
    cornerRatio: cfg.cornerRatio,
  });

  const result = closed
    ? recognizeClosed(rs, corners, cfg)
    : recognizeOpen(rs, corners, total, cfg);

  if (!result) return null;
  if (result.confidence < cfg.minConfidence) return null;
  result.closed = closed;
  result.cornerCount = corners.length;
  return result;
}

/* ── החלקת דיו חופשי ──────────────────────────────────────────────── */

/** פישוט Ramer-Douglas-Peucker — מסיר נקודות מיותרות בלי לשנות את הצורה */
export function simplifyRDP(points, epsilon) {
  const n = points.length;
  if (n < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * הפיכת רשימת נקודות לנתיב חלק. כל קטע הופך לעקומת בזייה מעוקבת שנגזרת
 * מספליין קטמול־רום, כך שהקו נראה זורם במקום משונן — וגם קצר בהרבה
 * לאחסון מרשימת קטעים ישרים.
 */
export function smoothPathData(points) {
  const n = points.length;
  if (n < 2) return '';
  if (n === 2) {
    return `M ${r2(points[0].x)} ${r2(points[0].y)} L ${r2(points[1].x)} ${r2(points[1].y)}`;
  }
  let d = `M ${r2(points[0].x)} ${r2(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${r2(c1.x)} ${r2(c1.y)} ${r2(c2.x)} ${r2(c2.y)} ${r2(p2.x)} ${r2(p2.y)}`;
  }
  return d;
}

/** צינור מלא לדיו חופשי: פישוט ואז החלקה */
export function buildInkPath(points, epsilon = 0.9) {
  const simplified = simplifyRDP(dedupe(points, epsilon * 0.5), epsilon);
  return smoothPathData(simplified);
}
