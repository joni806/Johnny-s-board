/**
 * בדיקות לשכבת האחסון: אימות, טבעת גרסאות, תור כתיבה ושחזור.
 * רצות מול IndexedDB מדומה: node tests/storage.test.mjs
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { get, set, clear } from 'idb-keyval';
import {
    saveProject, loadProject, listProjects, deleteProject,
    listRevisions, restoreRevision, isValidProject, contentSize,
    flushWrites, REVISION_PREFIX, MAX_REVISIONS,
} from '../src/utils/storage.js';

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const project = (id, objects = 1, extra = {}) => ({
    id,
    title: 'לוח בדיקה',
    bg: '#1e3d32',
    pattern: 'grid',
    lastModified: Date.now(),
    fabric: { version: '7', objects: Array.from({ length: objects }, (_, i) => ({ type: 'path', i })) },
    math: [],
    ...extra,
});

console.log('\nשכבת אחסון');

test('רשומה תקינה עוברת אימות', () => {
    assert.equal(isValidProject(project('a')), true);
    assert.equal(isValidProject({ ...project('a'), fabric: null }), true);
});

test('רשומה פגומה נחסמת', () => {
    assert.equal(isValidProject(null), false);
    assert.equal(isValidProject({}), false);
    assert.equal(isValidProject({ id: 'a', fabric: { objects: 'לא מערך' } }), false);
    assert.equal(isValidProject({ id: 'a', fabric: null, math: 'לא מערך' }), false);
});

test('contentSize סופר אובייקטים ושדות מתמטיקה', () => {
    assert.equal(contentSize(project('a', 3)), 3);
    assert.equal(contentSize({ ...project('a', 3), math: [1, 2] }), 5);
    assert.equal(contentSize(null), 0);
});

test('שמירה וטעינה מחזירות את אותה רשומה', async () => {
    const p = project('jb_project_1', 4);
    const res = await saveProject(p.id, p);
    assert.equal(res.ok, true);
    const back = await loadProject(p.id);
    assert.equal(back.fabric.objects.length, 4);
});

test('שמירה של רשומה פגומה נדחית ולא דורסת', async () => {
    const p = project('jb_project_2', 5);
    await saveProject(p.id, p);
    const res = await saveProject(p.id, { id: p.id, fabric: { objects: 'רעל' } });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid');
    const back = await loadProject(p.id);
    assert.equal(back.fabric.objects.length, 5, 'הרשומה הקודמת שרדה');
});

test('דריסה שמאבדת תוכן יוצרת גרסת גיבוי', async () => {
    const id = 'jb_project_3';
    await saveProject(id, project(id, 20));
    await saveProject(id, project(id, 1));   // איבוד תוכן → גיבוי מיידי
    const revs = await listRevisions(id);
    assert.ok(revs.length >= 1, 'נוצרה לפחות גרסה אחת');
    assert.equal(revs[0].size, 20);
});

test('שמירות רצופות קרובות בזמן לא מציפות את טבעת הגרסאות', async () => {
    const id = 'jb_project_4';
    await saveProject(id, project(id, 10));
    for (let i = 0; i < 12; i++) await saveProject(id, project(id, 10 + i));
    const revs = await listRevisions(id);
    assert.ok(revs.length <= MAX_REVISIONS, `נשמרו ${revs.length} גרסאות`);
    assert.ok(revs.length <= 2, 'רק גיבוי אחד או שניים נוצרו בפרק זמן קצר');
});

test('טבעת הגרסאות לא חורגת מהתקרה', async () => {
    const id = 'jb_project_5';
    await saveProject(id, project(id, 10));
    // דחיפה ידנית של גרסאות רבות, כדי לבדוק את גזירת הטבעת בשחזור
    const key = `${REVISION_PREFIX}${id}`;
    const many = Array.from({ length: MAX_REVISIONS + 5 }, (_, i) => ({
        ts: i, savedAt: i, data: project(id, i + 1),
    }));
    await set(key, many.slice(-MAX_REVISIONS));
    const revs = await listRevisions(id);
    assert.equal(revs.length, MAX_REVISIONS);
});

test('שחזור גרסה מחזיר תוכן ושומר את הנוכחי כגרסה', async () => {
    const id = 'jb_project_6';
    await saveProject(id, project(id, 30));
    await saveProject(id, project(id, 2));      // מאבד תוכן → מגבה את 30
    const revs = await listRevisions(id);
    const target = revs.find((r) => r.size === 30);
    assert.ok(target, 'הגרסה המלאה קיימת');
    const res = await restoreRevision(id, target.index);
    assert.equal(res.ok, true);
    const back = await loadProject(id);
    assert.equal(back.fabric.objects.length, 30, 'התוכן חזר');
    const after = await listRevisions(id);
    assert.ok(after.some((r) => r.size === 2), 'המצב שלפני השחזור נשמר');
});

test('טעינה מתאוששת מרשומה ראשית פגומה', async () => {
    const id = 'jb_project_7';
    await saveProject(id, project(id, 12));
    await saveProject(id, project(id, 1));       // יוצר גיבוי
    await set(id, { id, fabric: { objects: 'הרוס' } });  // השחתה ישירה
    const back = await loadProject(id);
    assert.ok(back, 'התקבלה רשומה');
    assert.ok(Array.isArray(back.fabric.objects), 'הרשומה שהוחזרה תקינה');
    assert.ok(back.recoveredFrom, 'מסומן שהיא באה מגיבוי');
});

test('כתיבות מקבילות לא דורסות זו את זו', async () => {
    const id = 'jb_project_8';
    const writes = [];
    for (let i = 1; i <= 10; i++) writes.push(saveProject(id, project(id, i)));
    await Promise.all(writes);
    await flushWrites(id);
    const back = await loadProject(id);
    assert.equal(back.fabric.objects.length, 10, 'האחרונה ניצחה');
});

test('רשימת הלוחות ממוינת מהאחרון שנערך', async () => {
    await clear();
    await saveProject('jb_project_a', { ...project('jb_project_a'), lastModified: 100, title: 'ישן' });
    await saveProject('jb_project_b', { ...project('jb_project_b'), lastModified: 900, title: 'חדש' });
    await set('לא_פרויקט', { שטות: true });
    const list = await listProjects();
    assert.equal(list.length, 2, 'מפתחות זרים לא נספרים');
    assert.equal(list[0].title, 'חדש');
});

test('מחיקת לוח מוחקת גם את הגרסאות שלו', async () => {
    const id = 'jb_project_9';
    await saveProject(id, project(id, 20));
    await saveProject(id, project(id, 1));
    assert.ok((await listRevisions(id)).length > 0);
    await deleteProject(id);
    assert.equal(await get(id), undefined);
    assert.equal((await listRevisions(id)).length, 0);
});

const run = async () => {
    for (const [name, fn] of tests) {
        try { await fn(); pass++; console.log(`  ok   ${name}`); }
        catch (err) { fail++; console.log(`  FAIL ${name}\n       ${err.message}`); }
    }
    console.log(`\n  עברו ${pass}, נכשלו ${fail}\n`);
    if (fail) process.exit(1);
};
run();
