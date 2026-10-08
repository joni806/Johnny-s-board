/* =====================================================================
 * stamps.js — ספריית סמלים: רכיבי מעגל, שערים לוגיים, מכניקה, אופטיקה
 * ---------------------------------------------------------------------
 * כל סמל מוגדר בקואורדינטות של הלוח, כשמשבצת אחת שווה 40 יחידות. רכיב
 * בעל שני הדקים תופס 80 יחידות ברוחב, והדקיו יושבים בגובה האמצע — כך
 * שסמל שהונח על נקודת רשת מתחבר בדיוק לחוטים שצוירו לאורך הרשת.
 *
 * חלק בסמל הוא אחד מאלה:
 *   { d }              קו בצבע העט
 *   { d, fill: true }  צורה מלאה בצבע העט
 *   { text, x, y, size } תווית
 * ===================================================================== */

/** מעגל כנתיב SVG, כדי שכל סמל יהיה רשימת נתיבים אחידה */
const circle = (cx, cy, r) => `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
const leads = (a = 24, b = 56, y = 20, w = 80) => `M 0 ${y} L ${a} ${y} M ${b} ${y} L ${w} ${y}`;

export const STAMP_CATEGORIES = [
    { id: 'circuit', label: 'מעגלים' },
    { id: 'semi', label: 'מוליכים למחצה' },
    { id: 'logic', label: 'לוגיקה' },
    { id: 'mech', label: 'מכניקה' },
    { id: 'optics', label: 'אופטיקה וגלים' },
    { id: 'em', label: 'שדות ומטענים' },
];

export const STAMPS = [
    /* ── מעגלים ── */
    { id: 'resistor', cat: 'circuit', label: 'נגד', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 20 20 L 23.33 12 L 30 28 L 36.67 12 L 43.33 28 L 50 12 L 56.67 28 L 60 20 L 80 20' }] },
    { id: 'resistor-iec', cat: 'circuit', label: 'נגד אירופי', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 20 20 M 60 20 L 80 20 M 20 13 L 60 13 L 60 27 L 20 27 Z' }] },
    { id: 'potentiometer', cat: 'circuit', label: 'פוטנציומטר', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 20 20 L 23.33 12 L 30 28 L 36.67 12 L 43.33 28 L 50 12 L 56.67 28 L 60 20 L 80 20 M 28 36 L 54 4' }, { d: 'M 54 4 L 45 7 L 51 12 Z', fill: true }] },
    { id: 'capacitor', cat: 'circuit', label: 'קבל', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 36 20 M 36 6 L 36 34 M 44 6 L 44 34 M 44 20 L 80 20' }] },
    { id: 'capacitor-pol', cat: 'circuit', label: 'קבל אלקטרוליטי', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 36 20 M 36 6 L 36 34 M 48 6 Q 40 20 48 34 M 44 20 L 80 20 M 27 5 L 27 11 M 24 8 L 30 8' }] },
    { id: 'inductor', cat: 'circuit', label: 'סליל', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 16 20 A 6 6 0 0 1 28 20 A 6 6 0 0 1 40 20 A 6 6 0 0 1 52 20 A 6 6 0 0 1 64 20 L 80 20' }] },
    { id: 'vsource', cat: 'circuit', label: 'מקור מתח', w: 80, h: 40,
      parts: [{ d: `${leads()} ${circle(40, 20, 16)} M 27 20 L 35 20 M 31 16 L 31 24 M 45 20 L 53 20` }] },
    { id: 'battery', cat: 'circuit', label: 'סוללה', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 35 20 M 35 4 L 35 36 M 45 12 L 45 28 M 45 20 L 80 20 M 27 3 L 27 9 M 24 6 L 30 6' }] },
    { id: 'acsource', cat: 'circuit', label: 'מקור זרם חילופין', w: 80, h: 40,
      parts: [{ d: `${leads()} ${circle(40, 20, 16)} M 30 20 Q 35 9 40 20 Q 45 31 50 20` }] },
    { id: 'isource', cat: 'circuit', label: 'מקור זרם', w: 80, h: 40,
      parts: [{ d: `${leads()} ${circle(40, 20, 16)} M 30 20 L 49 20 M 44 15 L 50 20 L 44 25` }] },
    { id: 'dep-vsource', cat: 'circuit', label: 'מקור מתח תלוי', w: 80, h: 40,
      parts: [{ d: `${leads()} M 24 20 L 40 4 L 56 20 L 40 36 Z M 29 20 L 36 20 M 32.5 16.5 L 32.5 23.5 M 44 20 L 51 20` }] },
    { id: 'dep-isource', cat: 'circuit', label: 'מקור זרם תלוי', w: 80, h: 40,
      parts: [{ d: `${leads()} M 24 20 L 40 4 L 56 20 L 40 36 Z M 31 20 L 48 20 M 43 15.5 L 48 20 L 43 24.5` }] },
    { id: 'ground', cat: 'circuit', label: 'הארקה', w: 40, h: 40,
      parts: [{ d: 'M 20 0 L 20 18 M 5 18 L 35 18 M 10 25 L 30 25 M 15 32 L 25 32' }] },
    { id: 'switch', cat: 'circuit', label: 'מפסק', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 24 20 M 56 20 L 80 20 M 26 19 L 53 6' }, { d: circle(26, 20, 2.6), fill: true }, { d: circle(55, 20, 2.6), fill: true }] },
    { id: 'lamp', cat: 'circuit', label: 'נורה', w: 80, h: 40,
      parts: [{ d: `${leads()} ${circle(40, 20, 16)} M 28.7 8.7 L 51.3 31.3 M 51.3 8.7 L 28.7 31.3` }] },
    { id: 'voltmeter', cat: 'circuit', label: 'וולטמטר', w: 80, h: 40,
      parts: [{ d: `${leads()} ${circle(40, 20, 16)} M 34 12 L 40 28 L 46 12` }] },
    { id: 'ammeter', cat: 'circuit', label: 'אמפרמטר', w: 80, h: 40,
      parts: [{ d: `${leads()} ${circle(40, 20, 16)} M 34 28 L 40 12 L 46 28 M 36.3 22.5 L 43.7 22.5` }] },
    { id: 'transformer', cat: 'circuit', label: 'שנאי', w: 80, h: 80,
      parts: [{ d: 'M 0 10 L 24 10 A 6 6 0 0 1 24 22 A 6 6 0 0 1 24 34 A 6 6 0 0 1 24 46 A 6 6 0 0 1 24 58 A 6 6 0 0 1 24 70 L 0 70 M 37 8 L 37 72 M 43 8 L 43 72 M 80 10 L 56 10 A 6 6 0 0 0 56 22 A 6 6 0 0 0 56 34 A 6 6 0 0 0 56 46 A 6 6 0 0 0 56 58 A 6 6 0 0 0 56 70 L 80 70' }] },
    { id: 'node', cat: 'circuit', label: 'צומת', w: 10, h: 10, parts: [{ d: circle(5, 5, 4), fill: true }] },
    { id: 'terminal', cat: 'circuit', label: 'הדק', w: 12, h: 12, parts: [{ d: circle(6, 6, 5) }] },
    { id: 'opamp', cat: 'circuit', label: 'מגבר שרת', w: 100, h: 80,
      parts: [{ d: 'M 20 2 L 20 78 L 88 40 Z M 0 20 L 20 20 M 0 60 L 20 60 M 88 40 L 100 40 M 25 20 L 33 20 M 25 60 L 33 60 M 29 56 L 29 64' }] },

    /* ── מוליכים למחצה ── */
    { id: 'diode', cat: 'semi', label: 'דיודה', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 30 20 M 50 20 L 80 20 M 50 7 L 50 33' }, { d: 'M 30 7 L 30 33 L 50 20 Z', fill: true }] },
    { id: 'zener', cat: 'semi', label: 'דיודת זנר', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 30 20 M 50 20 L 80 20 M 45 4 L 50 7 L 50 33 L 55 36' }, { d: 'M 30 7 L 30 33 L 50 20 Z', fill: true }] },
    { id: 'led', cat: 'semi', label: 'נורית LED', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 30 20 M 50 20 L 80 20 M 50 7 L 50 33 M 40 5 L 48 -5 M 48 3 L 56 -7' }, { d: 'M 30 7 L 30 33 L 50 20 Z', fill: true }, { d: 'M 48 -5 L 43 -3.5 L 46 0.5 Z M 56 -7 L 51 -5.5 L 54 -1.5 Z', fill: true }] },
    { id: 'npn', cat: 'semi', label: 'טרנזיסטור NPN', w: 60, h: 80,
      parts: [{ d: `M 0 40 L 22 40 M 22 22 L 22 58 M 22 32 L 46 16 L 46 0 M 22 48 L 46 64 L 46 80 ${circle(36, 40, 26)}` }, { d: 'M 46 64 L 35.5 62.5 L 40.5 55 Z', fill: true }] },
    { id: 'pnp', cat: 'semi', label: 'טרנזיסטור PNP', w: 60, h: 80,
      parts: [{ d: `M 0 40 L 22 40 M 22 22 L 22 58 M 22 32 L 46 16 L 46 0 M 22 48 L 46 64 L 46 80 ${circle(36, 40, 26)}` }, { d: 'M 23 49 L 33.5 50.5 L 28.5 58 Z', fill: true }] },
    { id: 'nmos', cat: 'semi', label: 'NMOS', w: 60, h: 80,
      parts: [{ d: 'M 0 54 L 16 54 M 16 24 L 16 56 M 22 20 L 22 60 M 22 28 L 46 28 L 46 0 M 22 52 L 46 52 L 46 80 M 22 40 L 46 40 L 46 52' }, { d: 'M 23 40 L 31 36 L 31 44 Z', fill: true }] },
    { id: 'pmos', cat: 'semi', label: 'PMOS', w: 60, h: 80,
      parts: [{ d: `M 0 54 L 8 54 ${circle(11.5, 54, 3.5)} M 16 24 L 16 56 M 22 20 L 22 60 M 22 28 L 46 28 L 46 0 M 22 52 L 46 52 L 46 80 M 22 40 L 46 40 L 46 28` }, { d: 'M 31 40 L 23 36 L 23 44 Z', fill: true }] },

    /* ── לוגיקה ── */
    { id: 'and', cat: 'logic', label: 'AND', w: 80, h: 60,
      parts: [{ d: 'M 0 15 L 20 15 M 0 45 L 20 45 M 20 2 L 45 2 A 28 28 0 0 1 45 58 L 20 58 Z M 73 30 L 80 30' }] },
    { id: 'nand', cat: 'logic', label: 'NAND', w: 80, h: 60,
      parts: [{ d: `M 0 15 L 20 15 M 0 45 L 20 45 M 20 2 L 42 2 A 28 28 0 0 1 42 58 L 20 58 Z ${circle(74, 30, 4)} M 78 30 L 80 30` }] },
    { id: 'or', cat: 'logic', label: 'OR', w: 80, h: 60,
      parts: [{ d: 'M 0 15 L 26 15 M 0 45 L 26 45 M 18 2 Q 34 30 18 58 M 18 2 Q 56 2 74 30 Q 56 58 18 58 M 74 30 L 80 30' }] },
    { id: 'nor', cat: 'logic', label: 'NOR', w: 80, h: 60,
      parts: [{ d: `M 0 15 L 26 15 M 0 45 L 26 45 M 18 2 Q 34 30 18 58 M 18 2 Q 52 2 68 30 Q 52 58 18 58 ${circle(72, 30, 4)} M 76 30 L 80 30` }] },
    { id: 'xor', cat: 'logic', label: 'XOR', w: 80, h: 60,
      parts: [{ d: 'M 0 15 L 24 15 M 0 45 L 24 45 M 10 2 Q 26 30 10 58 M 18 2 Q 34 30 18 58 M 18 2 Q 56 2 74 30 Q 56 58 18 58 M 74 30 L 80 30' }] },
    { id: 'not', cat: 'logic', label: 'NOT', w: 80, h: 60,
      parts: [{ d: `M 0 30 L 16 30 M 16 6 L 16 54 L 62 30 Z ${circle(66, 30, 4)} M 70 30 L 80 30` }] },

    /* ── מכניקה ── */
    { id: 'block', cat: 'mech', label: 'גוף', w: 80, h: 60, parts: [{ d: 'M 0 0 L 80 0 L 80 60 L 0 60 Z' }, { text: 'm', x: 40, y: 30, size: 26 }] },
    { id: 'incline', cat: 'mech', label: 'מישור משופע', w: 160, h: 90,
      parts: [{ d: 'M 0 90 L 160 90 L 160 0 Z M 34 90 A 34 34 0 0 0 29.6 73.3' }, { text: 'θ', x: 48, y: 80, size: 18 }] },
    { id: 'spring', cat: 'mech', label: 'קפיץ', w: 80, h: 40,
      parts: [{ d: 'M 0 20 L 10 20 L 15 8 L 25 32 L 35 8 L 45 32 L 55 8 L 65 32 L 70 20 L 80 20' }] },
    { id: 'pulley', cat: 'mech', label: 'גלגלת', w: 60, h: 100,
      parts: [{ d: `${circle(30, 30, 20)} M 30 30 L 30 0 M 10 30 L 10 100 M 50 30 L 50 100` }, { d: circle(30, 30, 3), fill: true }] },
    { id: 'floor', cat: 'mech', label: 'משטח', w: 120, h: 20,
      parts: [{ d: 'M 0 4 L 120 4 M 12 4 L 4 16 M 28 4 L 20 16 M 44 4 L 36 16 M 60 4 L 52 16 M 76 4 L 68 16 M 92 4 L 84 16 M 108 4 L 100 16' }] },
    { id: 'wall', cat: 'mech', label: 'קיר', w: 20, h: 120,
      parts: [{ d: 'M 16 0 L 16 120 M 16 12 L 4 4 M 16 28 L 4 20 M 16 44 L 4 36 M 16 60 L 4 52 M 16 76 L 4 68 M 16 92 L 4 84 M 16 108 L 4 100' }] },
    { id: 'pendulum', cat: 'mech', label: 'מטוטלת', w: 100, h: 120,
      parts: [{ d: 'M 10 8 L 90 8 M 22 8 L 14 0 M 38 8 L 30 0 M 54 8 L 46 0 M 70 8 L 62 0 M 86 8 L 78 0 M 50 8 L 72 98 M 50 8 L 50 70' }, { d: circle(74.5, 108, 10), fill: true }] },
    { id: 'pivot', cat: 'mech', label: 'ציר סיבוב', w: 40, h: 44,
      parts: [{ d: `M 20 6 L 4 34 L 36 34 Z M 0 34 L 40 34 M 8 34 L 2 42 M 18 34 L 12 42 M 28 34 L 22 42 M 38 34 L 32 42` }, { d: circle(20, 6, 3.5), fill: true }] },
    { id: 'cart', cat: 'mech', label: 'עגלה', w: 100, h: 60,
      parts: [{ d: `M 0 0 L 100 0 L 100 40 L 0 40 Z ${circle(22, 50, 10)} ${circle(78, 50, 10)}` }] },
    { id: 'axes3d', cat: 'mech', label: 'מערכת צירים תלת־ממדית', w: 120, h: 120,
      parts: [{ d: 'M 40 80 L 116 80 M 40 80 L 40 4 M 40 80 L 6 114' }, { d: 'M 120 80 L 110 75 L 110 85 Z M 40 0 L 35 10 L 45 10 Z M 4 116 L 8 105 L 15 112 Z', fill: true },
              { text: 'x', x: 112, y: 94, size: 16 }, { text: 'z', x: 54, y: 8, size: 16 }, { text: 'y', x: 20, y: 116, size: 16 }] },

    /* ── אופטיקה וגלים ── */
    { id: 'lens-convex', cat: 'optics', label: 'עדשה מרכזת', w: 40, h: 120, parts: [{ d: 'M 20 0 Q 44 60 20 120 Q -4 60 20 0 Z' }] },
    { id: 'lens-concave', cat: 'optics', label: 'עדשה מפזרת', w: 40, h: 120, parts: [{ d: 'M 2 0 L 38 0 Q 24 60 38 120 L 2 120 Q 16 60 2 0 Z' }] },
    { id: 'mirror', cat: 'optics', label: 'מראה', w: 20, h: 120,
      parts: [{ d: 'M 4 0 L 4 120 M 4 10 L 16 2 M 4 26 L 16 18 M 4 42 L 16 34 M 4 58 L 16 50 M 4 74 L 16 66 M 4 90 L 16 82 M 4 106 L 16 98' }] },
    { id: 'prism', cat: 'optics', label: 'מנסרה', w: 100, h: 90, parts: [{ d: 'M 50 0 L 100 88 L 0 88 Z' }] },
    { id: 'wave', cat: 'optics', label: 'גל', w: 160, h: 40,
      parts: [{ d: 'M 0 20 Q 10 0 20 20 Q 30 40 40 20 Q 50 0 60 20 Q 70 40 80 20 Q 90 0 100 20 Q 110 40 120 20 Q 130 0 140 20 Q 150 40 160 20' }] },
    { id: 'lightray', cat: 'optics', label: 'קרן אור', w: 120, h: 20, parts: [{ d: 'M 0 10 L 110 10' }, { d: 'M 120 10 L 106 4 L 106 16 Z', fill: true }] },

    /* ── שדות ומטענים ── */
    { id: 'into', cat: 'em', label: 'שדה אל תוך הדף', w: 24, h: 24, parts: [{ d: `${circle(12, 12, 10)} M 5 5 L 19 19 M 19 5 L 5 19` }] },
    { id: 'outof', cat: 'em', label: 'שדה אל מחוץ לדף', w: 24, h: 24, parts: [{ d: circle(12, 12, 10) }, { d: circle(12, 12, 3), fill: true }] },
    { id: 'pos', cat: 'em', label: 'מטען חיובי', w: 30, h: 30, parts: [{ d: `${circle(15, 15, 13)} M 8 15 L 22 15 M 15 8 L 15 22` }] },
    { id: 'neg', cat: 'em', label: 'מטען שלילי', w: 30, h: 30, parts: [{ d: `${circle(15, 15, 13)} M 8 15 L 22 15` }] },
    { id: 'antenna', cat: 'em', label: 'אנטנה', w: 40, h: 60, parts: [{ d: 'M 20 60 L 20 10 M 4 0 L 20 22 L 36 0 M 4 0 L 36 0' }] },
];

export const stampById = (id) => STAMPS.find((s) => s.id === id) || null;
