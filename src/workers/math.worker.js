/**
 * חוט צדדי לפתרון סימבולי.
 * nerdamer יכול לרוץ שניות ארוכות, ולפני כן הוא רץ בחוט הראשי והקפיא את
 * הלוח באמצע כתיבה. כאן הוא מבודד, והלקוח יכול גם לקטוע אותו בכוח.
 */
import { solveAsciiMath } from '../utils/solveMath.js';

self.onmessage = (event) => {
    const { id, expr } = event.data || {};
    const result = solveAsciiMath(expr || '');
    self.postMessage({ id, ...result });
};
