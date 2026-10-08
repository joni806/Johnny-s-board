/* =====================================================================
 * pens.js — העטים, ההגדרות שלהם, ושמירתם במכשיר
 * ---------------------------------------------------------------------
 * שלושה עטים תמידיים: עט, לורד ומדגיש. עט נוסף אחד, מבין כתב נוסחאות,
 * חוט מעגל וקו מקווקו, מופיע בסרגל אחרי שבוחרים בו, ואפשר להחליף אותו. לעט אין צבע משלו — הצבע נבחר
 * בסרגל הצבעים ומשותף לכל מה שמציירים, כך שאין מה לבלבל.
 *
 * המודול טהור — בלי React ובלי Fabric — ולכן ניתן לבדיקה ב־Node.
 * ===================================================================== */

/** הגדרות מנוע הדיו לכל סוג עט. createInkStroke ממזג אותן מעל ברירת המחדל */
export const PEN_KINDS = {
    pen: {
        label: 'עט', hint: 'עט רגיל, דק, רגיש ללחץ',
        icon: 'pen', ink: {}, extra: false,
        defaults: { width: 2.5, opacity: 1, dash: 'solid' },
        sizes: [1.5, 2.5, 4],
    },
    lord: {
        label: 'לורד', hint: 'עבה, מעוגל וקצת שקוף',
        icon: 'lord', ink: { minRatio: 1, maxRatio: 1, tiltInfluence: 0, taperFloor: 1 }, extra: false,
        defaults: { width: 9, opacity: 0.6, dash: 'solid' },
        sizes: [6, 9, 14],
    },
    highlighter: {
        label: 'מדגיש', hint: 'פס רחב ושקוף, נשאר מתחת לכתב',
        icon: 'highlighter', ink: null, extra: false,
        defaults: { width: 44, opacity: 0.35, dash: 'solid' },
        sizes: [26, 44, 72],
    },
    mathink: {
        label: 'עט נוסחאות', hint: 'כותבים נוסחה ביד והיא הופכת לנוסחה מוקלדת',
        icon: 'mathpen', ink: { minRatio: 1, maxRatio: 1, tiltInfluence: 0, taperFloor: 1 }, extra: true,
        defaults: { width: 3, opacity: 1, dash: 'solid' },
        sizes: [2, 3, 5],
    },
    wire: {
        label: 'עט חוט', hint: 'קווים ישרים, אופקיים ואנכיים, שנצמדים לרשת. לשרטוט מעגלים',
        icon: 'wirepen', ink: null, extra: true,
        defaults: { width: 2.5, opacity: 1, dash: 'solid' },
        sizes: [1.5, 2.5, 4],
    },
    dashed: {
        label: 'קו מקווקו', hint: 'קו מקווקו חופשי, לצירים, קווי עזר ושדות',
        icon: 'dashpen', ink: {}, extra: true,
        defaults: { width: 2.5, opacity: 1, dash: 'dashed' },
        sizes: [1.5, 2.5, 4],
    },
};

export const BASE_KINDS = ['pen', 'lord', 'highlighter'];
export const EXTRA_KINDS = ['mathink', 'wire', 'dashed'];

/** גודל ההיקף של תצוגת עובי: מייצג קו בעובי נתון בתוך נקודה בסרגל */
export const DASH_STYLES = {
    solid: { label: 'רציף' },
    dashed: { label: 'מקווקו' },
    dotted: { label: 'מנוקד' },
};

/** סרגל הצבעים, בסדר שהמשתמש מכיר: משמאל לימין בתצוגה. הראשון בסדר הקוד הוא הימני ביותר */
export const COLOR_BAR = ['#1a1a1a', '#f5f5f5', '#fde047', '#4ade80', '#22d3ee', '#f472b6'];
export const DEFAULT_COLOR = '#f5f5f5';

const STORE_KEY = 'pb_pens_v2';
const COLOR_KEY = 'pb_color_v1';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/** מצב ברירת המחדל: שלושת העטים, בלי תוספות */
export const defaultPenState = () => ({ extras: [], active: 'pen', settings: {} });

/** מנקה מצב שנטען מהאחסון. ערך פגום מוחלף בברירת מחדל ולא מפיל את האפליקציה */
export const sanitizePenState = (raw) => {
    const out = defaultPenState();
    if (!raw || typeof raw !== 'object') return out;
    // עט נוסף אחד בסרגל בכל רגע: האחרון שנבחר
    if (Array.isArray(raw.extras)) out.extras = raw.extras.filter((k) => EXTRA_KINDS.includes(k)).slice(-1);
    for (const k of Object.keys(PEN_KINDS)) {
        const s = raw.settings?.[k];
        if (!s) continue;
        const d = PEN_KINDS[k].defaults;
        out.settings[k] = {
            width: clamp(Number(s.width) || d.width, 0.5, 140),
            opacity: clamp(Number(s.opacity) || d.opacity, 0.05, 1),
        };
    }
    const visible = [...BASE_KINDS, ...out.extras];
    out.active = visible.includes(raw.active) ? raw.active : 'pen';
    return out;
};

export const loadPenState = (storage = globalThis.localStorage) => {
    try {
        const raw = storage?.getItem(STORE_KEY);
        return sanitizePenState(raw ? JSON.parse(raw) : null);
    } catch {
        return defaultPenState();
    }
};
export const savePenState = (state, storage = globalThis.localStorage) => {
    try { storage?.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* מצב פרטי או אחסון מלא */ }
};

export const loadColor = (storage = globalThis.localStorage) => {
    try { const c = storage?.getItem(COLOR_KEY); return isHex(c) ? c.toLowerCase() : DEFAULT_COLOR; } catch { return DEFAULT_COLOR; }
};
export const saveColor = (c, storage = globalThis.localStorage) => {
    try { storage?.setItem(COLOR_KEY, c); } catch { /* מצב פרטי */ }
};

/** רשימת העטים הגלויים בסרגל, לפי הסדר, כל אחד עם ההגדרות שלו */
export const buildPens = (state) =>
    [...BASE_KINDS, ...state.extras].map((kind) => {
        const d = PEN_KINDS[kind].defaults;
        const s = state.settings[kind] || {};
        return { id: kind, kind, width: s.width ?? d.width, opacity: s.opacity ?? d.opacity, dash: d.dash, arrow: false };
    });

/** בהירות יחסית של צבע, 0 עד 255 */
export const luminance = (hex) => {
    if (!isHex(hex)) return 128;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
};

/**
 * צבע הדיו בפועל על רקע נתון. עט לבן על לוח לבן היה נעלם, ולכן
 * לבן ושחור מתחלפים לפי הרקע. כל צבע אחר נשאר כמו שהמשתמש בחר.
 */
export const inkColorOn = (color, boardColor) => {
    const bg = luminance(boardColor);
    const c = (color || '').toLowerCase();
    if (bg > 180 && (c === '#f5f5f5' || c === '#ffffff')) return '#1a1a1a';
    if (bg < 70 && (c === '#1a1a1a' || c === '#000000')) return '#f5f5f5';
    return color;
};

/**
 * מערך הקווקוו של Fabric, ביחידות הלוח. נגזר מהעובי, כדי שקו עבה יקבל
 * מקטעים ארוכים יותר וקו מנוקד יישאר נקודות עגולות ולא קווים קצרים.
 */
export const dashArrayFor = (dash, strokeWidth) => {
    if (dash === 'dashed') return [strokeWidth * 3.2, strokeWidth * 2.4];
    if (dash === 'dotted') return [0.01, strokeWidth * 2.2];
    return null;
};

/** האם העט מצייר כמתאר ממולא, או כקו ברוחב אחיד שאפשר לקווקו */
export const isFilledInk = (pen) => !!PEN_KINDS[pen.kind]?.ink && (pen.dash || 'solid') === 'solid';

/** תיאור קצר לטולטיפ ולקורא מסך */
export const penTitle = (pen) => PEN_KINDS[pen.kind]?.label || 'עט';
