/**
 * סרגל מצב הצגה.
 *
 * במצב הזה סרגל הכלים המלא מוסתר, כדי שהלוח יתפוס את כל המסך מול קהל.
 * נשאר רק המינימום שמרצה צריך תוך כדי דיבור: סמן לייזר, עט, מחק, ביטול
 * פעולה ויציאה. הסרגל מתעמעם כשלא נוגעים בו, ומתעורר במעבר עכבר או מגע.
 */
import { useEffect, useRef, useState } from 'react';

const TOOLS = [
    { id: 'laser', label: 'לייזר', icon: '🔴' },
    { id: 'draw', label: 'עט', icon: '✏️' },
    { id: 'erase', label: 'מחק', icon: '🧽' },
];

const PresentBar = ({ mode, setMode, onUndo, onExit }) => {
    const [dim, setDim] = useState(false);
    const timerRef = useRef(null);

    useEffect(() => {
        const wake = () => {
            setDim(false);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setDim(true), 3200);
        };
        wake();
        window.addEventListener('pointermove', wake, { passive: true });
        window.addEventListener('pointerdown', wake, { passive: true });
        return () => {
            window.removeEventListener('pointermove', wake);
            window.removeEventListener('pointerdown', wake);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const btn = (active) => ({
        border: 'none', borderRadius: '11px', cursor: 'pointer',
        padding: '8px 12px', fontSize: '15px', lineHeight: 1,
        background: active ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.07)',
        color: active ? '#4ade80' : '#d4d4d8',
        outline: active ? '1px solid rgba(74,222,128,0.4)' : 'none',
        transition: '0.15s',
    });

    return (
        <div
            data-ui
            dir="rtl"
            onPointerDown={(e) => e.stopPropagation()}
            style={{
                position: 'fixed', bottom: '22px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 10001, display: 'flex', alignItems: 'center', gap: '6px',
                padding: '7px 9px', borderRadius: '16px',
                background: 'rgba(24,24,27,0.88)', backdropFilter: 'blur(18px)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
                opacity: dim ? 0.22 : 1, transition: 'opacity 0.45s',
            }}
        >
            {TOOLS.map((t) => (
                <button key={t.id} title={t.label} onClick={() => setMode(t.id)} style={btn(mode === t.id)}>
                    <span style={{ marginLeft: '5px' }}>{t.icon}</span>{t.label}
                </button>
            ))}
            <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,0.12)', margin: '0 3px' }} />
            <button title="בטל פעולה" onClick={onUndo} style={btn(false)}>↺</button>
            <button title="צא ממצב הצגה" onClick={onExit} style={{ ...btn(false), color: '#fca5a5' }}>יציאה</button>
        </div>
    );
};

export default PresentBar;
