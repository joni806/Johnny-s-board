import { useEffect, useState } from 'react';
import Icon from './icons';
import { getMathInkStatus, onMathInkStatus, preloadMathInk, cancelMathInk, wasMathInkDownloaded, MODEL_BYTES } from '../utils/mathInk';

const mb = (b) => (b / 1048576).toFixed(b >= 10485760 ? 0 : 1);

/**
 * חלון ההורדה הראשונה של מודל זיהוי הנוסחאות. מסביר מה יורד ולמה, מראה
 * התקדמות אמיתית בבייטים, מזהה הורדה תקועה או אתר חסום, ומאפשר לבטל ולנסות שוב.
 */
export default function MathInkDownload({ onClose }) {
    const [st, setSt] = useState(getMathInkStatus());
    useEffect(() => onMathInkStatus(setSt), []);
    useEffect(() => {
        if (st.state !== 'ready') return undefined;
        const t = setTimeout(onClose, 1300);
        return () => clearTimeout(t);
    }, [st.state, onClose]);

    const pct = Math.round((st.progress || 0) * 100);
    const downloaded = wasMathInkDownloaded();
    const start = () => { preloadMathInk(); };

    return (
        <div className="pb-modal" data-ui onPointerDown={(e) => { if (e.target === e.currentTarget && st.state !== 'loading') onClose(); }}>
            <div className="pb-modal-card mi-card" dir="rtl" role="dialog" aria-label="הורדת מודל זיהוי נוסחאות">
                <div className="mi-head">
                    <span className="mi-icon"><Icon name="mathpen" size={26} /></span>
                    <div>
                        <div className="pb-modal-title" style={{ margin: 0 }}>עט נוסחאות</div>
                        <div className="pe-hint">כותבים נוסחה ביד והיא הופכת לנוסחה מוקלדת</div>
                    </div>
                </div>

                {st.state === 'idle' && (
                    <>
                        <p className="mi-text">
                            כדי לזהות כתב יד מתמטי צריך להוריד מודל זיהוי, כ־{mb(MODEL_BYTES)} מגה־בייט. ההורדה חד־פעמית.
                            אחריה הזיהוי רץ במכשיר עצמו, בלי שרת, בלי מפתח ובלי חיבור לרשת, והכתב שלך לא יוצא מהמכשיר.
                        </p>
                        <div className="mi-actions">
                            <button className="stem-primary" onClick={start}><Icon name="drive" size={16} /> הורד עכשיו</button>
                            <button className="mi-ghost" onClick={onClose}>אחר כך</button>
                        </div>
                    </>
                )}

                {st.state === 'loading' && (
                    <>
                        <div className="mi-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                            <span style={{ width: `${Math.max(2, pct)}%` }} />
                        </div>
                        <div className="mi-meta">
                            <b dir="ltr">{pct}%</b>
                            <span dir="ltr">{mb(st.loaded || 0)} / {mb(MODEL_BYTES)} MB</span>
                        </div>
                        {st.phase === 'init' && <><p className="mi-text">ההורדה הסתיימה. מכין את המודל להפעלה…</p>{st.stage && <p className="pe-hint" dir="ltr">{st.stage}</p>}</>}
                        {st.phase !== 'init' && st.loaded === 0 && !st.stalled && <p className="mi-text">{downloaded ? 'טוען את המודל מהמכשיר…' : 'מתחבר לשרת ההורדה…'}</p>}
                        {st.stalled && (
                            <p className="mi-warn">
                                {st.retry ? `החיבור נקטע או איטי מאוד. מנסה להמשיך מאותה נקודה, ניסיון ${st.retry} מתוך 8.` : 'אין התקדמות כבר חצי דקה.'}
                                {st.progress < 0.995 && ' אם זה נמשך, ייתכן שהאתר huggingface.co חסום בסינון. אפשר לבטל ולנסות ברשת אחרת.'}
                            </p>
                        )}
                        {st.phase !== 'init' && st.progress >= 0.995 && <p className="mi-text">הקבצים ירדו. מעביר אותם להפעלה…</p>}
                        {st.stalled && st.stage && <p className="pe-hint" dir="ltr">{st.stage}</p>}
                        <div className="mi-actions">
                            <button className="mi-ghost" onClick={cancelMathInk}>בטל הורדה</button>
                            <button className="mi-ghost" onClick={onClose}>המשך ברקע</button>
                        </div>
                    </>
                )}

                {st.state === 'error' && (
                    <>
                        <p className="mi-warn">
                            {st.error === 'unreachable'
                                ? 'אין גישה לשרת ההורדה של המודל, huggingface.co, מהרשת הזו. אם יש סינון רשת, צריך לבקש לפתוח את האתר, או להתחבר לרשת אחרת. מה שכבר ירד נשמר, וניסיון חוזר ימשיך משם.'
                                : String(st.error || '').startsWith('init-timeout')
                                    ? 'המודל ירד אבל ההכנה שלו להפעלה נתקעה. הקבצים שמורים, אז ניסיון חוזר לא יוריד שוב. אם זה חוזר, שלח לי את השורה שמתחת.'
                                    : 'ההורדה נכשלה. בדוק את החיבור לרשת ונסה שוב.'}
                        </p>
                        {st.error && st.error !== 'unreachable' && <p className="pe-hint" dir="ltr" style={{ wordBreak: 'break-word' }}>{String(st.error).slice(0, 160)}</p>}
                        <div className="mi-actions">
                            <button className="stem-primary" onClick={() => { cancelMathInk(); start(); }}>נסה שוב</button>
                            <button className="mi-ghost" onClick={onClose}>סגור</button>
                        </div>
                    </>
                )}

                {st.state === 'ready' && (
                    <p className="mi-ok"><Icon name="check" size={18} /> המודל מוכן. אפשר לכתוב נוסחה ביד</p>
                )}
            </div>
        </div>
    );
}
