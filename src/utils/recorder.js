/**
 * הקלטת שמע מסונכרנת לדיו.
 *
 * הרעיון, בעקבות Notability: כל מה שנכתב על הלוח מקבל חותמת זמן ביחס
 * לתחילת ההקלטה. אחר כך אפשר ללחוץ על משפט שנכתב ולקפוץ ישר לרגע שבו הוא
 * נכתב, במקום לחפש בהקלטה של שעה.
 *
 * המודול מטפל רק בשמע ובשעון. חיבור חותמות הזמן לאובייקטים נעשה בלוח עצמו.
 */

const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
];

/** האם הדפדפן תומך בהקלטה בכלל */
export const isRecordingSupported = () =>
    typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;

const pickMimeType = () => {
    for (const type of MIME_CANDIDATES) {
        try { if (window.MediaRecorder.isTypeSupported(type)) return type; } catch { /* בדיקה לא נתמכת */ }
    }
    return '';
};

/**
 * מקליט יחיד. מחזיק שעון שמתעלם מזמני השהיה, כך שחותמות הזמן תואמות
 * למיקום בפועל בקובץ השמע ולא לשעון הקיר.
 */
export const createRecorder = () => {
    let mediaRecorder = null;
    let stream = null;
    let chunks = [];
    let startedAt = 0;
    let pausedTotal = 0;
    let pausedAt = 0;
    let status = 'idle';   // idle | recording | paused | stopping

    /** כמה מילי־שניות של שמע הוקלטו עד כה */
    const elapsed = () => {
        if (status === 'idle') return 0;
        const frozen = status === 'paused' ? Date.now() - pausedAt : 0;
        return Date.now() - startedAt - pausedTotal - frozen;
    };

    const start = async () => {
        if (!isRecordingSupported()) return { ok: false, reason: 'unsupported' };
        if (status !== 'idle') return { ok: false, reason: 'busy' };
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch (err) {
            return { ok: false, reason: err?.name === 'NotAllowedError' ? 'denied' : 'no-mic' };
        }
        const mimeType = pickMimeType();
        try {
            mediaRecorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        } catch {
            stream.getTracks().forEach((t) => t.stop());
            stream = null;
            return { ok: false, reason: 'unsupported' };
        }
        chunks = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        // מקטעים של שנייה מונעים אובדן הכל אם הלשונית קורסת באמצע
        mediaRecorder.start(1000);
        startedAt = Date.now();
        pausedTotal = 0;
        pausedAt = 0;
        status = 'recording';
        return { ok: true, mimeType: mediaRecorder.mimeType || mimeType || 'audio/webm' };
    };

    const pause = () => {
        if (status !== 'recording' || !mediaRecorder.pause) return false;
        mediaRecorder.pause();
        pausedAt = Date.now();
        status = 'paused';
        return true;
    };

    const resume = () => {
        if (status !== 'paused') return false;
        mediaRecorder.resume();
        pausedTotal += Date.now() - pausedAt;
        pausedAt = 0;
        status = 'recording';
        return true;
    };

    /** עוצר ומחזיר { blob, mimeType, duration } */
    const stop = () => new Promise((resolve) => {
        if (status === 'idle' || !mediaRecorder) { resolve(null); return; }
        const duration = elapsed();
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        status = 'stopping';
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            chunks = [];
            if (stream) stream.getTracks().forEach((t) => t.stop());
            stream = null;
            mediaRecorder = null;
            status = 'idle';
            resolve({ blob, mimeType, duration });
        };
        try { mediaRecorder.stop(); }
        catch { status = 'idle'; resolve(null); }
    });

    /** ביטול מיידי בלי לייצר קובץ, לשימוש בסגירת הלוח */
    const abort = () => {
        try { if (mediaRecorder && status !== 'idle') mediaRecorder.stop(); } catch { /* כבר נעצר */ }
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null; mediaRecorder = null; chunks = []; status = 'idle';
    };

    return {
        start, stop, pause, resume, abort, elapsed,
        get status() { return status; },
    };
};

/** פורמט זמן קצר לתצוגה: 04:31 */
export const formatTime = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
