import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from './icons';
import Popover from './Popover';
import StemPanel from './StemPanel';
import MathInkDownload from './MathInkDownload';
import { getMathInkStatus, preloadMathInk, wasMathInkDownloaded } from '../utils/mathInk';
import { PEN_KINDS, EXTRA_KINDS, COLOR_BAR } from '../utils/pens';
import './toolbar.css';

const DOCK_KEY = 'pb_dock_v1';
const ERASER_SIZES = [8, 16, 28, 48, 80];
/** מרחק מהקצה שבו גרירה מצמידה את הסרגל. גדול, כדי שיהיה קל לפגוע בו באצבע */
const SNAP = 120;
const SIDES = ['top', 'bottom', 'left', 'right'];
const SIDE_LABEL = { top: 'למעלה', bottom: 'למטה', left: 'שמאל', right: 'ימין' };

const loadDock = () => {
    try {
        const d = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null');
        if (d && [...SIDES, 'float'].includes(d.side)) return { collapsed: false, x: 0, y: 0, ...d };
    } catch { /* אין אחסון */ }
    return { side: 'top', x: 0, y: 0, collapsed: false };
};
const saveDock = (d) => { try { localStorage.setItem(DOCK_KEY, JSON.stringify(d)); } catch { /* מצב פרטי */ } };

/** לאיזה צד של המסך הגרירה הקרובה ביותר. בפינה מעדיפים צד, כי שם נוח ליד */
const nearestSide = (x, y) => {
    const d = { left: x, right: window.innerWidth - x, top: y, bottom: window.innerHeight - y };
    let best = null;
    for (const k of ['left', 'right', 'top', 'bottom']) if (best === null || d[k] < d[best]) best = k;
    return d[best] <= SNAP ? best : null;
};

const SHAPE_CATEGORIES = [
    { title: 'מצולעים', shapes: ['rect', 'triangle', 'right-triangle', 'diamond', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'parallelogram', 'trapezoid'] },
    { title: 'מעוגלים וכוכבים', shapes: ['circle', 'ellipse', 'half-circle', 'star-4', 'star-5', 'star-6'] },
    { title: 'חצים', shapes: ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down'] },
    { title: 'סימנים ותרשימים', shapes: ['math-plus', 'math-minus', 'math-multiply', 'cylinder', 'cube', 'heart', 'lightning', 'moon', 'cloud', 'speech-bubble'] },
];

const SHORTCUTS = [
    ['1 עד 9', 'בחירת עט'],
    ['E', 'מחק, ולחיצה נוספת מחליפה בין מחק חלקי לשלם'],
    ['V', 'בחירה'],
    ['T', 'טקסט'],
    ['M', 'נוסחה'],
    ['Ctrl+C / Ctrl+V', 'העתקה והדבקה במקום של הסמן'],
    ['Ctrl+D', 'שכפול'],
    ['Ctrl+Z / Ctrl+Y', 'ביטול וחזרה'],
    ['Delete', 'מחיקת הבחירה'],
    ['לחיצה ארוכה על הלוח', 'הגדרות הלוח, ואחרי העתקה גם הדבקה במקום הלחיצה'],
    ['השהיית העט בסוף קו', 'הפיכת משיכה לצורה'],
    ['שתי אצבעות', 'הקשה מבטלת, גרירה מזיזה, צביטה מגדילה'],
    ['שלוש אצבעות', 'הקשה מבצעת שוב'],
];

/** כפתור בסרגל: אייקון ותווית קצרה מתחתיו, כדי שיהיה ברור מה כל כלי עושה */
function DockButton({ icon, label, title, active, onClick, className = '', color }) {
    return (
        <button data-popover-anchor title={title || label} aria-label={title || label} aria-pressed={active ? 'true' : undefined}
            className={`pb-btn ${active ? 'active' : ''} ${className}`} onClick={onClick}>
            <Icon name={icon} size={22} />
            <span className="pb-btn-label">{label}</span>
            {active && color && <i className="pb-btn-ink" style={{ background: color }} />}
        </button>
    );
}

/**
 * סרגל הכלים. למעלה: העטים והכלים. מתחתיו: סרגל צבעים אחד לכל מה שמציירים.
 * הסרגל עוגן לכל אחד מארבעת הקצוות, כך שימניים ושמאליים מקבלים את אותה נוחות,
 * או צף בכל מקום, מתכווץ לבועה, ונעשה שקוף כשכותבים לידו.
 */
export default function Toolbar({
    mode, setMode, pens, activePenId, setActivePenId, updatePen, addExtraPen, removeExtraPen,
    color, setColor, shownColor,
    eraser, setEraser, setGlobalFontSize, boardRef,
    onBack, onPresent, onDrive, pattern, selectionType, setSelectionType,
}) {
    const [dock, setDock] = useState(loadDock);
    const [drag, setDrag] = useState(null);
    const [pop, setPop] = useState(null);
    const [showStem, setShowStem] = useState(false);
    const [showDesmos, setShowDesmos] = useState(false);
    const [showGridModal, setShowGridModal] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [gridCols, setGridCols] = useState('10');
    const [gridRows, setGridRows] = useState('10');
    const [clearArmed, setClearArmed] = useState(false);
    const [showMathDl, setShowMathDl] = useState(false);
    const [lastText, setLastText] = useState('text');
    const wrapRef = useRef(null);
    const fileInputRef = useRef(null);
    const recolorTimer = useRef(null);

    const act = useCallback((fn, ...args) => boardRef.current && boardRef.current[fn]?.(...args), [boardRef]);
    const activePen = pens.find((p) => p.id === activePenId) || pens[0];
    const side = drag ? 'float' : dock.side;
    const vertical = side === 'left' || side === 'right';
    const popSide = side === 'float' ? 'top' : side;
    const kind = PEN_KINDS[activePen.kind];
    
    useEffect(() => { saveDock(dock); }, [dock]);

    /* ── גרירת הסרגל ── */
    const onGripDown = (e) => {
        e.preventDefault();
        const r = wrapRef.current.getBoundingClientRect();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setPop(null);
        setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top, x: r.left, y: r.top, sx: e.clientX, sy: e.clientY, moved: false, edge: null });
    };
    const onGripMove = (e) => {
        if (!drag) return;
        const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8;
        setDrag({ ...drag, x: e.clientX - drag.dx, y: e.clientY - drag.dy, moved, edge: moved ? nearestSide(e.clientX, e.clientY) : null });
    };
    const onGripUp = () => {
        if (!drag) return;
        if (!drag.moved) {
            setDock((d) => ({ ...d, collapsed: !d.collapsed }));
        } else if (drag.edge) {
            setDock((d) => ({ ...d, side: drag.edge }));
        } else {
            const vw = window.innerWidth, vh = window.innerHeight;
            setDock((d) => ({ ...d, side: 'float', x: Math.max(4, Math.min(vw - 80, drag.x)), y: Math.max(4, Math.min(vh - 60, drag.y)) }));
        }
        setDrag(null);
    };
    const dockTo = (sd) => { setDock((d) => ({ ...d, side: sd, collapsed: false })); setPop(null); };

    const wrapStyle = (() => {
        if (drag) return { left: drag.x, top: drag.y };
        if (dock.side === 'float') {
            const vw = window.innerWidth, vh = window.innerHeight;
            return { left: Math.max(4, Math.min(vw - 80, dock.x)), top: Math.max(4, Math.min(vh - 60, dock.y)) };
        }
        return {};
    })();

    /* ── קיצורי מקלדת ── */
    useEffect(() => {
        const onKey = (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'MATH-FIELD' || t.isContentEditable)) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (/^[1-9]$/.test(e.key)) {
                const p = pens[Number(e.key) - 1];
                if (p) { setActivePenId(p.id); setMode('draw'); }
            } else if (e.key === 'e' || e.key === 'E') {
                if (mode === 'erase') setEraser({ ...eraser, mode: eraser.mode === 'pixel' ? 'stroke' : 'pixel' });
                setMode('erase');
            } else if (e.key === 'v' || e.key === 'V') setMode('select');
            else if (e.key === 't' || e.key === 'T') { setLastText('text'); setMode('text'); }
            else if (e.key === 'm' || e.key === 'M') { setLastText('math'); setMode('math'); }
            else if (e.key === '?') setShowHelp((v) => !v);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [pens, mode, eraser, setEraser, setMode, setActivePenId]);

    /* ── עט הנוסחאות: בבחירה הראשונה מציעים להוריד את המודל, ומראים התקדמות ── */
    useEffect(() => {
        if (mode !== 'draw' || activePenId !== 'mathink') return undefined;
        if (getMathInkStatus().state === 'ready') return undefined;
        if (wasMathInkDownloaded()) { preloadMathInk(); return undefined; }
        const t = setTimeout(() => setShowMathDl(true), 0);
        return () => clearTimeout(t);
    }, [mode, activePenId]);

    /* ── Desmos ── */
    useEffect(() => {
        let calcInstance = null;
        if (showDesmos) {
            const initDesmos = () => {
                const elt = document.getElementById('desmos-calculator');
                if (elt && window.Desmos) {
                    calcInstance = window.Desmos.GraphingCalculator(elt, { expressions: true, keypad: true, settingsMenu: true, language: 'he' });
                    elt.setAttribute('dir', 'ltr');
                }
            };
            if (!document.getElementById('desmos-api-script')) {
                const script = document.createElement('script');
                script.id = 'desmos-api-script';
                script.src = 'https://www.desmos.com/api/v1.8/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6&lang=he';
                script.async = true;
                script.onload = initDesmos;
                document.head.appendChild(script);
            } else {
                setTimeout(initDesmos, 50);
            }
        }
        return () => { if (calcInstance) calcInstance.destroy(); };
    }, [showDesmos]);

    /** חלונית נפתחת ליד הכפתור, אבל מעבר לסרגל הצבעים ולא מעליו */
    const openPop = (type, e) => {
        const b = e.currentTarget.getBoundingClientRect();
        const w = wrapRef.current?.getBoundingClientRect();
        let a = { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
        if (w) {
            if (dock.side === 'top') a = { ...a, bottom: w.bottom };
            else if (dock.side === 'bottom') a = { ...a, top: w.top };
            else if (dock.side === 'left') a = { ...a, right: w.right };
            else if (dock.side === 'right') a = { ...a, left: w.left };
        }
        setPop((p) => (p && p.type === type ? null : { type, anchor: a }));
    };

    /* ── צבע: אחד לכל מה שמציירים, ובמצב בחירה גם צובע את מה שמסומן ── */
    const pickColor = (c) => {
        setColor(c);
        act('updateActiveColor', c);
        if (mode === 'select') {
            clearTimeout(recolorTimer.current);
            recolorTimer.current = setTimeout(() => act('recolorSelection', c), 120);
        }
    };
    const isCustomColor = !COLOR_BAR.includes(color);

    /* ── עטים ── */
    const onPenTap = (p, e) => {
        if (mode === 'draw' && p.id === activePenId) {
            if (p.id === 'mathink' && getMathInkStatus().state !== 'ready' && !wasMathInkDownloaded()) { setShowMathDl(true); return; }
            openPop('pen', e); return;
        }
        setActivePenId(p.id);
        setMode('draw');
        setPop(null);
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (f) => act('addImage', f.target.result);
            reader.readAsDataURL(file);
        }
        e.target.value = '';
        setPop(null);
    };

    const confirmAddGrid = () => {
        const cols = Math.max(1, Math.min(200, parseInt(gridCols, 10) || 10));
        const rows = Math.max(1, Math.min(200, parseInt(gridRows, 10) || 10));
        act('addGrid', cols, rows);
        setShowGridModal(false);
    };

    const eraserIcon = eraser.mode === 'pixel' ? 'erase' : 'erase-stroke';
    /* מחק, בחירה וטקסט: הקשה ראשונה בוחרת את הכלי, וכל הקשה נוספת מחליפה את סוגו */
    const tapErase = () => {
        setPop(null);
        if (mode === 'erase') setEraser({ ...eraser, mode: eraser.mode === 'pixel' ? 'stroke' : 'pixel' });
        else setMode('erase');
    };
    const tapSelect = () => {
        setPop(null);
        if (mode === 'select') setSelectionType(selectionType === 'box' ? 'freehand' : 'box');
        else setMode('select');
    };
    const tapText = () => {
        setPop(null);
        if (mode === 'text') { setLastText('math'); setMode('math'); }
        else if (mode === 'math') { setLastText('text'); setMode('text'); }
        else setMode(lastText);
    };

    /* סרגל הגדלים: עובי העט הפעיל, או גודל המחק */
    const textMode = mode === 'text' || mode === 'math';
    const sizes = mode === 'draw' ? kind.sizes : mode === 'erase' ? ERASER_SIZES : null;
    const sizeNow = mode === 'draw' ? activePen.width : eraser.size;
    const sizeDot = (v) => (mode === 'draw'
        ? Math.min(16, 3 + v * (activePen.kind === 'highlighter' ? 0.2 : 0.9))
        : Math.min(16, 4 + v * 0.15));
    const pickSize = (v) => { if (mode === 'draw') updatePen(activePen.id, { width: v }); else setEraser({ ...eraser, size: v }); };

    return (
        <>
            {/* ── בית, ביטול וחזרה ── */}
            {onBack && (
                <button title="חזרה ללוחות שלי" aria-label="חזרה ללוחות שלי" className="pb-corner pb-corner-left" onClick={onBack}>
                    <Icon name="home" size={18} />
                </button>
            )}
            <div className="pb-corner-group">
                <button title="בטל (Ctrl+Z, הקשה בשתי אצבעות)" aria-label="בטל" className="pb-corner" onClick={() => act('undo')}><Icon name="undo" size={18} /></button>
                <button title="בצע שוב (Ctrl+Y, הקשה בשלוש אצבעות)" aria-label="בצע שוב" className="pb-corner" onClick={() => act('redo')}><Icon name="redo" size={18} /></button>
            </div>

            {drag && drag.moved && SIDES.map((sd) => <div key={sd} className={`pb-dock-target edge-${sd} ${drag.edge === sd ? 'hot' : ''}`} />)}

            {/* ── הסרגל, וסרגל הצבעים לצדו ── */}
            <div ref={wrapRef} data-ui dir="ltr" data-side={side}
                className={`pb-wrap side-${side} ${vertical ? 'vertical' : ''} ${dock.collapsed ? 'collapsed' : ''} ${drag ? 'dragging' : ''}`}
                style={wrapStyle}>
                <div data-scrollable dir="rtl" className="pb-dock" role="toolbar" aria-label="כלים">
                    <button className="pb-grip" title="גרור לכל קצה של המסך, או הקש כדי לכווץ" aria-label="הזזה וכיווץ של הסרגל"
                        onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
                        <Icon name="grip" size={16} />
                    </button>

                    {dock.collapsed ? (
                        <DockButton icon={kind.icon} label="" title="פתח את הסרגל" active={mode === 'draw'} color={shownColor}
                            onClick={() => setDock((d) => ({ ...d, collapsed: false }))} />
                    ) : (
                        <>
                            <div className="pb-group" role="radiogroup" aria-label="עטים">
                                {pens.map((p, i) => (
                                    <DockButton key={p.id} icon={PEN_KINDS[p.kind].icon} label={PEN_KINDS[p.kind].label}
                                        title={`${PEN_KINDS[p.kind].label}, ${PEN_KINDS[p.kind].hint}. מקש ${i + 1}${mode === 'draw' && p.id === activePenId ? '. הקש שוב להגדרות' : ''}`}
                                        active={mode === 'draw' && p.id === activePenId} color={shownColor}
                                        onClick={(e) => onPenTap(p, e)} />
                                ))}
                                <button data-popover-anchor className="pb-btn pb-add" title="עטים נוספים: נוסחאות, חוט וקו מקווקו" aria-label="עטים נוספים" onClick={(e) => openPop('addpen', e)}>
                                    <Icon name="plus" size={18} />
                                </button>
                            </div>
                            <div className="pb-sep" />
                            <div className="pb-group">
                                <DockButton icon={eraserIcon} label={eraser.mode === 'pixel' ? 'מחק' : 'קו שלם'} className="pb-flip"
                                    title={eraser.mode === 'pixel' ? 'מחק חלקי. הקש שוב כדי לעבור למחיקת קו שלם' : 'מחק קו שלם. הקש שוב כדי לעבור למחיקה חלקית'}
                                    active={mode === 'erase'} onClick={tapErase} />
                                <DockButton icon={selectionType === 'box' ? 'select-box' : 'lasso'} label={selectionType === 'box' ? 'מלבן' : 'לאסו'} className="pb-flip"
                                    title={selectionType === 'box' ? 'בחירה במלבן. הקש שוב כדי לעבור ללאסו' : 'בחירה בלאסו. הקש שוב כדי לעבור למלבן'}
                                    active={mode === 'select'} onClick={tapSelect} />
                                <DockButton icon={mode === 'math' ? 'math' : mode === 'text' ? 'text' : lastText}
                                    label={(mode === 'math' || (mode !== 'text' && lastText === 'math')) ? 'נוסחה' : 'טקסט'} className="pb-flip"
                                    title={mode === 'math' ? 'נוסחה. הקש שוב כדי לעבור לטקסט' : mode === 'text' ? 'טקסט. הקש שוב כדי לעבור לנוסחה' : 'טקסט או נוסחה. הקש שוב כדי להחליף'}
                                    active={mode === 'text' || mode === 'math'} onClick={tapText} />
                            </div>
                            <div className="pb-sep" />
                            <div className="pb-group">
                                <DockButton icon="stem" label="הנדסה" title="הנדסה ופיזיקה: רכיבים, נוסחאות, מחשבון, גרפים" className="pb-stem"
                                    active={showStem} onClick={() => { setShowStem((v) => !v); setPop(null); }} />
                                <DockButton icon="shapes" label="צורות" title="צורות, תמונה וצירים" active={pop?.type === 'shapes'} onClick={(e) => openPop('shapes', e)} />
                                <DockButton icon="more" label="עוד" title="עוד: הגדרות, מיקום הסרגל, מצב הצגה" active={pop?.type === 'more'} onClick={(e) => openPop('more', e)} />
                            </div>
                        </>
                    )}
                </div>

                {/* ── סרגל הצבעים ── */}
                {!dock.collapsed && (
                    <div data-ui dir="rtl" className={`pb-colorbar ${mode === 'erase' ? 'dim' : ''}`} role="group" aria-label="צבעים">
                        <div className="pb-colors">
                            {COLOR_BAR.map((c) => (
                                <button key={c} className={`pb-swatch ${color.toLowerCase() === c ? 'on' : ''}`} style={{ '--c': c }}
                                    title={c === '#f5f5f5' ? 'לבן' : c === '#1a1a1a' ? 'שחור' : c} aria-label={`צבע ${c}`} aria-pressed={color.toLowerCase() === c}
                                    onClick={() => pickColor(c)} />
                            ))}
                            <label className={`pb-swatch pb-rainbow ${isCustomColor ? 'on' : ''}`} title="בחירת צבע חופשית" aria-label="בחירת צבע חופשית">
                                {isCustomColor && <i style={{ background: color }} />}
                                <input type="color" value={color} onChange={(e) => pickColor(e.target.value)} />
                            </label>
                        </div>
                        {textMode && (
                            <>
                                <div className="pb-sep" />
                                <div className="pb-sizes" role="group" aria-label="גודל כתב">
                                    <button className="pb-size pb-font" title="הקטן כתב" aria-label="הקטן כתב" onClick={() => { setGlobalFontSize((v) => Math.max(16, v - 6)); act('updateGlobalFontSize', -6); }}>A−</button>
                                    <button className="pb-size pb-font" title="הגדל כתב" aria-label="הגדל כתב" onClick={() => { setGlobalFontSize((v) => v + 6); act('updateGlobalFontSize', 6); }}>A+</button>
                                </div>
                            </>
                        )}
                        {sizes && (
                            <>
                                <div className="pb-sep" />
                                <div className="pb-sizes" role="group" aria-label={mode === 'draw' ? 'עובי' : 'גודל המחק'}>
                                    {sizes.map((v) => (
                                        <button key={v} className={`pb-size ${Math.abs(sizeNow - v) < 0.01 ? 'on' : ''}`} onClick={() => pickSize(v)}
                                            title={mode === 'draw' ? `עובי ${v}` : `גודל ${v}`} aria-label={mode === 'draw' ? `עובי ${v}` : `גודל ${v}`}>
                                            <span style={{ width: sizeDot(v), height: sizeDot(v), ...(mode === 'erase' ? { background: 'transparent', border: '1.5px solid currentColor' } : null) }} />
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ── חלוניות ── */}
            {pop?.type === 'pen' && activePen && (
                <Popover anchor={pop.anchor} side={popSide} onClose={() => setPop(null)} width={290} label="הגדרות עט">
                    <div className="pe">
                        <div className="pe-preview">
                            <span className="pe-icon"><Icon name={kind.icon} size={26} /></span>
                            <div>
                                <div className="pe-title">{kind.label}</div>
                                <div className="pe-hint">{kind.hint}</div>
                            </div>
                        </div>
                        <div className="pe-section">
                            <div className="pe-label">עובי <b dir="ltr">{activePen.width}</b></div>
                            <input className="pe-range" type="range" min={activePen.kind === 'highlighter' ? 8 : 1} max={activePen.kind === 'highlighter' ? 140 : 30} step="0.5"
                                value={activePen.width} onChange={(e) => updatePen(activePen.id, { width: Number(e.target.value) })} aria-label="עובי" />
                        </div>
                        {(activePen.kind === 'lord' || activePen.kind === 'highlighter') && (
                            <div className="pe-section">
                                <div className="pe-label">שקיפות <b dir="ltr">{Math.round((1 - activePen.opacity) * 100)}%</b></div>
                                <input className="pe-range" type="range" min="0" max="90" step="5"
                                    value={Math.round((1 - activePen.opacity) * 100)} onChange={(e) => updatePen(activePen.id, { opacity: 1 - Number(e.target.value) / 100 })} aria-label="שקיפות" />
                            </div>
                        )}
                        <div className="pe-hint">הצבע נבחר בסרגל הצבעים שמתחת לסרגל הכלים.</div>
                        <div className="pe-footer">
                            <button onClick={() => updatePen(activePen.id, { width: kind.defaults.width, opacity: kind.defaults.opacity })}>איפוס</button>
                            {kind.extra && <button className="danger" onClick={() => { removeExtraPen(activePen.id); setPop(null); }}><Icon name="trash" size={14} /> הסר מהסרגל</button>}
                        </div>
                    </div>
                </Popover>
            )}

            {pop?.type === 'addpen' && (
                <Popover anchor={pop.anchor} side={popSide} onClose={() => setPop(null)} width={300} label="הוספת עט">
                    <div className="pe stem-list">
                        <div className="pe-label" style={{ padding: '0 4px' }}>עטים נוספים. הבחירה מופיעה בסרגל</div>
                        {EXTRA_KINDS.map((k) => (
                            <button key={k} className={`pe-pick ${activePenId === k ? 'on' : ''}`} onClick={() => { addExtraPen(k); setMode('draw'); setPop(null); }}>
                                <Icon name={PEN_KINDS[k].icon} size={22} />
                                <span><b>{PEN_KINDS[k].label}</b><small>{PEN_KINDS[k].hint}</small></span>
                            </button>
                        ))}
                    </div>
                </Popover>
            )}

            {pop?.type === 'shapes' && (
                <Popover anchor={pop.anchor} side={popSide} onClose={() => setPop(null)} width={340} label="צורות">
                    <div className="pe">
                        <div className="pe-seg two" style={{ marginBottom: 10 }}>
                            <button onClick={() => fileInputRef.current?.click()}><Icon name="image" size={16} /> תמונה</button>
                            <button onClick={() => { setPop(null); setShowGridModal(true); }}><Icon name="grid" size={16} /> מערכת צירים</button>
                        </div>
                        {SHAPE_CATEGORIES.map((cat) => (
                            <div key={cat.title} className="pe-section">
                                <div className="pe-label">{cat.title}</div>
                                <div className="shape-grid">
                                    {cat.shapes.map((shape) => (
                                        <button key={shape} className="shape-btn" title={shape} onClick={() => { act('addShape', shape); setPop(null); }}>
                                            <Icon name={shape} size={18} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="pe-hint">הצורה נוצרת בצבע שנבחר בסרגל הצבעים.</div>
                    </div>
                </Popover>
            )}

            {pop?.type === 'more' && (
                <Popover anchor={pop.anchor} side={popSide} onClose={() => { setPop(null); setClearArmed(false); }} width={290} label="עוד">
                    <div className="pe stem-list">
                        <div className="pe-section">
                            <div className="pe-label">מיקום הסרגל</div>
                            <div className="pe-sides">
                                {['right', 'left', 'top', 'bottom'].map((sd) => (
                                    <button key={sd} className={dock.side === sd ? 'on' : ''} onClick={() => dockTo(sd)} aria-label={`סרגל ${SIDE_LABEL[sd]}`} title={`סרגל ${SIDE_LABEL[sd]}`}>
                                        <Icon name={`dock-${sd}`} size={22} />
                                        <span>{SIDE_LABEL[sd]}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="pe-section" style={{ marginBottom: 6 }}>
                            <div className="pe-label">מחק</div>
                            <label className="pe-toggle sm">
                                <input type="checkbox" checked={!!eraser.highlighterOnly} onChange={(e) => setEraser({ ...eraser, highlighterOnly: e.target.checked })} />
                                <span>מחק רק מדגיש. הכתב שמתחתיו לא ייפגע</span>
                            </label>
                            <button className="mi-danger" onClick={() => {
                                if (!clearArmed) { setClearArmed(true); return; }
                                act('clearBoard'); setClearArmed(false); setPop(null);
                            }}><Icon name="trash" size={15} /> {clearArmed ? 'לחץ שוב כדי לנקות הכול' : 'ניקוי כל הלוח'}</button>
                        </div>
                        <button onClick={() => { setShowDesmos(true); setPop(null); }}><Icon name="desmos" size={16} /> מחשבון גרפי Desmos</button>
                        <button onClick={() => { onPresent?.(); setPop(null); }}><Icon name="present" size={16} /> מצב הצגה עם לייזר</button>
                        <button onClick={() => { act('toggleRecorder'); setPop(null); }}><Icon name="mic" size={16} /> הקלטה מסונכרנת</button>
                        <button onClick={() => { onDrive?.(); setPop(null); }}><Icon name="drive" size={16} /> גוגל דרייב</button>
                        <button onClick={() => { act('openBoardSettings'); setPop(null); }}><Icon name="settings" size={16} /> הגדרות הלוח</button>
                        <button onClick={() => { setShowHelp(true); setPop(null); }}><Icon name="keyboard" size={16} /> מחוות וקיצורים</button>
                    </div>
                </Popover>
            )}

            {showStem && (
                <StemPanel boardRef={boardRef} inkColor={shownColor} pattern={pattern} dockSide={dock.side}
                    onPattern={(p) => act('setPattern', p)}
                    onInsertGrid={() => setShowGridModal(true)}
                    onClose={() => setShowStem(false)} />
            )}

            {showMathDl && <MathInkDownload onClose={() => setShowMathDl(false)} />}

            {showHelp && (
                <div className="pb-modal" data-ui onPointerDown={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
                    <div className="pb-modal-card" dir="rtl">
                        <div className="pb-modal-title">מחוות וקיצורים</div>
                        <table className="pb-keys"><tbody>
                            {SHORTCUTS.map(([k, d]) => <tr key={k}><td dir="ltr">{k}</td><td>{d}</td></tr>)}
                        </tbody></table>
                        <button className="stem-primary" onClick={() => setShowHelp(false)}>סגור</button>
                    </div>
                </div>
            )}

            {showDesmos && (
                <div className="desmos-overlay" data-ui onClick={(e) => { if (e.target === e.currentTarget) setShowDesmos(false); }}>
                    <div className="desmos-window">
                        <div className="desmos-header">
                            <button onClick={() => setShowDesmos(false)} className="desmos-close" aria-label="סגור">✕</button>
                            <span style={{ fontWeight: 700, color: '#fff', fontSize: '1.05rem', direction: 'rtl' }}>מחשבון גרפי Desmos</span>
                        </div>
                        <div id="desmos-calculator" dir="ltr" />
                    </div>
                </div>
            )}

            {showGridModal && (
                <div className="pb-modal" data-ui onClick={(e) => { if (e.target === e.currentTarget) setShowGridModal(false); }}>
                    <div className="pb-modal-card" dir="rtl" style={{ width: 'min(330px, 92vw)' }}>
                        <div className="pb-modal-title">הוספת מערכת צירים</div>
                        {[{ key: 'x', label: 'משבצות בציר X', value: gridCols, set: setGridCols },
                          { key: 'y', label: 'משבצות בציר Y', value: gridRows, set: setGridRows }].map((f) => (
                            <label key={f.key} className="calc-field">
                                <span>{f.label}</span>
                                <input type="number" min="1" max="200" dir="ltr" value={f.value} onChange={(e) => f.set(e.target.value)} />
                            </label>
                        ))}
                        <div className="pe-seg two" style={{ marginTop: 14 }}>
                            <button onClick={() => setShowGridModal(false)}>ביטול</button>
                            <button className="on" onClick={confirmAddGrid}>הוסף</button>
                        </div>
                    </div>
                </div>
            )}

            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} />
        </>
    );
}

