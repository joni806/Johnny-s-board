/**
 * שכבת האחסון של הלוחות.
 *
 * עד כה השמירה האוטומטית דרסה את הרשומה היחידה ב־IndexedDB בכל פעם. באג אחד
 * בסריאליזציה, לשונית שנסגרה באמצע כתיבה, או ניקוי לוח בטעות — וכל העבודה
 * נעלמת בלי דרך חזרה. כאן נוספות שלוש הגנות:
 *
 *   1. אימות — רשומה שנראית פגומה לא נכתבת בכלל.
 *   2. גרסאות — לפני כל דריסה משמעותית הגרסה הקודמת נשמרת בטבעת גיבויים.
 *   3. תור כתיבה — שתי שמירות לאותו לוח לעולם לא רצות במקביל.
 *
 * המודול לא מכיר את React ולא את Fabric, וניתן לבדיקה ישירה.
 */
import { get, set, del, keys } from 'idb-keyval';

export const PROJECT_PREFIX = 'jb_project_';
export const REVISION_PREFIX = 'jb_rev_';

/** כמה גרסאות קודמות נשמרות לכל לוח */
export const MAX_REVISIONS = 8;
/** מרווח מזערי בין שתי גרסאות, כדי שציור רצוף לא יציף את הטבעת */
export const REVISION_INTERVAL_MS = 120000;

const revisionKey = (id) => `${REVISION_PREFIX}${id}`;

/**
 * בדיקת שפיות לפני כתיבה. עדיף לא לשמור כלל מאשר לשמור רשומה פגומה
 * שתפיל את הטעינה בפעם הבאה.
 */
export const isValidProject = (data) => {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.id !== 'string' || !data.id) return false;
    if (data.fabric !== null && data.fabric !== undefined) {
        if (typeof data.fabric !== 'object') return false;
        if (!Array.isArray(data.fabric.objects)) return false;
    }
    if (data.math !== undefined && !Array.isArray(data.math)) return false;
    return true;
};

/** כמה תוכן יש ברשומה — משמש כדי לזהות דריסה של לוח מלא בלוח ריק */
export const contentSize = (data) => {
    const objs = data?.fabric?.objects?.length || 0;
    const math = Array.isArray(data?.math) ? data.math.length : 0;
    return objs + math;
};

// תור כתיבה לכל לוח. שמירה אוטומטית שנקראה פעמיים ברצף כתבה בעבר בסדר
// לא צפוי, והגרסה הישנה יכלה לנחות אחרי החדשה.
const queues = new Map();
const enqueue = (id, task) => {
    const prev = queues.get(id) || Promise.resolve();
    const next = prev.then(task, task);
    queues.set(id, next.catch(() => {}));
    return next;
};

/** ממתין לסיום כל הכתיבות התלויות, לשימוש בסגירת לוח ובבדיקות */
export const flushWrites = async (id) => {
    if (id) { await (queues.get(id) || Promise.resolve()); return; }
    await Promise.all([...queues.values()]);
};

/**
 * דוחף את הגרסה הנוכחית לטבעת הגיבויים, אם עבר מספיק זמן מהגיבוי האחרון
 * או אם הרשומה החדשה מוחקת תוכן קיים.
 */
const pushRevision = async (id, previous, incoming) => {
    if (!previous || contentSize(previous) === 0) return;
    const key = revisionKey(id);
    const list = (await get(key)) || [];
    const last = list[list.length - 1];
    const now = Date.now();
    const shrinks = contentSize(incoming) < contentSize(previous) * 0.5;
    if (last && !shrinks && now - last.ts < REVISION_INTERVAL_MS) return;
    list.push({ ts: previous.lastModified || now, savedAt: now, data: previous });
    while (list.length > MAX_REVISIONS) list.shift();
    await set(key, list);
};

/**
 * שמירת לוח. מחזירה { ok, reason } כדי שהקורא יוכל להתריע במקום לשתוק.
 */
export const saveProject = (id, data) => enqueue(id, async () => {
    if (!isValidProject(data)) return { ok: false, reason: 'invalid' };
    let previous;
    try { previous = await get(id); } catch { previous = null; }
    try {
        if (previous) await pushRevision(id, previous, data);
    } catch { /* כישלון גיבוי לא יעצור את השמירה עצמה */ }
    try {
        await set(id, data);
        return { ok: true, backedUp: !!previous };
    } catch (err) {
        return { ok: false, reason: err?.name === 'QuotaExceededError' ? 'quota' : 'write' };
    }
});

export const loadProject = async (id) => {
    const data = await get(id);
    if (data && isValidProject(data)) return data;
    // הרשומה הראשית פגומה — מנסים את הגיבוי האחרון התקין
    const list = (await get(revisionKey(id))) || [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (isValidProject(list[i].data)) return { ...list[i].data, recoveredFrom: list[i].savedAt };
    }
    return data || null;
};

export const listProjects = async () => {
    const allKeys = await keys();
    const out = [];
    for (const key of allKeys) {
        // idb-keyval מחזיר גם מפתחות שאינם מחרוזת, ו-startsWith היה קורס עליהם
        if (typeof key !== 'string' || !key.startsWith(PROJECT_PREFIX)) continue;
        const data = await get(key);
        if (!data) continue;
        out.push({
            id: key,
            title: data.title || 'לוח ללא שם',
            lastModified: data.lastModified || 0,
            previewColor: data.bg || '#1e3d32',
            pattern: data.pattern || 'none',
        });
    }
    out.sort((a, b) => b.lastModified - a.lastModified);
    return out;
};

export const deleteProject = (id) => enqueue(id, async () => {
    await del(id);
    await del(revisionKey(id));
    return { ok: true };
});

/** רשימת הגרסאות השמורות, מהחדשה לישנה */
export const listRevisions = async (id) => {
    const list = (await get(revisionKey(id))) || [];
    return list
        .map((r, index) => ({ index, ts: r.ts, savedAt: r.savedAt, size: contentSize(r.data) }))
        .reverse();
};

/** מחזיר גרסה שמורה ושומר את המצב הנוכחי כגרסה נוספת, כדי שהשחזור הפיך */
export const restoreRevision = (id, index) => enqueue(id, async () => {
    const key = revisionKey(id);
    const list = (await get(key)) || [];
    const entry = list[index];
    if (!entry || !isValidProject(entry.data)) return { ok: false, reason: 'missing' };
    const current = await get(id);
    if (current && isValidProject(current)) {
        list.push({ ts: current.lastModified || Date.now(), savedAt: Date.now(), data: current });
        while (list.length > MAX_REVISIONS) list.shift();
        await set(key, list);
    }
    const restored = { ...entry.data, id, lastModified: Date.now() };
    await set(id, restored);
    return { ok: true, data: restored };
});

/** הערכת נפח האחסון שבשימוש, להצגה בהגדרות ולהחלטה על העברה לענן */
export const storageEstimate = async () => {
    if (!navigator?.storage?.estimate) return null;
    try {
        const { usage, quota } = await navigator.storage.estimate();
        return { usage: usage || 0, quota: quota || 0 };
    } catch { return null; }
};
