import assert from 'node:assert/strict';
import { detectScribble } from '../src/utils/scribble.js';
let pass = 0, fail = 0;
const test = (n, f) => { try { f(); pass++; console.log('PASS |', n); } catch (e) { fail++; console.log('FAIL |', n, e.message); } };
const zig = (passes, w = 120, h = 40) => {
    const out = [];
    for (let k = 0; k < passes; k++) for (let i = 0; i <= 12; i++) {
        const t = i / 12; const x = k % 2 ? w * (1 - t) : w * t; out.push({ x, y: (k / passes) * h + 2 * Math.sin(i) });
    }
    return out;
};
console.log('\nקישקוש מחיקה');
test('קישקוש של שש מעברים מזוהה', () => assert.ok(detectScribble(zig(6))));
test('קו ישר אינו קישקוש', () => assert.equal(detectScribble(Array.from({ length: 40 }, (_, i) => ({ x: i * 5, y: 0 }))), null));
test('עיגול אינו קישקוש', () => assert.equal(detectScribble(Array.from({ length: 80 }, (_, i) => ({ x: 100 + 60 * Math.cos(i / 12.7), y: 100 + 60 * Math.sin(i / 12.7) }))), null));
test('מעבר אחד הלוך וחזור אינו קישקוש', () => assert.equal(detectScribble(zig(2)), null));
test('קישקוש ענק אינו נחשב', () => assert.equal(detectScribble(zig(8, 900, 700)), null));
console.log(`\n${pass} עברו, ${fail} נכשלו`); if (fail) process.exit(1);
