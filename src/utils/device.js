/* =====================================================================
 * device.js — העדפות של המכשיר עצמו: העט, כפתור הצד ודחיית כף היד
 * ---------------------------------------------------------------------
 * ההגדרות האלה שייכות לטאבלט ולא ללוח: מי שכותב ב־S Pen רוצה אותן בכל
 * לוח שהוא פותח. לכן הן נשמרות ב־localStorage ולא בקובץ הלוח.
 *
 * המודול טהור — בלי React ובלי Fabric — ולכן ניתן לבדיקה ב־Node.
 * ===================================================================== */

/** מה עושה לחיצה על כפתור הצד של העט, כשהיא מוחזקת בזמן שהעט נוגע במסך */
export const PEN_BUTTON_ACTIONS = [
    { id: 'erase', label: 'מחק', hint: 'כל עוד הכפתור לחוץ העט מוחק' },
    { id: 'erase-stroke', label: 'מחק קו שלם', hint: 'מוחק כל קו שהעט נוגע בו' },
    { id: 'select', label: 'בחירה', hint: 'מקיפים בעט, והתוכן נבחר להזזה' },
    { id: 'highlighter', label: 'מדגיש', hint: 'מדגיש זמני בצבע הנוכחי' },
    { id: 'laser', label: 'לייזר', hint: 'סמן לייזר דועך, להצגה' },
    { id: 'undo', label: 'ביטול', hint: 'לחיצה ונגיעה במסך מבטלות פעולה' },
    { id: 'menu', label: 'תפריט', hint: 'כמו לחיצה ימנית: תפריט האובייקט או הגדרות הלוח' },
    { id: 'none', label: 'כלום', hint: 'הכפתור לא משפיע' },
];

/** פעולות שמחליפות כלי רק לזמן המשיכה, לעומת פעולות של נגיעה אחת */
export const HOLD_ACTIONS = ['erase', 'erase-stroke', 'select', 'highlighter', 'laser'];

const STORE_KEY = 'pb_device_v1';

export const defaultDevicePrefs = () => ({
    /** null הוא מצב אוטומטי: נדלק מעצמו בפעם הראשונה שמזוהה עט */
    penOnly: null,
    penSeen: false,
    penButton: 'erase',
    lowLatency: false,
    /** קישקוש על כתב מוחק אותו */
    scratchErase: true,
});

export const sanitizeDevicePrefs = (raw) => {
    const out = defaultDevicePrefs();
    if (!raw || typeof raw !== 'object') return out;
    if (raw.penOnly === true || raw.penOnly === false) out.penOnly = raw.penOnly;
    out.penSeen = raw.penSeen === true;
    if (PEN_BUTTON_ACTIONS.some((a) => a.id === raw.penButton)) out.penButton = raw.penButton;
    out.lowLatency = raw.lowLatency === true;
    if (raw.scratchErase === false) out.scratchErase = false;
    return out;
};

export const loadDevicePrefs = (storage = globalThis.localStorage) => {
    try {
        const raw = storage?.getItem(STORE_KEY);
        return sanitizeDevicePrefs(raw ? JSON.parse(raw) : null);
    } catch {
        return defaultDevicePrefs();
    }
};

export const saveDevicePrefs = (prefs, storage = globalThis.localStorage) => {
    try { storage?.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* מצב פרטי או אחסון מלא */ }
};

/** האם רק העט כותב, והאצבע מזיזה את הלוח */
export const isPenOnly = (prefs) => (prefs.penOnly === null ? prefs.penSeen : prefs.penOnly);

/* ── קריאת כפתורי העט מאירוע מצביע ──────────────────────────────────
 * לפי תקן Pointer Events, כפתור הצד מדווח כמו הכפתור הימני של העכבר
 * (button 2, ביט 2 ב־buttons), וקצה המחק כ־button 5, ביט 32. */

/** קצה מחק של עט, בעטים שיש להם כזה */
export const isEraserTip = (e) => e?.pointerType === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5);

/** כפתור הצד של העט לחוץ */
export const isBarrelPressed = (e) => e?.pointerType === 'pen' && ((e.buttons & 2) !== 0 || e.button === 2);

/**
 * האם העט נוגע במסך. בריחוף עם כפתור לחוץ חלק מהדפדפנים שולחים
 * pointerdown עוד לפני המגע, ולכן בודקים לחץ או את ביט החוד.
 */
export const isPenContact = (e) => e?.pointerType !== 'pen' || e.pressure > 0 || (e.buttons & 1) !== 0;

/** משטח מגע גדול מזה, בפיקסלי CSS, הוא כמעט תמיד כף יד ולא אצבע */
export const PALM_CONTACT_PX = 60;
/** מגע שמגיע בחלון הזה אחרי פעילות של העט נחשב לכף היד שמחזיקה אותו */
export const PALM_WINDOW_MS = 350;

/**
 * דחיית כף יד: מגע שמגיע בזמן שהעט כותב או מרחף מעל המסך, או שמשטח
 * המגע שלו גדול, לא נחשב לאצבע.
 */
export const isLikelyPalm = (e, { penDown = false, lastPenAt = -Infinity } = {}) => {
    if (e?.pointerType !== 'touch') return false;
    if (penDown) return true;
    if (typeof e.timeStamp === 'number' && e.timeStamp - lastPenAt < PALM_WINDOW_MS) return true;
    return Math.max(e.width || 0, e.height || 0) > PALM_CONTACT_PX;
};
