/**
 * בדיקות למנוע הדיו הרגיש ללחץ.
 * רצות ב־Node בלי דפדפן: node tests/ink.test.mjs
 */
import assert from 'node:assert/strict';
import { createInkStroke, buildPressurePath, dotPath, INK_DEFAULTS } from '../src/utils/ink.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
    try { fn(); pass++; console.log(`  ok   ${name}`); }
    catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message}`); }
};

/** ממיר נתיב למערך נקודות, כדי למדוד רוחב רצועה בפועל */
const pathPoints = (d) => {
    const nums = d.match(/-?\d+(\.\d+)?/g) || [];
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: +nums[i], y: +nums[i + 1] });
    return out;
};

const sample = (x, y, p, t, pen = true) => ({ x, y, p, tx: 0, ty: 0, t, pen });

const straight = (n, pressure) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(sample(i * 4, 100, typeof pressure === 'function' ? pressure(i / (n - 1)) : pressure, i * 10));
    return out;
};

console.log('\nמנוע דיו — לחץ והטיה');

test('משיכה ריקה לא מייצרת נתיב', () => {
    const s = createInkStroke();
    assert.equal(s.toPathData(), '');
    assert.equal(s.isEmpty, true);
});

test('נקירה בודדת מייצרת נקודה עגולה סגורה', () => {
    const s = createInkStroke({ baseWidth: 4 });
    s.push(sample(10, 10, 0.5, 0));
    const d = s.toPathData();
    assert.ok(d.startsWith('M '), 'נתיב מתחיל ב-M');
    assert.ok(d.trim().endsWith('Z'), 'נתיב סגור');
    assert.equal((d.match(/C /g) || []).length, 4, 'ארבע עקומות למעגל');
});

test('נתיב המשיכה סגור ומתחיל ב-M', () => {
    const d = buildPressurePath(straight(25, 0.6));
    assert.ok(d.startsWith('M '));
    assert.ok(d.trim().endsWith('Z'));
});

test('לחץ גבוה מייצר רצועה רחבה יותר מלחץ נמוך', () => {
    const wide = pathPoints(buildPressurePath(straight(40, 0.95), { baseWidth: 6 }));
    const thin = pathPoints(buildPressurePath(straight(40, 0.1), { baseWidth: 6 }));
    const spread = (pts) => {
        const ys = pts.map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
    };
    assert.ok(spread(wide) > spread(thin) * 1.5, `רחב ${spread(wide).toFixed(2)} מול דק ${spread(thin).toFixed(2)}`);
});

test('רוחב הרצועה קרוב לרוחב הבסיס בלחץ בינוני', () => {
    const pts = pathPoints(buildPressurePath(straight(60, 0.55), { baseWidth: 8 }));
    const mid = pts.filter((p) => p.x > 80 && p.x < 140);
    const ys = mid.map((p) => p.y);
    const spread = Math.max(...ys) - Math.min(...ys);
    assert.ok(spread > 3 && spread < 13, `רוחב בפועל ${spread.toFixed(2)} עבור בסיס 8`);
});

test('לחץ עולה מייצר קו שמתעבה לאורכו', () => {
    const d = buildPressurePath(straight(60, (t) => 0.05 + 0.9 * t), { baseWidth: 8 });
    const pts = pathPoints(d);
    const spreadNear = (x0) => {
        const win = pts.filter((p) => Math.abs(p.x - x0) < 14);
        if (win.length < 2) return 0;
        const ys = win.map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
    };
    assert.ok(spreadNear(180) > spreadNear(60) * 1.3, `סוף ${spreadNear(180).toFixed(2)} מול התחלה ${spreadNear(60).toFixed(2)}`);
});

test('הטיית עט מרחיבה את הקו', () => {
    const flat = straight(40, 0.5).map((s) => ({ ...s, tx: 70, ty: 30 }));
    const upright = straight(40, 0.5);
    const spread = (samples) => {
        const pts = pathPoints(buildPressurePath(samples, { baseWidth: 6 }));
        const ys = pts.map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
    };
    assert.ok(spread(flat) > spread(upright) * 1.05, 'קו מוטה רחב יותר');
});

test('עכבר ללא לחץ נופל למהירות — איטי עבה ממהיר', () => {
    const slow = [], fast = [];
    for (let i = 0; i < 40; i++) {
        slow.push({ x: i * 1.2, y: 50, p: 0.5, tx: 0, ty: 0, t: i * 16, pen: false });
        fast.push({ x: i * 14, y: 50, p: 0.5, tx: 0, ty: 0, t: i * 16, pen: false });
    }
    const spread = (samples) => {
        const pts = pathPoints(buildPressurePath(samples, { baseWidth: 6 }));
        const ys = pts.map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
    };
    assert.ok(spread(slow) > spread(fast), `איטי ${spread(slow).toFixed(2)} מול מהיר ${spread(fast).toFixed(2)}`);
});

test('הקצוות דקים מהאמצע — דעיכת חוד', () => {
    const pts = pathPoints(buildPressurePath(straight(70, 0.8), { baseWidth: 10 }));
    const spreadIn = (lo, hi) => {
        const win = pts.filter((p) => p.x >= lo && p.x <= hi);
        if (win.length < 2) return 0;
        const ys = win.map((p) => p.y);
        return Math.max(...ys) - Math.min(...ys);
    };
    const head = spreadIn(-4, 1.5);
    const mid = spreadIn(120, 145);
    assert.ok(head < mid * 0.7, `קצה ${head.toFixed(2)} מול אמצע ${mid.toFixed(2)}`);
});

test('push מחזיר מרובע לציור חי', () => {
    const s = createInkStroke();
    assert.equal(s.push(sample(0, 0, 0.5, 0)), null, 'הדגימה הראשונה לא מייצרת קטע');
    const step = s.push(sample(9, 0, 0.6, 10));
    assert.ok(step && step.quad.length === 4, 'קטע בן ארבע פינות');
    assert.ok(step.tip.r > 0, 'רדיוס חיובי לעיגול המפרק');
});

test('הדגימות הגולמיות נשמרות למנוע הזיהוי', () => {
    const s = createInkStroke();
    const input = straight(30, 0.5);
    input.forEach((p) => s.push(p));
    assert.equal(s.rawPoints.length, input.length);
    assert.equal(s.rawPoints[0].x, input[0].x);
});

test('דגימות צפופות מאוד לא מנפחות את הנתיב', () => {
    const s = createInkStroke();
    for (let i = 0; i < 400; i++) s.push(sample(i * 0.05, 0, 0.5, i));
    assert.ok(s.count < 60, `רק ${s.count} צמתים מתוך 400 דגימות`);
});

test('שינוי רוחב מוגבל בקצב גם כשהלחץ קופץ', () => {
    const jumpy = [];
    for (let i = 0; i < 30; i++) jumpy.push(sample(i * 5, 0, i % 2 ? 0.05 : 0.98, i * 10));
    const s = createInkStroke({ baseWidth: 8 });
    jumpy.forEach((p) => s.push(p));
    const hs = s.nodes.map((n) => n.h);
    for (let i = 1; i < hs.length; i++) {
        assert.ok(Math.abs(hs[i] - hs[i - 1]) <= 4 * INK_DEFAULTS.maxWidthDelta + 1e-6, 'קפיצת רוחב חורגת מהתקרה');
    }
});

test('dotPath מייצר מעגל במיקום ובגודל הנכונים', () => {
    const pts = pathPoints(dotPath(50, 60, 5));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 50) < 0.5);
    assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 60) < 0.5);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 10) < 0.5);
});

test('אין ערכי NaN בנתיב', () => {
    const d = buildPressurePath(straight(50, 0.7));
    assert.ok(!/NaN|undefined/.test(d), 'הנתיב נקי');
});

test('משיכה עם נקודות חופפות לא מפילה את המנוע', () => {
    const s = createInkStroke();
    for (let i = 0; i < 20; i++) s.push(sample(10, 10, 0.5, i));
    const d = s.toPathData();
    assert.ok(!/NaN/.test(d));
});

console.log(`\n  עברו ${pass}, נכשלו ${fail}\n`);
if (fail) process.exit(1);
