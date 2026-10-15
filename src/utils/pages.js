/* =====================================================================
 * pages.js — פריסת הלוח: אינסופי, או דפים בגודל קבוע
 * ---------------------------------------------------------------------
 * המודול הזה נקי מ־React ומ־Fabric. הוא מחשב איפה כל דף יושב על הלוח,
 * לאן מותר להזיז את המצלמה, ואיך מתאימים את התצוגה לדף. הלוח עצמו
 * נשאר אותו קנבס; הדפים הם רק שכבת רקע וגבולות לתנועה.
 * ===================================================================== */

/** גודל הדף בעולם האמיתי, במ"מ, כשהוא עומד לאורך */
export const PAPER_SIZES = [
    { id: 'a4', label: 'A4', w: 210, h: 297 },
    { id: 'a5', label: 'A5', w: 148, h: 210 },
    { id: 'a3', label: 'A3', w: 297, h: 420 },
    { id: 'b5', label: 'B5', w: 176, h: 250 },
    { id: 'letter', label: 'Letter', w: 216, h: 279 },
    { id: 'legal', label: 'Legal', w: 216, h: 356 },
    { id: 'slide169', label: 'שקף 16:9', w: 160, h: 90, landscapeOnly: true },
    { id: 'slide43', label: 'שקף 4:3', w: 160, h: 120, landscapeOnly: true },
    { id: 'square', label: 'ריבוע', w: 200, h: 200, landscapeOnly: true },
    { id: 'custom', label: 'מותאם', w: 210, h: 297 },
];

export const LAYOUT_MODES = [
    { id: 'infinite', label: 'לוח אינסופי', hint: 'אין גבולות. מזיזים ומגדילים לכל כיוון.' },
    { id: 'vertical', label: 'דפים בגלילה אנכית', hint: 'דפים זה מתחת לזה, וגוללים ביניהם ברצף.' },
    { id: 'horizontal', label: 'דפים בגלילה אופקית', hint: 'דפים זה לצד זה, וגוללים הצידה.' },
    { id: 'single', label: 'דף אחד בכל פעם', hint: 'מציג דף שלם, ועוברים בין הדפים בכפתורים.' },
];

/** יחידות לוח לכל מילימטר, בקנה מידה 100%: כמו פיקסל של מסך בגודל 96 נקודות לאינץ' */
export const UNITS_PER_MM = 96 / 25.4;

export const DEFAULT_LAYOUT = {
    mode: 'infinite',
    paper: 'a4',
    orientation: 'portrait',
    customW: 210,      // מ"מ, כשהנייר הוא "מותאם"
    customH: 297,
    scale: 100,        // אחוזים. דף גדול יותר = כתב קטן יותר ביחס אליו
    count: 'auto',     // 'auto' מוסיף דפים תוך כדי כתיבה, או מספר קבוע
    pages: 3,          // כמה דפים כשהמספר קבוע, ומינימום כשהוא אוטומטי
    gap: 36,           // רווח בין דפים, ביחידות לוח
    numbers: true,
};

const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
};

/** מנקה פריסה שנטענה מקובץ ישן או שנערכה ידנית, כך שאף שדה לא יפיל את הלוח */
export function normalizeLayout(raw) {
    const d = DEFAULT_LAYOUT;
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        mode: LAYOUT_MODES.some((m) => m.id === r.mode) ? r.mode : d.mode,
        paper: PAPER_SIZES.some((p) => p.id === r.paper) ? r.paper : d.paper,
        orientation: r.orientation === 'landscape' ? 'landscape' : 'portrait',
        customW: clamp(r.customW, 40, 2000, d.customW),
        customH: clamp(r.customH, 40, 2000, d.customH),
        scale: Math.round(clamp(r.scale, 25, 400, d.scale)),
        count: r.count === 'fixed' ? 'fixed' : 'auto',
        pages: Math.round(clamp(r.pages, 1, 200, d.pages)),
        gap: Math.round(clamp(r.gap, 0, 200, d.gap)),
        numbers: r.numbers !== false,
    };
}

export const isPaged = (layout) => !!layout && layout.mode !== 'infinite';

/** מידות דף אחד ביחידות לוח, אחרי כיוון וקנה מידה */
export function pageSize(layout) {
    const paper = PAPER_SIZES.find((p) => p.id === layout.paper) || PAPER_SIZES[0];
    let w = paper.id === 'custom' ? layout.customW : paper.w;
    let h = paper.id === 'custom' ? layout.customH : paper.h;
    // שקפים וריבוע מוגדרים לרוחב; לכל השאר הכיוון נקבע בהגדרה
    const wantLandscape = layout.orientation === 'landscape';
    if (paper.landscapeOnly) {
        if (!wantLandscape && w > h) [w, h] = [h, w];
    } else if (wantLandscape !== (w > h)) {
        [w, h] = [h, w];
    }
    const k = UNITS_PER_MM * (layout.scale / 100);
    return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** בדף אחד בכל פעם השכנים מרוחקים, כדי שלא ייראו בשולי הדף */
export const gapOf = (layout) => (layout.mode === 'single' ? Math.max(layout.gap, 260) : layout.gap);

/**
 * מיקומי הדפים. pageCount הוא כמות הדפים בפועל, כולל אלה שנוספו אוטומטית.
 * בדף אחד בכל פעם הדפים מסודרים אנכית, ורק התצוגה מוגבלת לאחד מהם.
 */
export function layoutPages(layout, pageCount) {
    const { w, h } = pageSize(layout);
    const horizontal = layout.mode === 'horizontal';
    const gap = gapOf(layout);
    const n = Math.max(1, Math.round(pageCount) || 1);
    const pages = [];
    for (let i = 0; i < n; i++) {
        pages.push(horizontal
            ? { index: i, x: i * (w + gap), y: 0, w, h }
            : { index: i, x: 0, y: i * (h + gap), w, h });
    }
    return pages;
}

/** כמה דפים צריכים להיות: המספר הקבוע, או כמה שהכתב דורש ועוד דף ריק אחד */
export function pageCountFor(layout, inkBounds) {
    const base = layout.pages;
    if (layout.count === 'fixed') return base;
    if (!inkBounds) return base;
    const { w, h } = pageSize(layout);
    const horizontal = layout.mode === 'horizontal';
    const stride = (horizontal ? w : h) + gapOf(layout);
    const end = horizontal ? inkBounds.right : inkBounds.bottom;
    const lastWithInk = Math.max(0, Math.floor(end / stride));
    return Math.max(base, lastWithInk + 2);
}

/** מלבן שמכיל את כל הדפים */
export function pagesBounds(pages) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of pages) {
        left = Math.min(left, p.x); top = Math.min(top, p.y);
        right = Math.max(right, p.x + p.w); bottom = Math.max(bottom, p.y + p.h);
    }
    return { left, top, right, bottom };
}

export const mergeBounds = (a, b) => (!a ? b : !b ? a : {
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
});

/**
 * הזום שמתאים את הדף לרוחב המסך, או — בדף אחד בכל פעם ובגלילה אופקית —
 * את הדף כולו לגובה ולרוחב.
 */
export function fitZoom(layout, vw, vh, pad = 24) {
    const { w, h } = pageSize(layout);
    const aw = Math.max(50, vw - pad * 2), ah = Math.max(50, vh - pad * 2);
    if (layout.mode === 'vertical') return aw / w;
    return Math.min(aw / w, ah / h);
}

/** מטריצת מצלמה שמציגה את הדף i במרכז, בזום הנתון */
export function viewForPage(page, zoom, vw, vh, alignTop = false) {
    const cx = page.x + page.w / 2;
    const cy = alignTop ? page.y + (vh / 2 - 16) / zoom : page.y + page.h / 2;
    return [zoom, 0, 0, zoom, vw / 2 - cx * zoom, vh / 2 - cy * zoom];
}

/**
 * מגביל מצלמה לתחום המותר: לא נותנים לצאת רחוק מהדפים. בציר שבו התוכן קטן
 * מהמסך הוא ממורכז; בציר שבו הוא גדול, אפשר לגלול עד שוליים מוגדרים.
 * הזום מוגבל לטווח שמתאים לגודל הדף.
 */
export function constrainView(vpt, bounds, vw, vh, zoomRange, margin = 60) {
    let [z, , , , tx, ty] = vpt;
    if (zoomRange) {
        const nz = Math.min(zoomRange.max, Math.max(zoomRange.min, z));
        if (nz !== z) {
            // שומרים את מרכז המסך במקום בזמן תיקון הזום
            const cx = (vw / 2 - tx) / z, cy = (vh / 2 - ty) / z;
            z = nz; tx = vw / 2 - cx * z; ty = vh / 2 - cy * z;
        }
    }
    const fitAxis = (t, lo, hi, size) => {
        const span = (hi - lo) * z;
        if (span + margin * 2 <= size) return (size - span) / 2 - lo * z;
        const max = margin - lo * z;                 // התחלת התוכן לא עוברת את השוליים
        const min = size - margin - hi * z;          // סוף התוכן לא נעלם
        return Math.min(max, Math.max(min, t));
    };
    return [z, 0, 0, z, fitAxis(tx, bounds.left, bounds.right, vw), fitAxis(ty, bounds.top, bounds.bottom, vh)];
}

/** האם נקודה על הלוח נמצאת בתוך אחד הדפים */
export function pointOnPage(pages, x, y) {
    return pages.some((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
}

/** האינדקס של הדף שרוב המסך מציג, לפי מרכז המסך */
export function currentPageIndex(pages, vpt, vw, vh, layout) {
    if (!pages.length) return 0;
    const z = vpt[0];
    const cx = (vw / 2 - vpt[4]) / z, cy = (vh / 2 - vpt[5]) / z;
    const horizontal = layout.mode === 'horizontal';
    let best = 0, bestD = Infinity;
    for (const p of pages) {
        const mid = horizontal ? p.x + p.w / 2 : p.y + p.h / 2;
        const d = Math.abs((horizontal ? cx : cy) - mid);
        if (d < bestD) { bestD = d; best = p.index; }
    }
    return best;
}

/** טווח הזום המותר בדפים: מהצגת כמה דפים יחד ועד הגדלה ברורה של שורה */
export function zoomRangeFor(layout, vw, vh) {
    const f = fitZoom(layout, vw, vh);
    return { min: f * 0.3, max: f * 10 };
}

/** צבע השולחן שהדפים מונחים עליו, לפי צבע הדף */
export function deskColorFor(pageColor) {
    const hex = String(pageColor || '').replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return '#2a2d33';
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum > 140 ? '#9aa0aa' : '#0d0f12';
}
