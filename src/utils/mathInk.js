/* =====================================================================
 * mathInk.js — מכתב יד ל־LaTeX
 * ---------------------------------------------------------------------
 * הזרימה: המשיכות שנכתבו מצוירות מחדש בשחור על לבן לקנבס נפרד, התמונה
 * עוברת את אותו עיבוד מקדים שהמודל אומן עליו — גווני אפור, חיתוך שוליים,
 * התאמה ל־384 על 384 ונרמול — ונשלחת לחוט הצדדי. התשובה היא LaTeX, שאחרי
 * ניקוי קל נכנס לשדה נוסחה רגיל של MathLive, שאפשר לערוך ולפתור.
 * ===================================================================== */

import * as fabricPkg from 'fabric';
import { getOutlinePolylines, typeOf } from './canvasUtils.js';

const fabric = fabricPkg.fabric || fabricPkg;

const SIZE = 384;
const MEAN = 0.7931;
const STD = 0.1738;

/* ── מצב המודל, לחיווי בממשק ── */
const READY_KEY = 'pb_mathink_downloaded_v1';
/** גדלי הקבצים הגדולים, כדי שההתקדמות תחושב מההתחלה ולא תקפוץ בין קבצים */
const EXPECTED = { 'onnx/encoder_model.onnx': 54168561, 'onnx/decoder_model_merged.onnx': 25946299 };
export const MODEL_BYTES = Object.values(EXPECTED).reduce((a, b) => a + b, 0) + 30000;

let worker = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();
let status = { state: 'idle', phase: 'download', progress: 0, loaded: 0, total: MODEL_BYTES, stalled: false, retry: 0, error: null };
let lastAlive = 0;
let watchdog = null;
let lastStage = '';
const INIT_TIMEOUT = 60000;

const setStatus = (next) => {
    status = { ...status, ...next };
    listeners.forEach((fn) => { try { fn(status); } catch { /* מאזין שבור לא מפיל את השאר */ } });
};

export const getMathInkStatus = () => status;
export const onMathInkStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** האם המודל כבר ירד פעם למכשיר הזה. אז הטעינה מהירה ועובדת גם בלי רשת */
export const wasMathInkDownloaded = () => { try { return localStorage.getItem(READY_KEY) === '1'; } catch { return false; } };

const startWatchdog = () => {
    clearInterval(watchdog);
    lastAlive = Date.now();
    // אם 25 שניות לא זז כלום, מתריעים. אם זז שוב, ההתרעה נעלמת
    watchdog = setInterval(() => {
        if (status.state !== 'loading') { clearInterval(watchdog); return; }
        if (status.phase === 'init' && Date.now() - lastAlive > INIT_TIMEOUT) {
            clearInterval(watchdog);
            const err = `init-timeout: ${lastStage || 'no-stage'}`;
            if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null; }
            for (const [, entry] of pending) entry.resolve({ ok: false, error: err });
            pending.clear();
            setStatus({ state: 'error', error: err, stalled: false });
            return;
        }
        const stalled = Date.now() - lastAlive > 25000;
        if (stalled !== status.stalled) setStatus({ stalled });
    }, 3000);
};

const ensureWorker = () => {
    if (worker) return worker;
    const w = new Worker(new URL('../workers/mathink.worker.js', import.meta.url), { type: 'module' });
    worker = w;
    const files = new Map(Object.entries(EXPECTED).map(([k, v]) => [k, { loaded: 0, total: v }]));
    w.onmessage = (e) => {
        if (w !== worker) return;
        const msg = e.data || {};
        if (msg.type === 'tick') { lastAlive = Date.now(); return; }
        if (msg.type === 'stage') { lastAlive = Date.now(); lastStage = `${msg.stage}${msg.detail ? ' ' + msg.detail : ''}`; setStatus({ stage: lastStage }); return; }
        if (msg.type === 'progress') {
            lastAlive = Date.now();
            if (abortCtl) return;      // ההורדה מנוהלת מבחוץ
            const exp = EXPECTED[msg.file] || 0;
            files.set(msg.file, { loaded: msg.loaded || 0, total: Math.max(msg.total || 0, exp) });
            let loaded = 0;
            files.forEach((f) => { loaded += f.loaded; });
            setStatus({ state: 'loading', loaded, progress: Math.min(1, loaded / MODEL_BYTES), stalled: false });
            return;
        }
        if (msg.type === 'ready') {
            try { localStorage.setItem(READY_KEY, '1'); } catch { /* מצב פרטי */ }
            setStatus({ state: 'ready', progress: 1, loaded: MODEL_BYTES, stalled: false, retry: 0, error: null });
            return;
        }
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.type === 'error') {
            if (status.state !== 'ready') setStatus({ state: 'error', error: msg.error || 'unknown', stalled: false });
            entry.resolve({ ok: false, error: msg.error });
        } else entry.resolve({ ok: true, ...msg });
    };
    w.onerror = (ev) => {
        if (w !== worker) return;
        setStatus({ state: 'error', error: (ev && ev.message) || 'worker', stalled: false });
        for (const [, entry] of pending) entry.resolve({ ok: false, error: 'worker' });
        pending.clear();
        worker = null;
    };
    return w;
};

const call = (payload, transfer = []) => new Promise((resolve) => {
    const w = ensureWorker();
    const id = ++seq;
    pending.set(id, { resolve });
    w.postMessage({ id, ...payload }, transfer);
});

/* ── הורדה עצמאית של קבצי המודל הגדולים ──
   ההורדה הרגילה של הספרייה לא מראה למה היא תקועה, ולא מתאוששת מניתוק. כאן
   הקבצים יורדים לפי חלקים, עם התקדמות אמיתית, חידוש מהנקודה שבה נעצרו,
   וזיהוי של חיבור תקוע. התוכן עובר לחוט הצדדי ישירות, ובמקביל נשמר ברקע
   במטמון של הדפדפן לפעם הבאה. כך מטמון איטי או מלא לא תוקע את ההפעלה. */
const SMALL = ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json'];
const BASE = 'https://huggingface.co/alephpi/FormulaNet/resolve/main/';
const CACHE_NAME = 'transformers-cache';
const CHUNK_TIMEOUT = 20000;
let abortCtl = null;

const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('cancelled')); }, { once: true });
});

/** מחכה להבטחה, ואם היא לא מסתיימת בזמן מחזיר undefined במקום להיתקע */
const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => undefined), new Promise((r) => setTimeout(() => r(undefined), ms))]);

let cachePromise = null;
const openCache = () => {
    if (typeof caches === 'undefined') return Promise.resolve(undefined);
    if (!cachePromise) cachePromise = within(caches.open(CACHE_NAME), 8000);
    return cachePromise;
};

/**
 * שמירה במטמון ברקע. ההורדה לא מחכה לה: אם המטמון איטי, מלא או חסום,
 * המודל עדיין נטען מהזיכרון ועובד. השמירה רק חוסכת הורדה בפעם הבאה.
 */
const persist = (url, blob) => {
    openCache().then((cache) => {
        if (!cache) return undefined;
        return within(cache.put(url, new Response(blob, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(blob.size) } })), 120000);
    }).catch(() => { /* בלי מטמון, המודל ירד שוב בפעם הבאה */ });
};

/** מוריד קובץ אחד. מחזיר את התוכן, או null אם הוא כבר שמור במכשיר */
async function downloadFile(file, onBytes, signal, { quiet = false } = {}) {
    const url = BASE + file;
    const cache = await openCache();
    if (cache && await within(cache.match(url), 10000)) { onBytes(EXPECTED[file] || 0, true); return null; }

    let chunks = [];
    let got = 0;
    let total = EXPECTED[file];
    const attempts = quiet ? 3 : 8;
    for (let attempt = 0; attempt < attempts; attempt++) {
        if (signal.aborted) throw new Error('cancelled');
        const ctl = new AbortController();
        const onAbort = () => ctl.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        let reader = null;
        try {
            const res = await Promise.race([
                fetch(url, { headers: got ? { Range: `bytes=${got}-` } : {}, signal: ctl.signal }),
                sleep(CHUNK_TIMEOUT).then(() => { throw new Error('timeout'); }),
            ]);
            if (res.status === 200 && got) { chunks = []; onBytes(-got); got = 0; }       // השרת התעלם מהבקשה לחידוש
            else if (res.status === 416 && got) break;                                     // כבר יש את כל הקובץ
            else if (!res.ok && res.status !== 206) {
                const err = new Error(`HTTP ${res.status}`); err.http = res.status; throw err;
            }
            const len = Number(res.headers.get('content-length')) || 0;
            if (len && res.status === 200) total = len;
            reader = res.body.getReader();
            for (;;) {
                const { done, value } = await Promise.race([
                    reader.read(),
                    sleep(CHUNK_TIMEOUT).then(() => { throw new Error('timeout'); }),
                ]);
                if (done) break;
                chunks.push(value); got += value.length;
                onBytes(value.length);
                if (total && got >= total) break;          // יש הכול, לא מחכים לסגירת החיבור
            }
            if (total && got < total * 0.99) throw new Error('short');
            break;
        } catch (err) {
            try { reader?.cancel(); } catch { /* נסגר כבר */ }
            ctl.abort();
            if (signal.aborted || err.message === 'cancelled') throw new Error('cancelled', { cause: err });
            if (err.http && err.http !== 429 && err.http < 500) throw err;       // אין טעם לנסות שוב על 403 או 404
            if (attempt === attempts - 1) throw err;
            // חיבור תקוע או נותק: ממתינים רגע וממשיכים מאותה נקודה
            if (!quiet) setStatus({ stalled: true, retry: attempt + 1 });
            try { await sleep(Math.min(8000, 1200 * (attempt + 1)), signal); } catch (e2) { throw new Error('cancelled', { cause: e2 }); }
        } finally {
            try { reader?.cancel(); } catch { /* נסגר כבר */ }
            signal.removeEventListener('abort', onAbort);
        }
    }
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    persist(url, blob);
    return { url, buffer: await blob.arrayBuffer() };
}

async function downloadModel() {
    abortCtl = new AbortController();
    const signal = abortCtl.signal;
    let loaded = 0;
    const onBytes = (n, cached) => {
        loaded = Math.max(0, loaded + n);
        lastAlive = Date.now();
        setStatus({ state: 'loading', phase: 'download', loaded, progress: Math.min(1, loaded / MODEL_BYTES), stalled: false, retry: 0, cached: !!cached });
    };
    const alive = () => { lastAlive = Date.now(); };
    setStatus({ stage: 'download' });
    // הקבצים הקטנים יורדים במקביל. אם אחד מהם נכשל, הספרייה תביא אותו בעצמה
    const small = Promise.all(SMALL.map((f) => downloadFile(f, alive, signal, { quiet: true }).catch((err) => {
        if (err.message === 'cancelled') throw err;
        return null;
    })));
    const big = await Promise.all(Object.keys(EXPECTED).map((f) => downloadFile(f, onBytes, signal)));
    setStatus({ stage: 'small files' });
    const rest = await small;
    setStatus({ stage: 'handoff' });
    return [...big, ...rest].filter(Boolean);
}

/** ביטול הורדה באמצע. החוט נסגר, וההורדה הבאה ממשיכה מהקבצים השלמים שכבר נשמרו */
export const cancelMathInk = () => {
    clearInterval(watchdog);
    try { abortCtl?.abort(); } catch { /* כבר בוטל */ }
    abortCtl = null;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.terminate(); worker = null; }
    for (const [, entry] of pending) entry.resolve({ ok: false, error: 'cancelled' });
    pending.clear();
    setStatus({ state: 'idle', phase: 'download', progress: 0, loaded: 0, stalled: false, retry: 0, error: null });
};

/** הורדת המודל, עם חיווי התקדמות. מחזיר true כשהמודל מוכן */
export const preloadMathInk = async () => {
    if (status.state === 'ready') return true;
    if (status.state === 'loading') return false;
    setStatus({ state: 'loading', phase: 'download', progress: 0, loaded: 0, stalled: false, retry: 0, error: null, stage: '' });
    startWatchdog();
    let files;
    try {
        files = await downloadModel();
    } catch (err) {
        clearInterval(watchdog);
        if (err.message === 'cancelled') return false;
        setStatus({ state: 'error', error: err.http ? `HTTP ${err.http}` : (err.name === 'TypeError' || err.message === 'timeout' ? 'unreachable' : err.message), stalled: false });
        return false;
    }
    if (status.state !== 'loading') return false;          // בוטל בזמן ההורדה
    lastStage = '';
    setStatus({ phase: 'init', progress: 1, loaded: MODEL_BYTES, stalled: false, stage: '' });
    startWatchdog();
    // התוכן עובר לחוט הצדדי ישירות מהזיכרון, בלי לחכות למטמון של הדפדפן
    if (files.length) ensureWorker().postMessage({ type: 'files', files: files.map((f) => [f.url, f.buffer]) }, files.map((f) => f.buffer));
    const res = await call({ type: 'load' });
    clearInterval(watchdog);
    return !!res.ok;
};

/* ── ציור המשיכות לתמונה ── */

/** תיבה תוחמת משותפת לכמה אובייקטים, בקואורדינטות הלוח */
export const unionBounds = (objects) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objects) {
        const b = o.getBoundingRect();
        minX = Math.min(minX, b.left); minY = Math.min(minY, b.top);
        maxX = Math.max(maxX, b.left + b.width); maxY = Math.max(maxY, b.top + b.height);
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * מצייר את המשיכות בשחור על לבן. דיו ממולא מצויר מהנתיב שלו עצמו, וכל
 * השאר — קווים, חצים ושברים שהפכו לקו ישר — מצוירים כקווי מתאר.
 */
export function renderInkToCanvas(objects) {
    const b = unionBounds(objects);
    const target = 720;
    const k = Math.min(6, target / Math.max(b.width, b.height, 1));
    const pad = 24;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(b.width * k + pad * 2);
    cv.height = Math.ceil(b.height * k + pad * 2);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const base = [k, 0, 0, k, pad - b.left * k, pad - b.top * k];

    for (const obj of objects) {
        if (obj.inkFilled && Array.isArray(obj.path)) {
            const m = fabric.util.multiplyTransformMatrices(base, obj.calcTransformMatrix());
            const off = obj.pathOffset || { x: 0, y: 0 };
            ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
            ctx.translate(-off.x, -off.y);
            ctx.fill(new Path2D(fabric.util.joinPath(obj.path)));
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            continue;
        }
        const lines = getOutlinePolylines(obj);
        if (!lines) continue;
        const sc = Math.sqrt(Math.abs(obj.calcTransformMatrix()[0] * obj.calcTransformMatrix()[3]));
        ctx.lineWidth = Math.max(2, (obj.strokeWidth || 2) * sc * k);
        for (const { points, closed } of lines) {
            ctx.beginPath();
            points.forEach((p, i) => {
                const x = p.x * k + base[4], y = p.y * k + base[5];
                if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            });
            if (closed) ctx.closePath();
            ctx.stroke();
        }
    }
    return cv;
}

/**
 * העיבוד המקדים של Texo: חיתוך לתוכן, הקטנה כך שהמימד הקצר יגיע ל־384
 * בלי לחרוג משום מימד, מירכוז על רקע שחור, ונרמול לפי הממוצע וסטיית התקן
 * של נתוני האימון. זהה לעיבוד שבאתר המודל.
 */
export function preprocess(cv) {
    const ctx = cv.getContext('2d');
    const { width: w, height: h } = cv;
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (g < 200) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX <= minX || maxY <= minY) return null;
    const cw = maxX - minX, ch = maxY - minY;
    let scale = SIZE / Math.min(cw, ch);
    let nw = Math.round(cw * scale), nh = Math.round(ch * scale);
    if (nw > SIZE || nh > SIZE) {
        const r = Math.min(SIZE / nw, SIZE / nh);
        nw = Math.max(1, Math.round(nw * r)); nh = Math.max(1, Math.round(nh * r));
    }
    const out = document.createElement('canvas');
    out.width = SIZE; out.height = SIZE;
    const o = out.getContext('2d');
    o.fillStyle = '#000';
    o.fillRect(0, 0, SIZE, SIZE);
    o.imageSmoothingQuality = 'high';
    o.drawImage(cv, minX, minY, cw, ch, Math.floor((SIZE - nw) / 2), Math.floor((SIZE - nh) / 2), nw, nh);
    const od = o.getImageData(0, 0, SIZE, SIZE).data;
    const arr = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < arr.length; i++) {
        const v = 0.299 * od[i * 4] + 0.587 * od[i * 4 + 1] + 0.114 * od[i * 4 + 2];
        arr[i] = (v / 255 - MEAN) / STD;
    }
    return arr;
}

/**
 * ניקוי הפלט של המודל. הוא מחזיר אסימונים מופרדים ברווחים, כמו
 * "x ^ { 2 } + 1", ולעיתים \! ו־~ שאין בהם צורך בשדה עריכה.
 */
export function cleanLatex(raw) {
    let s = String(raw || '').trim()
        .replace(/~/g, ' ')
        .replace(/\\!/g, '')
        .replace(/\\(?:infin)\b/g, '\\infty')
        .replace(/\\rarr\b/g, '\\rightarrow')
        .replace(/\\Rarr\b/g, '\\Rightarrow');
    const tokens = s.split(/\s+/).filter(Boolean);
    let out = '';
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        const next = tokens[i + 1];
        out += tok;
        /* רווח נשמר רק אחרי פקודה שאחריה אות, אחרת \alpha b היה הופך ל־\alphab */
        if (next && /^\\[A-Za-z]+$/.test(tok) && /^[A-Za-z0-9]/.test(next)) out += ' ';
    }
    s = out
        .replace(/\\left\(/g, '(').replace(/\\right\)/g, ')')
        .replace(/\\operatorname\{(sin|cos|tan|ln|log|exp)\}/g, '\\$1');
    return s;
}

/** מזהה את המשיכות ומחזיר { ok, latex, raw } */
export async function recognizeInk(objects) {
    const ink = objects.filter((o) => o && !o.isEditHelper && typeOf(o) !== 'group' && typeOf(o) !== 'image');
    if (!ink.length) return { ok: false, error: 'empty' };
    const cv = renderInkToCanvas(ink);
    const pixels = preprocess(cv);
    if (!pixels) return { ok: false, error: 'empty' };
    if (status.state !== 'ready') {
        // המודל עוד לא הורד: ההורדה העצמאית, עם ההתקדמות והחידוש, ורק אחריה הזיהוי
        if (status.state === 'loading') await new Promise((res) => { const off = onMathInkStatus((st) => { if (st.state !== 'loading') { off(); res(); } }); });
        else await preloadMathInk();
        if (status.state !== 'ready') return { ok: false, error: status.error || 'model' };
    }
    const res = await call({ type: 'recognize', pixels }, [pixels.buffer]);
    if (!res.ok) return res;
    const latex = cleanLatex(res.latex);
    if (!latex) return { ok: false, error: 'no-result' };
    return { ok: true, latex, raw: res.latex };
}
