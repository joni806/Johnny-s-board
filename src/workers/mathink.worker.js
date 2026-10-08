/**
 * חוט צדדי לזיהוי כתב יד מתמטי.
 *
 * המודל הוא Texo — מודל קטן של כעשרים מיליון פרמטרים, שמזהה נוסחאות
 * מודפסות וכתובות ביד ומחזיר LaTeX. הוא רץ כולו בדפדפן דרך Transformers.js,
 * בלי שרת ובלי מפתח: התמונה של כתב היד לא יוצאת מהמכשיר. בשימוש הראשון
 * המודל יורד מ־Hugging Face, בערך 80 מגה־בייט, ונשמר במטמון של הדפדפן.
 * מאותו רגע הזיהוי עובד גם בלי רשת.
 *
 * מודל: alephpi/FormulaNet — https://github.com/alephpi/Texo
 */
import { VisionEncoderDecoderModel, PreTrainedTokenizer, Tensor, cat, env } from '@huggingface/transformers';
/* מנוע ה־ONNX נארז עם האפליקציה ולא נטען מ־CDN, כדי שהזיהוי יעבוד גם
   בלי רשת ולא יהיה תלוי בשרת חיצוני מלבד ההורדה הראשונה של המודל */
import ortMjsUrl from '../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import ortWasmUrl from '../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';

const MODEL_ID = 'alephpi/FormulaNet';

env.allowLocalModels = false;

/* מטמון משלנו: קודם קבצים שהגיעו עכשיו מההורדה, בזיכרון, ורק אחר כך המטמון
   של הדפדפן. כל פנייה למטמון מוגבלת בזמן, כדי שמטמון תקוע לא יתקע את הטעינה. */
const mem = new Map();
const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => undefined), new Promise((r) => setTimeout(() => r(undefined), ms))]);
let cachePromise = null;
const openCache = () => {
    if (typeof caches === 'undefined') return Promise.resolve(undefined);
    if (!cachePromise) cachePromise = within(caches.open('transformers-cache'), 8000);
    return cachePromise;
};
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
    async match(key) {
        const url = typeof key === 'string' ? key : key && key.url;
        const buf = mem.get(url);
        if (buf) return new Response(buf, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } });
        const cache = await openCache();
        return cache ? within(cache.match(url), 15000) : undefined;
    },
    async put(key, response) {
        const cache = await openCache();
        if (cache) await within(cache.put(key, response), 60000);
    },
};
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = { mjs: new URL(ortMjsUrl, self.location.href).href, wasm: new URL(ortWasmUrl, self.location.href).href };
    env.backends.onnx.wasm.numThreads = 1;
}

let model = null;
let tokenizer = null;
let loading = null;

const load = () => {
    if (loading) return loading;
    loading = (async () => {
        const stage = (name, detail) => self.postMessage({ type: 'stage', stage: name, detail: detail || '' });
        const progress = (p) => {
            self.postMessage({ type: 'tick' });
            if (p && p.file && (p.status === 'initiate' || p.status === 'done')) stage(p.status === 'initiate' ? 'fetch' : 'got', p.file);
            if (p && p.status === 'progress' && typeof p.progress === 'number') {
                self.postMessage({ type: 'progress', file: p.file, progress: p.progress, loaded: p.loaded, total: p.total });
            }
        };
        stage('start', typeof caches === 'undefined' ? 'no-cache-api' : 'cache-api');
        model = await VisionEncoderDecoderModel.from_pretrained(MODEL_ID, { dtype: 'fp32', progress_callback: progress });
        stage('model-ready');
        tokenizer = await PreTrainedTokenizer.from_pretrained(MODEL_ID);
        stage('tokenizer-ready');
        mem.clear();
        self.postMessage({ type: 'ready' });
    })().catch((err) => {
        loading = null;
        throw err;
    });
    return loading;
};

self.onmessage = async (event) => {
    const { id, type, pixels, files } = event.data || {};
    if (type === 'files') {
        for (const [url, buf] of files || []) mem.set(url, buf);
        self.postMessage({ type: 'stage', stage: 'files', detail: String((files || []).length) });
        return;
    }
    try {
        if (type === 'load') {
            await load();
            self.postMessage({ id, type: 'loaded' });
            return;
        }
        if (type === 'recognize') {
            await load();
            const t = new Tensor('float32', pixels, [1, 1, 384, 384]);
            const input = cat([t, t, t], 1);
            const out = await model.generate({ inputs: input, max_new_tokens: 320 });
            const text = tokenizer.batch_decode(out, { skip_special_tokens: true })[0] || '';
            self.postMessage({ id, type: 'result', latex: text });
        }
    } catch (err) {
        self.postMessage({ id, type: 'error', error: String((err && err.message) || err) });
    }
};
