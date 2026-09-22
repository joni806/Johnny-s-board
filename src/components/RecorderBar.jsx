/**
 * סרגל ההקלטה והנגן.
 *
 * ההקלטה נשמרת בגוגל דרייב ולא במכשיר, ולכן בלי חיבור פעיל הסרגל מציג
 * הסבר וכפתור חיבור במקום כפתור הקלטה. זו החלטה מכוונת: שעה של שמע תופסת
 * עשרות מגה־בייט, ואחסון הדפדפן נמחק בלי התראה כשהמקום אוזל.
 */
import { formatTime } from '../utils/recorder';

const RecorderBar = ({
    status, elapsed, recordings, playing, playhead, duration,
    driveReady, onStart, onStop, onPause, onResume,
    onPlay, onStopPlay, onSeek, onDelete, onOpenDrive, onClose,
}) => {
    const btn = (tone) => ({
        border: 'none', borderRadius: '11px', padding: '8px 13px', cursor: 'pointer',
        fontSize: '13px', fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap',
        background: tone === 'rec' ? 'rgba(239,68,68,0.9)'
            : tone === 'primary' ? '#4ade80'
            : 'rgba(255,255,255,0.08)',
        color: tone === 'rec' ? '#fff' : tone === 'primary' ? '#14532d' : '#d4d4d8',
    });

    return (
        <div
            data-ui
            dir="rtl"
            onPointerDown={(e) => e.stopPropagation()}
            style={{
                position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
                zIndex: 10001, width: 'min(560px, calc(100vw - 24px))',
                background: 'rgba(24,24,27,0.94)', backdropFilter: 'blur(18px)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px',
                boxShadow: '0 12px 34px rgba(0,0,0,0.45)', padding: '12px 14px', color: '#e4e4e7',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '14px', marginInlineEnd: 'auto' }}>הקלטה מסונכרנת</strong>
                <button onClick={onClose} style={{ ...btn(), padding: '6px 10px' }}>סגור</button>
            </div>

            {!driveReady ? (
                <div style={{ marginTop: '10px' }}>
                    <p style={{ fontSize: '12.5px', color: '#a1a1aa', lineHeight: 1.6, margin: '0 0 10px' }}>
                        ההקלטות נשמרות בגוגל דרייב שלך ולא בזיכרון הדפדפן, כדי שהאפליקציה לא תתנפח
                        ושהשמע לא יימחק כשהמקום אוזל. צריך לחבר חשבון פעם אחת.
                    </p>
                    <button onClick={onOpenDrive} style={btn('primary')}>חבר את גוגל דרייב</button>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        {status === 'idle' && <button onClick={onStart} style={btn('rec')}>● התחל הקלטה</button>}
                        {status === 'recording' && (
                            <>
                                <button onClick={onPause} style={btn()}>השהה</button>
                                <button onClick={onStop} style={btn('rec')}>■ עצור ושמור</button>
                            </>
                        )}
                        {status === 'paused' && (
                            <>
                                <button onClick={onResume} style={btn('primary')}>המשך</button>
                                <button onClick={onStop} style={btn('rec')}>■ עצור ושמור</button>
                            </>
                        )}
                        {status === 'uploading' && <span style={{ fontSize: '13px', color: '#fde047' }}>מעלה לדרייב…</span>}

                        {(status === 'recording' || status === 'paused') && (
                            <span style={{ fontSize: '14px', fontVariantNumeric: 'tabular-nums', color: status === 'paused' ? '#a1a1aa' : '#f87171' }}>
                                {formatTime(elapsed)}
                            </span>
                        )}
                    </div>

                    {status === 'recording' && (
                        <div style={{ fontSize: '11.5px', color: '#71717a', marginTop: '8px', lineHeight: 1.5 }}>
                            כל מה שתכתוב מעכשיו מקבל חותמת זמן. אחר כך לחיצה על משפט תקפיץ את ההקלטה לרגע שבו נכתב.
                        </div>
                    )}

                    {playing && (
                        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button onClick={onStopPlay} style={btn()}>■</button>
                                <input
                                    type="range"
                                    min={0}
                                    max={Math.max(1, duration)}
                                    value={Math.min(playhead, duration)}
                                    onChange={(e) => onSeek(Number(e.target.value))}
                                    style={{ flex: 1, accentColor: '#4ade80' }}
                                />
                                <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: '#a1a1aa' }}>
                                    {formatTime(playhead)} / {formatTime(duration)}
                                </span>
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#71717a', marginTop: '7px', lineHeight: 1.5 }}>
                                מה שנכתב אחרי הרגע הנוכחי מוצג עמום. לחיצה על כתב יד קופצת לרגע שבו נכתב.
                            </div>
                        </div>
                    )}

                    {recordings.length > 0 && status === 'idle' && !playing && (
                        <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '170px', overflowY: 'auto' }}>
                            {recordings.map((r) => (
                                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                                    <button onClick={() => onPlay(r)} style={{ ...btn(), flex: 1, textAlign: 'start' }}>
                                        ▶ {new Date(r.createdAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        <span style={{ color: '#71717a', marginInlineStart: '8px' }}>{formatTime(r.duration)}</span>
                                    </button>
                                    <button onClick={() => onDelete(r)} title="מחק הקלטה" style={{ ...btn(), color: '#fca5a5', padding: '8px 10px' }}>✕</button>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default RecorderBar;
