/**
 * בדיקות להעדפות המכשיר ולקריאת העט: כפתור הצד, קצה מחק ודחיית כף יד.
 * node tests/device.test.mjs
 */
import assert from 'node:assert/strict';
import {
    defaultDevicePrefs, sanitizeDevicePrefs, loadDevicePrefs, saveDevicePrefs, isPenOnly,
    isBarrelPressed, isEraserTip, isPenContact, isLikelyPalm, PEN_BUTTON_ACTIONS, PALM_WINDOW_MS,
} from '../src/utils/device.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
    try { fn(); pass++; console.log(`PASS | ${name}`); }
    catch (err) { fail++; console.log(`FAIL | ${name}\n       ${err.message}`); }
};
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

console.log('\nהעדפות המכשיר והעט');

test('ברירת מחדל: כפתור הצד מוחק, מצב רק־עט אוטומטי', () => {
    const d = defaultDevicePrefs();
    assert.equal(d.penButton, 'erase');
    assert.equal(d.penOnly, null);
    assert.equal(isPenOnly(d), false);
});

test('מצב רק־עט נדלק מעצמו אחרי שזוהה עט', () => {
    assert.equal(isPenOnly({ ...defaultDevicePrefs(), penSeen: true }), true);
});

test('בחירה מפורשת גוברת על הזיהוי האוטומטי', () => {
    assert.equal(isPenOnly({ ...defaultDevicePrefs(), penSeen: true, penOnly: false }), false);
    assert.equal(isPenOnly({ ...defaultDevicePrefs(), penSeen: false, penOnly: true }), true);
});

test('ערכים פגומים מהאחסון מוחלפים בברירת מחדל', () => {
    const s = sanitizeDevicePrefs({ penButton: 'explode', penOnly: 'yes', lowLatency: 1 });
    assert.equal(s.penButton, 'erase');
    assert.equal(s.penOnly, null);
    assert.equal(s.lowLatency, false);
});

test('כל פעולות הכפתור נשמרות ונטענות', () => {
    for (const a of PEN_BUTTON_ACTIONS) {
        const store = memStore();
        saveDevicePrefs({ ...defaultDevicePrefs(), penButton: a.id }, store);
        assert.equal(loadDevicePrefs(store).penButton, a.id);
    }
});

test('JSON שבור באחסון לא מפיל את הטעינה', () => {
    const store = memStore();
    store.setItem('pb_device_v1', '{oops');
    assert.deepEqual(loadDevicePrefs(store), defaultDevicePrefs());
});

test('כפתור הצד מזוהה לפי button 2 או לפי ביט 2', () => {
    assert.equal(isBarrelPressed({ pointerType: 'pen', button: 2, buttons: 2 }), true);
    assert.equal(isBarrelPressed({ pointerType: 'pen', button: 0, buttons: 3 }), true);
    assert.equal(isBarrelPressed({ pointerType: 'pen', button: 0, buttons: 1 }), false);
    assert.equal(isBarrelPressed({ pointerType: 'mouse', button: 2, buttons: 2 }), false);
});

test('קצה מחק מזוהה לפי button 5 או ביט 32', () => {
    assert.equal(isEraserTip({ pointerType: 'pen', button: 5, buttons: 32 }), true);
    assert.equal(isEraserTip({ pointerType: 'pen', button: -1, buttons: 32 }), true);
    assert.equal(isEraserTip({ pointerType: 'pen', button: 0, buttons: 1 }), false);
});

test('מגע של עט: לחץ או ביט החוד. ריחוף עם כפתור אינו מגע', () => {
    assert.equal(isPenContact({ pointerType: 'pen', pressure: 0.4, buttons: 2 }), true);
    assert.equal(isPenContact({ pointerType: 'pen', pressure: 0, buttons: 1 }), true);
    assert.equal(isPenContact({ pointerType: 'pen', pressure: 0, buttons: 2 }), false);
    assert.equal(isPenContact({ pointerType: 'touch', pressure: 0, buttons: 1 }), true);
});

test('כף יד: מגע בזמן שהעט על המסך', () => {
    assert.equal(isLikelyPalm({ pointerType: 'touch', timeStamp: 5000, width: 10, height: 10 }, { penDown: true }), true);
});

test('כף יד: מגע מיד אחרי שהעט ריחף', () => {
    assert.equal(isLikelyPalm({ pointerType: 'touch', timeStamp: 5000, width: 10, height: 10 }, { lastPenAt: 5000 - PALM_WINDOW_MS / 2 }), true);
    assert.equal(isLikelyPalm({ pointerType: 'touch', timeStamp: 5000, width: 10, height: 10 }, { lastPenAt: 5000 - PALM_WINDOW_MS * 3 }), false);
});

test('כף יד: משטח מגע גדול', () => {
    assert.equal(isLikelyPalm({ pointerType: 'touch', timeStamp: 5000, width: 90, height: 70 }, {}), true);
    assert.equal(isLikelyPalm({ pointerType: 'touch', timeStamp: 5000, width: 18, height: 20 }, {}), false);
});

test('עט ועכבר לעולם אינם כף יד', () => {
    assert.equal(isLikelyPalm({ pointerType: 'pen', timeStamp: 1 }, { penDown: true }), false);
    assert.equal(isLikelyPalm({ pointerType: 'mouse', timeStamp: 1, width: 200 }, {}), false);
});

console.log(`\n${pass} עברו, ${fail} נכשלו`);
if (fail) process.exit(1);
