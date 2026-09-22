import { useEffect, useState } from 'react';
import {
    setClientId, connect, disconnect, getStatus, onDriveChange,
} from '../utils/drive';

// פה אתה מדביק את ה-Client ID שלך בתוך המרכאות!
const MY_CLIENT_ID = "506884770834-873shlqn1tk1c9qa594h5ngdh918l38r.apps.googleusercontent.com";

const DrivePanel = ({ onClose, onBackup, backupLabel }) => {
    const [status, setStatus] = useState(getStatus());
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        // המערכת מזינה את המזהה שלך אוטומטית מאחורי הקלעים
        setClientId(MY_CLIENT_ID);
        onDriveChange(setStatus);
    }, []);

    // Escape סוגר את החלונית
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const doConnect = async () => {
        setClientId(MY_CLIENT_ID); // מוודאים שהמזהה מעודכן לפני החיבור
        setBusy(true);
        setMessage(null);
        
        const res = await connect({ interactive: true });
        
        setBusy(false);
        setStatus(getStatus());
        
        if (res.ok) { 
            setMessage('מחובר בהצלחה לדרייב'); 
            return; 
        }
        
        const texts = {
            'no-client-id': 'ה-Client ID חסר בקוד',
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

    const action = (tone) => ({
        border: 'none', borderRadius: '10px', padding: '12px 14px', cursor: busy ? 'default' : 'pointer',
        fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
        background: tone === 'primary' ? '#4ade80' : 'rgba(255,255,255,0.07)',
        color: tone === 'primary' ? '#14532d' : tone === 'danger' ? '#fca5a5' : '#d4d4d8',
        transition: '0.2s', width: '100%'
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
                    width: 'min(400px, 100%)', maxHeight: '86vh', overflowY: 'auto',
                    background: 'rgba(24,24,27,0.98)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '20px', padding: '24px', color: '#e4e4e7',
                    boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0, fontSize: '20px' }}>שמירה בענן</h2>
                    <button onClick={onClose} style={{ ...action(), padding: '6px 10px', width: 'auto', fontSize: '13px' }}>סגור</button>
                </div>

                <p style={{ fontSize: '14px', color: '#a1a1aa', lineHeight: 1.6, margin: '0 0 24px' }}>
                    התחבר עם חשבון הגוגל שלך כדי לשמור את הלוחות וההקלטות בבטחה ב-Google Drive.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {!status.connected ? (
                        <button disabled={busy} onClick={doConnect} style={action('primary')}>
                            התחבר עם חשבון גוגל
                        </button>
                    ) : (
                        <>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '12px 14px', borderRadius: '10px',
                                background: 'rgba(74,222,128,0.12)', color: '#4ade80'
                            }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#4ade80' }} />
                                <span style={{ fontSize: '14px', fontWeight: 500 }}>
                                    מחובר ({status.email})
                                </span>
                            </div>
                            
                            {onBackup && (
                                <button disabled={busy} onClick={doBackup} style={action('primary')}>
                                    {backupLabel || 'גבה את הלוח עכשיו'}
                                </button>
                            )}
                            
                            <button disabled={busy} onClick={() => { disconnect(); setStatus(getStatus()); setMessage('החיבור נותק'); }} style={action('danger')}>
                                התנתק מהחשבון
                            </button>
                        </>
                    )}
                </div>

                {message && (
                    <div style={{ fontSize: '14px', color: '#fde047', marginTop: '16px', textAlign: 'center', fontWeight: 500 }}>
                        {message}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DrivePanel;