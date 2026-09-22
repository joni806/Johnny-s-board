/**
 * חיבור לגוגל דרייב.
 *
 * למה זה נדרש: ההקלטות הן הקובץ הכבד באפליקציה. שעה אחת של שמע דחוס תופסת
 * בערך 25 מגה־בייט, ו-IndexedDB בדפדפן מוגבל ונמחק בלי התראה כשהמקום אוזל.
 * לכן השמע נשמר בדרייב של המשתמש, ובמכשיר נשארים רק מזהה הקובץ וחותמות
 * הזמן — כמה קילו־בייטים.
 *
 * ההרשאה המבוקשת היא drive.file בלבד: גישה אך ורק לקבצים שהאפליקציה עצמה
 * יצרה. אין לה שום יכולת לקרוא את שאר הדרייב של המשתמש.
 *
 * מזהה הלקוח אינו מוטמע בקוד. המשתמש מדביק אותו בהגדרות, והוא נשמר מקומית.
 * אסימון הגישה נשמר בזיכרון בלבד ולא נכתב לשום מקום.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID_KEY = 'jb_drive_client_id';
const FOLDER_NAME = 'לוח פיזיקה';

const state = {
    token: null,
    expiresAt: 0,
    tokenClient: null,
    folderId: null,
    email: null,
};

const listeners = new Set();
/** מאפשר לממשק להתעדכן בכל שינוי מצב חיבור */
export const onDriveChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) { try { fn(getStatus()); } catch { /* מאזין תקול */ } } };

export const getClientId = () => {
    try { return localStorage.getItem(CLIENT_ID_KEY) || ''; } catch { return ''; }
};

export const setClientId = (id) => {
    try {
        const clean = (id || '').trim();
        if (clean) localStorage.setItem(CLIENT_ID_KEY, clean);
        else localStorage.removeItem(CLIENT_ID_KEY);
    } catch { /* אחסון חסום */ }
    // החלפת מזהה מבטלת את החיבור הקיים
    state.token = null; state.expiresAt = 0; state.tokenClient = null; state.folderId = null; state.email = null;
    emit();
};

export const isConfigured = () => !!getClientId();
export const isConnected = () => !!state.token && Date.now() < state.expiresAt;

export const getStatus = () => ({
    configured: isConfigured(),
    connected: isConnected(),
    email: state.email,
    clientId: getClientId(),
});

/** טוען את ספריית הזהות של גוגל פעם אחת */
const loadGis = () => new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('gis-load')));
        return;
    }
    const el = document.createElement('script');
    el.src = GIS_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('gis-load'));
    document.head.appendChild(el);
});

/**
 * מבקש אסימון גישה. interactive=false מנסה חידוש שקט, בלי חלון קופץ,
 * ומשמש כשאסימון קיים פג באמצע עבודה.
 */
export const connect = async ({ interactive = true } = {}) => {
    const clientId = getClientId();
    if (!clientId) return { ok: false, reason: 'no-client-id' };

    try { await loadGis(); }
    catch { return { ok: false, reason: 'offline' }; }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve(value); } };

        try {
            state.tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPE,
                callback: (response) => {
                    if (response.error || !response.access_token) {
                        finish({ ok: false, reason: response.error || 'denied' });
                        return;
                    }
                    state.token = response.access_token;
                    // שומרים שוליים של דקה, כדי לא להיתפס עם אסימון שפג באמצע העלאה
                    state.expiresAt = Date.now() + (Number(response.expires_in || 3600) - 60) * 1000;
                    emit();
                    fetchUserEmail().finally(() => finish({ ok: true }));
                },
                error_callback: (err) => finish({ ok: false, reason: err?.type || 'denied' }),
            });
            state.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        } catch (err) {
            finish({ ok: false, reason: err?.message || 'init' });
        }

        // חלון שנסגר בלי בחירה לא מחזיר שום דבר, ובלי זה ההבטחה תיתקע לנצח
        setTimeout(() => finish({ ok: false, reason: 'timeout' }), interactive ? 120000 : 15000);
    });
};

export const disconnect = () => {
    const token = state.token;
    state.token = null; state.expiresAt = 0; state.folderId = null; state.email = null;
    emit();
    if (token && window.google?.accounts?.oauth2?.revoke) {
        try { window.google.accounts.oauth2.revoke(token, () => {}); } catch { /* כבר בוטל */ }
    }
};

const fetchUserEmail = async () => {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${state.token}` },
        });
        if (res.ok) { state.email = (await res.json()).email || null; emit(); }
    } catch { /* לא קריטי, זה רק לתצוגה */ }
};

/**
 * קריאה מאומתת ל-Drive. על 401 מנסים חידוש שקט פעם אחת, כי אסימון
 * גוגל חי כשעה וסשן עבודה ארוך מזה.
 */
const driveFetch = async (url, options = {}, retry = true) => {
    if (!isConnected()) {
        const res = await connect({ interactive: false });
        if (!res.ok) throw Object.assign(new Error('not-connected'), { reason: res.reason });
    }
    const response = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${state.token}` },
    });
    if (response.status === 401 && retry) {
        state.token = null; state.expiresAt = 0;
        const again = await connect({ interactive: false });
        if (!again.ok) throw Object.assign(new Error('not-connected'), { reason: again.reason });
        return driveFetch(url, options, false);
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw Object.assign(new Error(`drive-${response.status}`), { status: response.status, body: text });
    }
    return response;
};

/** מאתר או יוצר את תיקיית האפליקציה בדרייב */
export const ensureFolder = async () => {
    if (state.folderId) return state.folderId;
    const q = encodeURIComponent(
        `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
    const data = await res.json();
    if (data.files?.length) { state.folderId = data.files[0].id; return state.folderId; }

    const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    state.folderId = (await created.json()).id;
    return state.folderId;
};

/**
 * העלאת קובץ. fileId קיים גורם לעדכון במקום ליצירה, כדי שגיבוי חוזר
 * של אותו לוח לא ייצור עשרות עותקים בדרייב.
 */
export const uploadFile = async ({ name, mimeType, body, fileId = null, appProperties = null }) => {
    const metadata = { name, mimeType };
    if (appProperties) metadata.appProperties = appProperties;
    if (!fileId) metadata.parents = [await ensureFolder()];

    const boundary = `pb${Math.random().toString(36).slice(2)}`;
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const payload = new Blob([head, body, tail], { type: `multipart/related; boundary=${boundary}` });

    const url = fileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,size`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size';

    const res = await driveFetch(url, { method: fileId ? 'PATCH' : 'POST', body: payload });
    return res.json();
};

export const downloadFile = async (fileId) => {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return res.blob();
};

export const downloadJson = async (fileId) => {
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return res.json();
};

export const deleteFile = async (fileId) => {
    try { await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' }); return true; }
    catch { return false; }
};

/** רשימת הקבצים שהאפליקציה יצרה, אפשר לסנן לפי appProperties */
export const listAppFiles = async (extraQuery = '') => {
    const folderId = await ensureFolder();
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false${extraQuery ? ` and ${extraQuery}` : ''}`);
    const res = await driveFetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,modifiedTime,appProperties)&orderBy=modifiedTime desc`
    );
    return (await res.json()).files || [];
};

/** גיבוי מלא של לוח כקובץ JSON יחיד בדרייב */
export const backupProject = async (project, existingFileId = null) => {
    const payload = JSON.stringify({ ...project, backedUpAt: Date.now() });
    const file = await uploadFile({
        name: `${(project.title || 'לוח').replace(/[\\/:*?"<>|]/g, '_')}.board.json`,
        mimeType: 'application/json',
        body: payload,
        fileId: existingFileId,
        appProperties: { kind: 'board', projectId: project.id },
    });
    return file;
};

/** העלאת הקלטה. מחזיר את מזהה הקובץ שיישמר מקומית במקום השמע עצמו */
export const uploadRecording = async (projectId, blob, { name, mimeType }) => {
    const file = await uploadFile({
        name,
        mimeType: mimeType || blob.type || 'audio/webm',
        body: blob,
        appProperties: { kind: 'recording', projectId },
    });
    return file;
};
