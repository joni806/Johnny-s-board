import assert from 'node:assert/strict';
import {
    normalizeLayout, pageSize, layoutPages, pageCountFor, pagesBounds, constrainView, fitZoom,
    viewForPage, currentPageIndex, zoomRangeFor, DEFAULT_LAYOUT,
} from '../src/utils/pages.js';
let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('PASS |', n); } catch (e) { fail++; console.log('FAIL |', n, e.message); } };
const L = (o) => normalizeLayout({ ...DEFAULT_LAYOUT, ...o });
console.log('\nפריסת דפים');
test('פריסה פגומה מתנקה לברירת מחדל', () => {
    assert.deepEqual(normalizeLayout(null), DEFAULT_LAYOUT);
    const n = normalizeLayout({ mode: 'x', scale: 'abc', pages: -4, gap: 9999, paper: 'zzz' });
    assert.equal(n.mode, 'infinite'); assert.equal(n.scale, 100); assert.equal(n.pages, 1); assert.equal(n.gap, 200); assert.equal(n.paper, 'a4');
});
test('A4 לאורך ולרוחב', () => {
    const p = pageSize(L({})), q = pageSize(L({ orientation: 'landscape' }));
    assert.ok(p.h > p.w); assert.equal(q.w, p.h); assert.equal(q.h, p.w);
});
test('שקף 16:9 לרוחב, ולאורך כשמבקשים', () => {
    assert.ok(pageSize(L({ paper: 'slide169', orientation: 'landscape' })).w > pageSize(L({ paper: 'slide169', orientation: 'landscape' })).h);
    assert.ok(pageSize(L({ paper: 'slide169', orientation: 'portrait' })).h > pageSize(L({ paper: 'slide169', orientation: 'portrait' })).w);
});
test('קנה מידה משנה את הדף באותו יחס', () => {
    const a = pageSize(L({ scale: 100 })), b = pageSize(L({ scale: 200 }));
    assert.ok(Math.abs(b.w / a.w - 2) < 0.01 && Math.abs(b.h / a.h - 2) < 0.01);
});
test('גודל מותאם אישית', () => {
    const p = pageSize(L({ paper: 'custom', customW: 100, customH: 50, orientation: 'landscape' }));
    assert.ok(Math.abs(p.w / p.h - 2) < 0.02);
});
test('דפים אנכיים ואופקיים', () => {
    const v = layoutPages(L({ mode: 'vertical' }), 3), h = layoutPages(L({ mode: 'horizontal' }), 3);
    assert.equal(v[2].x, 0); assert.ok(v[2].y > v[1].y); assert.equal(h[2].y, 0); assert.ok(h[2].x > h[1].x);
    assert.equal(v[1].y, v[0].h + 36);
});
test('מספר דפים אוטומטי גדל עם הכתב', () => {
    const l = L({ mode: 'vertical', pages: 2 }); const { h } = pageSize(l);
    assert.equal(pageCountFor(l, null), 2);
    assert.equal(pageCountFor(l, { left: 0, top: 0, right: 10, bottom: h * 0.5 }), 2);
    assert.equal(pageCountFor(l, { left: 0, top: 0, right: 10, bottom: (h + 36) * 3 + 5 }), 5);
    assert.equal(pageCountFor(L({ mode: 'vertical', count: 'fixed', pages: 4 }), { left: 0, top: 0, right: 10, bottom: 99999 }), 4);
});
test('המצלמה לא בורחת מהדפים', () => {
    const l = L({ mode: 'vertical' }); const pages = layoutPages(l, 4); const b = pagesBounds(pages);
    const out = constrainView([1, 0, 0, 1, 5000, 99999], b, 1000, 800, null);
    assert.ok(out[4] <= 1000 && out[5] <= 800);
    const out2 = constrainView([1, 0, 0, 1, -99999, -99999], b, 1000, 800, null);
    assert.ok(out2[5] + b.bottom * 1 >= 800 - 60 - 1);
});
test('תוכן קטן מהמסך ממורכז', () => {
    const b = { left: 0, top: 0, right: 100, bottom: 100 };
    const out = constrainView([1, 0, 0, 1, 7, 7], b, 1000, 800, null);
    assert.equal(out[4], 450); assert.equal(out[5], 350);
});
test('התאמה לרוחב ואחיזה בדף', () => {
    const l = L({ mode: 'vertical' }); const z = fitZoom(l, 1000, 700); const { w } = pageSize(l);
    assert.ok(Math.abs(w * z - 952) < 1);
    const page = layoutPages(l, 3)[1]; const v = viewForPage(page, z, 1000, 700);
    assert.equal(currentPageIndex(layoutPages(l, 3), v, 1000, 700, l), 1);
});
test('טווח הזום סביב ההתאמה', () => {
    const l = L({ mode: 'single' }); const r = zoomRangeFor(l, 1000, 700); const f = fitZoom(l, 1000, 700);
    assert.ok(r.min < f && r.max > f);
    const out = constrainView([100, 0, 0, 100, 0, 0], { left: 0, top: 0, right: 500, bottom: 700 }, 1000, 700, r);
    assert.equal(out[0], r.max);
});
console.log(`\n${pass} עברו, ${fail} נכשלו`); if (fail) process.exit(1);
