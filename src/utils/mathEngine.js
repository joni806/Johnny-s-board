/**
 * לקוח למנוע החישוב הסימבולי.
 *
 * הפתרון רץ ב־Web Worker, ולכן ביטוי כבד כבר לא מקפיא את הלוח. אם המנוע
 * נתקע בלולאה אינסופית — מצב אמיתי ב־nerdamer עבור מערכות משוואות מסוימות —
 * הלקוח קוטע את החוט אחרי פסק זמן, והבא בתור מקבל חוט נקי.
 */

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

const disposeWorker = () => {
    if (worker) { try { worker.terminate(); } catch { /* כבר מת */ } }
    worker = null;
};

const ensureWorker = () => {
    if (worker || workerBroken) return worker;
    try {
        worker = new Worker(new URL('../workers/math.worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (event) => {
            const { id, ...result } = event.data || {};
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);
            clearTimeout(entry.timer);
            entry.resolve(result);
        };
        worker.onerror = () => {
            // כשל בטעינת החוט — נופלים לחישוב בחוט הראשי עד סוף הסשן
            workerBroken = true;
            disposeWorker();
            for (const [, entry] of pending) { clearTimeout(entry.timer); entry.resolve({ ok: false, error: 'worker' }); }
            pending.clear();
        };
    } catch {
        workerBroken = true;
        worker = null;
    }
    return worker;
};

/** חישוב בחוט הראשי, רק כשאין Worker זמין */
const solveInline = async (expr) => {
    const { solveAsciiMath } = await import('./solveMath.js');
    return solveAsciiMath(expr);
};

/**
 * פותר ביטוי ומחזיר { ok, resultLatex } או { ok: false, error }.
 * error שווה 'timeout' כשהמנוע נקטע בגלל חריגת זמן.
 */
export const solveExpression = (expr, timeoutMs = 5000) => {
    const w = ensureWorker();
    if (!w) return solveInline(expr);

    return new Promise((resolve) => {
        const id = ++seq;
        const timer = setTimeout(() => {
            pending.delete(id);
            // המנוע תקוע. קטיעה היא הדרך היחידה להשתחרר ממנו
            disposeWorker();
            resolve({ ok: false, error: 'timeout' });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        w.postMessage({ id, expr });
    });
};

/** שחרור החוט, לניקוי כשהלוח נסגר */
export const terminateMathWorker = () => {
    for (const [, entry] of pending) clearTimeout(entry.timer);
    pending.clear();
    disposeWorker();
};
