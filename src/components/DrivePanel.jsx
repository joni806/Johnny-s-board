/**
 * חלונית חיבור לגוגל דרייב.
 *
 * האפליקציה רצה כולה בדפדפן ואין לה שרת, ולכן אין מקום בטוח להחזיק בו
 * מזהה לקוח משותף. במקום זה כל משתמש יוצר מזהה משלו בקונסולת גוגל ומדביק
 * אותו כאן. כך הקבצים נשארים בחשבון שלו, והאפליקציה מבקשת הרשאה לקבצים
 * שהיא עצמה יצרה בלבד.
 */
import { useEffect, useState } from 'react';
import {
    getClientId, setClientId, connect, disconnect, getStatus, onDriveChange,
} from '../utils/drive';

const STEPS = [
    'היכנס אל console.cloud.google.com ופתח פרויקט חדש',
    'בתפריט APIs & Services הפעל את Google Drive API',
    'במסך OAuth consent screen בחר External, מלא שם ואימייל, והוסף את עצמך תחת Test users',
    'ב-Credentials צור OAuth client ID מסוג Web application',
    'תחת Authorized JavaScript origins הוסף את http://localhost:5173 ואת הכתובת שבה האפליקציה מתארחת',
    'העתק את ה-Client ID והדבק אותו כאן',
];

const DrivePanel = ({ onClose, onBackup, backupLabel }) => {
    const [clientId, setValue] = useState(getClientId());
    const [status, setStatus] = useState(getStatus());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);
    const [showGuide, setShowGuide] = useState(!getClientId());

    useEffect(() => onDriveChange(setStatus), []);

    // Escape סוגר את החלונית, כמו בכל דיאלוג אחר באפליקציה
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const saveId = () => {
        setClientId(clientId);
        setStatus(getStatus());
        setMessage(clientId.trim() ? 'המזהה נשמר' : 'המזהה נמחק');
    };

    const doConnect = async () => {
        setClientId(clientId);
        setBusy(true);
        setMessage(null);
        const res = await connect({ interactive: true });
        setBusy(false);
        setStatus(getStatus());
        if (res.ok) { setMessage('מחובר לדרייב'); return; }
        const texts = {
            'no-client-id': 'צריך להדביק Client ID קודם',
            offline: 'אין חיבור לאינטרנט, או שגוגל חסומה כאן',
            timeout: 'חלון ההרשאה נסגר בלי אישור',
            denied: 'ההרשאה נדחתה',
        };
        setMessage(texts[res.reason] || `החיבור נכשל: ${res.reason}`);
    };

    const doBackup = async () => {
        if (!onBackup) return;
        setBusy(true);
        setMessage(null);
        const res = await onBackup();
        setBusy(false);
        setMessage(res && res.ok ? 'הלוח גובה לדרייב' : 'הגיבוי נכשל');
    };

    const box = {
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px', color: '#e4e4e7', padding: '10px 12px',
        fontSize: '13px', width: '100%', outline: 'none', fontFamily: 'inherit',
    };
    const action = (tone) => ({
        border: 'none', borderRadius: '10px', padding: '10px 14px', cursor: busy ? 'default' : 'pointer',
        fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
        background: tone === 'primary' ? '#4ade80' : 'rgba(255,255,255,0.07)',
        color: tone === 'primary' ? '#14532d' : tone === 'danger' ? '#fca5a5' : '#d4d4d8',
    });

    return (
        <div
            dir="rtl"
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 10050, display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: '20px',
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: 'min(520px, 100%)', maxHeight: '86vh', overflowY: 'auto',
                    background: 'rgba(24,24,27,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '18px', padding: '22px', color: '#e4e4e7',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <h2 style={{ margin: 0, fontSize: '18px' }}>גוגל דרייב</h2>
                    <button onClick={onClose} style={{ ...action(), padding: '6px 10px' }}>סגור</button>
                </div>

                <p style={{ fontSize: '13px', color: '#a1a1aa', lineHeight: 1.6, margin: '0 0 16px' }}>
                    חיבור לדרייב מאפשר לשמור הקלטות וגיבויים של הלוחות בחשבון שלך במקום בזיכרון הדפדפן.
                    האפליקציה מבקשת הרשאה לקבצים שהיא עצמה יוצרת בלבד, ואין לה גישה לשאר הדרייב.
                </p>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px',
                    padding: '10px 12px', borderRadius: '10px',
                    background: status.connected ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)',
                }}>
                    <span style={{
                        width: '9px', height: '9px', borderRadius: '50%',
                        background: status.connected ? '#4ade80' : '#71717a',
                    }} />
                    <span style={{ fontSize: '13px' }}>
                        {status.connected ? `מחובר${status.email ? ` — ${status.email}` : ''}` : 'לא מחובר'}
                    </span>
                </div>

                <label style={{ fontSize: '12px', color: '#a1a1aa', display: 'block', marginBottom: '6px' }}>
                    Client ID
                </label>
                <input
                    value={clientId}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="123456789-abc.apps.googleusercontent.com"
                    dir="ltr"
                    style={{ ...box, marginBottom: '10px', textAlign: 'left' }}
                />

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <button disabled={busy} onClick={doConnect} style={action('primary')}>
                        {status.connected ? 'התחבר מחדש' : 'התחבר לדרייב'}
                    </button>
                    <button disabled={busy} onClick={saveId} style={action()}>שמור מזהה</button>
                    {status.connected && (
                        <button disabled={busy} onClick={() => { disconnect(); setStatus(getStatus()); setMessage('החיבור נותק'); }} style={action('danger')}>
                            נתק
                        </button>
                    )}
                    {onBackup && status.connected && (
                        <button disabled={busy} onClick={doBackup} style={action()}>
                            {backupLabel || 'גבה את הלוח עכשיו'}
                        </button>
                    )}
                </div>

                {message && (
                    <div style={{ fontSize: '13px', color: '#fde047', marginBottom: '14px' }}>{message}</div>
                )}

                <button onClick={() => setShowGuide((v) => !v)} style={{ ...action(), width: '100%' }}>
                    {showGuide ? 'הסתר את המדריך' : 'איך משיגים Client ID'}
                </button>

                {showGuide && (
                    <ol style={{ fontSize: '12.5px', color: '#a1a1aa', lineHeight: 1.75, paddingInlineStart: '20px', marginTop: '12px' }}>
                        {STEPS.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                )}
            </div>
        </div>
    );
};

export default DrivePanel;
