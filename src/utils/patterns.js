/* =====================================================================
 * patterns.js — רקעי הלוח: משבצות, דף הנדסי, איזומטרי וחצי־לוגריתמי
 * ---------------------------------------------------------------------
 * הרקע הוא שכבת CSS אחת מתחת לקנבס, ולא אובייקטים בלוח. כך הוא לא נשמר
 * בקובץ, לא נמחק בטעות, ותמיד מכסה את כל המסך — גם בלוח אינסופי. הגודל
 * והמיקום שלו מתעדכנים עם הזום וההזזה של המצלמה.
 * ===================================================================== */

export const PAPER_TYPES = [
    { id: 'none', label: 'חלק' },
    { id: 'grid', label: 'משבצות' },
    { id: 'engineering', label: 'הנדסי' },
    { id: 'lines', label: 'שורות' },
    { id: 'dots', label: 'נקודות' },
    { id: 'isometric', label: 'איזומטרי' },
    { id: 'semilog', label: 'חצי־לוגריתמי' },
];

/** גודל משבצת אחת ביחידות הלוח — כל הרכיבים בספרייה נבנו סביבו */
export const GRID = 40;

const svgTile = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

/**
 * הסגנון של שכבת הרקע. rgb הוא צבע הקווים כ־"r, g, b", שנבחר לפי בהירות
 * הלוח. מוחזרים backgroundImage, backgroundSize ומספר השכבות, כדי שמיקום
 * הרקע יוחל על כל שכבה בנפרד.
 */
export function patternStyle(type, rgb, zoom = 1) {
    const g = GRID * zoom;
    const line = (a) => `rgba(${rgb}, ${a})`;
    switch (type) {
        case 'grid':
            return { image: `linear-gradient(${line(0.15)} 1px, transparent 1px), linear-gradient(90deg, ${line(0.15)} 1px, transparent 1px)`, size: `${g}px ${g}px, ${g}px ${g}px`, layers: 2 };
        case 'lines':
            return { image: `linear-gradient(${line(0.15)} 1px, transparent 1px)`, size: `${g}px ${g}px`, layers: 1 };
        case 'dots':
            return { image: `radial-gradient(circle, ${line(0.45)} 1.5px, transparent 1.5px)`, size: `${g}px ${g}px`, layers: 1 };
        case 'engineering': {
            const m = g / 5;
            return {
                image: `linear-gradient(${line(0.24)} 1px, transparent 1px), linear-gradient(90deg, ${line(0.24)} 1px, transparent 1px), linear-gradient(${line(0.08)} 1px, transparent 1px), linear-gradient(90deg, ${line(0.08)} 1px, transparent 1px)`,
                size: `${g}px ${g}px, ${g}px ${g}px, ${m}px ${m}px, ${m}px ${m}px`,
                layers: 4,
            };
        }
        case 'isometric': {
            const w = GRID * Math.sqrt(3), h = GRID;
            const c = `rgb(${rgb})`;
            const body = `<g stroke='${c}' stroke-opacity='0.16' stroke-width='1' fill='none'><path d='M0 0 L${w} ${h} M0 ${h} L${w} 0 M0 0 V${h} M${w / 2} 0 V${h}'/></g>`;
            return { image: svgTile(w, h, body), size: `${w * zoom}px ${h * zoom}px`, layers: 1 };
        }
        case 'semilog': {
            /* עשור אחד לרוחב שש משבצות: קו לכל 1..9, והקו של 1 מודגש */
            const W = GRID * 6, H = GRID;
            const c = `rgb(${rgb})`;
            let lines = '';
            for (let k = 1; k <= 9; k++) {
                const x = (W * Math.log10(k)).toFixed(2);
                lines += `<path d='M${x} 0 V${H}' stroke-opacity='${k === 1 ? 0.32 : 0.13}'/>`;
            }
            const body = `<g stroke='${c}' stroke-width='1' fill='none'>${lines}<path d='M0 0 H${W}' stroke-opacity='0.16'/></g>`;
            return { image: svgTile(W, H, body), size: `${W * zoom}px ${H * zoom}px`, layers: 1 };
        }
        default:
            return { image: 'none', size: 'auto', layers: 1 };
    }
}
