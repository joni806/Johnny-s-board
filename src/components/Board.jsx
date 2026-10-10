import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import * as fabricPkg from 'fabric';
import 'mathlive';
import katex from 'katex';
import {
    createGridGroup, createShape, buildRecognizedShape, isObjectNearPoint, EXTRA_PROPS, typeOf,
    eraseObjectPartially, buildStamp, buildPlotGroup, SHAPE_FILL, getEraseGeometry,
} from '../utils/canvasUtils';
import { recognizeShape, buildInkPath, fitLine, simplifyRDP } from '../utils/recognition';
import { createInkStroke, samplePointer, paintInkStep } from '../utils/ink';
import { detectScribble } from '../utils/scribble';
import { PEN_KINDS, inkColorOn, dashArrayFor, isFilledInk, loadPenState, buildPens } from '../utils/pens';
import {
    PEN_BUTTON_ACTIONS, HOLD_ACTIONS, loadDevicePrefs, saveDevicePrefs, isPenOnly,
    isEraserTip, isBarrelPressed, isPenContact, isLikelyPalm,
} from '../utils/device';
import { patternStyle, PAPER_TYPES, GRID } from '../utils/patterns';
import { stampById } from '../utils/stamps';
import { samplePlot, niceTicks, logTicks, tickLabel } from '../utils/plot';
import { recognizeInk, onMathInkStatus, getMathInkStatus, unionBounds } from '../utils/mathInk';
import { installEngineeringKeyboard } from '../utils/mathKeyboard';
import Icon from './icons';
import { listRevisions, restoreRevision } from '../utils/storage';
import { createLaser } from '../utils/laser';
import { createRecorder, isRecordingSupported } from '../utils/recorder';
import { isConnected as driveIsConnected, onDriveChange, uploadRecording, downloadFile, deleteFile } from '../utils/drive';
import RecorderBar from './RecorderBar';
import { solveExpression, runCasAction, terminateMathWorker } from '../utils/mathEngine';

const fabric = fabricPkg.fabric || fabricPkg;

/* ── מסגרת עם ארבע פינות בלבד ──
   כל פינה מותחת לפי כיוון התנועה, ובכל רגע של הגרירה מחדש: משיכה הצידה
   מותחת רק לרוחב, משיכה למעלה או למטה רק לאורך, ומשיכה באלכסון מותחת את
   שני הצירים יחד, חופשי לפי האצבע. כשהיחס בין הצירים קרוב למקורי, הוא
   ננעל עליו, כך שקל להגדיל צורה בלי לעוות אותה. הכיוון נמדד ביחס לצירים
   של האובייקט, ולכן גם אובייקט מסובב מתנהג נכון. אין ידיות באמצע הצלעות,
   ויש מסגרת אחת לכל קבוצה נבחרת. */
const originDir = (o) => {
    const v = o === 'left' || o === 'top' ? -0.5 : o === 'right' || o === 'bottom' ? 0.5 : o === 'center' ? 0 : Number(o) || 0;
    return v < 0 ? 1 : v > 0 ? -1 : 0;
};
const flexCorner = (eventData, transform, x, y) => {
    const t = transform, o = t.target;
    const dx = x - t.ex, dy = y - t.ey;
    if (!t.pbMoved && Math.hypot(dx, dy) < 6) return false;
    t.pbMoved = true;
    const a = -((o.angle || 0) * Math.PI) / 180;
    const lx = Math.abs(dx * Math.cos(a) - dy * Math.sin(a));
    const ly = Math.abs(dx * Math.sin(a) + dy * Math.cos(a));
    const ang = (Math.atan2(ly, lx) * 180) / Math.PI;
    const mode = ang < 22 ? 'x' : ang > 68 ? 'y' : 'xy';
    const np = fabric.controlsUtils.getLocalPoint(t, t.originX, t.originY, x, y);
    const dim = o._getTransformedDimensions();
    const span = (v, dir) => Math.max(4, dir === 0 ? Math.abs(v) * 2 : v * dir);
    let sx = (span(np.x, originDir(t.originX)) * o.scaleX) / (dim.x || 1);
    let sy = (span(np.y, originDir(t.originY)) * o.scaleY) / (dim.y || 1);
    const ox = t.original.scaleX, oy = t.original.scaleY;
    if (mode === 'x') sy = oy;
    else if (mode === 'y') sx = ox;
    else {
        const rx = sx / ox, ry = sy / oy;
        if (Math.abs(rx / ry - 1) < 0.08) { const k = Math.sqrt(rx * ry); sx = ox * k; sy = oy * k; }
    }
    if (o.lockScalingX) sx = o.scaleX;
    if (o.lockScalingY) sy = o.scaleY;
    if (sx === o.scaleX && sy === o.scaleY) return false;
    o.set({ scaleX: sx, scaleY: sy });
    return true;
};
let flexCornerAction = null;
const cornerStretchOrScale = (eventData, transform, x, y) => {
    if (!flexCornerAction) flexCornerAction = fabric.controlsUtils.wrapWithFireEvent('scaling', fabric.controlsUtils.wrapWithFixedAnchor(flexCorner));
    return flexCornerAction(eventData, transform, x, y);
};
if (fabric.InteractiveFabricObject && fabric.Control && !fabric.InteractiveFabricObject.__pbFourCorners) {
    const base = fabric.InteractiveFabricObject;
    const orig = base.createControls.bind(base);
    base.createControls = () => {
        const { controls } = orig();
        const mk = (x, y) => new fabric.Control({ x, y, actionHandler: cornerStretchOrScale, cursorStyleHandler: fabric.controlsUtils.scaleCursorStyleHandler });
        const next = { tl: mk(-0.5, -0.5), tr: mk(0.5, -0.5), bl: mk(-0.5, 0.5), br: mk(0.5, 0.5) };
        if (controls.mtr) next.mtr = controls.mtr;
        return { controls: next };
    };
    base.__pbFourCorners = true;
    // בבחירה מרובה: מסגרת אחת סביב הקבוצה, בלי מסגרת נפרדת לכל אובייקט
    if (fabric.ActiveSelection) {
        const parent = Object.getPrototypeOf(fabric.ActiveSelection.prototype);
        fabric.ActiveSelection.prototype._renderControls = function (ctx, styleOverride) {
            ctx.save();
            ctx.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
            parent._renderControls.call(this, ctx, styleOverride);
            ctx.restore();
        };
    }
}

/** תקרות ההיסטוריה בזיכרון — במספר צעדים ובנפח תווים */
const HISTORY_MAX_STEPS = 40;
const HISTORY_MAX_CHARS = 6000000;

/** מזהה ייחודי להקלטה. מוגדר מחוץ לרכיב, כי הוא לא טהור */
const newRecordingId = () => `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** מתג דו־מצבי בלוח ההגדרות. הוצא לרכיב כדי שלא יחזור בכל הגדרה מחדש */
const SettingToggle = ({ on, label, onClick }) => (
    <button
        onClick={onClick}
        style={{
            width: '100%', padding: '10px 12px', borderRadius: '10px', border: 'none',
            background: on ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
            outline: on ? '1px solid rgba(74,222,128,0.35)' : 'none',
            color: on ? '#4ade80' : '#a1a1aa', cursor: 'pointer', fontSize: '13px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        }}
    >
        <span>{label}</span>
        <span style={{
            width: '34px', height: '20px', borderRadius: '10px', flexShrink: 0, padding: '2px',
            background: on ? '#4ade80' : 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center',
            justifyContent: on ? 'flex-end' : 'flex-start', transition: '0.15s',
        }}>
            <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: on ? '#14532d' : '#71717a' }} />
        </span>
    </button>
);
const getPatternContrastColor = (hexColor) => {
    if (!hexColor || !hexColor.startsWith('#')) return '255, 255, 255';
    let r = parseInt(hexColor.slice(1, 3), 16) || 0;
    let g = parseInt(hexColor.slice(3, 5), 16) || 0;
    let b = parseInt(hexColor.slice(5, 7), 16) || 0;
    let luminance = (0.299 * r + 0.587 * g + 0.114 * b);
    return luminance > 140 ? '0, 0, 0' : '255, 255, 255';
};

/** רמות היישור של זיהוי הצורות, כפי שהן מוצגות בהגדרות הלוח */
const SNAP_LEVELS = [
    { id: 'faithful', label: 'כפי שצויר', hint: 'רק מיישר קווים. מרובע נשאר מרובע.' },
    { id: 'balanced', label: 'מאוזן', hint: 'כמעט־ריבוע הופך לריבוע, מקבילית מכוונת נשארת מקבילית.' },
    { id: 'perfect', label: 'מושלם', hint: 'כל צורה קופצת לגרסה הסימטרית שלה.' },
];

/** פעולות החישוב שבסרגל מעל תיבת נוסחה. label בכתיב מתמטי, title בעברית */
const CAS_ACTIONS = [
    { id: 'solve', label: '=', title: 'פתור או חשב' },
    { id: 'simplify', label: 'פשט', title: 'פישוט', he: true },
    { id: 'expand', label: 'פתח', title: 'פתיחת סוגריים', he: true },
    { id: 'factor', label: 'פרק', title: 'פירוק לגורמים', he: true },
    { id: 'diff', label: 'd/dx', title: 'נגזרת' },
    { id: 'integrate', label: '∫dx', title: 'אינטגרל לא מסוים' },
    { id: 'evaluate', label: '≈', title: 'ערך מספרי' },
    { id: 'laplace', label: 'ℒ', title: 'התמרת לפלס, t אל s' },
    { id: 'ilaplace', label: 'ℒ⁻¹', title: 'התמרת לפלס הפוכה, s אל t, דרך הקטבים' },
    { id: 'partfrac', label: 'שברים חלקיים', title: 'פירוק לשברים חלקיים', he: true },
    { id: 'det', label: 'det', title: 'דטרמיננטה של מטריצה' },
    { id: 'inv', label: 'A⁻¹', title: 'מטריצה הופכית' },
    { id: 'plot', label: 'גרף', title: 'שרטוט הפונקציה על הלוח', he: true },
];

const Board = forwardRef(({
    mode, setMode, pen, eraser, textColor, globalFontSize, projectId, initialData, onAutoSave,
    onBoardColorChange, onPatternChange, onOpenDrive, selectionType: selectionTypeProp = 'freehand',
}, ref) => {
    const fabricCanvasElRef = useRef(null);
    const drawingCanvasRef = useRef(null);
    const mathLayerRef = useRef(null);
    const viewportRef = useRef(null);
    const fCanvas = useRef(null);
    const patternBgRef = useRef(null);
    const predictCanvasRef = useRef(null);
    const openSelectionMenuRef = useRef(() => {});

    const [boardColor, setBoardColor] = useState(initialData?.bg || '#1e3d32');
    const [boardPatternType, setBoardPatternType] = useState(initialData?.pattern || 'grid');
    const selectionType = selectionTypeProp;
    const selectionTypeRef = useRef(selectionType);
    /** בחירה במלבן פעילה. הדגל חייב להישאר דלוק בזמן ההרמה, כי Fabric קורא אותו אז */
    const boxSelectOn = () => modeRef.current === 'select' && selectionTypeRef.current === 'box';
    useEffect(() => { selectionTypeRef.current = selectionType; }, [selectionType]);
    // רמת היישור של זיהוי הצורות, נשמרת עם הלוח
    const [snapLevel, setSnapLevel] = useState(initialData?.snapLevel || 'balanced');
    const snapLevelRef = useRef(snapLevel);
    useEffect(() => { snapLevelRef.current = snapLevel; }, [snapLevel]);
    // העדפות המכשיר: העט, כפתור הצד ודחיית כף היד. משותפות לכל הלוחות
    const [devicePrefs, setDevicePrefs] = useState(loadDevicePrefs);
    const devicePrefsRef = useRef(devicePrefs);
    useEffect(() => { devicePrefsRef.current = devicePrefs; saveDevicePrefs(devicePrefs); }, [devicePrefs]);
    // יומן אירועי העט, לבדיקה מה הטאבלט שולח כשלוחצים על הכפתור
    const [penDebug, setPenDebug] = useState(false);
    const [penLog, setPenLog] = useState([]);
    useEffect(() => { sb.current.penDebug = penDebug; }, [penDebug]);
    const updateDevicePrefs = (patch) => setDevicePrefs((p) => ({ ...p, ...patch }));
    // שבבים צפים: זיהוי נוסחה, הדבקה, וסרגל החישוב
    const [inkChip, setInkChip] = useState(null);
    const [pasteChip, setPasteChip] = useState(false);
    const [pasteArmed, setPasteArmed] = useState(false);
    const pasteArmedRef = useRef(false);
    useEffect(() => { pasteArmedRef.current = pasteArmed; }, [pasteArmed]);
    const [casBar, setCasBar] = useState(null);
    const [mathInkState, setMathInkState] = useState(getMathInkStatus());
    useEffect(() => onMathInkStatus(setMathInkState), []);
    const [gridSize] = useState(40);
    // המרה של משיכה לצורה רק בהשהיית העט. ניתן לכיבוי כדי לכתוב בכתב יד
    const [autoSnap, setAutoSnap] = useState(initialData?.autoSnap !== false);
    const [pressureInk, setPressureInk] = useState(initialData?.pressureInk !== false);
    const [showBoardSettings, setShowBoardSettings] = useState(false);
    // רשימת גרסאות קודמות. null כשהחלונית סגורה
    const [revisions, setRevisions] = useState(null);
    // דולק בזמן שהמנוע הסימבולי עובד בחוט הצדדי
    const [solving, setSolving] = useState(false);

    // ── הקלטה מסונכרנת ──────────────────────────────────────────────
    const [showRecorder, setShowRecorder] = useState(false);
    const [recStatus, setRecStatus] = useState('idle');   // idle | recording | paused | uploading
    const [recElapsed, setRecElapsed] = useState(0);
    const [recordings, setRecordings] = useState(initialData?.recordings || []);
    const [playing, setPlaying] = useState(null);         // ההקלטה המתנגנת כרגע
    const [playhead, setPlayhead] = useState(0);
    const [playDuration, setPlayDuration] = useState(0);
    const [driveReady, setDriveReady] = useState(driveIsConnected());
    useEffect(() => onDriveChange((st) => setDriveReady(st.connected)), []);
    const [boardSettingsPos, setBoardSettingsPos] = useState({ x: 0, y: 0 });
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null });
    const [toast, setToast] = useState(null);
    const toastTimerRef = useRef(null);
    // הודעה צפה במקום alert, שחוסם את חוט הריצה ומפיל את מיקוד העט באמצע ציור
    const showToast = (text, tone = 'info') => {
        setToast({ text, tone });
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => setToast(null), 2800);
    };
    useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
    // שחרור חוט החישוב כשהלוח נסגר, כדי שלא יישאר תקוע ברקע
    useEffect(() => () => terminateMathWorker(), []);

    // צבע הלוח מדווח למעלה, כדי שהקלמר יציג גיר לבן כשחור על לוח בהיר
    const boardColorRef = useRef(boardColor);
    useEffect(() => {
        boardColorRef.current = boardColor;
        if (onBoardColorChange) onBoardColorChange(boardColor);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardColor]);
    useEffect(() => { if (onPatternChange) onPatternChange(boardPatternType); }, [boardPatternType, onPatternChange]);

    const modeRef = useRef(mode);
    useEffect(() => {
        modeRef.current = mode;
        if (mode !== 'select') sb.current.wasAutoSelected = false;
    }, [mode]);

    useEffect(() => {
        if (fCanvas.current) fCanvas.current.selection = (mode === 'select' && selectionType === 'box');
    }, [mode, selectionType]);

    const autoSnapRef = useRef(autoSnap);
    useEffect(() => { autoSnapRef.current = autoSnap; }, [autoSnap]);

    const pressureInkRef = useRef(pressureInk);
    useEffect(() => { pressureInkRef.current = pressureInk; }, [pressureInk]);

    const gestureActions = useRef({});
    const penRef = useRef(pen);
    useEffect(() => { penRef.current = pen; }, [pen]);
    /** צבע הדיו בפועל — לבן הופך לשחור על לוח בהיר ולהפך */
    const inkColor = () => inkColorOn(penRef.current?.color || '#f5f5f5', boardColorRef.current);
    const eraserRef = useRef(eraser);
    useEffect(() => { eraserRef.current = eraser; }, [eraser]);
    const textColorRef = useRef(textColor);
    useEffect(() => { textColorRef.current = textColor; }, [textColor]);

const sb = useRef({
    drawing: false, points: [], snapTimeout: null, hasSnapped: false, activeBox: null,
    inkStroke: null, laser: null, laserFrame: null,
    recorder: null, activeRecordingId: null, audioEl: null, recTimer: null, playTimer: null,
    historyStack: [], redoStack: [], isLocked: false, isPanning: false, lastX: 0, lastY: 0,
    pendingSave: false, idleHandle: null, idleKind: null, historyBytes: 0, lastState: null,
    liveObj: null, liveObjType: null, liveObjProps: null, editCircles: [], editingOriginalObj: null,
    wasAutoSelected: false, isEnteringNodeEdit: false, clipboard: null,
    activePointers: new Map(),
    ignoredPointers: new Set(), // מגעים שזוהו ככף יד, עד שהם עוזבים את המסך
    fingerPan: null,            // אצבע אחת שמזיזה את הלוח במצב "רק העט כותב"
    penSession: null,           // משיכה עם כפתור הצד של העט לחוץ
    drawPointerId: null,        // המצביע שמצייר עכשיו. מצביעים אחרים לא נכנסים למשיכה
    lastPenAt: -Infinity, penDown: false,
    multiTouchStartTime: null,
    multiTouchInitialPositions: new Map(),
    multiTouchMoved: false,
    multiTouchMaxFingers: 0,
    pinchInitialDist: 0,
    pinchInitialZoom: 1,
    longPressTimer: null,
    longPressStartX: 0,
    longPressStartY: 0,
    hasMovedEnoughToDraw: false,
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    singleTapExitTimer: null,
    longPressFired: false,
    isSelectingEditCircle: false,
    isSelectingShape: false, // ← התוספת שלנו למעקב אחרי גרירת הצורה כולה
    forceBoundingBox: false, // ← התוספת החדשה שלנו!
    liveRebuild: null,       // פונקציה שבונה מחדש את הצורה החיה בזמן גרירה
});

/** סמן הגרירה מוחל ישירות על אזור התצוגה, ולא דרך רינדור מחדש */
    const setPanCursor = (on) => {
        if (viewportRef.current) viewportRef.current.style.cursor = on ? 'grabbing' : 'default';
    };

    /* ── מצלמה חלקה ──────────────────────────────────────────────────
       זום והזזה ציירו מחדש את כל הלוח ב־Fabric בכל תזוזה של האצבע. בלוח
       עם הרבה כתב זה לוקח יותר מפריים, ולכן התנועה קפצה בפסיעות. עכשיו,
       בזמן המחווה, הקנבס זז בטרנספורם CSS שהמעבד הגרפי מבצע בלי לצייר כלום,
       והציור האמיתי נעשה פעם אחת: בסוף המחווה, או כשהיא נעצרת לרגע. */
    const fabricWrapRef = useRef(null);
    const viewGesture = () => {
        if (!sb.current.viewG) {
            const v = fCanvas.current.viewportTransform.slice();
            sb.current.viewG = { base: v, cur: v.slice() };
            if (fabricWrapRef.current) fabricWrapRef.current.style.willChange = 'transform';
        }
        return sb.current.viewG;
    };
    /** הזום הנוכחי, כולל מחווה שעוד לא הוחלה על Fabric */
    const liveZoom = () => (sb.current.viewG ? sb.current.viewG.cur[0] : fCanvas.current?.getZoom() || 1);
    const scheduleView = () => {
        if (sb.current.viewFrame == null) sb.current.viewFrame = requestAnimationFrame(applyViewFrame);
        clearTimeout(sb.current.viewIdle);
        sb.current.viewIdle = setTimeout(endViewGesture, 160);
    };
    const applyViewFrame = () => {
        sb.current.viewFrame = null;
        const g = sb.current.viewG;
        if (!g) return;
        const k = g.cur[0] / g.base[0];
        const tx = g.cur[4] - k * g.base[4], ty = g.cur[5] - k * g.base[5];
        if (fabricWrapRef.current) {
            fabricWrapRef.current.style.transformOrigin = '0 0';
            fabricWrapRef.current.style.transform = `matrix(${k}, 0, 0, ${k}, ${tx}, ${ty})`;
        }
        applyLayers(g.cur);
    };
    /** זום סביב נקודה במסך */
    const viewZoomTo = (px, py, zoom) => {
        const g = viewGesture();
        const z = g.cur[0], k = zoom / z;
        g.cur = [zoom, 0, 0, zoom, px - (px - g.cur[4]) * k, py - (py - g.cur[5]) * k];
        scheduleView();
    };
    const viewPanBy = (dx, dy) => {
        const g = viewGesture();
        g.cur = [g.cur[0], 0, 0, g.cur[3], g.cur[4] + dx, g.cur[5] + dy];
        scheduleView();
    };
    /** מחיל את המחווה על Fabric ומצייר פעם אחת, באותו פריים שבו הטרנספורם מתאפס */
    const endViewGesture = () => {
        clearTimeout(sb.current.viewIdle);
        if (sb.current.viewFrame != null) { cancelAnimationFrame(sb.current.viewFrame); sb.current.viewFrame = null; }
        const g = sb.current.viewG;
        if (!g || !fCanvas.current) return;
        sb.current.viewG = null;
        fCanvas.current.setViewportTransform(g.cur);
        const zoom = g.cur[0];
        if (sb.current.editCircles.length > 0) {
            sb.current.editCircles.forEach((c) => { c.set({ radius: 10 / zoom, strokeWidth: 2 / zoom }); c.setCoords(); });
        }
        fCanvas.current.renderAll();
        if (fabricWrapRef.current) { fabricWrapRef.current.style.transform = ''; fabricWrapRef.current.style.willChange = ''; }
        syncCustomLayers();
    };

    /** שכבת המתמטיקה ורקע המשבצות, לפי מטריצת מצלמה נתונה */
    const applyLayers = (vpt) => {
        const zoom = vpt[0];
        const transform = `matrix(${vpt[0]}, ${vpt[1]}, ${vpt[2]}, ${vpt[3]}, ${vpt[4]}, ${vpt[5]})`;
        if (mathLayerRef.current) {
            mathLayerRef.current.style.transform = transform;
            mathLayerRef.current.style.transformOrigin = '0 0';
        }
        if (patternBgRef.current) {
            const el = patternBgRef.current;
            const key = `${boardPatternTypeRef.current}|${boardColorRef.current}|${zoom}`;
            if (el.dataset.pbKey !== key) {
                const st = patternStyle(boardPatternTypeRef.current, getPatternContrastColor(boardColorRef.current), zoom);
                el.style.backgroundImage = st.image;
                el.style.backgroundSize = st.size;
                el.dataset.pbKey = key;
                el.dataset.pbLayers = String(st.layers);
            }
            el.style.backgroundPosition = Array(Number(el.dataset.pbLayers) || 1).fill(`${vpt[4]}px ${vpt[5]}px`).join(', ');
        }
    };

const syncCustomLayers = () => {
        if (!fCanvas.current) return;
        if (sb.current.viewG) { applyViewFrame(); return; }
        const vpt = fCanvas.current.viewportTransform;
        const zoom = fCanvas.current.getZoom(); // שליפת רמת הזום
        const transform = `matrix(${vpt[0]}, ${vpt[1]}, ${vpt[2]}, ${vpt[3]}, ${vpt[4]}, ${vpt[5]})`;

        // שכבת המתמטיקה זזה בהתאם למצלמה של פבריק
        if (mathLayerRef.current) {
            mathLayerRef.current.style.transform = transform;
            mathLayerRef.current.style.transformOrigin = '0 0';
        }

        // שכבת הרקע מסתנכרנת עם הזום והתזוזה. לכל שכבה בתוך הרקע — למשל
        // הקווים הראשיים והמשניים בדף הנדסי — מוחל אותו מיקום. התמונה והגודל
        // נבנים מחדש רק כשהזום, הסוג או הצבע משתנים; בהזזה רגילה מתעדכן רק
        // המיקום, כדי לא לפרק ולצייר מחדש את כל הרקע בכל תזוזה של האצבע
        if (patternBgRef.current) {
            const el = patternBgRef.current;
            const key = `${boardPatternTypeRef.current}|${boardColorRef.current}|${zoom}`;
            if (el.dataset.pbKey !== key) {
                const st = patternStyle(boardPatternTypeRef.current, getPatternContrastColor(boardColorRef.current), zoom);
                el.style.backgroundImage = st.image;
                el.style.backgroundSize = st.size;
                el.dataset.pbKey = key;
                el.dataset.pbLayers = String(st.layers);
            }
            el.style.backgroundPosition = Array(Number(el.dataset.pbLayers) || 1).fill(`${vpt[4]}px ${vpt[5]}px`).join(', ');
        }
        // סרגל החישוב צמוד למקום על הלוח, ולכן זז עם המצלמה
        if (sb.current.activeBox && isMathBox(sb.current.activeBox)) placeCasBar(sb.current.activeBox);

        fCanvas.current.requestRenderAll();
    };
    const boardPatternTypeRef = useRef(boardPatternType);
    useEffect(() => {
        boardPatternTypeRef.current = boardPatternType;
        syncCustomLayers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [boardPatternType, boardColor, gridSize]);

 useEffect(() => {
        // פונקציית עזר להגדרת קנבס חד התומך במסכי רטינה (אייפד/מובייל)
        const updateDrawingCanvasResolution = (width, height) => {
            if (!drawingCanvasRef.current) return;
            const dpr = window.devicePixelRatio || 1;
            drawingCanvasRef.current.style.width = width + 'px';
            drawingCanvasRef.current.style.height = height + 'px';
            drawingCanvasRef.current.width = Math.round(width * dpr);
            drawingCanvasRef.current.height = Math.round(height * dpr);

            // בלי desynchronized: בטאבלטים של סמסונג הקנבס השקוף נצבע שחור ומכסה את כל הלוח
            const ctx = drawingCanvasRef.current.getContext('2d');
            // setTransform ולא scale: scale מצטבר בכל שינוי גודל ומעוות את הציור
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const pc = predictCanvasRef.current;
            if (pc) {
                pc.style.width = width + 'px'; pc.style.height = height + 'px';
                pc.width = Math.round(width * dpr); pc.height = Math.round(height * dpr);
                pc.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
            }
        };

        const initCanvas = () => {
            if (fCanvas.current) {
                fCanvas.current.dispose();
            }

            const width = window.innerWidth;
            const height = window.innerHeight;

            // עדכון הקנבס השקוף עם התמיכה החדשה
            updateDrawingCanvasResolution(width, height);

           fCanvas.current = new fabric.Canvas(fabricCanvasElRef.current, {
                width: width,
                height: height,
                selection: modeRef.current === 'select' && selectionTypeRef.current === 'box',
                selectionFullyContained: false,
                isDrawingMode: false,
                enableRetinaScaling: true,
                // Fabric מקשיב לאירועי מצביע ולא לאירועי מגע. אחרת, בטאבלט, כל נגיעה
                // של עט או של כף יד הגיעה אליו גם כאירוע מגע — גם כשהלוח כבר טיפל בה
                // ועצר אותה — והוא ביטל מיד כל בחירה שהלאסו עשה
                enablePointerEvents: true,
                fireMiddleClick: true, allowTouchScrolling: false,
                stopContextMenu: true, renderOnAddRemove: false
            });

            // נקודת גישה לבדיקות הקצה־לקצה ולניפוי באגים מהקונסולה
            window.__pbCanvas = fCanvas.current;
            window.__pbFabric = fabric;

            // כל אובייקט שנוצר תוך כדי הקלטה מקבל את מיקומו בציר הזמן של
            // השמע. זה כל הסוד מאחורי קפיצה מכתב יד לרגע שבו הוא נכתב.
            fCanvas.current.on('object:added', (opt) => {
                const obj = opt.target;
                if (!obj || obj.isEditHelper) return;
                if (!sb.current.recorder || sb.current.recorder.status === 'idle') return;
                if (obj.recTime === undefined) {
                    obj.recTime = sb.current.recorder.elapsed();
                    obj.recId = sb.current.activeRecordingId;
                }
            });

// --- כניסה אוטומטית לעיגולים הכחולים בלחיצה רגילה (בחירה) ---
            fCanvas.current.on('selection:created', (opt) => {
                if (sb.current.isEnteringNodeEdit || sb.current.forceBoundingBox) return;
                if (!sb.current.lasso) openSelectionMenuRef.current(fCanvas.current.getActiveObject());
                if (opt.selected && opt.selected.length > 1) return;
                const target = opt.selected[0];
                if (target && isSmartShape(target)) {
                    enterNodeEditMode(target);
                }
            });

            fCanvas.current.on('selection:updated', (opt) => {
                if (sb.current.isEnteringNodeEdit || sb.current.forceBoundingBox) return;
                if (opt.selected && opt.selected.length > 1) return;
                const target = opt.selected[0];
                if (target && isSmartShape(target)) {
                    enterNodeEditMode(target);
                }
            });

            // --- לחיצה כפולה להחלפה בין עיגולים למסגרת לבנה ---
            fCanvas.current.on('mouse:dblclick', (opt) => {
                if (sb.current.justDoubleTapped) return; // מונע התנגשות עם הלחיצה הכפולה של מצב הציור!
                const target = opt.target || objectAt(opt.e.clientX, opt.e.clientY);
                if (target && isSmartShape(target)) {
                    if (sb.current.editCircles.length > 0 && sb.current.editingOriginalObj === target) {
                        // אם אנחנו בעיגולים כחולים -> עוברים למסגרת לבנה
                        sb.current.forceBoundingBox = true;
                        exitNodeEditMode();
                        fCanvas.current.setActiveObject(target);
                        fCanvas.current.requestRenderAll();
                        setTimeout(() => { sb.current.forceBoundingBox = false; }, 200); // משחרר את החסימה מיד אחרי ההחלפה
                    } else if (sb.current.editCircles.length === 0) {
                        // אם אנחנו במסגרת הלבנה -> חוזרים לעיגולים הכחולים
                        enterNodeEditMode(target);
                    }
                }
            });

            fCanvas.current.on('object:moving', () => { sb.current.activeObjTapMoved = true; });
            fCanvas.current.on('object:scaling', () => { sb.current.activeObjTapMoved = true; });
            fCanvas.current.on('object:rotating', () => { sb.current.activeObjTapMoved = true; });

            fCanvas.current.on('mouse:up', (opt) => {
                if (opt.target && opt.target === fCanvas.current.getActiveObject() && !sb.current.activeObjTapMoved) {
                    const now = Date.now();
                    if (now - (sb.current.lastActiveObjTap || 0) > 200) {
                        setContextMenu({ visible: true, x: opt.e.clientX, y: opt.e.clientY, target: opt.target });
                        setShowBoardSettings(false); setRevisions(null);
                    }
                    sb.current.lastActiveObjTap = now;
                }

                // בזמן נגינה, לחיצה על משהו שנכתב מקפיצה את השמע לרגע שלו
                if (opt.target && seekToObjectRef.current(opt.target)) return;
                if (!opt.target && sb.current.editCircles.length > 0 && !sb.current.longPressFired) {
                    clearTimeout(sb.current.singleTapExitTimer);
                    sb.current.singleTapExitTimer = setTimeout(() => {
                        if (sb.current.editCircles.length > 0) {
                            exitNodeEditMode();
                            setMode('draw');
                            sb.current.wasAutoSelected = false;
                        }
                    }, 250);
                }
                sb.current.longPressFired = false;
            });

            // #3: בחירת אזור עם עט — סימון בקו מקווקו במקום מלבן נמתח
           fCanvas.current.on('mouse:down', (opt) => {
                if (modeRef.current !== 'select') return;
                if (selectionTypeRef.current === 'box') {
                    fCanvas.current.selection = true;
                    return;
                }

                fCanvas.current.selection = false; // מכבה באופן מוחלט את הריבוע הכחול של המערכת!

                if (opt.target) {
                    sb.current.activeObjTapMoved = false; // הכנה לתפריט צף
                    return;
                }
                if (sb.current.editCircles.length > 0) return; // עריכת קודקודים פעילה
                lassoBegin(opt.e.clientX, opt.e.clientY);
            });
            fCanvas.current.on('mouse:move', (opt) => {
                if (sb.current.lasso) lassoMove(opt.e.clientX, opt.e.clientY);
            });
            fCanvas.current.on('mouse:up', () => {
                const lasso = lassoEnd();
                if (!lasso) return;
                if (!lasso.moved) {
                    // הקשה על אזור ריק — חזרה לציור אם צורה נבחרה קודם
                    if (sb.current.wasAutoSelected && sb.current.editCircles.length === 0) {
                        setMode('draw'); sb.current.wasAutoSelected = false;
                    }
                    return;
                }
                selectInsideLasso(lasso.scene);
            });

            fCanvas.current.on('selection:cleared', () => {
                if (sb.current.lasso) return;
                if (sb.current.isEnteringNodeEdit) return;
                if (sb.current.isSelectingEditCircle || sb.current.isSelectingShape) return;
                exitNodeEditMode();
                if (modeRef.current === 'select' && sb.current.wasAutoSelected && sb.current.editCircles.length === 0) {
                    setMode('draw'); sb.current.wasAutoSelected = false;
                }
            });

            // טעינת מידע קיים - חובה לעטוף בטיימר כדי למנוע קריסה של Fabric
            if (initialData && initialData.fabric) {
                setTimeout(() => {
                    sb.current.isLocked = true;
                    restore(initialData);
                }, 50);
            } else {
                setTimeout(saveState, 200);
            }
        };

        initCanvas();

        // סיבוב הטאבלט, פתיחת המקלדת ושינוי גודל החלון מגיעים כרצף של
        // אירועים. הקנבסים נבנים מחדש פעם אחת לפריים, ולא בכל אירוע
        let resizeFrame = null;
        const handleResize = () => {
            if (resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                if (fCanvas.current) {
                    fCanvas.current.setDimensions({ width: window.innerWidth, height: window.innerHeight });
                    fCanvas.current.requestRenderAll();
                }
                sb.current.canvasRect = null;
                updateDrawingCanvasResolution(window.innerWidth, window.innerHeight);
            });
        };
        window.addEventListener('resize', handleResize);

        const handleKeyDown = async (e) => {
            if (sb.current.activeBox) return;
            if (e.code === 'Escape') {
                // Escape סגר רק את תפריט ההקשר, וחלונית הגדרות הלוח נשארה
                // פתוחה עם שכבת הסגירה שלה חוסמת את סרגל הכלים
                exitNodeEditMode();
                setContextMenu({ visible: false, x: 0, y: 0, target: null });
                setShowBoardSettings(false); setRevisions(null);
            }
            if (e.code === 'Delete' || e.code === 'Backspace') {
                if (modeRef.current === 'select') {
                    const activeObjects = fCanvas.current.getActiveObjects();
                    if (activeObjects.length > 0) {
                        e.preventDefault(); activeObjects.forEach(obj => fCanvas.current.remove(obj));
                        fCanvas.current.discardActiveObject(); fCanvas.current.requestRenderAll(); saveState();
                    }
                }
            }
            if (e.ctrlKey || e.metaKey) {
                if (e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
                else if (e.code === 'KeyY') { e.preventDefault(); redo(); }
                else if (e.code === 'KeyC' || e.code === 'KeyX' || e.code === 'KeyD' || e.code === 'KeyV') {
                    keyClipboardRef.current(e);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, { passive: false });
        // מיקום הסמן האחרון מעל הלוח — Ctrl+V מדביק בדיוק שם
        const trackPointer = (e) => { sb.current.lastPointer = { x: e.clientX, y: e.clientY }; };
        window.addEventListener('pointermove', trackPointer, { passive: true });
        const handleGlobalPointerGone = (e) => {
    if (!sb.current.activePointers.has(e.pointerId)) return;
    sb.current.activePointers.delete(e.pointerId);
    if (sb.current.activePointers.size === 0) {
        sb.current.isPanning = false; setPanCursor(false); endViewGesture();
        sb.current.multiTouchStartTime = null;
        sb.current.multiTouchMoved = false;
        sb.current.multiTouchMaxFingers = 0;
        sb.current.multiTouchInitialPositions = new Map();
        if (fCanvas.current) fCanvas.current.selection = boxSelectOn();
    }
};
window.addEventListener('pointerup', handleGlobalPointerGone);
window.addEventListener('pointercancel', handleGlobalPointerGone);

        /* ── הקשה בשתי אצבעות מבטלת, ובשלוש מבצעת שוב ──
           המעקב כאן גלובלי ולא על הלוח בלבד: אצבע שנוגעת בסרגל עדיין נספרת,
           ומערכת ההפעלה שמבטלת מחוות של שלוש אצבעות לא מבטלת גם את הפעולה. */
        const tg = { ids: new Map(), max: 0, start: 0, moved: false, onBoard: false };
        const gDown = (e) => {
            if (e.pointerType !== 'touch') return;
            // כף היד שמחזיקה את העט אינה הקשה בשתי אצבעות, ואסור לה לבטל פעולה
            if (isPenOnly(devicePrefsRef.current) && isLikelyPalm(e, sb.current)) return;
            if (tg.ids.size === 0) { tg.max = 0; tg.start = e.timeStamp; tg.moved = false; tg.onBoard = false; }
            tg.ids.set(e.pointerId, { x0: e.clientX, y0: e.clientY });
            tg.max = Math.max(tg.max, tg.ids.size);
            if (e.target && e.target.closest && e.target.closest('#viewport')) tg.onBoard = true;
        };
        const gMove = (e) => {
            const f = tg.ids.get(e.pointerId);
            if (f && Math.hypot(e.clientX - f.x0, e.clientY - f.y0) > 18) tg.moved = true;
        };
        const gUp = (cancelled) => (e) => {
            if (!tg.ids.has(e.pointerId)) return;
            tg.ids.delete(e.pointerId);
            if (tg.ids.size > 0) return;
            const quick = (e.timeStamp - tg.start) < 600;
            // ביטול של המערכת באמצע מחווה של שלוש אצבעות נחשב להקשה, אם לא הייתה תנועה
            const ok = quick && !tg.moved && tg.onBoard && (cancelled ? tg.max >= 3 : tg.max >= 2);
            if (ok) { if (tg.max >= 3) gestureActions.current.redo?.(); else gestureActions.current.undo?.(); }
            tg.max = 0;
        };
        const gUpOk = gUp(false), gCancel = gUp(true);

        /* ── מעקב אחרי העט: בריחוף ובמגע ──
           משמש לדחיית כף היד, ובפעם הראשונה שמזוהה עט גם מדליק מעצמו את
           מצב "רק העט כותב", שבו האצבע מזיזה את הלוח במקום לצייר. */
        const penTrack = (e) => {
            if (sb.current.penDebug) logPenEvent(e);
            if (e.pointerType !== 'pen') return;
            sb.current.lastPenAt = e.timeStamp;
            // רשת ביטחון: אם משיכה עם כפתור הצד הסתיימה והכלי הזמני לא הוחזר, מחזירים אותו
            if ((e.type === 'pointerup' || e.type === 'pointercancel') && sb.current.penOverride && !sb.current.penSession) penOverrideEnd();
            // ב־S Pen כפתור הצד מדווח כ־buttons=1 בזמן שהעט מרחף (לחץ 0). זה האות היחיד
            // שהדפדפן שולח, ולכן רק ריחוף נחשב: במגע אין דרך להבדיל בינו לבין מגע רגיל
            // רק אירועי ריחוף (לחץ 0) משנים את המצב. אירוע מגע שמגיע רגע לפני
            // ה־pointerdown לא מוחק את הלחיצה שנקלטה באוויר
            if (e.type === 'pointermove' && !sb.current.penDown && e.pressure === 0) {
                sb.current.barrelHeld = (e.buttons & 3) !== 0;
                // הדיווח של הכפתור בריחוף מהבהב בין 1 ל־0, ולכן זוכרים מתי נראה לאחרונה
                if (sb.current.barrelHeld) sb.current.barrelSeenAt = e.timeStamp;
            }
            else if (e.type === 'pointerup' || e.type === 'pointercancel') sb.current.barrelHeld = false;
            if (e.type === 'pointerdown') sb.current.penDown = true;
            else if (e.type === 'pointerup' || e.type === 'pointercancel') sb.current.penDown = false;
            if (!devicePrefsRef.current.penSeen) {
                devicePrefsRef.current = { ...devicePrefsRef.current, penSeen: true };
                setDevicePrefs((p) => ({ ...p, penSeen: true }));
                if (devicePrefsRef.current.penOnly === null) showToast('זוהה עט. מעכשיו העט כותב והאצבע מזיזה את הלוח. אפשר לשנות בהגדרות הלוח');
            }
        };
        // עט שנוגע במסך לא מעלה את תפריט ההקשר של הדפדפן, גם עם כפתור הצד
        /* Chrome באנדרואיד מתרגם עט שנוגע עם כפתור לחוץ ל"לחיצה ארוכה", ושולח
           contextmenu — לפעמים בלי סוג מצביע של עט, ולפעמים רק אחרי שהעט הורם.
           לכן כל contextmenu שמגיע מיד אחרי פעילות של העט שייך לכפתור. הוא
           נתפס כבר בשלב ה־capture, כדי שלא יגיע למאזין של הלוח ויפתח את ההגדרות */
        const penContextMenu = (e) => {
            const recentPen = e.pointerType === 'pen' || sb.current.penDown || e.timeStamp - (sb.current.lastPenAt ?? -1e9) < 700;
            if (sb.current.penDebug) setPenLog((l) => [`contextmenu ${e.pointerType || '?'} +${Math.round(e.timeStamp - (sb.current.strokeStartAt ?? e.timeStamp))}ms${recentPen ? ' (עט)' : ''}`, ...l].slice(0, 14));
            if (!recentPen) return;
            e.preventDefault();
            e.stopPropagation();
            penButtonFromContextMenuRef.current(e);
        };
        // היומן של בדיקת הכפתור רושם כל סוג מצביע — ייתכן שהדפדפן הופך עט עם כפתור לעכבר
        const logPenEvent = (e) => {
            const sig = `${e.pointerType}|${e.type}|${e.button}|${e.buttons}|${e.pressure > 0 ? 1 : 0}`;
            if (sig === sb.current.penDebugSig && e.type === 'pointermove') return;
            sb.current.penDebugSig = sig;
            const line = `${e.pointerType} ${e.type.replace('pointer', '')} btn=${e.button} btns=${e.buttons} p=${(e.pressure || 0).toFixed(2)}${sb.current.barrelHeld ? ' [כפתור]' : ''}`;
            setPenLog((l) => [line, ...l].slice(0, 14));
        };
        for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, penTrack, { capture: true, passive: true });
        window.addEventListener('contextmenu', penContextMenu, true);
        window.addEventListener('pointerdown', gDown, true);
        window.addEventListener('pointermove', gMove, true);
        window.addEventListener('pointerup', gUpOk, true);
        window.addEventListener('pointercancel', gCancel, true);
        const closeMenu = (e) => { if (!e.target.closest('.context-menu')) setContextMenu(prev => ({...prev, visible: false})); };
        window.addEventListener('pointerdown', closeMenu);

        const viewport = viewportRef.current;
        const handleNativeWheel = (e) => {
            e.preventDefault();
            if (!fCanvas.current) return;
            if (e.ctrlKey || e.metaKey) {
                let zoom = liveZoom();
                zoom *= 0.999 ** e.deltaY;
                zoom = Math.max(0.1, Math.min(20, zoom));
                const rect = viewport.getBoundingClientRect();
                viewZoomTo(e.clientX - rect.left, e.clientY - rect.top, zoom);
            } else {
                viewPanBy(-e.deltaX, -e.deltaY);
            }
        };
        if (viewport) viewport.addEventListener('wheel', handleNativeWheel, { passive: false });

    // ... (הקוד של initCanvas ו-handleResize) ...

            // --- חסימת גלילה אגרסיבית למכשירים ניידים ---
            const preventNativeScroll = (e) => {
                // רשימות וחלוניות שמסומנות כנגללות — הסרגל, מגירת ההנדסה — גוללות כרגיל
                if (e.target && e.target.closest && e.target.closest('[data-scrollable], .stem-panel, .pb-popover, .pb-modal-card, .ML__keyboard')) return;
                // חוסמים גלילה אלא אם המשתמש נמצא במצב בחירה (Select) ומנסה לגלול אובייקט ספציפי
                if (modeRef.current !== 'select') {
                    e.preventDefault();
                }
            };

            // אנחנו שמים את ההאזנה על window ולא על רכיב ספציפי, כדי לתפוס הכל לפני הדפדפן
            // הגדרת passive: false היא קריטית כאן
            window.addEventListener('touchmove', preventNativeScroll, { passive: false });
            window.addEventListener('wheel', preventNativeScroll, { passive: false }); // למקרה שחיברו עכבר לאייפד

            return () => {
                window.removeEventListener('resize', handleResize);
                window.removeEventListener('keydown', handleKeyDown);
                window.removeEventListener('pointermove', trackPointer);
                window.removeEventListener('pointerdown', closeMenu);
                window.removeEventListener('pointerup', handleGlobalPointerGone);
window.removeEventListener('pointercancel', handleGlobalPointerGone);
                window.removeEventListener('pointerdown', gDown, true);
                window.removeEventListener('pointermove', gMove, true);
                window.removeEventListener('pointerup', gUpOk, true);
                window.removeEventListener('pointercancel', gCancel, true);
                for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(t, penTrack, { capture: true });
                window.removeEventListener('contextmenu', penContextMenu, true);
                if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);

                window.removeEventListener('touchmove', preventNativeScroll);
                window.removeEventListener('wheel', preventNativeScroll);

                if (fCanvas.current) fCanvas.current.dispose();
            };
        }, [setMode]); // סיום ה-useEffect

 const handleViewportPointerDown = (e) => {
      // ── תיקון באג Apple Pencil: אם הלחיצה היא על כפתור, קלט, label וכו' —
    // נניח ל-event להגיע לאלמנט בלי שנתערב
    const isOnUI = e.target.closest('[data-ui], button, input, select, textarea, label, a');
    if (isOnUI) return; // ← יציאה מיידית, הכפתור יקבל את ה-click רגיל

    const penOnly = isPenOnly(devicePrefsRef.current);
    // דחיית כף היד: מגע בזמן שהעט כותב או מרחף לא מגיע לשום מקום בלוח
    if (penOnly && isLikelyPalm(e, sb.current)) {
        e.stopPropagation();
        sb.current.ignoredPointers.add(e.pointerId);
        return;
    }

    // כפתור הצד של העט, או קצה מחק: המשיכה מנותבת לכלי שהוגדר לכפתור
    const barrel = (e.pointerType === 'pen' && (isBarrelPressed(e) || sb.current.barrelHeld || e.timeStamp - (sb.current.barrelSeenAt ?? -1e9) < 450))
        // יש דפדפנים שמעבירים עט עם כפתור לחוץ כלחיצה ימנית של עכבר
        || (e.pointerType === 'mouse' && devicePrefsRef.current.penSeen && (e.button === 2 || (e.buttons & 2) !== 0));
    if (barrel || isEraserTip(e)) {
        const action = isEraserTip(e) ? 'erase' : devicePrefsRef.current.penButton;
        if (action !== 'none') {
            e.stopPropagation();
            e.preventDefault();
            if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }
            sb.current.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            sb.current.penSession = { id: e.pointerId, action, inContact: false, done: false };
            if (sb.current.penDebug) setPenLog((l) => [`>>> כפתור זוהה: ${action}`, ...l].slice(0, 14));
            if (!sb.current.barrelAnnounced && !isEraserTip(e)) {
                sb.current.barrelAnnounced = true;
                const label = PEN_BUTTON_ACTIONS.find((a) => a.id === action)?.label;
                if (label) showToast(`כפתור העט: ${label}. אפשר לשנות בהגדרות הלוח`);
            }
            if (isPenContact(e)) penContactStart(e);
            return;
        }
    }

    sb.current.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const drawingMode = modeRef.current === 'draw' || modeRef.current === 'erase';
    // עט בכלי כתיבה: בלי לחיצה כפולה ובלי לחיצה ארוכה. נקודתיים, שלוש
    // נקודות או השהיה לפני תחילת קו הם חלק רגיל מכתיבה, ולא בקשה לתפריט.
    // התפריט זמין מכפתור הצד של העט, או בלחיצה ארוכה באצבע
    const penWriting = e.pointerType === 'pen' && drawingMode;

    /* בחירה בלאסו: מתחילה בכל נגיעה של עט או עכבר על שטח ריק. הלוח מטפל
       בה בעצמו ולא Fabric, כדי שהקו המקווקו יופיע ויעבוד בעט כמו בעכבר.
       נגיעה על אובייקט או על בחירה קיימת עוברת ל־Fabric, להזזה ולשינוי גודל */
    if (modeRef.current === 'select' && selectionTypeRef.current !== 'box' && sb.current.activePointers.size === 1
        && fCanvas.current && !(penOnly && e.pointerType === 'touch')) {
        const hit = objectAt(e.clientX, e.clientY);
        if (!hit) {
            e.stopPropagation();
            e.preventDefault();
            if (sb.current.editCircles.length > 0) exitNodeEditMode();
            fCanvas.current.discardActiveObject();
            fCanvas.current.requestRenderAll();
            setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
            sb.current.lassoPointer = e.pointerId;
            lassoBegin(e.clientX, e.clientY);
            return;
        }
    }

    // במצב "רק העט כותב" אצבע אחת מזיזה את הלוח במקום לצייר, וגם בבחירה כשהיא על שטח ריק
    const fingerOnEmpty = modeRef.current === 'select' && fCanvas.current && !objectAt(e.clientX, e.clientY);
    if (penOnly && e.pointerType === 'touch' && (drawingMode || fingerOnEmpty) && sb.current.activePointers.size === 1) {
        e.stopPropagation();
        sb.current.fingerPan = { id: e.pointerId };
        sb.current.lastX = e.clientX;
        sb.current.lastY = e.clientY;
    }

    // Shift ולחיצה במחשב: הזזת הלוח
    if (e.shiftKey && sb.current.activePointers.size === 1 && e.pointerType === 'mouse') {
        e.stopPropagation();
        sb.current.isPanning = true; setPanCursor(true);
        sb.current.lastX = e.clientX;
        sb.current.lastY = e.clientY;
        return;
    }

// לחיצה ארוכה — רק אצבע אחת
    if (sb.current.activePointers.size === 1 && penWriting) {
        sb.current.longPressStartX = e.clientX;
        sb.current.longPressStartY = e.clientY;
        sb.current.lastTapTime = 0;
    } else if (sb.current.activePointers.size === 1) {
        // ← זיהוי לחיצה כפולה למעבר מעיגולים כחולים → מסגרת לבנה
        // זמן האירוע עצמו ולא Date.now — אותו שעון לכל האירועים, ובלי קריאה לא טהורה
        const now = e.timeStamp;
        sb.current.touchStartTime = now;     // תחילת המגע, למדידת הקשה בשתי אצבעות או שלוש
        if (e.pointerType === 'touch') sb.current.lastTouchEventAt = now;
        const timeSinceLastTap = now - sb.current.lastTapTime;
        const tapDist = Math.hypot(e.clientX - sb.current.lastTapX, e.clientY - sb.current.lastTapY);
        sb.current.lastTapTime = now;
        sb.current.lastTapX = e.clientX;
        sb.current.lastTapY = e.clientY;

       if (timeSinceLastTap < 350 && tapDist < 40) {
            e.stopPropagation();
            e.preventDefault();
            sb.current.drawing = false;

            clearTimeout(sb.current.singleTapExitTimer);
            sb.current.singleTapExitTimer = null;
            if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }

            // מחיקת "נקודת הזבל" שנוצרה בטעות מהלחיצה הראשונה של הדאבל-קליק
            const objects = fCanvas.current.getObjects();
            const lastObj = objects[objects.length - 1];
            if (lastObj && lastObj.customType === 'ink') {
                const bound = lastObj.getBoundingRect();
                if (bound.width < 15 && bound.height < 15) {
                    fCanvas.current.remove(lastObj);
                }
            }

            const zoom = fCanvas.current.getZoom();
            const vpt = fCanvas.current.viewportTransform;
            const fabricPt = new fabric.Point((e.clientX - vpt[4]) / zoom, (e.clientY - vpt[5]) / zoom);

            let target = null;
            const updatedObjects = fCanvas.current.getObjects();
            for (let i = updatedObjects.length - 1; i >= 0; i--) {
                if (updatedObjects[i].isEditHelper) continue;
                if (updatedObjects[i].containsPoint(fabricPt) || isObjectNearPoint(updatedObjects[i], fabricPt, 15 / zoom)) {
                    target = updatedObjects[i]; break;
                }
            }

           if (target) {
                sb.current.justDoubleTapped = true;
                setTimeout(() => { sb.current.justDoubleTapped = false; }, 400); // מאותת ל-Fabric להתעלם

                setMode('select');
                sb.current.wasAutoSelected = true;
                if (isSmartShape(target)) enterNodeEditMode(target);
                else { fCanvas.current.setActiveObject(target); fCanvas.current.requestRenderAll(); }
            } else if (sb.current.editCircles.length > 0) {
                const editedObj = sb.current.editingOriginalObj;
                exitNodeEditMode();
                if (editedObj && fCanvas.current) { fCanvas.current.setActiveObject(editedObj); fCanvas.current.requestRenderAll(); }
            }
            return;
        }

        sb.current.longPressStartX = e.clientX;
        sb.current.longPressStartY = e.clientY;

        // שומרים את המיקום בצד, כי React מנקה את האירוע אחרי ההשהיה
        const cx = e.clientX;
        const cy = e.clientY;

     sb.current.longPressTimer = setTimeout(() => {
    sb.current.longPressTimer = null;
    // אם הונחה אצבע שנייה, זו הקשה בשתי אצבעות ולא לחיצה ארוכה
    if (sb.current.activePointers.size !== 1 || sb.current.multiTouchMaxFingers >= 2) return;
    sb.current.longPressFired = true;
    sb.current.drawing = false;
    sb.current.points = [];
    sb.current.hasMovedEnoughToDraw = false;
    clearTimeout(sb.current.snapTimeout);
    if (drawingCanvasRef.current) {
        const ctx = drawingCanvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }

    if (!fCanvas.current) return;

    // ← חישוב ידני של קואורדינטות Fabric — בלי getPointer()
    const zoom = fCanvas.current.getZoom();
    const vpt = fCanvas.current.viewportTransform;
    const fabricX = (cx - vpt[4]) / zoom;
    const fabricY = (cy - vpt[5]) / zoom;
    const fabricPoint = new fabric.Point(fabricX, fabricY);

    // ← חיפוש צורה במיקום הלחיצה
    let target = null;
    const objects = fCanvas.current.getObjects();
    for (let i = objects.length - 1; i >= 0; i--) {
        if (objects[i].isEditHelper) continue;   // עיגולי עריכה אינם מטרה לתפריט
        if (objects[i].containsPoint(fabricPoint)) {
            target = objects[i];
            break;
        }
    }

    if (target) {
        setContextMenu({ visible: true, x: cx, y: cy, target });
        setShowBoardSettings(false); setRevisions(null);
    } else {
        // לחיצה ארוכה על מקום ריק: אם הועתק משהו, תפריט עם הדבקה בנקודה הזו.
        // אחרת, הגדרות הלוח, כמו שהיה תמיד
        sb.current.menuPoint = { x: cx, y: cy };
        if (sb.current.clipboard) {
            setContextMenu({ visible: true, x: cx, y: cy, target: null });
            setShowBoardSettings(false); setRevisions(null);
        } else {
            setBoardSettingsPos({ x: cx, y: cy });
            setShowBoardSettings(true);
            setContextMenu({ visible: false, x: 0, y: 0, target: null });
        }
    }
}, 500);
    }

    if (sb.current.activePointers.size >= 2) {
        sb.current.fingerPan = null;
        // ביטול לחיצה ארוכה כשנוגעת אצבע שנייה
        if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }

        if (sb.current.activePointers.size === 2) {
            sb.current.multiTouchStartTime = sb.current.touchStartTime ?? e.timeStamp;
            sb.current.multiTouchMoved = false;
            sb.current.multiTouchMaxFingers = 2;
            sb.current.multiTouchInitialPositions = new Map(sb.current.activePointers);

            const pts = Array.from(sb.current.activePointers.values());
            sb.current.pinchInitialDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            sb.current.pinchInitialZoom = fCanvas.current ? liveZoom() : 1;

            sb.current.pinchingObject = null;
            if (fCanvas.current && modeRef.current === 'select') {
                const midX = (pts[0].x + pts[1].x) / 2;
                const midY = (pts[0].y + pts[1].y) / 2;
                const zoom = fCanvas.current.getZoom();
                const vpt = fCanvas.current.viewportTransform;
                const fabricPt = new fabric.Point((midX - vpt[4]) / zoom, (midY - vpt[5]) / zoom);
                const activeObj = fCanvas.current.getActiveObject();
                if (activeObj && activeObj.containsPoint(fabricPt)) {
                    sb.current.pinchingObject = activeObj;
                    sb.current.pinchObjInitialScaleX = activeObj.scaleX || 1;
                    sb.current.pinchObjInitialScaleY = activeObj.scaleY || 1;
                    sb.current.pinchObjInitialAngle = activeObj.angle || 0;
                    sb.current.pinchInitialAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
                }
            }
        }
        if (sb.current.activePointers.size > sb.current.multiTouchMaxFingers) {
            sb.current.multiTouchMaxFingers = sb.current.activePointers.size;
        }

        sb.current.drawing = false;
        if (drawingCanvasRef.current) (() => { const _c = drawingCanvasRef.current; if(_c) _c.getContext("2d").clearRect(0,0,_c.width,_c.height); })();
        if (fCanvas.current) { fCanvas.current.discardActiveObject(); fCanvas.current.selection = false; }
        const pts = Array.from(sb.current.activePointers.values());
        sb.current.lastX = (pts[0].x + pts[1].x) / 2;
        sb.current.lastY = (pts[0].y + pts[1].y) / 2;
    }
};

const handleViewportPointerMove = (e) => {
    if (sb.current.ignoredPointers.has(e.pointerId)) { e.stopPropagation(); return; }
    if (sb.current.activePointers.has(e.pointerId)) sb.current.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // משיכה עם כפתור הצד מנותבת ישירות לכלי של הכפתור
    const ps = sb.current.penSession;
    if (ps && ps.id === e.pointerId) {
        e.stopPropagation();
        const contact = isPenContact(e);
        if (contact && !ps.inContact) penContactStart(e);
        else if (!contact && ps.inContact) penContactEnd(e);
        else if (contact) penContactMove(e);
        return;
    }

    // כפתור הצד נלחץ באמצע משיכה, אחרי שהעט כבר נגע: המשיכה הרגילה מבוטלת
    // והעט עובר לכלי של הכפתור מהנקודה הזו
    if (e.pointerType === 'pen' && !sb.current.penSession && sb.current.drawing && sb.current.drawPointerId === e.pointerId
        && isBarrelPressed(e) && devicePrefsRef.current.penButton !== 'none'
        && (modeRef.current === 'draw' || modeRef.current === 'erase')) {
        e.stopPropagation();
        switchStrokeToButton(e);
        return;
    }

    if (sb.current.lassoPointer === e.pointerId) {
        e.stopPropagation();
        const native = e.nativeEvent || e;
        const evs = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : null;
        if (evs && evs.length > 1) for (const ce of evs) lassoMove(ce.clientX, ce.clientY);
        else lassoMove(e.clientX, e.clientY);
        return;
    }

    // עט שמרחף מעל המסך במצב מחק מראה את עיגול המחק לפני שנוגעים
    if (e.pointerType === 'pen' && !sb.current.drawing && modeRef.current === 'erase' && !isPenContact(e)) schedulePenHover(e);

    // אצבע אחת במצב "רק העט כותב": הזזת הלוח, אחרי תזוזה קטנה כדי שהקשה תישאר הקשה
    const fp = sb.current.fingerPan;
    if (fp && fp.id === e.pointerId && sb.current.activePointers.size === 1) {
        e.stopPropagation();
        if (!sb.current.isPanning && Math.hypot(e.clientX - sb.current.lastX, e.clientY - sb.current.lastY) > 6) {
            sb.current.isPanning = true; setPanCursor(true);
            if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }
            sb.current.lastTapTime = 0;
        }
    }

    // ביטול לחיצה ארוכה ודאבל קליק אם האצבע זזה (מונע התנגשות בזמן ציור קווים)
    if (sb.current.activePointers.size > 0) {
        const moved = Math.hypot(e.clientX - sb.current.longPressStartX, e.clientY - sb.current.longPressStartY);
        if (moved > 10) {
            if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }
            sb.current.lastTapTime = 0; // פוסל לחיצה כפולה כי המשתמש מצייר קו
        }
    }

    // אצבע "מושלם" שמונחת על המסך לא מזיזה את הלוח
    if (sb.current.perfectPointer !== undefined && sb.current.perfectPointer !== null) return;

    // פינץ' + פאן — שתי אצבעות
    if (sb.current.activePointers.size === 2 && fCanvas.current) {
        const pts = Array.from(sb.current.activePointers.values());
        const currentMidX = (pts[0].x + pts[1].x) / 2;
        const currentMidY = (pts[0].y + pts[1].y) / 2;
        const currentDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

        // בדיקה אם זה מחווה (לא טאפ)
        let maxMovement = 0;
        sb.current.activePointers.forEach((pos, id) => {
            const initial = sb.current.multiTouchInitialPositions.get(id);
            if (initial) { const d = Math.hypot(pos.x - initial.x, pos.y - initial.y); if (d > maxMovement) maxMovement = d; }
        });

       if (maxMovement > 16 || Math.abs(currentDist - sb.current.pinchInitialDist) > 14) {
            sb.current.multiTouchMoved = true;
            if (!sb.current.pinchingObject) {
                sb.current.isPanning = true; setPanCursor(true);
            }
        }

        if (sb.current.multiTouchMoved) {
            if (sb.current.pinchingObject) {
                const scaleFactor = currentDist / sb.current.pinchInitialDist;
                const currentAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
                const angleDiff = (currentAngle - sb.current.pinchInitialAngle) * (180 / Math.PI);
                sb.current.pinchingObject.set({
                    scaleX: sb.current.pinchObjInitialScaleX * scaleFactor,
                    scaleY: sb.current.pinchObjInitialScaleY * scaleFactor,
                    angle: sb.current.pinchObjInitialAngle + angleDiff
                });
                fCanvas.current.requestRenderAll();
                sb.current.pinchingObjectModified = true;
            } else {
                const rect = viewportRef.current.getBoundingClientRect();
                if (sb.current.pinchInitialDist > 5) {
                    const newZoom = Math.max(0.02, Math.min(100, sb.current.pinchInitialZoom * (currentDist / sb.current.pinchInitialDist)));
                    viewZoomTo(currentMidX - rect.left, currentMidY - rect.top, newZoom);
                }
                viewPanBy(currentMidX - sb.current.lastX, currentMidY - sb.current.lastY);
                sb.current.lastX = currentMidX;
                sb.current.lastY = currentMidY;
            }
        }
        return;
    }

    // פאן אצבע + Shift (מחשב)
    if (sb.current.isPanning && fCanvas.current && sb.current.activePointers.size < 2) {
        e.stopPropagation();
        viewPanBy(e.clientX - sb.current.lastX, e.clientY - sb.current.lastY);
        sb.current.lastX = e.clientX; sb.current.lastY = e.clientY;
    }
};

const handleViewportPointerUp = (e) => {
    if (sb.current.ignoredPointers.delete(e.pointerId)) { e.stopPropagation(); return; }
    if (sb.current.lassoPointer === e.pointerId) {
        e.stopPropagation();
        sb.current.lassoPointer = null;
        sb.current.activePointers.delete(e.pointerId);
        const lasso = lassoEnd();
        if (lasso && lasso.moved) selectInsideLasso(lasso.scene);
        else if (sb.current.wasAutoSelected) { setMode('draw'); sb.current.wasAutoSelected = false; }
        return;
    }

    if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }
    const ps = sb.current.penSession;
    if (ps && ps.id === e.pointerId) {
        e.stopPropagation();
        if (ps.inContact) penContactEnd(e);
        sb.current.penSession = null;
    }
    if (sb.current.fingerPan && sb.current.fingerPan.id === e.pointerId) {
        e.stopPropagation();
        sb.current.fingerPan = null;
    }
    sb.current.activePointers.delete(e.pointerId);
    if (sb.current.perfectPointer === e.pointerId) {
        sb.current.perfectPointer = null;
        sb.current.multiTouchStartTime = null;
        sb.current.multiTouchMaxFingers = 0;
        return;
    }

    if (sb.current.pinchingObjectModified) { saveState(); sb.current.pinchingObjectModified = false; }

        if (sb.current.activePointers.size === 0) {
            // כל האצבעות עלו — עכשיו בודקים טאפ

            // ביטול וביצוע חוזר מטופלים במעקב המחוות הגלובלי, שסופר גם אצבעות שנוגעות בסרגל

            // מאפסים הכל רק אחרי הבדיקה
            sb.current.isPanning = false; setPanCursor(false); endViewGesture();
            sb.current.multiTouchStartTime = null;
            sb.current.multiTouchMoved = false;
            sb.current.multiTouchMaxFingers = 0;
            sb.current.multiTouchInitialPositions = new Map();
            sb.current.activePointers.clear();
            if (fCanvas.current) fCanvas.current.selection = boxSelectOn();

        } else if (sb.current.activePointers.size < 2) {
            // נשארה אצבע אחת — עוצרים פאן אבל שומרים את מידע הטאפ!
            sb.current.isPanning = false; setPanCursor(false); endViewGesture();
            if (fCanvas.current) fCanvas.current.selection = boxSelectOn();
        }
    };


 const handleContextMenuAction = (clientX, clientY) => {
        if (!fCanvas.current) return;
        // getPointer הוסר ב־Fabric 7, והקריאה אליו זרקה שגיאה שהשתיקה את כל
        // תפריט הלחיצה הימנית. החישוב כאן ידני ותואם לכל גרסה.
        const pointer = toScene(clientX, clientY);
        const active = fCanvas.current.getActiveObject();
        let target = null;
        if (active && active.containsPoint(pointer)) target = active;
        const objects = fCanvas.current.getObjects();
        for (let i = objects.length - 1; i >= 0 && !target; i--) {
            if (objects[i].isEditHelper) continue;
            if (objects[i].containsPoint(pointer) || isObjectNearPoint(objects[i], pointer, 6 / fCanvas.current.getZoom())) { target = objects[i]; break; }
        }
        if (target) {
            setContextMenu({ visible: true, x: clientX, y: clientY, target });
            setShowBoardSettings(false); setRevisions(null);
        } else if (sb.current.clipboard) {
            sb.current.menuPoint = { x: clientX, y: clientY };
            setContextMenu({ visible: true, x: clientX, y: clientY, target: null });
            setShowBoardSettings(false); setRevisions(null);
        } else {
            setShowBoardSettings(true);
            setBoardSettingsPos({ x: clientX, y: clientY });
            setContextMenu({ visible: false, x: 0, y: 0, target: null });
        }
    };

    const handleNativeContextMenu = (e) => {
        e.preventDefault();
        // לחיצה ארוכה במגע מעלה גם אירוע contextmenu — הטיימר כבר מטפל בה
        if (sb.current.longPressFired || e.pointerType === 'touch' || e.pointerType === 'pen') return;
        // מערכות מסוימות הופכות הקשה בשתי אצבעות ללחיצה ימנית. זו לא בקשה לתפריט
        if (sb.current.activePointers.size >= 2 || sb.current.multiTouchMaxFingers >= 2 || (e.timeStamp - (sb.current.lastTouchEventAt || -1e9)) < 900) return;
        handleContextMenuAction(e.clientX, e.clientY);
    };

    /** מקום הנחה של אובייקט שנגרר מהפאנל. כל הוספה באותו רגע נוחתת שם ולא במרכז */
    const dropRef = useRef(null);
    const withDrop = (at, fn) => {
        dropRef.current = at && fCanvas.current ? toScene(at.x, at.y) : null;
        try { return fn(); } finally { dropRef.current = null; }
    };

    /**
     * האובייקט שמתחת לנקודה במסך, או null. ב־Fabric 7 הפונקציה findTarget
     * מחזירה תמיד אובייקט מידע ולא את היעד עצמו, ולכן כל בדיקה של "יש משהו
     * מתחת לעט" יצאה חיובית — וזה מה ששבר את הלאסו ואת היציאה מבחירה.
     */
    const objectAt = (clientX, clientY) => {
        if (!fCanvas.current) return null;
        const pt = toScene(clientX, clientY);
        const zoom = fCanvas.current.getZoom();
        const active = fCanvas.current.getActiveObject();
        if (active) {
            const b = active.getBoundingRect();
            const pad = 14 / zoom;
            if (pt.x >= b.left - pad && pt.x <= b.left + b.width + pad && pt.y >= b.top - pad && pt.y <= b.top + b.height + pad) return active;
        }
        const objs = fCanvas.current.getObjects();
        for (let i = objs.length - 1; i >= 0; i--) {
            const o = objs[i];
            if (!o.evented && !o.isEditHelper) continue;
            if (o.containsPoint(pt) || isObjectNearPoint(o, pt, 6 / zoom)) return o;
        }
        return null;
    };

    /** נקודה במסך → נקודה בלוח */
    const toScene = (clientX, clientY) => {
        const rect = viewportRef.current ? viewportRef.current.getBoundingClientRect() : { left: 0, top: 0 };
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        return new fabric.Point((clientX - rect.left - vpt[4]) / zoom, (clientY - rect.top - vpt[5]) / zoom);
    };

    const getStrokeWidth = () => fCanvas.current ? 3 / fCanvas.current.getZoom() : 3;

    const buildLine = (p1, p2, color) => { let l = new fabric.Line([p1.x, p1.y, p2.x, p2.y], { stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', selectable: true, hasControls: true }); l.customType = 'line'; return l; };
    const buildArrow = (start, end, color) => { let angle = Math.atan2(end.y - start.y, end.x - start.x); let headlen = 20; const pathData = `M ${start.x} ${start.y} L ${end.x} ${end.y} L ${end.x - headlen * Math.cos(angle - Math.PI / 6)} ${end.y - headlen * Math.sin(angle - Math.PI / 6)} M ${end.x} ${end.y} L ${end.x - headlen * Math.cos(angle + Math.PI / 6)} ${end.y - headlen * Math.sin(angle + Math.PI / 6)}`; let p = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true }); p.customType = 'arrow'; return p; };
    const buildCurve = (start, cp, end, color) => { const pathData = `M ${start.x} ${start.y} Q ${cp.x} ${cp.y} ${end.x} ${end.y}`; let p = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', selectable: true }); p.customType = 'curve'; return p; };

    // ← פונקציה חדשה שקושרת את הצורה לעיגולים הכחולים ומאפשרת לגרור את כולה
    const bindShapeEvents = (shape) => {
        shape.set({
            selectable: true, evented: true, hasControls: false, hasBorders: false,
            opacity: 0.5 * (sb.current.editOpacity ?? 1), lockRotation: true, lockScalingX: true, lockScalingY: true
        });

        shape.off('mousedown'); shape.off('mouseup'); shape.off('moving'); shape.off('modified');

        shape.on('mousedown', () => { sb.current.isSelectingShape = true; });
        shape.on('mouseup', () => { sb.current.isSelectingShape = false; });

        let lastLeft = shape.left;
        let lastTop = shape.top;

        shape.on('moving', () => {
            const dx = shape.left - lastLeft;
            const dy = shape.top - lastTop;
            sb.current.editCircles.forEach(c => {
                c.set({ left: c.left + dx, top: c.top + dy });
                c.setCoords();
            });
            lastLeft = shape.left;
            lastTop = shape.top;
        });

        shape.on('modified', () => { saveState(); });
    };

    const exitNodeEditMode = () => {
        if (sb.current.editCircles.length > 0) {
            sb.current.editCircles.forEach(c => fCanvas.current.remove(c)); sb.current.editCircles = [];
            if (sb.current.editingOriginalObj) {
 sb.current.editingOriginalObj.set({
                    opacity: sb.current.editOpacity ?? 1, selectable: true, evented: true, hasControls: true,
                    lockRotation: false, lockScalingX: false, lockScalingY: false
                });

                sb.current.editingOriginalObj.off('mousedown');
                sb.current.editingOriginalObj.off('mouseup');
                sb.current.editingOriginalObj.off('moving');
                sb.current.editingOriginalObj.off('modified');

                fCanvas.current.discardActiveObject();
                sb.current.editingOriginalObj = null;
            }
            fCanvas.current.requestRenderAll();
        }
    };

   const enterNodeEditMode = (obj) => {
        sb.current.isEnteringNodeEdit = true;
        exitNodeEditMode();
        sb.current.editingOriginalObj = obj;
        // האטימות המקורית נשמרת בצד — מדגיש שקוף לא יחזור אטום אחרי עריכה
        sb.current.editOpacity = obj.opacity ?? 1;

        bindShapeEvents(obj); // מפעיל את הגרירה החכמה על הצורה
        fCanvas.current.setActiveObject(obj); // משאיר את הצורה פעילה כך שנוכל לגרור אותה מיד

        const color = obj.stroke;
        const m = obj.calcTransformMatrix();
        const getAbs = (p) => fabric.util.transformPoint({
            x: p.x - (obj.pathOffset ? obj.pathOffset.x : 0),
            y: p.y - (obj.pathOffset ? obj.pathOffset.y : 0)
        }, m);

        const makeNode = (x, y, onDrag) => {
            const currentZoom = fCanvas.current.getZoom();
            const circle = new fabric.Circle({
                left: x, top: y, originX: 'center', originY: 'center',
                radius: 10 / currentZoom, fill: '#3b82f6', stroke: '#ffffff',
                strokeWidth: 2 / currentZoom, hasControls: false, hasBorders: false, selectable: true,
                // בלי שתי אלה העיגולים הכחולים נשמרים לקובץ והופכים לנקודות קבועות
                excludeFromExport: true, isEditHelper: true,
            });
            circle.on('mousedown', () => { sb.current.isSelectingEditCircle = true; });
            circle.on('mouseup', () => { sb.current.isSelectingEditCircle = false; });
            circle.on('moving', () => { onDrag(circle); fCanvas.current.requestRenderAll(); });
            circle.on('modified', () => { saveState(); });
            fCanvas.current.add(circle);
            sb.current.editCircles.push(circle);
            return circle;
        };

        // 1. טיפול בכל צורה שיש לה נקודות
        if (obj.points) {
            const nodes = [];
            obj.points.forEach((p) => {
                const absP = getAbs(p);
                const n = makeNode(absP.x, absP.y, () => {
                    const absolutePoints = nodes.map(nd => ({ x: nd.left, y: nd.top }));
                    const props = {
                        fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth,
                        strokeLineJoin: 'round', strokeLineCap: 'round', customType: obj.customType,
                    };
                    // שרשרת קטעים פתוחה לא נסגרת בגרירה, בשונה ממצולע
                    updateNodeGeometry(obj.customType === 'polyline'
                        ? new fabric.Polyline(absolutePoints, props)
                        : new fabric.Polygon(absolutePoints, props));
                });
                nodes.push(n);
            });
        }
        // 2. מלבנים
        else if (obj.customType === 'rect') {
            const tl = obj.getPointByOrigin('left', 'top'); const br = obj.getPointByOrigin('right', 'bottom');
            const tlN = makeNode(tl.x, tl.y, (c) => {
                const nL = Math.min(c.left, brN.left), nT = Math.min(c.top, brN.top);
                trN.set({ left: Math.max(c.left, brN.left), top: Math.min(c.top, brN.top) }); trN.setCoords();
                blN.set({ left: Math.min(c.left, brN.left), top: Math.max(c.top, brN.top) }); blN.setCoords();
                updateNodeGeometry(new fabric.Rect({ originX: 'left', originY: 'top', left: nL, top: nT, width: Math.abs(brN.left - c.left), height: Math.abs(brN.top - c.top), fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'rect' }));
            });
            const trN = makeNode(br.x, tl.y, (c) => {
                const nL = Math.min(blN.left, c.left), nT = Math.min(c.top, blN.top);
                tlN.set({ left: Math.min(c.left, blN.left), top: Math.min(c.top, blN.top) }); tlN.setCoords();
                brN.set({ left: Math.max(c.left, blN.left), top: Math.max(c.top, blN.top) }); brN.setCoords();
                updateNodeGeometry(new fabric.Rect({ originX: 'left', originY: 'top', left: nL, top: nT, width: Math.abs(c.left - blN.left), height: Math.abs(blN.top - c.top), fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'rect' }));
            });
            const brN = makeNode(br.x, br.y, (c) => {
                const nL = Math.min(tlN.left, c.left), nT = Math.min(tlN.top, c.top);
                trN.set({ left: Math.max(c.left, tlN.left), top: Math.min(c.top, tlN.top) }); trN.setCoords();
                blN.set({ left: Math.min(c.left, tlN.left), top: Math.max(c.top, tlN.top) }); blN.setCoords();
                updateNodeGeometry(new fabric.Rect({ originX: 'left', originY: 'top', left: nL, top: nT, width: Math.abs(c.left - tlN.left), height: Math.abs(c.top - tlN.top), fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'rect' }));
            });
            const blN = makeNode(tl.x, br.y, (c) => {
                const nL = Math.min(c.left, trN.left), nT = Math.min(trN.top, c.top);
                tlN.set({ left: Math.min(c.left, trN.left), top: Math.min(c.top, trN.top) }); tlN.setCoords();
                brN.set({ left: Math.max(c.left, trN.left), top: Math.max(c.top, trN.top) }); brN.setCoords();
                updateNodeGeometry(new fabric.Rect({ originX: 'left', originY: 'top', left: nL, top: nT, width: Math.abs(trN.left - c.left), height: Math.abs(c.top - trN.top), fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'rect' }));
            });
        }
        // 3. אליפסות
        else if (obj.customType === 'ellipse') {
            // הידיות נעות לאורך צירי האליפסה עצמה, ולכן גם אליפסה מוטה
            // נערכת נכון. הגרסה הקודמת הניחה תמיד צירים מאונכים למסך.
            const center = obj.getPointByOrigin('center', 'center');
            const angle = ((obj.angle || 0) * Math.PI) / 180;
            const uAxis = { x: Math.cos(angle), y: Math.sin(angle) };
            const vAxis = { x: -Math.sin(angle), y: Math.cos(angle) };
            let rx = Math.max(1, obj.rx * (obj.scaleX || 1));
            let ry = Math.max(1, obj.ry * (obj.scaleY || 1));
            const along = (axis, r) => ({ x: center.x + axis.x * r, y: center.y + axis.y * r });
            const project = (node, axis) => Math.max(1, Math.abs((node.left - center.x) * axis.x + (node.top - center.y) * axis.y));
            const rebuild = () => updateNodeGeometry(new fabric.Ellipse({
                originX: 'center', originY: 'center', left: center.x, top: center.y,
                rx, ry, angle: obj.angle || 0,
                fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'ellipse',
            }));
            const place = (node, axis, r) => { const q = along(axis, r); node.set({ left: q.x, top: q.y }); node.setCoords(); };

            const pR = along(uAxis, rx), pL = along(uAxis, -rx);
            const pB = along(vAxis, ry), pT = along(vAxis, -ry);
            const rN = makeNode(pR.x, pR.y, (c) => { rx = project(c, uAxis); place(lN, uAxis, -rx); rebuild(); });
            const lN = makeNode(pL.x, pL.y, (c) => { rx = project(c, uAxis); place(rN, uAxis, rx); rebuild(); });
            const bN = makeNode(pB.x, pB.y, (c) => { ry = project(c, vAxis); place(tN, vAxis, -ry); rebuild(); });
            const tN = makeNode(pT.x, pT.y, (c) => { ry = project(c, vAxis); place(bN, vAxis, ry); rebuild(); });
        }
        // 4. פרבולות
        else if (obj.customType === 'curve' && obj.path) {
            const pStart = getAbs({x: obj.path[0][1], y: obj.path[0][2]});
            const pCp = getAbs({x: obj.path[1][1], y: obj.path[1][2]});
            const pEnd = getAbs({x: obj.path[1][3], y: obj.path[1][4]});

            const sN = makeNode(pStart.x, pStart.y, (c) => updateNodeGeometry(buildCurve({x: c.left, y: c.top}, {x: cpN.left, y: cpN.top}, {x: eN.left, y: eN.top}, color)));
            const cpN = makeNode(pCp.x, pCp.y, (c) => updateNodeGeometry(buildCurve({x: sN.left, y: sN.top}, {x: c.left, y: c.top}, {x: eN.left, y: eN.top}, color)));
            const eN = makeNode(pEnd.x, pEnd.y, (c) => updateNodeGeometry(buildCurve({x: sN.left, y: sN.top}, {x: cpN.left, y: cpN.top}, {x: c.left, y: c.top}, color)));
        }
        // 5. חצים
        else if (obj.customType === 'arrow' && obj.path) {
            const pStart = getAbs({x: obj.path[0][1], y: obj.path[0][2]});
            const pEnd = getAbs({x: obj.path[1][1], y: obj.path[1][2]});

            const sN = makeNode(pStart.x, pStart.y, (c) => updateNodeGeometry(buildArrow({x: c.left, y: c.top}, {x: eN.left, y: eN.top}, color)));
            const eN = makeNode(pEnd.x, pEnd.y, (c) => updateNodeGeometry(buildArrow({x: sN.left, y: sN.top}, {x: c.left, y: c.top}, color)));
        }
        // 6. קווים
        else if (obj.customType === 'line') {
            const pts = obj.calcLinePoints();
            const p1 = fabric.util.transformPoint({ x: pts.x1, y: pts.y1 }, m);
            const p2 = fabric.util.transformPoint({ x: pts.x2, y: pts.y2 }, m);

            const sN = makeNode(p1.x, p1.y, (c) => updateNodeGeometry(buildLine({x: c.left, y: c.top}, {x: eN.left, y: eN.top}, color)));
            const eN = makeNode(p2.x, p2.y, (c) => updateNodeGeometry(buildLine({x: sN.left, y: sN.top}, {x: c.left, y: c.top}, color)));
        }

        fCanvas.current.requestRenderAll();
        sb.current.isEnteringNodeEdit = false;
    };

 const updateNodeGeometry = (newObj) => {
        const obj = sb.current.editingOriginalObj;
        // הצורה החדשה יורשת את המראה של המקורית: עובי, קווקוו, סוג העט וחוט
        if (obj) {
            newObj.set({ strokeWidth: obj.strokeWidth, strokeDashArray: obj.strokeDashArray || null });
            for (const k of ['dashStyle', 'penKind', 'wire', 'recTime', 'recId']) if (obj[k] !== undefined) newObj[k] = obj[k];
            if (obj.customType === 'arrow' && obj.headLength) newObj.headLength = obj.headLength;
        }
        const at = obj ? fCanvas.current.getObjects().indexOf(obj) : -1;
        fCanvas.current.remove(obj);

        bindShapeEvents(newObj); // חיבור מחדש של אירועי הגרירה לצורה החדשה

        // באותו מקום בערימה, כדי שעריכת קודקוד לא תקפיץ צורה מעל הכתב
        if (at >= 0) fCanvas.current.insertAt(at, newObj); else fCanvas.current.add(newObj);

        // הפתרון לקפיצות: להבטיח שהעיגולים הכחולים תמיד נשארים השכבה העליונה ביותר!
        // ברגע שהצורה החדשה נוצרה, נוודא שהיא לא מסתירה אותם וגונבת את הלחיצה.
        sb.current.editCircles.forEach(c => {
            if (typeof c.bringToFront === 'function') c.bringToFront();
            else if (typeof fCanvas.current.bringObjectToFront === 'function') fCanvas.current.bringObjectToFront(c);

            c.setCoords(); // קריטי: מעדכן את תיבת הלחיצה הבלתי נראית של העיגול כדי שהעכבר יזהה אותו
        });

        sb.current.editingOriginalObj = newObj;
    };


    const autosaveTimerRef = useRef(null);

    /* ── כפתור הצד של העט ──────────────────────────────────────────
       משיכה שמתחילה כשהכפתור לחוץ מנותבת לכלי שהמשתמש בחר לכפתור, רק לזמן
       המשיכה. ההחלפה נעשית ישירות ב־ref ולא דרך setMode, כי עדכון מצב של
       React מגיע רק אחרי שהמשיכה כבר התחילה בכלי הקודם. */

    /** מדגיש זמני בצבע הנוכחי, עם העובי והשקיפות שהמשתמש קבע למדגיש */
    const highlighterPen = () => {
        const hp = buildPens({ ...loadPenState(), extras: [] }).find((p) => p.kind === 'highlighter');
        return { ...hp, color: penRef.current?.color };
    };

    const penOverrideStart = (action) => {
        const prev = { mode: modeRef.current, pen: penRef.current, eraser: eraserRef.current };
        sb.current.penOverride = prev;
        let next = null;
        if (action === 'erase' || action === 'erase-stroke') {
            next = 'erase';
            eraserRef.current = { ...(eraserRef.current || {}), mode: action === 'erase' ? 'pixel' : 'stroke', highlighterOnly: false };
        } else if (action === 'highlighter') {
            next = 'draw';
            penRef.current = highlighterPen();
        } else if (action === 'laser') {
            next = 'laser';
        }
        if (next) {
            modeRef.current = next;
            if (next !== prev.mode) setMode(next);
        }
    };

    const penOverrideEnd = () => {
        const prev = sb.current.penOverride;
        if (!prev) return;
        sb.current.penOverride = null;
        penRef.current = prev.pen;
        eraserRef.current = prev.eraser;
        if (modeRef.current !== prev.mode) {
            modeRef.current = prev.mode;
            setMode(prev.mode);
        }
    };

    /**
     * המשיכה שכבר התחילה עוברת לכלי של כפתור הצד: מה שצויר עד עכשיו נמחק,
     * והמשיכה ממשיכה בכלי של הכפתור מהנקודה שבה העט נגע במסך.
     */
    const switchStrokeToButton = (e) => {
        clearTimeout(sb.current.snapTimeout); clearTimeout(sb.current.perfectTimer);
        if (sb.current.liveObj) { fCanvas.current.remove(sb.current.liveObj); sb.current.liveObj = null; }
        const id = sb.current.drawPointerId ?? e.pointerId;
        sb.current.drawing = false; sb.current.drawPointerId = null; sb.current.points = []; sb.current.inkStroke = null; sb.current.hasSnapped = false;
        clearLiveCanvas(); setInking(false);
        const action = devicePrefsRef.current.penButton;
        sb.current.penSession = { id, action, inContact: false, done: false };
        if (sb.current.penDebug) setPenLog((l) => [`>>> כפתור זוהה: ${action}`, ...l].slice(0, 14));
        penContactStart(e);
    };

    /**
     * ב־Chrome באנדרואיד כפתור הצד של העט מדווח לדף כמו מגע רגיל (buttons=1),
     * אבל כשהעט נוגע במסך והכפתור לחוץ, Chrome מפעיל מיד "לחיצה ארוכה" ושולח
     * contextmenu כבר בתזוזה הראשונה. לחיצה ארוכה אמיתית מגיעה רק אחרי חצי
     * שנייה, ולכן contextmenu שמגיע מהר אחרי תחילת המשיכה הוא הכפתור.
     */
    const penButtonFromContextMenu = (e) => {
        if (devicePrefsRef.current.penButton === 'none' || sb.current.penSession) return false;
        // המשיכה עדיין נמשכת: עוברים לכלי של הכפתור מהנקודה שבה העט נגע
        if (sb.current.drawing && sb.current.drawPointerId != null) {
            if (modeRef.current !== 'draw' && modeRef.current !== 'erase') return false;
            // לחיצה ארוכה רגילה, בלי כפתור, מגיעה רק אחרי כ־400ms של עט שעומד במקום
            if (e.timeStamp - (sb.current.strokeStartAt ?? -1e9) > 320) return false;
            const at = sb.current.strokeStart || { x: e.clientX, y: e.clientY };
            switchStrokeToButton({
                clientX: at.x, clientY: at.y, pointerId: sb.current.drawPointerId, pointerType: 'pen',
                pressure: 0.5, buttons: 1, button: -1, tiltX: 0, tiltY: 0, timeStamp: e.timeStamp,
                target: drawingCanvasRef.current, shiftKey: false,
            });
            return true;
        }
        // העט כבר הורם: הכפתור מוחל על המשיכה שזה עתה נכתבה
        const ls = sb.current.lastStroke;
        if (ls && !ls.handled && e.timeStamp - ls.endAt < 700 && e.timeStamp - ls.startAt < 1500) {
            ls.handled = true;
            applyButtonToFinishedStroke(ls);
            return true;
        }
        return false;
    };

    /** מחיל את פעולת הכפתור על משיכה שכבר הסתיימה: היא נמחקת, ובמקומה מתבצעת הפעולה לאורך המסלול שלה */
    const applyButtonToFinishedStroke = (ls) => {
        const canvas = fCanvas.current;
        if (!canvas) return;
        const action = devicePrefsRef.current.penButton;
        if (sb.current.penDebug) setPenLog((l) => [`>>> כפתור זוהה אחרי ההרמה: ${action}`, ...l].slice(0, 14));
        if (action === 'undo') { undo(); setTimeout(() => undo(), 90); return; }
        ls.objs.forEach((o) => canvas.remove(o));
        const pts = ls.points;
        if ((action === 'erase' || action === 'erase-stroke') && pts.length) {
            const saved = eraserRef.current;
            eraserRef.current = { ...(saved || {}), mode: action === 'erase' ? 'pixel' : 'stroke', highlighterOnly: false };
            const r = (eraserRef.current.size || 16) / 2 / canvas.getZoom();
            const segs = pts.length === 1 ? [{ a: pts[0], b: pts[0] }] : pts.slice(1).map((q, i) => ({ a: pts[i], b: q }));
            eraseAlong(segs, r);
            eraserRef.current = saved;
        } else if (action === 'select' && pts.length > 2) {
            selectInsideLasso(pts);
            if (canvas.getActiveObject()) {
                if (modeRef.current !== 'select') { modeRef.current = 'select'; setMode('select'); }
                sb.current.wasAutoSelected = true;
            }
        } else if (action === 'menu' && ls.screenEnd) {
            handleContextMenuAction(ls.screenEnd.x, ls.screenEnd.y);
        }
        canvas.requestRenderAll();
        saveState();
    };

    const penButtonFromContextMenuRef = useRef(() => false);
    useEffect(() => { penButtonFromContextMenuRef.current = penButtonFromContextMenu; });

    /** העט נגע במסך כשהכפתור לחוץ */
    const penContactStart = (e) => {
        const ps = sb.current.penSession;
        if (!ps || ps.done) return;
        ps.inContact = true;
        if (ps.action === 'undo') { ps.done = true; undo(); try { navigator.vibrate?.(8); } catch { /* אין רטט */ } return; }
        if (ps.action === 'menu') { ps.done = true; handleContextMenuAction(e.clientX, e.clientY); return; }
        if (ps.action === 'select') {
            if (sb.current.editCircles.length > 0) exitNodeEditMode();
            fCanvas.current?.discardActiveObject();
            lassoBegin(e.clientX, e.clientY);
            return;
        }
        penOverrideStart(ps.action);
        handlePointerDown(e);
    };

    const penContactMove = (e) => {
        const ps = sb.current.penSession;
        if (!ps || !ps.inContact || ps.done) return;
        if (ps.action === 'select') lassoMove(e.clientX, e.clientY);
        else handlePointerMove(e);
    };

    const penContactEnd = (e) => {
        const ps = sb.current.penSession;
        if (!ps) return;
        ps.inContact = false;
        if (ps.done) return;
        if (ps.action === 'select') {
            const lasso = lassoEnd();
            if (!lasso || !lasso.moved) return;
            selectInsideLasso(lasso.scene);
            if (fCanvas.current?.getActiveObject()) {
                // הבחירה נשארת פעילה להזזה. הקשה על מקום ריק מחזירה לכלי הקודם
                if (modeRef.current !== 'select') { modeRef.current = 'select'; setMode('select'); }
                sb.current.wasAutoSelected = true;
            }
            return;
        }
        handlePointerUp(e);
        penOverrideEnd();
    };

    /** עיגול המחק מתחת לעט המרחף, פעם אחת לכל פריים */
    const schedulePenHover = (e) => {
        sb.current.hoverPt = getCanvasCoords(e.clientX, e.clientY);
        if (sb.current.hoverFrame) return;
        sb.current.hoverFrame = requestAnimationFrame(() => {
            sb.current.hoverFrame = null;
            const pt = sb.current.hoverPt;
            if (!pt || sb.current.drawing || modeRef.current !== 'erase') return;
            paintEraserCursor(pt.screenX, pt.screenY);
        });
    };

    const handleViewportPointerLeave = (e) => {
        if (e.pointerType !== 'pen' || sb.current.drawing) return;
        sb.current.hoverPt = null;
        if (modeRef.current === 'erase') clearLiveCanvas();
    };

    // עיגול מחק שנשאר מהריחוף נמחק כשעוברים לכלי אחר
    useEffect(() => {
        if (mode !== 'erase' && !sb.current.drawing && !sb.current.lasso && drawingCanvasRef.current) {
            const cvs = drawingCanvasRef.current;
            cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
        }
    }, [mode]);

    const captureState = () => {
        if (!fCanvas.current || !mathLayerRef.current) return null;
        const mathData = Array.from(mathLayerRef.current.children).map(wrapper => {
            const ta = wrapper.querySelector('textarea');
            if (ta) {
                return {
                    kind: 'text', left: wrapper.style.left, top: wrapper.style.top,
                    value: ta.value, size: ta.style.fontSize || '32px',
                    color: ta.style.color || '#f5f5f5', width: wrapper.style.width || '340px',
                };
            }
            const mf = wrapper.querySelector('math-field');
            return { kind: 'math', left: wrapper.style.left, top: wrapper.style.top, value: mf ? mf.getValue() : '', size: mf ? mf.style.fontSize : '48px', color: mf ? mf.style.color : '#fff' };
        });
        // הצורה שנמצאת בעריכת קודקודים מוצגת חצי שקופה ונעולה. המצב הזמני
        // הזה נשמר בעבר לקובץ, ולכן צורות נטענו שקופות ובלתי ניתנות לבחירה.
        const edited = sb.current.editingOriginalObj;
        const editLook = edited ? {
            opacity: edited.opacity, selectable: edited.selectable, evented: edited.evented,
            hasControls: edited.hasControls, hasBorders: edited.hasBorders,
            lockRotation: edited.lockRotation, lockScalingX: edited.lockScalingX, lockScalingY: edited.lockScalingY,
        } : null;
        if (edited) edited.set({
            opacity: sb.current.editOpacity ?? 1, selectable: true, evented: true, hasControls: true, hasBorders: true,
            lockRotation: false, lockScalingX: false, lockScalingY: false,
        });
        const state = { fabric: fCanvas.current.toObject(EXTRA_PROPS), math: mathData };
        if (edited && editLook) edited.set(editLook);
        return state;
    };

    const flushHistory = () => {
        if (sb.current.idleHandle !== null && sb.current.idleHandle !== undefined) {
            if (sb.current.idleKind === 'idle' && typeof cancelIdleCallback === 'function') cancelIdleCallback(sb.current.idleHandle);
            else clearTimeout(sb.current.idleHandle);
            sb.current.idleHandle = null;
        }
        if (!sb.current.pendingSave) return;
        sb.current.pendingSave = false;
        const state = captureState();
        if (!state) return;
        const json = JSON.stringify(state);
        sb.current.lastState = state;
        if (sb.current.historyStack[sb.current.historyStack.length - 1] === json) return;
        sb.current.historyStack.push(json);
        sb.current.historyBytes = (sb.current.historyBytes || 0) + json.length;
        while (sb.current.historyStack.length > HISTORY_MAX_STEPS
            || (sb.current.historyBytes > HISTORY_MAX_CHARS && sb.current.historyStack.length > 2)) {
            sb.current.historyBytes -= sb.current.historyStack.shift().length;
        }
    };

    const scheduleHistory = () => {
        if (sb.current.pendingSave) return;
        sb.current.pendingSave = true;
        const run = () => { sb.current.idleHandle = null; flushHistory(); };
        if (typeof requestIdleCallback === 'function') {
            sb.current.idleKind = 'idle';
            sb.current.idleHandle = requestIdleCallback(run, { timeout: 700 });
        } else {
            sb.current.idleKind = 'timeout';
            sb.current.idleHandle = setTimeout(run, 120);
        }
    };

    /**
     * הגדרות הלוח שנשמרות עם התוכן. נקראות מ־refs ולא מהמצב של הרינדור:
     * saveState נקרא גם ממאזינים שנרשמו פעם אחת, למשל בתיבות נוסחה ובקיצורי
     * המקלדת, ושם הערכים מהרינדור הראשון היו דורסים צבע לוח שהשתנה מאז.
     */
    const boardMeta = () => ({
        bg: boardColorRef.current, pattern: boardPatternTypeRef.current,
        autoSnap: autoSnapRef.current, pressureInk: pressureInkRef.current, snapLevel: snapLevelRef.current,
    });

    const saveState = () => {
        if (!fCanvas.current || sb.current.isLocked || !mathLayerRef.current) return;
        sb.current.redoStack = [];
        scheduleHistory();
        if (onAutoSave) {
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = setTimeout(() => {
                flushHistory();
                const state = sb.current.lastState;
                if (!state) return;
                Promise.resolve(onAutoSave({ fabric: state.fabric, math: state.math, ...boardMeta() })).then((res) => {
                    if (res && res.ok === false) {
                        showToast(res.reason === 'quota'
                            ? 'האחסון המקומי מלא. כדאי לחבר את הלוח לגוגל דרייב.'
                            : 'השמירה האוטומטית נכשלה, והגרסה הקודמת נשמרה.', 'error');
                    }
                });
            }, 1500); // מחכה 1.5 שניות של חוסר פעילות לפני כתיבה למסד הנתונים
        }
    };

    const flushNow = () => {
        if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; }
        flushHistory();
        if (onAutoSave && sb.current.lastState) {
            onAutoSave({ fabric: sb.current.lastState.fabric, math: sb.current.lastState.math, ...boardMeta() });
        }
    };
    const flushNowRef = useRef(flushNow);
    useEffect(() => { flushNowRef.current = flushNow; });
    useEffect(() => {
        const onHide = () => { if (document.visibilityState === 'hidden') flushNowRef.current(); };
        const onPageHide = () => flushNowRef.current();
        document.addEventListener('visibilitychange', onHide);
        window.addEventListener('pagehide', onPageHide);
        return () => {
            document.removeEventListener('visibilitychange', onHide);
            window.removeEventListener('pagehide', onPageHide);
            flushNowRef.current();
        };
    }, []);

    // ─────────────────────────────────────────────────────────────────
    //  הקלטה מסונכרנת לדיו
    // ─────────────────────────────────────────────────────────────────

    /** מציג את כל האובייקטים במלוא האטימות, בסיום נגינה או בעצירה */
    const clearPlaybackDimming = () => {
        if (!fCanvas.current) return;
        let touched = false;
        fCanvas.current.getObjects().forEach((obj) => {
            if (obj.playDimmed) {
                obj.set({ opacity: obj.playOpacity === undefined ? 1 : obj.playOpacity });
                delete obj.playDimmed;
                delete obj.playOpacity;
                touched = true;
            }
        });
        if (touched) fCanvas.current.requestRenderAll();
    };

    /**
     * מעמעם את מה שנכתב אחרי הרגע הנוכחי בהקלטה, כך שהלוח נראה כפי שנראה
     * באותו רגע. זו גרסה חסכונית של "צפייה בכתיבה מתרחשת", בלי לשכתב
     * את מנוע הרינדור.
     */
    const applyPlaybackDimming = (ms, recId) => {
        if (!fCanvas.current) return;
        let touched = false;
        fCanvas.current.getObjects().forEach((obj) => {
            if (obj.isEditHelper) return;
            const stamped = obj.recId === recId && typeof obj.recTime === 'number';
            const future = stamped && obj.recTime > ms;
            if (future && !obj.playDimmed) {
                obj.playDimmed = true;
                obj.playOpacity = obj.opacity === undefined ? 1 : obj.opacity;
                obj.set({ opacity: 0.18 });
                touched = true;
            } else if (!future && obj.playDimmed) {
                obj.set({ opacity: obj.playOpacity === undefined ? 1 : obj.playOpacity });
                delete obj.playDimmed;
                delete obj.playOpacity;
                touched = true;
            }
        });
        if (touched) fCanvas.current.requestRenderAll();
    };

    /* המסך נשאר דולק רק בזמן הקלטה. כיבוי מסך באמצע שיעור עוצר את המיקרופון
       בחלק מהמכשירים, אבל בכל זמן אחר נעילה כזו רק מבזבזת סוללה */
    const acquireWakeLock = async () => {
        if (sb.current.wakeLock || !navigator.wakeLock?.request) return;
        try {
            const lock = await navigator.wakeLock.request('screen');
            sb.current.wakeLock = lock;
            lock.addEventListener?.('release', () => { if (sb.current.wakeLock === lock) sb.current.wakeLock = null; });
        } catch { /* נדחה, למשל במצב חיסכון בסוללה */ }
    };
    const releaseWakeLock = () => {
        const lock = sb.current.wakeLock;
        sb.current.wakeLock = null;
        if (lock) lock.release().catch(() => {});
    };
    // הדפדפן משחרר את הנעילה כשהלשונית מוסתרת. בחזרה אליה, אם עדיין מקליטים, היא נלקחת שוב
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible' && sb.current.recorder && sb.current.recorder.status !== 'idle') acquireWakeLock();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);

    const startRecording = async () => {
        if (!isRecordingSupported()) { showToast('הדפדפן הזה לא תומך בהקלטה', 'warn'); return; }
        if (!driveIsConnected()) { showToast('צריך לחבר את גוגל דרייב לפני הקלטה', 'warn'); return; }
        stopPlayback();
        sb.current.recorder = createRecorder();
        const res = await sb.current.recorder.start();
        if (!res.ok) {
            sb.current.recorder = null;
            const texts = {
                denied: 'הגישה למיקרופון נדחתה. אפשר לאשר אותה בהגדרות הדפדפן.',
                'no-mic': 'לא נמצא מיקרופון',
                unsupported: 'הדפדפן הזה לא תומך בהקלטה',
                busy: 'הקלטה כבר פועלת',
            };
            showToast(texts[res.reason] || 'ההקלטה לא התחילה', 'warn');
            return;
        }
        sb.current.activeRecordingId = newRecordingId();
        acquireWakeLock();
        setRecStatus('recording');
        setRecElapsed(0);
        if (sb.current.recTimer) clearInterval(sb.current.recTimer);
        sb.current.recTimer = setInterval(() => {
            if (sb.current.recorder) setRecElapsed(sb.current.recorder.elapsed());
        }, 500);
        showToast('מקליט. כל מה שתכתוב יקבל חותמת זמן');
    };

    const pauseRecording = () => { if (sb.current.recorder?.pause()) setRecStatus('paused'); };
    const resumeRecording = () => { if (sb.current.recorder?.resume()) setRecStatus('recording'); };

    const stopRecording = async () => {
        const rec = sb.current.recorder;
        if (!rec) return;
        if (sb.current.recTimer) { clearInterval(sb.current.recTimer); sb.current.recTimer = null; }
        releaseWakeLock();
        setRecStatus('uploading');
        const result = await rec.stop();
        sb.current.recorder = null;
        const recId = sb.current.activeRecordingId;
        sb.current.activeRecordingId = null;

        if (!result || !result.blob || result.blob.size === 0) {
            setRecStatus('idle');
            showToast('ההקלטה יצאה ריקה ולא נשמרה', 'warn');
            return;
        }

        try {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const file = await uploadRecording(projectId, result.blob, {
                name: `${stamp}.webm`,
                mimeType: result.mimeType,
            });
            const entry = {
                id: recId,
                fileId: file.id,
                mimeType: result.mimeType,
                duration: result.duration,
                createdAt: Date.now(),
            };
            const next = [entry, ...recordings];
            setRecordings(next);
            setRecStatus('idle');
            // רק המזהה נשמר במכשיר. השמע עצמו נשאר בדרייב.
            if (onAutoSave) onAutoSave({ recordings: next });
            saveState();
            showToast('ההקלטה נשמרה בדרייב');
        } catch {
            setRecStatus('idle');
            showToast('ההעלאה לדרייב נכשלה. ההקלטה לא נשמרה.', 'warn');
        }
    };

    const stopPlayback = () => {
        if (sb.current.playTimer) { clearInterval(sb.current.playTimer); sb.current.playTimer = null; }
        if (sb.current.audioEl) {
            try { sb.current.audioEl.pause(); } catch { /* כבר עצר */ }
            if (sb.current.audioEl.src?.startsWith('blob:')) URL.revokeObjectURL(sb.current.audioEl.src);
            sb.current.audioEl = null;
        }
        clearPlaybackDimming();
        setPlaying(null);
        setPlayhead(0);
        setPlayDuration(0);
    };

    const playRecording = async (entry) => {
        stopPlayback();
        showToast('טוען את ההקלטה מהדרייב…');
        let blob;
        try { blob = await downloadFile(entry.fileId); }
        catch { showToast('לא הצלחתי להוריד את ההקלטה מהדרייב', 'warn'); return; }

        const audio = new Audio(URL.createObjectURL(blob));
        sb.current.audioEl = audio;
        setPlaying(entry);
        setPlayDuration(entry.duration || 0);
        audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) setPlayDuration(audio.duration * 1000);
        });
        audio.addEventListener('ended', () => stopPlayback());
        try { await audio.play(); }
        catch { showToast('הדפדפן חסם את הניגון. נסה שוב בלחיצה.', 'warn'); }

        sb.current.playTimer = setInterval(() => {
            if (!sb.current.audioEl) return;
            const ms = sb.current.audioEl.currentTime * 1000;
            setPlayhead(ms);
            applyPlaybackDimming(ms, entry.id);
        }, 250);
        applyPlaybackDimming(0, entry.id);
    };

    const seekPlayback = (ms) => {
        if (!sb.current.audioEl) return;
        sb.current.audioEl.currentTime = Math.max(0, ms / 1000);
        setPlayhead(ms);
        if (playing) applyPlaybackDimming(ms, playing.id);
    };

    const deleteRecording = async (entry) => {
        if (playing && playing.id === entry.id) stopPlayback();
        const next = recordings.filter((r) => r.id !== entry.id);
        setRecordings(next);
        if (onAutoSave) onAutoSave({ recordings: next });
        // מחיקה מהדרייב היא ניסיון בלבד. גם אם היא נכשלת הרשומה כבר ירדה.
        try { await deleteFile(entry.fileId); } catch { /* הקובץ כבר לא שם */ }
        showToast('ההקלטה נמחקה');
    };

    /** קפיצה בהקלטה אל הרגע שבו נכתב האובייקט שנלחץ */
    const seekToObject = (obj) => {
        if (!playing || !obj || typeof obj.recTime !== 'number') return false;
        if (obj.recId !== playing.id) return false;
        seekPlayback(obj.recTime);
        showToast('קפצתי לרגע שבו זה נכתב');
        return true;
    };

    const seekToObjectRef = useRef(() => false);
    useEffect(() => { seekToObjectRef.current = seekToObject; });

    /* קיצורי העתקה והדבקה. מוגדרים דרך ref, כי מאזין המקלדת נרשם פעם אחת */
    const keyClipboardRef = useRef(() => {});
    useEffect(() => {
        keyClipboardRef.current = async (e) => {
            if (!fCanvas.current || sb.current.activeBox) return;
            const active = fCanvas.current.getActiveObject();
            if (e.code === 'KeyC' && active) { e.preventDefault(); await copyObject(active); showToast('הועתק'); }
            else if (e.code === 'KeyX' && active) {
                e.preventDefault();
                await copyObject(active);
                const kids = typeOf(active) === 'activeselection' ? active.getObjects() : [active];
                exitNodeEditMode();
                fCanvas.current.discardActiveObject();
                kids.forEach((o) => fCanvas.current.remove(o));
                fCanvas.current.requestRenderAll();
                saveState();
            } else if (e.code === 'KeyD' && active) {
                e.preventDefault();
                const prev = sb.current.clipboard;
                await copyObject(active);
                await pasteAt(null);
                sb.current.clipboard = prev || sb.current.clipboard;
            } else if (e.code === 'KeyV' && sb.current.clipboard) {
                e.preventDefault();
                const lp = sb.current.lastPointer;
                const rect = viewportRef.current?.getBoundingClientRect();
                const inside = lp && rect && lp.x > rect.left && lp.x < rect.right && lp.y > rect.top && lp.y < rect.bottom;
                await pasteAt(inside ? toScene(lp.x, lp.y) : null);
            }
        };
    });

    // ניקוי בסגירת הלוח — מיקרופון פתוח או נגן שממשיך ברקע הם באג מציק
    useEffect(() => () => {
        if (sb.current.recTimer) clearInterval(sb.current.recTimer);
        if (sb.current.playTimer) clearInterval(sb.current.playTimer);
        if (sb.current.recorder) sb.current.recorder.abort();
        if (sb.current.wakeLock) sb.current.wakeLock.release().catch(() => {});
        if (sb.current.audioEl) { try { sb.current.audioEl.pause(); } catch { /* כבר עצר */ } }
    }, []);

    /** טוען את רשימת הגרסאות השמורות ללוח הנוכחי */
    const openRevisions = async () => {
        if (!projectId) { setRevisions([]); return; }
        try { setRevisions(await listRevisions(projectId)); }
        catch { setRevisions([]); }
    };

    /** מחזיר את הלוח לגרסה שמורה. המצב הנוכחי נשמר קודם כגרסה נוספת */
    const applyRevision = async (index) => {
        if (!projectId) return;
        const res = await restoreRevision(projectId, index);
        if (!res || !res.ok) { showToast('לא הצלחתי לשחזר את הגרסה הזו', 'error'); return; }
        sb.current.historyStack = [];
        sb.current.redoStack = [];
        sb.current.historyBytes = 0;
        sb.current.isLocked = true;
        restore({ fabric: res.data.fabric, math: res.data.math });
        if (res.data.bg) setBoardColor(res.data.bg);
        if (res.data.pattern) setBoardPatternType(res.data.pattern);
        setRevisions(null);
        setShowBoardSettings(false);
        showToast('הגרסה שוחזרה. אפשר לחזור אחורה מרשימת הגרסאות');
        // restore משחרר את הנעילה בתוך קריאה אסינכרונית, ולכן הצילום מחכה לה
        setTimeout(() => saveState(), 60);
    };

    const undo = () => {
        flushHistory();
        if (sb.current.historyStack.length <= 1 || sb.current.isLocked) return;
        exitNodeEditMode(); sb.current.isLocked = true;
        const popped = sb.current.historyStack.pop();
        sb.current.historyBytes = Math.max(0, (sb.current.historyBytes || 0) - popped.length);
        sb.current.redoStack.push(popped);
        restore(JSON.parse(sb.current.historyStack[sb.current.historyStack.length - 1]));
    };

    const redo = () => {
        flushHistory();
        if (sb.current.redoStack.length === 0 || sb.current.isLocked) return;
        exitNodeEditMode(); sb.current.isLocked = true; const stateStr = sb.current.redoStack.pop();
        sb.current.historyStack.push(stateStr);
        sb.current.historyBytes = (sb.current.historyBytes || 0) + stateStr.length;
        restore(JSON.parse(stateStr));
    };
    useEffect(() => { gestureActions.current = { undo, redo }; });

const restore = (state) => {
    deactivateBox(false);

    let done = false;
    const finish = () => {
        if (done) return; // מונע הרצה כפולה
        done = true;
        fCanvas.current.requestRenderAll();
        mathLayerRef.current.innerHTML = '';
        (state.math || []).forEach(data => {
            // קבצים ישנים נשמרו בלי kind, והיו כולם שדות מתמטיקה
            mathLayerRef.current.appendChild(
                data.kind === 'text'
                    ? createTextFieldDOM(data.left, data.top, data.value, data.size, data.color, data.width)
                    : createMathFieldDOM(data.left, data.top, data.value, data.size, data.color)
            );
        });
        sb.current.isLocked = false; // ← משחרר את הנעילה!
    };

    // תמיכה בשתי גרסאות של Fabric:
    // v5 = callback, v6 = Promise
    try {
        const result = fCanvas.current.loadFromJSON(state.fabric, finish);
        if (result && typeof result.then === 'function') {
            result.then(finish).catch((err) => { console.error('restore failed', err); finish(); });
        }
    } catch (err) {
        // בלי זה כשל בטעינה משאיר את sb.current.isLocked דלוק והלוח מפסיק להגיב
        console.error('restore failed', err);
        finish();
    }
};

    const getCenterPos = () => {
        if (dropRef.current) return { x: dropRef.current.x, y: dropRef.current.y };
        if (!fCanvas.current) return { x: window.innerWidth/2, y: window.innerHeight/2 };
        const vpt = fCanvas.current.viewportTransform; const zoom = fCanvas.current.getZoom();
        return { x: (-vpt[4] + window.innerWidth / 2) / zoom, y: (-vpt[5] + window.innerHeight / 2) / zoom };
    };

    // ─── התוספת שלנו: פונקציה שמזהה למי מותר לקבל עיגולים כחולים ───
    const isSmartShape = (obj) => {
        if (!obj) return false;
        if (obj.points) return true; // כל המצולעים והכוכבים תומכים בעריכת קודקודים
        const smartTypes = ['rect', 'ellipse', 'curve', 'arrow', 'line'];
        return smartTypes.includes(obj.customType);
    };

    useImperativeHandle(ref, () => ({
        undo, redo,
        toggleRecorder: () => setShowRecorder((v) => !v),
        isRecording: () => recStatus === 'recording' || recStatus === 'paused',
        clearBoard: () => { deactivateBox(false); exitNodeEditMode(); dismissMathInk(); fCanvas.current.clear(); mathLayerRef.current.innerHTML = ''; saveState(); },
        // החישוב עבר ל-Web Worker. קודם הוא רץ בחוט הראשי, וביטוי כבד הקפיא
        // את הלוח לגמרי, בלי שום דרך לבטל.
        solveActiveBox: async () => {
            const box = sb.current.activeBox;
            if (!box) { showToast('בחר קודם את המשוואה שברצונך לפתור', 'warn'); return; }
            if (!isMathBox(box)) { showToast('אפשר לפתור רק תיבת נוסחה, לא טקסט חופשי', 'warn'); return; }

            const plainMath = box.getValue('ascii-math');
            const latexEq = box.getValue('latex');
            if (!plainMath || !plainMath.trim()) { showToast('התיבה ריקה', 'warn'); return; }

            setSolving(true);
            const res = await solveExpression(plainMath);
            setSolving(false);

            if (!res || !res.ok) {
                showToast(res && res.error === 'timeout'
                    ? 'החישוב ארך יותר מדי וקוטע. נסה לפשט את הביטוי.'
                    : 'לא הצלחתי לפתור את הביטוי הזה', 'warn');
                return;
            }
            try {
                box.setValue(`${latexEq} \\textcolor{#fde047}{\\; ${res.resultLatex}}`);
                box.focus();
                saveState();
            } catch (uiError) {
                console.error('failed to write the result back into the field', uiError);
            }
        },
        /** צובע את מה שמסומן עכשיו על הלוח, מסרגל הצבעים */
        recolorSelection: (c) => {
            const a = fCanvas.current?.getActiveObject();
            if (a && !a.isEditHelper) handleColorChange(c, a);
        },
        hasSelection: () => { const a = fCanvas.current?.getActiveObject(); return !!a && !a.isEditHelper; },
        updateActiveColor: (newColor) => { if (sb.current.activeBox) { sb.current.activeBox.style.color = newColor; saveState(); } },
        /** מדליק או מכבה מחיקה בקישקוש. מחזיר את המצב החדש */
        toggleScratchErase: () => {
            const next = !devicePrefsRef.current.scratchErase;
            devicePrefsRef.current = { ...devicePrefsRef.current, scratchErase: next };
            updateDevicePrefs({ scratchErase: next });
            showToast(next ? 'מחיקה בקישקוש: פעילה' : 'מחיקה בקישקוש: כבויה');
            return next;
        },
        openBoardSettings: () => {
            setBoardSettingsPos({ x: window.innerWidth / 2, y: 60 });
            setShowBoardSettings(true);
        },
        setPattern: (p) => {
            if (!PAPER_TYPES.some((t) => t.id === p)) return;
            setBoardPatternType(p);
            if (onAutoSave) onAutoSave({ pattern: p });
        },
        /** סמל מהספרייה, במרכז המסך ועל נקודת רשת */
        insertStamp: (id, at) => withDrop(at, () => {
            const st = stampById(id);
            if (!st || !fCanvas.current) return;
            const c = getCenterPos();
            const g = buildStamp(st, inkColor(), 2.2);
            const snapTo = (v) => Math.round(v / (GRID / 2)) * (GRID / 2);
            g.setPositionByOrigin(new fabric.Point(snapTo(c.x), snapTo(c.y)), 'center', 'center');
            fCanvas.current.add(g);
            fCanvas.current.setActiveObject(g);
            setMode('select');
            sb.current.wasAutoSelected = true;
            fCanvas.current.requestRenderAll();
            saveState();
        }),
        /** נוסחה כשדה עריכה, במרכז המסך — מדף הנוסחאות ומהמחשבון */
        insertMath: (latex, at) => withDrop(at, () => insertMathAt(latex)),
        insertPlot: (spec, at) => withDrop(at, () => insertPlot(spec)),
        insertPolarGrid: (at) => withDrop(at, () => insertPolarGrid()),
        insertBodeFrame: (at) => withDrop(at, () => insertBodeFrame()),
        updateGlobalFontSize: (delta) => { if (sb.current.activeBox) { let currentSize = parseFloat(sb.current.activeBox.style.fontSize) || 48; sb.current.activeBox.style.fontSize = Math.max(16, currentSize + delta) + 'px'; saveState(); } },
        addGrid: (cols, rows) => { const center = getCenterPos(); const grid = createGridGroup(cols, rows, inkColor()); grid.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' }); fCanvas.current.add(grid); fCanvas.current.setActiveObject(grid); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); },
        addImage: (dataUrl) => { const imgEl = new Image(); imgEl.onload = () => { const center = getCenterPos(); const fabricImg = new fabric.Image(imgEl); fabricImg.scaleToWidth(400); fabricImg.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' }); fCanvas.current.add(fabricImg); fCanvas.current.setActiveObject(fabricImg); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); }; imgEl.src = dataUrl; },

       addShape: (type) => {
            const center = getCenterPos();
            const obj = createShape(type, inkColor(), center, penWidth());

            if (obj) {
                fCanvas.current.add(obj);
                setMode('select');
                sb.current.wasAutoSelected = true;
                saveState();

                // מבקש עיגולים כחולים רק אם הצורה תומכת בזה!
                if (isSmartShape(obj)) {
                    enterNodeEditMode(obj);
                } else {
                    fCanvas.current.setActiveObject(obj);
                    fCanvas.current.requestRenderAll();
                }
            }
        }
    }));

    const deactivateBox = (shouldSave = true) => {
        const box = sb.current.activeBox;
        if (!box) return;
        box.wrapper.classList.remove('active-wrapper');
        box.classList.remove('active-box');
        // התיבה יכולה להיות math-field או textarea עברי, ולכן הערך נקרא בשתי הדרכים
        if (!boxValue(box).trim()) box.wrapper.remove();
        box.blur();
        if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide();
        sb.current.activeBox = null;
        setCasBar(null);
        if (shouldSave) saveState();
    };

    /* ── סרגל החישוב מעל תיבת נוסחה ───────────────────────────────── */

    /** מצמיד את סרגל החישוב לתיבה הפעילה, מעליה או מתחתיה לפי המקום */
    const placeCasBar = (box) => {
        if (!box || !box.wrapper || !isMathBox(box)) return;
        const r = box.wrapper.getBoundingClientRect();
        const above = r.top > 110;
        setCasBar({ x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above });
    };

    /** נוסחה חדשה בנקודה בלוח, בגודל ובצבע הנוכחיים */
    const insertMathAt = (latex, pos, size) => {
        const c = pos || getCenterPos();
        const fs = size || globalFontSize * 0.75;
        const wrapper = createMathFieldDOM(`${c.x - (pos ? 0 : 160)}px`, `${c.y - fs * 0.7}px`, latex, `${fs}px`, textColorRef.current);
        mathLayerRef.current.appendChild(wrapper);
        saveState();
        return wrapper;
    };

    /** מצייר גרף וקטורי במרכז המסך, או מתחת לנוסחה שממנה הוא נוצר */
    const insertPlot = (spec, below) => {
        if (!fCanvas.current) return false;
        let sampled;
        try { sampled = samplePlot({ ...spec, samples: 700 }); }
        catch (e) { showToast(`לא הצלחתי לשרטט: ${e.message}`, 'warn'); return false; }
        const xt = spec.logX ? logTicks(sampled.xmin, sampled.xmax) : niceTicks(sampled.xmin, sampled.xmax, 7).ticks;
        const yt = niceTicks(sampled.ymin, sampled.ymax, 6).ticks;
        const g = buildPlotGroup(sampled, { ...spec, xName: spec.xName || spec.variable }, inkColor(), {
            ticks: { x: xt, y: yt, xLabel: tickLabel, yLabel: tickLabel },
        });
        const c = below || getCenterPos();
        if (below) g.set({ left: below.x, top: below.y, originX: 'left', originY: 'top' });
        else g.setPositionByOrigin(new fabric.Point(c.x, c.y), 'center', 'center');
        fCanvas.current.add(g);
        fCanvas.current.setActiveObject(g);
        setMode('select');
        sb.current.wasAutoSelected = true;
        fCanvas.current.requestRenderAll();
        saveState();
        return true;
    };

    /** רשת קוטבית: מעגלים כל משבצת וקרניים כל 30 מעלות, עם תוויות זווית */
    const insertPolarGrid = () => {
        const color = inkColor();
        const objs = [];
        const R = 200;
        for (let r = 40; r <= R; r += 40) {
            objs.push(new fabric.Circle({ left: 0, top: 0, originX: 'center', originY: 'center', radius: r, fill: '', stroke: color, strokeWidth: r === R ? 1.4 : 0.8, opacity: r === R ? 0.7 : 0.35, objectCaching: false }));
        }
        for (let a = 0; a < 360; a += 30) {
            const rad = (a * Math.PI) / 180;
            objs.push(new fabric.Line([0, 0, R * Math.cos(rad), -R * Math.sin(rad)], { stroke: color, strokeWidth: a % 90 === 0 ? 1.4 : 0.7, opacity: a % 90 === 0 ? 0.8 : 0.35, objectCaching: false }));
            objs.push(new fabric.Text(`${a}°`, {
                left: (R + 18) * Math.cos(rad), top: -(R + 18) * Math.sin(rad), originX: 'center', originY: 'center',
                fontSize: 13, fill: color, opacity: 0.8, fontFamily: 'Assistant, Arial, sans-serif', objectCaching: false,
            }));
        }
        const g = new fabric.Group(objs, { objectCaching: false });
        g.customType = 'polar';
        const c = getCenterPos();
        g.setPositionByOrigin(new fabric.Point(c.x, c.y), 'center', 'center');
        fCanvas.current.add(g);
        fCanvas.current.requestRenderAll();
        saveState();
    };

    /** מסגרת בודה: גודל בדציבלים ומופע במעלות, על ציר תדר לוגריתמי משותף */
    const insertBodeFrame = () => {
        const color = inkColor();
        const mk = (ymin, ymax, yName) => {
            const sampled = { xmin: 1, xmax: 1e5, ymin, ymax, logX: true, segments: [] };
            return buildPlotGroup(sampled, { fns: [], xName: 'ω', yName }, color, {
                width: 520, height: 180,
                ticks: { x: logTicks(1, 1e5), y: niceTicks(ymin, ymax, 4).ticks, xLabel: tickLabel, yLabel: tickLabel },
            });
        };
        const mag = mk(-60, 20, '|H| dB');
        const ph = mk(-180, 0, '∠H°');
        const c = getCenterPos();
        mag.set({ left: c.x - 260, top: c.y - 215, originX: 'left', originY: 'top' });
        ph.set({ left: c.x - 260, top: c.y + 20, originX: 'left', originY: 'top' });
        const labels = [
            new fabric.Text('|H(jω)|  [dB]', { left: c.x - 250, top: c.y - 245, originX: 'left', originY: 'top', fontSize: 15, fill: color, fontFamily: 'Assistant, Arial, sans-serif' }),
            new fabric.Text('∠H(jω)  [°]', { left: c.x - 250, top: c.y - 10, originX: 'left', originY: 'top', fontSize: 15, fill: color, fontFamily: 'Assistant, Arial, sans-serif' }),
        ];
        [mag, ph, ...labels].forEach((o) => fCanvas.current.add(o));
        fCanvas.current.requestRenderAll();
        saveState();
    };

    /**
     * מריץ פעולת חישוב על התיבה הפעילה. התוצאה נכנסת כשורה חדשה מתחת
     * לנוסחה, כך שכל צעד בפתרון נשאר על הלוח — כמו פתרון בכתב יד.
     */
    const runCasOnActive = async (action) => {
        const box = sb.current.activeBox;
        if (!box || !isMathBox(box)) return;
        const latex = box.getValue('latex');
        const ascii = box.getValue('ascii-math');
        if (!ascii || !ascii.trim()) { showToast('התיבה ריקה', 'warn'); return; }
        const r = box.wrapper.getBoundingClientRect();
        const zoom = fCanvas.current.getZoom();
        const left = parseFloat(box.wrapper.style.left) || 0;
        const top = parseFloat(box.wrapper.style.top) || 0;
        const below = { x: left, y: top + r.height / zoom + 14 };

        if (action === 'plot') {
            const rhs = ascii.includes('=') ? ascii.split('=').pop() : ascii;
            const v = /(^|[^a-z])t([^a-z]|$)/i.test(rhs) && !/(^|[^a-z])x([^a-z]|$)/i.test(rhs) ? 't' : 'x';
            const expr = rhs.replace(/\s+\(/g, '(');
            const ok = insertPlot({ fns: [expr], variable: v, xmin: v === 't' ? 0 : -10, xmax: 10, xName: v }, { x: below.x, y: below.y + 10 });
            if (ok) deactivateBox(false);
            return;
        }

        setSolving(true);
        const res = action === 'solve' ? await solveExpression(ascii) : await runCasAction(action, ascii, latex);
        setSolving(false);
        if (!res || !res.ok) {
            const msg = res && res.error === 'timeout' ? 'החישוב ארך יותר מדי וקוטע. נסה לפשט את הביטוי.'
                : res && res.error === 'not-matrix' ? 'הפעולה הזו מיועדת למטריצה'
                    : 'לא הצלחתי לחשב את הביטוי הזה';
            showToast(msg, 'warn');
            return;
        }
        if (action === 'solve') {
            box.setValue(`${latex} \\textcolor{#fde047}{\\; ${res.resultLatex}}`);
            saveState();
            return;
        }
        const size = parseFloat(box.style.fontSize) || globalFontSize;
        const fs = Math.max(18, size * 0.85);
        const wrapper = createMathFieldDOM(`${below.x}px`, `${below.y}px`, res.latex, `${fs}px`, box.style.color || textColorRef.current);
        mathLayerRef.current.appendChild(wrapper);
        saveState();
    };

    /** קריאת הערך מתיבה, בלי לדעת אם היא math-field או textarea */
    const boxValue = (box) => {
        if (!box) return '';
        if (typeof box.getValue === 'function') return box.getValue() || '';
        return box.value || '';
    };

    /** האם התיבה היא שדה מתמטיקה. משמש כדי לא להריץ פתרון על טקסט חופשי */
    const isMathBox = (box) => !!box && typeof box.setValue === 'function' && box.tagName === 'MATH-FIELD';

    /**
     * גרירת תיבה צפה בשכבת ה-DOM שמעל הקנבס.
     * החישוב נעשה במרחב הקנבס ולא במרחב המסך, אחרת התיבה בורחת מהאצבע בכל
     * זום שונה מ-100 אחוז. לכידת המצביע על העוטף מייתרת מאזינים גלובליים
     * שבעבר נוצרו לכל תיבה ולא הוסרו לעולם.
     */
    const attachBoxDrag = (wrapper, inner) => {
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let originLeft = 0, originTop = 0;

        const screenToCanvas = (clientX, clientY) => {
            if (!fCanvas.current || !viewportRef.current) return { x: clientX, y: clientY };
            const rect = viewportRef.current.getBoundingClientRect();
            const zoom = fCanvas.current.getZoom();
            const vpt = fCanvas.current.viewportTransform;
            return {
                x: (clientX - rect.left - vpt[4]) / zoom,
                y: (clientY - rect.top - vpt[5]) / zoom,
            };
        };

        const onDragMove = (e) => {
            if (!isDragging || modeRef.current !== 'select') return;
            const cur = screenToCanvas(e.clientX, e.clientY);
            wrapper.style.left = `${originLeft + cur.x - dragStart.x}px`;
            wrapper.style.top = `${originTop + cur.y - dragStart.y}px`;
        };

        const onDragEnd = (e) => {
            if (!isDragging) return;
            isDragging = false;
            wrapper.style.cursor = 'default';
            inner.style.cursor = 'text';
            try { wrapper.releasePointerCapture(e.pointerId); } catch { /* כבר שוחרר */ }
            saveState();
        };

        wrapper.addEventListener('pointerdown', (e) => {
            if (modeRef.current !== 'select') return;
            e.stopPropagation();
            isDragging = true;
            dragStart = screenToCanvas(e.clientX, e.clientY);
            originLeft = parseFloat(wrapper.style.left) || 0;
            originTop = parseFloat(wrapper.style.top) || 0;
            wrapper.style.cursor = 'grabbing';
            inner.style.cursor = 'grabbing';
            sb.current.activeBox = inner;
            try { wrapper.setPointerCapture(e.pointerId); } catch { /* ללא תמיכה */ }
        });
        wrapper.addEventListener('pointermove', onDragMove);
        wrapper.addEventListener('pointerup', onDragEnd);
        wrapper.addEventListener('pointercancel', onDragEnd);
    };

    const createMathFieldDOM = (left, top, value = '', size, color) => {
        const wrapper = document.createElement('div'); wrapper.className = 'math-wrapper'; wrapper.style.left = left; wrapper.style.top = top;
        const mf = document.createElement('math-field'); mf.className = 'math-box'; mf.style.fontSize = size; mf.style.color = color; mf.setValue(value); mf.mathVirtualKeyboardPolicy = "manual"; mf.wrapper = wrapper; wrapper.appendChild(mf);

        mf.addEventListener('focusin', () => {
            if (sb.current.activeBox !== mf) deactivateBox(false);
            sb.current.activeBox = mf; wrapper.classList.add('active-wrapper');
            installEngineeringKeyboard();
            if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show();
            placeCasBar(mf);
            setTimeout(() => {
                const rect = wrapper.getBoundingClientRect(); const safeHeight = window.innerHeight - 320;
                if (rect.bottom > safeHeight && fCanvas.current) {
                    fCanvas.current.relativePan(new fabric.Point(0, -(rect.bottom - safeHeight + 60))); syncCustomLayers();
                }
                placeCasBar(mf);
            }, 400);
        });
        mf.addEventListener('input', () => placeCasBar(mf));

        mf.addEventListener('input', () => { clearTimeout(sb.current.snapTimeout); sb.current.snapTimeout = setTimeout(saveState, 1000); });
        // שתי תקלות תוקנו כאן. הגרירה חישבה מיקום בפיקסלי מסך לתוך שכבה
        // שכבר עברה את טרנספורם המצלמה, ולכן בכל זום שונה מ-100 אחוז התיבה
        // קפצה והתרחקה מהאצבע. בנוסף כל תיבת משוואה הוסיפה שני מאזינים
        // גלובליים שלא הוסרו לעולם.
        attachBoxDrag(wrapper, mf);
        return wrapper;
    };

    /**
     * תיבת טקסט עברי. עד כה מצב הטקסט יצר שדה MathLive שכפוי ל-LTR, וכתיבת
     * משפט בעברית בתוכו הזיזה פסיקים ונקודות לצד הלא נכון. כאן זה textarea
     * אמיתי עם dir=rtl, שגדל לגובה לפי התוכן ורוחבו נשלט על ידי המשתמש.
     */
    const createTextFieldDOM = (left, top, value = '', size = '32px', color = '#f5f5f5', width = '340px') => {
        const wrapper = document.createElement('div');
        wrapper.className = 'math-wrapper';
        wrapper.style.left = left;
        wrapper.style.top = top;
        wrapper.style.width = width;

        const ta = document.createElement('textarea');
        ta.className = 'hebrew-box';
        ta.dir = 'rtl';
        ta.rows = 1;
        ta.spellcheck = false;
        ta.placeholder = 'כתוב כאן…';
        ta.style.fontSize = size;
        ta.style.color = color;
        ta.value = value;
        ta.wrapper = wrapper;
        // getValue מאפשר לשאר הקוד להתייחס לשתי התיבות באותו אופן
        ta.getValue = () => ta.value;
        ta.setValue = (v) => { ta.value = v; autoGrow(); };
        wrapper.appendChild(ta);

        const autoGrow = () => {
            ta.style.height = 'auto';
            ta.style.height = `${ta.scrollHeight}px`;
        };

        ta.addEventListener('focusin', () => {
            if (sb.current.activeBox !== ta) deactivateBox(false);
            sb.current.activeBox = ta;
            wrapper.classList.add('active-wrapper');
            ta.classList.add('active-box');
        });
        ta.addEventListener('input', () => {
            autoGrow();
            clearTimeout(sb.current.snapTimeout);
            sb.current.snapTimeout = setTimeout(saveState, 1000);
        });
        // שינוי רוחב בגרירת הפינה נשמר גם הוא
        ta.addEventListener('pointerup', () => {
            const w = `${Math.round(ta.offsetWidth)}px`;
            if (w !== wrapper.style.width) { wrapper.style.width = w; saveState(); }
        });

        attachBoxDrag(wrapper, ta);
        requestAnimationFrame(autoGrow);
        return wrapper;
    };

    // פונקציה אחידה שמחשבת קואורדינטות בדיוק באותו אופן לכל האירועים
    const getCanvasCoords = (clientX, clientY) => {
        // המלבן נשמר בין אירועים: קריאה אליו בכל תזוזת עט מכריחה חישוב פריסה
        const rect = sb.current.canvasRect || (sb.current.canvasRect = drawingCanvasRef.current.getBoundingClientRect());

        // קואורדינטות פיזיות נקיות על המסך
        const screenX = clientX - rect.left;
        const screenY = clientY - rect.top;

        // קואורדינטות וירטואליות של Fabric
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        const virtualX = (screenX - vpt[4]) / zoom;
        const virtualY = (screenY - vpt[5]) / zoom;

        return { screenX, screenY, virtualX, virtualY };
    };

  /**
   * לולאת הדעיכה של סמן הלייזר. רצה רק כל עוד יש נקודות חיות, ומכבה
   * את עצמה אחרי שהזנב האחרון נעלם, כדי לא לשרוף סוללה במצב הצגה.
   */
  const runLaserFrame = () => {
        const cvs = drawingCanvasRef.current;
        if (!cvs || !sb.current.laser) { sb.current.laserFrame = null; return; }
        const ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        const alive = sb.current.laser.prune();
        if (alive) sb.current.laser.draw(ctx);
        if (alive || sb.current.drawing) {
            sb.current.laserFrame = requestAnimationFrame(runLaserFrame);
        } else {
            sb.current.laserFrame = null;
        }
    };

  const pushLaser = (screenX, screenY) => {
        if (!sb.current.laser) sb.current.laser = createLaser();
        sb.current.laser.add(screenX, screenY);
        if (sb.current.laserFrame === null || sb.current.laserFrame === undefined) {
            sb.current.laserFrame = requestAnimationFrame(runLaserFrame);
        }
    };

    /* ─────────────────────────────────────────────────────────────────
     *  קלט העט: ציור, מחק, ומצבי טקסט ונוסחה
     * ───────────────────────────────────────────────────────────────── */

    /** עובי הקו של העט הנוכחי ביחידות הלוח. העובי על המסך נשאר קבוע בכל זום */
    const penWidth = (p = penRef.current) => (p?.width || 2.5) / (fCanvas.current?.getZoom() || 1);

    /** האם העט מפעיל זיהוי צורות. חוט מעגל מטופל אחרת */
    const penRecognizes = (p = penRef.current) => p && p.kind !== 'wire';

    /** סגנון אחיד לכל מה שנוצר מהעט: אטימות, קווקוו וסוג העט */
    const applyPenStyle = (obj, p = penRef.current) => {
        if (!obj || !p) return obj;
        obj.set({ opacity: p.opacity ?? 1 });
        if (p.dash && p.dash !== 'solid' && !obj.inkFilled) {
            const sw = obj.strokeWidth || penWidth(p);
            obj.set({ strokeDashArray: dashArrayFor(p.dash, sw) });
            obj.dashStyle = p.dash;
        }
        if (p.kind === 'highlighter') obj.set({ fill: '' });
        obj.penKind = p.kind;
        return obj;
    };

    /** בונה צורה מזוהה בסגנון העט, וממיר קו לחץ כשהעט מוגדר עם ראש חץ */
    const buildShapeObject = (shape, p = penRef.current) => {
        const s = p?.arrow && shape.type === 'line' ? { ...shape, type: 'arrow', headLength: undefined } : shape;
        return applyPenStyle(buildRecognizedShape(s, inkColor(), penWidth(p)), p);
    };

    /** מסמן לסרגל הכלים שכותבים עכשיו, כדי שיתפוגג ולא יפריע */
    const setInking = (on) => {
        if (on) document.body.dataset.inking = '1';
        else delete document.body.dataset.inking;
    };

    /** מוחק את קו החיזוי: שכבה נפרדת, כדי שאפשר יהיה למחוק אותו בכל תזוזה בלי לגעת בדיו עצמו */
    const clearPrediction = () => {
        const pc = predictCanvasRef.current;
        if (pc && sb.current.predictDirty) {
            pc.getContext('2d').clearRect(0, 0, pc.width, pc.height);
            sb.current.predictDirty = false;
        }
    };

    /**
     * מצייר את המשך הקו כפי שהדפדפן מנבא אותו, כדי שהדיו יגיע לקצה העט ולא
     * יישאר כמה פריימים מאחוריו. הקו הזה זמני ונמחק בכל תזוזה.
     */
    const paintPrediction = (nativeEvent, lastStep) => {
        const pc = predictCanvasRef.current;
        if (!pc || !lastStep || typeof nativeEvent.getPredictedEvents !== 'function') return;
        const predicted = nativeEvent.getPredictedEvents();
        clearPrediction();
        if (!predicted || !predicted.length) return;
        const p = penRef.current;
        const ctx = pc.getContext('2d');
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        ctx.save();
        ctx.strokeStyle = inkColor(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, lastStep.tip.r * 2 * zoom);
        ctx.beginPath();
        ctx.moveTo(lastStep.tip.x * zoom + vpt[4], lastStep.tip.y * zoom + vpt[5]);
        for (const pe of predicted.slice(0, 4)) {
            const c = getCanvasCoords(pe.clientX, pe.clientY);
            ctx.lineTo(c.screenX, c.screenY);
        }
        ctx.stroke();
        ctx.restore();
        pc.style.opacity = String(p.opacity ?? 1);
        sb.current.predictDirty = true;
    };

    const clearLiveCanvas = () => {
        clearPrediction();
        const cvs = drawingCanvasRef.current;
        if (!cvs) return;
        cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
        cvs.style.opacity = '1';
    };

    /** קו חי לעטים שאינם דיו ממולא — מדגיש, קו מקווקו וחוט — מצויר מחדש בכל תזוזה */
    const paintLiveStroke = () => {
        const cvs = drawingCanvasRef.current;
        if (!cvs || !fCanvas.current) return;
        const p = penRef.current;
        const ctx = cvs.getContext('2d');
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        const pts = sb.current.points;
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        if (!pts.length) return;
        ctx.save();
        ctx.strokeStyle = inkColor();
        ctx.lineWidth = p.width;
        ctx.lineCap = p.kind === 'highlighter' ? 'square' : 'round';
        ctx.lineJoin = 'round';
        const dash = p.kind !== 'highlighter' && p.dash !== 'solid' ? dashArrayFor(p.dash, p.width) : null;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        pts.forEach((q, i) => {
            const x = q.x * zoom + vpt[4], y = q.y * zoom + vpt[5];
            if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        if (pts.length === 1) ctx.lineTo(pts[0].x * zoom + vpt[4] + 0.01, pts[0].y * zoom + vpt[5]);
        ctx.stroke();
        ctx.restore();
    };

    /** עיגול המחק במקום העט, במקום שובל אדום — רואים בדיוק מה ייפגע */
    const paintEraserCursor = (screenX, screenY) => {
        const cvs = drawingCanvasRef.current;
        if (!cvs) return;
        const ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        const r = (eraserRef.current?.size || 16) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(screenX, screenY, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = eraserRef.current?.mode === 'stroke' ? 'rgba(248,113,113,0.9)' : 'rgba(255,255,255,0.85)';
        ctx.stroke();
        ctx.restore();
    };

    /**
     * מעביר את המחק לאורך קטע אחד. במחק חלקי כל משיכה שנחתכת מוחלפת
     * בחלקים ששרדו, באותו מקום בערימת השכבות; במחק שלם האובייקט כולו יורד.
     */
    const eraseAlong = (segs, radius) => {
        const canvas = fCanvas.current;
        if (!canvas) return;
        const er = eraserRef.current || { mode: "pixel" };
        const zoom = canvas.getZoom();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const sg of segs) for (const q of [sg.a, sg.b]) {
            minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
        }
        const objs = canvas.getObjects();
        let changed = false;
        for (let i = objs.length - 1; i >= 0; i--) {
            const obj = objs[i];
            if (obj.isEditHelper || obj === sb.current.editingOriginalObj) continue;
            if (er.highlighterOnly && obj.penKind !== 'highlighter') continue;
            const b = obj.getBoundingRect();
            const pad = radius + (obj.strokeWidth || 1) * 2;
            if (b.left > maxX + pad || b.left + b.width < minX - pad || b.top > maxY + pad || b.top + b.height < minY - pad) continue;

            if (er.mode === 'stroke') {
                let hit = false;
                for (const sg of segs) {
                    const L = Math.hypot(sg.b.x - sg.a.x, sg.b.y - sg.a.y);
                    const n = Math.max(1, Math.ceil(L / Math.max(1, radius / 2)));
                    for (let k = 0; k <= n && !hit; k++) {
                        const t = k / n;
                        if (isObjectNearPoint(obj, { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t }, radius)) hit = true;
                    }
                    if (hit) break;
                }
                if (hit) { canvas.remove(obj); changed = true; }
                continue;
            }

            const pieces = eraseObjectPartially(obj, segs, radius);
            if (pieces === null) continue;
            if (pieces === undefined) {
                /* דיו ישן שנשמר בלי קו אמצע — אין מה לחתוך, ולכן הוא יורד שלם */
                if (obj.inkFilled && segs.some((sg) => isObjectNearPoint(obj, sg.b, radius))) { canvas.remove(obj); changed = true; }
                continue;
            }
            const index = canvas.getObjects().indexOf(obj);
            canvas.remove(obj);
            if (pieces.length) canvas.insertAt(index, ...pieces);
            changed = true;
        }
        if (er.mode === 'stroke' && mathLayerRef.current) {
            const c = segs[segs.length - 1].b;
            Array.from(mathLayerRef.current.children).forEach((wrapper) => {
                const boxX = parseFloat(wrapper.style.left) + wrapper.offsetWidth / 2;
                const boxY = parseFloat(wrapper.style.top) + wrapper.offsetHeight / 2;
                if (Math.hypot(boxX - c.x, boxY - c.y) < Math.max(wrapper.offsetWidth, wrapper.offsetHeight) / 2 + radius) { wrapper.remove(); changed = true; }
            });
        }
        if (changed) { sb.current.eraseChanged = true; canvas.requestRenderAll(); }
        return zoom;
    };

    const handlePointerDown = (e) => {
        if (sb.current.viewG) endViewGesture();
        if (sb.current.isPanning || sb.current.activePointers.size >= 2) return;
        if (sb.current.activeBox || (window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible)) { deactivateBox(); return; }
        if (!e.target.closest('.context-menu') && sb.current.editCircles.length > 0) exitNodeEditMode();

        // setPointerCapture הכרחי כדי שpointerUp יגיע תמיד גם אם האצבע יצאה מהcanvas
        // אבל רק ב-mouse/touch — לא ב-pen שמקבל capture אוטומטי
        if (e.pointerType !== 'pen' && e.target && e.target.setPointerCapture) {
            try { e.target.setPointerCapture(e.pointerId); } catch { /* דפדפן ללא תמיכה בלכידת מצביע */ }
        }

        const { screenX, screenY, virtualX, virtualY } = getCanvasCoords(e.clientX, e.clientY);
        const coords = { x: virtualX, y: virtualY };

        // הדבקה ממתינה: ההקשה הבאה על הלוח קובעת איפה מה שהועתק ינחת
        if (pasteArmedRef.current) {
            setPasteArmed(false);
            pasteAt(coords);
            return;
        }

        if (modeRef.current === 'select') {
            const target = objectAt(e.clientX, e.clientY);
            if (!target && sb.current.wasAutoSelected) { setMode('draw'); sb.current.wasAutoSelected = false; return; } return;
        }

        if (modeRef.current === 'laser') {
            sb.current.drawing = true;
            sb.current.drawPointerId = e.pointerId;
            sb.current.hasMovedEnoughToDraw = true;
            pushLaser(screenX, screenY);
            return;
        }

        if (modeRef.current === 'text') {
            const wrapper = createTextFieldDOM(`${virtualX - 340}px`, `${virtualY}px`, '', `${Math.round(globalFontSize * 0.62)}px`, textColorRef.current);
            mathLayerRef.current.appendChild(wrapper);
            wrapper.querySelector('textarea').focus();
            return;
        }
        if (modeRef.current === 'math') {
            const wrapper = createMathFieldDOM(`${virtualX}px`, `${virtualY - 30}px`, '', `${globalFontSize}px`, textColorRef.current);
            mathLayerRef.current.appendChild(wrapper); wrapper.querySelector('math-field').focus();
            return;
        }
        if (modeRef.current !== 'draw' && modeRef.current !== 'erase') return;

        sb.current.drawing = true;
        sb.current.drawPointerId = e.pointerId;
        sb.current.strokeStartAt = e.timeStamp;
        sb.current.strokeStart = { x: e.clientX, y: e.clientY };
        sb.current.hasSnapped = false;
        sb.current.hasMovedEnoughToDraw = false;
        sb.current.points = [coords];
        sb.current.lastCoords = coords;
        sb.current.liveObj = null;
        sb.current.liveResult = null;
        sb.current.shiftPerfect = false;
        setInking(true);
        const ctx = drawingCanvasRef.current.getContext('2d');
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);

        if (modeRef.current === 'erase') {
            sb.current.inkStroke = null;
            sb.current.eraseLast = coords;
            sb.current.eraseChanged = false;
            paintEraserCursor(screenX, screenY);
            const r = (eraserRef.current?.size || 16) / 2 / fCanvas.current.getZoom();
            eraseAlong([{ a: coords, b: coords }], r);
            return;
        }

        const p = penRef.current;
        drawingCanvasRef.current.style.opacity = String(p.opacity ?? 1);
        if (isFilledInk(p)) {
            const pressureOff = !pressureInkRef.current && (p.kind === 'pen' || p.kind === 'lord');
            sb.current.inkStroke = createInkStroke({
                baseWidth: penWidth(p),
                ...(PEN_KINDS[p.kind]?.ink || {}),
                ...(pressureOff ? { minRatio: 1, maxRatio: 1, tiltInfluence: 0, taperFloor: 1 } : {}),
            });
            sb.current.inkStroke.push(samplePointer(e, virtualX, virtualY));
        } else {
            sb.current.inkStroke = null;
            paintLiveStroke();
        }
    };

    const handlePointerMove = (e) => {
        // רק המצביע שהתחיל את המשיכה מצייר בה. אצבע או כף יד שנוגעות באמצע
        // לא מוסיפות לה נקודות
        if (sb.current.drawPointerId !== null && e.pointerId !== sb.current.drawPointerId) return;
        const perfectHeld = sb.current.perfectPointer !== undefined && sb.current.perfectPointer !== null;
        if (sb.current.isPanning || !sb.current.drawing || (sb.current.activePointers.size >= 2 && !perfectHeld)) return;
        if (perfectHeld && e.pointerId === sb.current.perfectPointer) return;
        if (modeRef.current === 'laser') {
            const l = getCanvasCoords(e.clientX, e.clientY);
            pushLaser(l.screenX, l.screenY);
            return;
        }
        // אין ציור עד תזוזה של 5 פיקסלים, כדי שלחיצה ארוכה לא תשאיר נקודה
        if (!sb.current.hasMovedEnoughToDraw) {
            const moved = Math.hypot(e.clientX - sb.current.longPressStartX, e.clientY - sb.current.longPressStartY);
            if (moved < 5) return;
            sb.current.hasMovedEnoughToDraw = true;
        }

        const { screenX, screenY, virtualX, virtualY } = getCanvasCoords(e.clientX, e.clientY);
        const coords = { x: virtualX, y: virtualY };
        const zoom = fCanvas.current.getZoom();
        sb.current.lastCoords = coords;

        if (modeRef.current === 'erase') {
            const r = (eraserRef.current?.size || 16) / 2 / zoom;
            eraseAlong([{ a: sb.current.eraseLast || coords, b: coords }], r);
            sb.current.eraseLast = coords;
            paintEraserCursor(screenX, screenY);
            return;
        }

        if (sb.current.liveObj) {
            // Shift במחשב עושה מה שאצבע שנייה עושה בטאבלט — צורה מושלמת
            if (e.shiftKey && !sb.current.shiftPerfect) { sb.current.shiftPerfect = true; makeLivePerfect(); }
            // החזקה קצרה של העט במקום, כשהצורה כבר חיה, הופכת אותה למושלמת
            const lp = sb.current.perfectHold;
            if (!lp || Math.hypot(coords.x - lp.x, coords.y - lp.y) * zoom > 3) {
                clearTimeout(sb.current.perfectTimer);
                sb.current.perfectHold = { x: coords.x, y: coords.y };
                sb.current.perfectTimer = setTimeout(() => { if (sb.current.liveObj) makeLivePerfect(); }, 280);
            }
            fCanvas.current.remove(sb.current.liveObj);
            const next = sb.current.liveRebuild ? sb.current.liveRebuild(coords) : null;
            if (next) {
                sb.current.liveObj = next;
                fCanvas.current.add(next);
            }
            fCanvas.current.requestRenderAll();
            return;
        }

        if (sb.current.hasSnapped) return;
        const ctx = drawingCanvasRef.current.getContext('2d');
        sb.current.points.push(coords);

        if (sb.current.inkStroke) {
            const vpt = fCanvas.current.viewportTransform;
            const toScreen = (q) => ({ x: q.x * zoom + vpt[4], y: q.y * zoom + vpt[5] });
            const steps = [];
            const native = e.nativeEvent || e;
            const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : null;
            if (coalesced && coalesced.length > 1) {
                for (const ce of coalesced) {
                    const c = getCanvasCoords(ce.clientX, ce.clientY);
                    steps.push(sb.current.inkStroke.push(samplePointer(ce, c.virtualX, c.virtualY)));
                }
            } else {
                steps.push(sb.current.inkStroke.push(samplePointer(e, virtualX, virtualY)));
            }
            const color = inkColor();
            for (const step of steps) paintInkStep(ctx, step, toScreen, color, zoom);
            const lastStep = [...steps].reverse().find(Boolean);
            if (lastStep && e.pointerType === 'pen') paintPrediction(native, lastStep);
        } else {
            paintLiveStroke();
        }

        if (!penRecognizes() || !autoSnapRef.current) return;
        // השהיית העט במקום מבקשת צורה. תזוזה קטנה מ־2 יחידות לא מאפסת את הטיימר
        if (sb.current.points.length > 1) {
            const lastPt = sb.current.points[sb.current.points.length - 2];
            if (Math.hypot(coords.x - lastPt.x, coords.y - lastPt.y) > 2) {
                clearTimeout(sb.current.snapTimeout);
                sb.current.snapTimeout = setTimeout(() => runRecognition('dwell'), 400);
            }
        } else {
            clearTimeout(sb.current.snapTimeout);
            sb.current.snapTimeout = setTimeout(() => runRecognition('dwell'), 400);
        }
    };

    const handlePointerUp = (e) => {
        if (e && e.pointerType !== 'pen' && e.target && e.target.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch { /* המצביע כבר שוחרר */ }
        }
        if (e && sb.current.perfectPointer === e.pointerId) return;
        if (e && sb.current.drawPointerId !== null && e.pointerId !== sb.current.drawPointerId) return;
        sb.current.drawPointerId = null;

        if (modeRef.current === 'laser') {
            // הזנב ממשיך לדעוך מעצמו אחרי ההרמה, ואין מה לשמור
            sb.current.drawing = false;
            return;
        }

        if (sb.current.isPanning) { setInking(false); return; }
        const p = penRef.current;
        clearTimeout(sb.current.perfectTimer);
        sb.current.perfectHold = null;
        if (sb.current.liveObj) {
            const obj = sb.current.liveObj;
            sb.current.liveObj = null;
            // מצב ביניים עם הדיו הגולמי לפני הצורה, כדי שביטול ראשון יחזיר אליו
            const rawInk = sb.current.pendingRawInk; sb.current.pendingRawInk = null;
            if (rawInk) {
                fCanvas.current.remove(obj);
                fCanvas.current.add(rawInk);
                saveState(); flushHistory();
                fCanvas.current.remove(rawInk);
                fCanvas.current.add(obj);
            }
            if (p?.kind === 'highlighter') placeBelowInk(obj);
            saveState();
        } else if (sb.current.drawing && !sb.current.hasSnapped && modeRef.current === 'draw') {
            // המשיכה נשמרת בצד לרגע: אם כפתור הצד מתגלה רק אחרי ההרמה, היא תוחלף בפעולה שלו
            const before = new Set(fCanvas.current.getObjects());
            const strokePts = sb.current.points.slice();
            if (p.kind === 'wire') finishWire();
            else if (p.kind === 'highlighter') finishHighlighter();
            else if (!tryScratchErase()) convertToScribble();   // הרמה בלי השהיה אף פעם לא מיישרת
            if (e && e.pointerType === 'pen') {
                sb.current.lastStroke = {
                    objs: fCanvas.current.getObjects().filter((o) => !before.has(o)), points: strokePts,
                    startAt: sb.current.strokeStartAt ?? e.timeStamp, endAt: e.timeStamp,
                    screenEnd: { x: e.clientX, y: e.clientY }, handled: false,
                };
            }
        }
        // הדגל מתאפס אחרי השמירה. אחרת כל הקשה בהמשך במצב מחק שמרה שוב
        // ומחקה את מחסנית ה"בצע שוב"
        if (modeRef.current === 'erase' && sb.current.eraseChanged) { sb.current.eraseChanged = false; saveState(); }
        sb.current.drawing = false; sb.current.points = []; sb.current.liveRebuild = null; clearTimeout(sb.current.snapTimeout);
        sb.current.inkStroke = null;
        clearLiveCanvas();
        setInking(false);
    };

    /**
     * בונה את הפונקציה שממשיכה לעצב את הצורה כל עוד העט עדיין על המסך.
     * קווים, חצים ועיקולים ממשיכים אחרי הקצה, מלבן ישר נאחז בפינה הנגדית,
     * וכל שאר הצורות משנות גודל באופן אחיד סביב המרכז.
     */
    const makeLiveRebuild = (result, anchor) => {
        const rebuild = (shape) => buildShapeObject(shape);

        if (result.type === 'line') {
            const start = { ...result.start };
            return (c) => rebuild({ type: 'line', start, end: c });
        }
        if (result.type === 'arrow') {
            const start = { ...result.start };
            const headLength = result.headLength;
            return (c) => rebuild({ type: 'arrow', start, end: c, headLength });
        }
        if (result.type === 'curve') {
            const start = { ...result.start };
            // שחזור נקודת האמצע של העיקול, כדי שהקימור יישמר כשהקצה זז
            const mid = {
                x: (result.cp.x + 0.5 * start.x + 0.5 * result.end.x) / 2,
                y: (result.cp.y + 0.5 * start.y + 0.5 * result.end.y) / 2,
            };
            return (c) => rebuild({
                type: 'curve', start, end: c,
                cp: { x: 2 * mid.x - 0.5 * start.x - 0.5 * c.x, y: 2 * mid.y - 0.5 * start.y - 0.5 * c.y },
            });
        }
        if (result.type === 'rect' && Math.abs(result.angle || 0) < 1e-6 && !result.square) {
            const anchorX = anchor.x > result.cx ? result.cx - result.width / 2 : result.cx + result.width / 2;
            const anchorY = anchor.y > result.cy ? result.cy - result.height / 2 : result.cy + result.height / 2;
            const offX = (anchor.x > result.cx ? result.cx + result.width / 2 : result.cx - result.width / 2) - anchor.x;
            const offY = (anchor.y > result.cy ? result.cy + result.height / 2 : result.cy - result.height / 2) - anchor.y;
            return (c) => {
                const vx = c.x + offX, vy = c.y + offY;
                return rebuild({
                    type: 'rect', angle: 0,
                    cx: (anchorX + vx) / 2, cy: (anchorY + vy) / 2,
                    width: Math.max(2, Math.abs(vx - anchorX)),
                    height: Math.max(2, Math.abs(vy - anchorY)),
                });
            };
        }

        // שינוי גודל אחיד — עובד לכל צורה, כולל ריבוע, מצולעים ומלבנים מסובבים
        const center = result.type === 'polygon' || result.type === 'polyline'
            ? result.points.reduce((a, q) => ({ x: a.x + q.x / result.points.length, y: a.y + q.y / result.points.length }), { x: 0, y: 0 })
            : { x: result.cx, y: result.cy };
        const d0 = Math.max(1, Math.hypot(anchor.x - center.x, anchor.y - center.y));
        const factor = (c) => Math.max(0.15, Math.min(12, Math.hypot(c.x - center.x, c.y - center.y) / d0));

        return (c) => {
            const k = factor(c);
            if (result.type === 'circle') return rebuild({ ...result, r: result.r * k });
            if (result.type === 'arc') return rebuild({ ...result, r: result.r * k });
            if (result.type === 'ellipse') return rebuild({ ...result, rx: result.rx * k, ry: result.ry * k });
            if (result.type === 'rect') return rebuild({ ...result, width: result.width * k, height: result.height * k });
            return rebuild({
                ...result,
                points: result.points.map((q) => ({
                    x: center.x + (q.x - center.x) * k,
                    y: center.y + (q.y - center.y) * k,
                })),
            });
        };
    };

    /**
     * אצבע שנייה בזמן שהעט מחזיק צורה חיה: הצורה קופצת לפירוש המושלם
     * שלה — ריבוע, מעגל, משולש שווה צלעות — וממשיכה לעקוב אחרי העט.
     */
    const makeLivePerfect = () => {
        const res = sb.current.liveResult;
        if (!res || !res.variants || !res.variants.length || !sb.current.liveObj) return;
        if (sb.current.liveVariantIndex === 0) return;
        const shape = res.variants[0].shape;
        sb.current.liveVariantIndex = 0;
        fCanvas.current.remove(sb.current.liveObj);
        sb.current.liveObj = buildShapeObject(shape);
        fCanvas.current.add(sb.current.liveObj);
        sb.current.liveRebuild = makeLiveRebuild(shape, sb.current.lastCoords || sb.current.points[sb.current.points.length - 1]);
        fCanvas.current.requestRenderAll();
        try { navigator.vibrate?.(8); } catch { /* אין רטט */ }
    };

    /**
     * מריץ את מנוע הזיהוי על המשיכה הנוכחית.
     * trigger הוא 'dwell' כשהמשתמש עצר את העט במקום ובכך ביקש המרה, או
     * 'lift' כשהעט הורם. בהרמה הספים מחמירים, כדי שכתב יד קטן יישאר דיו.
     */
    const runRecognition = (trigger) => {
        if (!fCanvas.current || modeRef.current !== 'draw' || !penRecognizes()) return false;
        if (!sb.current.points || sb.current.points.length < 5) return false;
        const p = penRef.current;

        const zoom = fCanvas.current.getZoom() || 1;
        const strict = trigger === 'lift';
        const result = recognizeShape(sb.current.points, {
            scale: 1 / zoom,
            minSpan: strict ? 58 : 30,
            minStrokeLength: strict ? 95 : 45,
            minConfidence: strict ? 0.75 : 0.62,
            snapLevel: snapLevelRef.current,
        });
        if (!result) return false;
        // מדגיש מתיישר רק לקו ישר. ריבוע מדגיש הוא כמעט תמיד טעות
        if (p.kind === 'highlighter' && result.type !== 'line') return false;

        const obj = buildShapeObject(result);
        if (!obj) return false;

        sb.current.hasSnapped = true;

        // לוכדים את הדיו הגולמי לפני היישור, כדי שאפשר יהיה לחזור אליו
        const rawInk = buildInkPathObject();
        clearLiveCanvas();
        if (sb.current.drawing) drawingCanvasRef.current.style.opacity = String(p.opacity ?? 1);

        if (trigger === 'dwell' && sb.current.drawing) {
            // הצורה נולדת מתחת לעט, והמשתמש ממשיך לעצב אותה עד ההרמה
            sb.current.liveObj = obj;
            sb.current.liveResult = result;
            sb.current.liveVariantIndex = result.variantIndex;
            sb.current.pendingRawInk = rawInk;
            sb.current.liveRebuild = makeLiveRebuild(result, sb.current.points[sb.current.points.length - 1]);
            // העט עדיין במקום: אם יישאר עוד רגע קצר, הצורה תהפוך למושלמת
            const lastPt = sb.current.points[sb.current.points.length - 1];
            sb.current.perfectHold = { x: lastPt.x, y: lastPt.y };
            clearTimeout(sb.current.perfectTimer);
            sb.current.perfectTimer = setTimeout(() => { if (sb.current.liveObj) makeLivePerfect(); }, 280);
            fCanvas.current.add(obj);
        } else {
            // קודם מצב היסטוריה עם הדיו הגולמי, ורק אחריו הצורה המיושרת —
            // כך "בטל" ראשון מחזיר את הדיו לפני היישור
            if (rawInk) {
                fCanvas.current.add(rawInk);
                saveState(); flushHistory();
                fCanvas.current.remove(rawInk);
            }
            fCanvas.current.add(obj);
            if (p.kind === 'highlighter') placeBelowInk(obj);
            saveState();
        }
        fCanvas.current.requestRenderAll();
        sb.current.points = [];
        return true;
    };

    /** ראש חץ בקצה המשיכה, לפי כיוון הקטע האחרון שלה */
    const arrowHeadPath = (pts, width) => {
        if (pts.length < 2) return '';
        const end = pts[pts.length - 1];
        let k = pts.length - 2;
        const minBack = width * 5;
        while (k > 0 && Math.hypot(end.x - pts[k].x, end.y - pts[k].y) < minBack) k--;
        const ang = Math.atan2(end.y - pts[k].y, end.x - pts[k].x);
        const head = Math.max(width * 4.5, 9 / (fCanvas.current?.getZoom() || 1));
        const a1 = ang + Math.PI - Math.PI / 7, a2 = ang + Math.PI + Math.PI / 7;
        const p1 = { x: end.x + head * Math.cos(a1), y: end.y + head * Math.sin(a1) };
        const p2 = { x: end.x + head * Math.cos(a2), y: end.y + head * Math.sin(a2) };
        return ` M ${end.x} ${end.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`;
    };

    /** אובייקט דיו מהמשיכה הנוכחית, בסגנון העט, בלי להוסיף אותו ללוח */
    const buildInkPathObject = () => {
        const zoom = fCanvas.current ? (fCanvas.current.getZoom() || 1) : 1;
        const p = penRef.current;
        const color = inkColor();
        let pathObj = null;

        if (sb.current.inkStroke && !sb.current.inkStroke.isEmpty) {
            let pathData = sb.current.inkStroke.toPathData();
            if (pathData) {
                if (p.arrow) pathData += arrowHeadPath(sb.current.inkStroke.nodes, penWidth(p));
                pathObj = new fabric.Path(pathData, {
                    fill: color, stroke: null, strokeWidth: 0,
                    strokeLineJoin: 'round', selectable: true, objectCaching: false,
                });
                pathObj.customType = 'ink';
                pathObj.inkFilled = true;
                pathObj.inkNodes = sb.current.inkStroke.nodesFlat();
            }
        }

        if (!pathObj) {
            if (!sb.current.points || sb.current.points.length < 2) return null;
            let pathData = buildInkPath(sb.current.points, 0.9 / zoom);
            if (!pathData) return null;
            if (p.arrow) pathData += arrowHeadPath(sb.current.points, penWidth(p)).replace(' Z', '');
            pathObj = new fabric.Path(pathData, {
                fill: '', stroke: color, strokeWidth: penWidth(p),
                strokeLineCap: p.kind === 'highlighter' ? 'square' : 'round', strokeLineJoin: 'round', selectable: true, objectCaching: false,
            });
            pathObj.customType = 'ink';
        }
        return applyPenStyle(pathObj, p);
    };

    /**
     * קישקוש על כתב קיים מוחק אותו. רק משיכה שחותכת לפחות עצם אחד נחשבת;
     * קישקוש על שטח ריק נשאר דיו רגיל, כך שציור של קפיץ או של הצללה לא נעלם.
     */
    const tryScratchErase = () => {
        const p = penRef.current;
        if (!devicePrefsRef.current.scratchErase || !fCanvas.current || (p.kind !== 'pen' && p.kind !== 'lord')) return false;
        const pts = sb.current.points;
        const zoom = fCanvas.current.getZoom() || 1;
        const hit = detectScribble(pts.map((q) => ({ x: q.x * zoom, y: q.y * zoom })));
        if (!hit) return false;
        const victims = fCanvas.current.getObjects().filter((obj) => {
            if (obj.isEditHelper || obj === sb.current.editingOriginalObj) return false;
            let n = 0;
            for (let i = 0; i < pts.length; i += 2) if (isObjectNearPoint(obj, pts[i], 8 / zoom) && ++n >= 3) return true;
            return false;
        });
        if (!victims.length) return false;
        victims.forEach((o) => fCanvas.current.remove(o));
        fCanvas.current.requestRenderAll();
        sb.current.points = []; sb.current.inkStroke = null;
        saveState();
        try { navigator.vibrate?.(10); } catch { /* אין רטט */ }
        return true;
    };

    const convertToScribble = () => {
        const pathObj = buildInkPathObject();
        if (!pathObj) { sb.current.points = []; sb.current.inkStroke = null; return null; }
        fCanvas.current.add(pathObj); fCanvas.current.requestRenderAll(); saveState();
        sb.current.points = []; sb.current.inkStroke = null;
        return pathObj;
    };

    /**
     * מדגיש נצבע מתחת לכתב, כמו טוש על נייר: הוא נכנס לערימה ממש מתחת
     * לאובייקט הנמוך ביותר שהוא חוצה, ולא מעליו.
     */
    const placeBelowInk = (obj) => {
        const canvas = fCanvas.current;
        const objs = canvas.getObjects();
        const b = obj.getBoundingRect();
        let target = -1;
        for (let i = 0; i < objs.length; i++) {
            const o = objs[i];
            if (o === obj || o.isEditHelper || o.penKind === 'highlighter') continue;
            const t = typeOf(o);
            if (t === 'image' || o.customType === 'plot' || t === 'group') continue;
            const ob = o.getBoundingRect();
            if (ob.left > b.left + b.width || ob.left + ob.width < b.left || ob.top > b.top + b.height || ob.top + ob.height < b.top) continue;
            target = i;
            break;
        }
        const cur = objs.indexOf(obj);
        if (target >= 0 && target < cur) canvas.moveObjectTo(obj, target);
    };

    /** מדגיש: אם המשיכה כמעט ישרה היא מתיישרת לקו, ואופקית לגמרי כשהיא קרובה לאופק */
    const finishHighlighter = () => {
        const pts = sb.current.points;
        const zoom = fCanvas.current.getZoom() || 1;
        if (pts.length >= 2) {
            const lf = fitLine(pts);
            if (pts.length > 4 && lf.span > 24 / zoom && lf.rms / lf.span < 0.035) {
                let { start, end } = lf;
                const ang = Math.atan2(end.y - start.y, end.x - start.x);
                const dev = Math.abs(Math.sin(ang));
                if (dev < Math.sin((8 * Math.PI) / 180)) {
                    const y = (start.y + end.y) / 2;
                    start = { x: start.x, y }; end = { x: end.x, y };
                }
                sb.current.points = [start, end];
            }
        }
        const obj = convertToScribble();
        if (obj) { placeBelowInk(obj); fCanvas.current.requestRenderAll(); }
    };

    /**
     * חוט מעגל: המשיכה מפושטת, כל קטע הופך לאופקי או לאנכי, והקודקודים
     * נצמדים לחצי משבצת — כך שהחוט מתחבר בדיוק להדקי הרכיבים מהספרייה.
     */
    const finishWire = () => {
        const zoom = fCanvas.current.getZoom() || 1;
        const raw = sb.current.points;
        if (!raw || raw.length < 2) { sb.current.points = []; return; }
        const step = GRID / 2;
        const snap = (v) => Math.round(v / step) * step;
        const simp = simplifyRDP(raw, 7 / zoom);
        const out = [{ x: snap(simp[0].x), y: snap(simp[0].y) }];
        for (let i = 1; i < simp.length; i++) {
            const cur = out[out.length - 1];
            const q = simp[i];
            const dx = q.x - simp[i - 1].x, dy = q.y - simp[i - 1].y;
            const next = Math.abs(dx) >= Math.abs(dy) ? { x: snap(q.x), y: cur.y } : { x: cur.x, y: snap(q.y) };
            if (next.x === cur.x && next.y === cur.y) continue;
            const prev = out[out.length - 2];
            // שני קטעים באותו כיוון מתאחדים לקטע אחד
            if (prev && ((prev.x === cur.x && cur.x === next.x) || (prev.y === cur.y && cur.y === next.y))) out[out.length - 1] = next;
            else out.push(next);
        }
        if (out.length < 2) {
            // קו קצר מחצי משבצת — נשמר כדיו רגיל, כדי שלא ייעלם
            convertToScribble();
            return;
        }
        const p = penRef.current;
        const obj = new fabric.Polyline(out, {
            fill: '', stroke: inkColor(), strokeWidth: penWidth(p),
            strokeLineJoin: 'round', strokeLineCap: 'round', selectable: true, objectCaching: false,
        });
        obj.customType = 'polyline';
        obj.wire = true;
        applyPenStyle(obj, p);
        fCanvas.current.add(obj);
        fCanvas.current.requestRenderAll();
        saveState();
        sb.current.points = [];
    };

    /* ── כתב יד מתמטי ─────────────────────────────────────────────── */

    const sessionScreenPos = (objs) => {
        const u = unionBounds(objs);
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        const x = (u.left + u.width / 2) * zoom + vpt[4];
        const top = u.top * zoom + vpt[5];
        const above = top > 130;
        return { x, y: above ? top - 12 : (u.top + u.height) * zoom + vpt[5] + 12, above };
    };

    const runMathRecognition = async (sess) => {
        if (!sess || !fCanvas.current) return;
        const objs = sess.objs.filter((o) => fCanvas.current.getObjects().includes(o));
        if (!objs.length) return;
        const seq = (sb.current.mathSeq = (sb.current.mathSeq || 0) + 1);
        setInkChip({ state: 'busy', ...sessionScreenPos(objs) });
        const res = await recognizeInk(objs);
        if (seq !== sb.current.mathSeq || sb.current.mathSession !== sess) return;
        if (!res.ok) {
            console.warn('math ink recognition failed:', res.error);
            setInkChip({ state: 'error', error: res.error, ...sessionScreenPos(objs) });
            return;
        }
        let html;
        try { html = katex.renderToString(res.latex, { throwOnError: false }); } catch { html = res.latex; }
        setInkChip({ state: 'ready', latex: res.latex, html, ...sessionScreenPos(objs) });
    };

    /** החלפת כתב היד בשדה נוסחה עם ה־LaTeX שזוהה, באותו מקום ובאותו גודל */
    const acceptMathInk = (focus = false) => {
        const sess = sb.current.mathSession;
        const chip = inkChip;
        if (!sess || !chip || !chip.latex) return;
        const objs = sess.objs.filter((o) => fCanvas.current.getObjects().includes(o));
        if (!objs.length) { setInkChip(null); return; }
        const u = unionBounds(objs);
        const color = objs[0].fill && objs[0].fill !== '' ? objs[0].fill : (objs[0].stroke || textColorRef.current);
        const size = Math.max(22, Math.min(110, u.height * 0.62));
        objs.forEach((o) => fCanvas.current.remove(o));
        const wrapper = createMathFieldDOM(`${u.left}px`, `${u.top + u.height / 2 - size * 0.9}px`, chip.latex, `${size}px`, color);
        mathLayerRef.current.appendChild(wrapper);
        fCanvas.current.requestRenderAll();
        sb.current.mathSession = null;
        setInkChip(null);
        saveState();
        if (focus) setTimeout(() => wrapper.querySelector('math-field')?.focus(), 30);
    };

    const dismissMathInk = () => {
        sb.current.mathSession = null;
        sb.current.mathSeq = (sb.current.mathSeq || 0) + 1;
        clearTimeout(sb.current.mathTimer);
        setInkChip(null);
    };

    /** המרת כתב יד שנבחר בבחירה לנוסחה — מכל עט, לא רק מכתב נוסחאות */
    const convertSelectionToMath = (target) => {
        if (!target) return;
        const t = typeOf(target);
        const objs = t === 'activeselection' ? target.getObjects() : [target];
        const ink = objs.filter((o) => o.customType === 'ink' || o.customType === 'line' || o.customType === 'polyline' || o.customType === 'curve');
        if (!ink.length) { showToast('אפשר להמיר לנוסחה רק כתב יד', 'warn'); return; }
        fCanvas.current.discardActiveObject();
        setContextMenu({ visible: false, x: 0, y: 0, target: null });
        const sess = { objs: ink };
        sb.current.mathSession = sess;
        runMathRecognition(sess);
    };

    // ─── #3: עזרי בחירת אזור בעזרת עט (lasso) ───
   const drawLasso = (screenPts) => {
        const canvas = drawingCanvasRef.current;
        if (!canvas || screenPts.length < 1) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);

        ctx.fillStyle = 'rgba(74, 144, 226, 0.08)';
        ctx.fill();
        ctx.setLineDash([7, 5]);
        ctx.lineWidth = 2; // מעט יותר עבה שיהיה ברור
        ctx.strokeStyle = 'rgba(74, 144, 226, 0.95)';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round'; // קצוות עגולים ויפים
        ctx.stroke();
        ctx.restore();
    };

    const clearLasso = () => {
        const canvas = drawingCanvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.getContext('2d').clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    };

    const lassoBegin = (clientX, clientY) => {
        const c = getCanvasCoords(clientX, clientY);
        sb.current.lasso = {
            screen: [{ x: c.screenX, y: c.screenY }],
            scene: [{ x: c.virtualX, y: c.virtualY }],
            moved: false, startX: clientX, startY: clientY,
        };
    };
    const lassoMove = (clientX, clientY) => {
        const lasso = sb.current.lasso;
        if (!lasso) return;
        const c = getCanvasCoords(clientX, clientY);
        lasso.screen.push({ x: c.screenX, y: c.screenY });
        lasso.scene.push({ x: c.virtualX, y: c.virtualY });
        if (Math.hypot(clientX - lasso.startX, clientY - lasso.startY) > 6) lasso.moved = true;
        drawLasso(lasso.screen);
    };
    /** מסיים את הלאסו ומחזיר אותו, או null כשלא היה לאסו פעיל */
    const lassoEnd = () => {
        const lasso = sb.current.lasso;
        if (!lasso) return null;
        sb.current.lasso = null;
        clearLasso();
        return lasso;
    };

    const pointInPolygon = (pt, poly) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            const denom = (yj - yi) || 1e-9;
            const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                (pt.x < (xj - xi) * (pt.y - yi) / denom + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    /**
     * רק מה שבתוך הלולאה נבחר: לפחות 80 אחוז מנקודות האובייקט — קו האמצע של
     * הדיו, או פינות ומרכזי הצלעות של צורה — צריכות להיות בפנים. קו שהלאסו
     * רק חותך, או שרובו בחוץ, לא נבחר.
     */
    const isObjInLasso = (obj, lassoPts) => {
        let pts = null;
        const g = getEraseGeometry(obj);
        if (g) pts = g.lines.flatMap((l) => l.points);
        if (!pts || pts.length < 2) {
            const b = obj.getBoundingRect();
            const xs = [b.left, b.left + b.width / 2, b.left + b.width], ys = [b.top, b.top + b.height / 2, b.top + b.height];
            pts = xs.flatMap((x) => ys.map((y) => ({ x, y })));
        }
        const step = Math.max(1, Math.floor(pts.length / 60));
        let inside = 0, total = 0;
        for (let i = 0; i < pts.length; i += step) { total++; if (pointInPolygon(pts[i], lassoPts)) inside++; }
        return total > 0 && inside / total >= 0.8;
    };

    const selectInsideLasso = (scenePts) => {
        if (!fCanvas.current || scenePts.length < 3) return;
        const matched = [];
        fCanvas.current.getObjects().forEach((obj) => {
            if (obj.isEditHelper || !obj.selectable) return;
            if (isObjInLasso(obj, scenePts)) matched.push(obj);
        });
        fCanvas.current.discardActiveObject();
        sb.current.wasAutoSelected = false;
        if (matched.length === 0) { fCanvas.current.requestRenderAll(); return; }
        if (matched.length === 1) fCanvas.current.setActiveObject(matched[0]);
        else fCanvas.current.setActiveObject(new fabric.ActiveSelection(matched, { canvas: fCanvas.current }));
        fCanvas.current.requestRenderAll();
        openSelectionMenu(fCanvas.current.getActiveObject());
    };

    /** תפריט הפעולות נפתח מעצמו ליד מה שנבחר, בלי לחיצה ארוכה */
    // מוגדר שוב בכל רינדור, כי מאזיני Fabric נרשמים פעם אחת
    const openSelectionMenu = (obj) => {
        if (!obj || obj.isEditHelper || !fCanvas.current || modeRef.current !== 'select') return;
        const b = obj.getBoundingRect();
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        const cx = (b.left + b.width / 2) * zoom + vpt[4];
        const bottom = (b.top + b.height) * zoom + vpt[5];
        setContextMenu({ visible: true, x: cx - 116, y: bottom + 14, target: obj });
        setShowBoardSettings(false); setRevisions(null);
    };

    useEffect(() => { openSelectionMenuRef.current = openSelectionMenu; });

    const handleColorChange = (c, target = contextMenu.target) => {
        const t = target;
        if (!t) return;

        const applyColor = (obj) => {
            const t = typeOf(obj);
            if (obj.inkFilled) { obj.set('fill', c); if (obj.strokeWidth) obj.set('stroke', c); }
            else if (t.includes('text')) obj.set('fill', c);
            else if (t === 'group') obj.getObjects().forEach(applyColor);
            else {
                obj.set('stroke', c);
                // חלקים מלאים בסמלים — ראש חץ, משולש של דיודה — מקבלים גם הם את הצבע
                if (obj.fill && obj.fill !== '' && obj.fill !== 'transparent' && obj.fill !== SHAPE_FILL) obj.set('fill', c);
            }
        };

        let newTarget = t;
        const tType = t.type ? t.type.toLowerCase() : '';

        if (tType === 'activeselection') {
            const objs = t.getObjects();
            fCanvas.current.discardActiveObject();
            objs.forEach(applyColor);
            const sel = new fabric.ActiveSelection(objs, { canvas: fCanvas.current });
            fCanvas.current.setActiveObject(sel);
            newTarget = sel;
        } else if (tType === 'group') {
            t.getObjects().forEach(applyColor);
            t.set('dirty', true);
        } else {
            applyColor(t);
        }

        fCanvas.current.requestRenderAll(); saveState();
        setContextMenu(prev => ({ ...prev, target: newTarget }));
    };

    const handleThicknessChange = (delta) => {
        const t = contextMenu.target;
        if (!t) return;

        const applyThickness = (obj) => {
            if (obj.inkFilled) {
                const w = Math.max(0, (parseFloat(obj.strokeWidth) || 0) + delta);
                obj.set({ strokeWidth: w, stroke: w > 0 ? obj.fill : null, strokeLineJoin: 'round' });
            } else {
                const w = parseFloat(obj.strokeWidth) || 3;
                obj.set('strokeWidth', Math.max(1, w + delta));
            }
            obj.setCoords();
        };

        let newTarget = t;
        const tType = t.type ? t.type.toLowerCase() : '';

        if (tType === 'activeselection') {
            const objs = t.getObjects();
            fCanvas.current.discardActiveObject();
            objs.forEach(applyThickness);
            const sel = new fabric.ActiveSelection(objs, { canvas: fCanvas.current });
            fCanvas.current.setActiveObject(sel);
            newTarget = sel;
        } else if (tType === 'group') {
            t.getObjects().forEach(applyThickness);
            if (typeof t.addWithUpdate === 'function') t.addWithUpdate();
            t.setCoords();
        } else {
            applyThickness(t);
        }

        fCanvas.current.requestRenderAll(); saveState();
        setContextMenu(prev => ({ ...prev, target: newTarget }));
    };

    /* ── העתקה, הדבקה ושכפול ──────────────────────────────────────── */

    /** האובייקט האמיתי מאחורי יעד התפריט — הצורה המקורית, כשהיא בעריכת קודקודים */
    const realTarget = (t) => (t && sb.current.editingOriginalObj && t === sb.current.editingOriginalObj ? sb.current.editingOriginalObj : t);

    /** שיבוט שתומך גם ב־Promise של Fabric 6 ומעלה וגם ב־callback של גרסה 5 */
    const cloneObj = (obj) => new Promise((resolve) => {
        const r = obj.clone(EXTRA_PROPS);
        if (r && typeof r.then === 'function') r.then(resolve);
        else obj.clone(resolve, EXTRA_PROPS);
    });

    /** העתקה ללוח הגזירים הפנימי. עובד גם על בחירה מרובה */
    const copyObject = async (target) => {
        const t = realTarget(target);
        if (!t) return false;
        const cloned = await cloneObj(t);
        cloned.set({ opacity: t.opacity ?? 1, selectable: true, evented: true, hasControls: true });
        if (sb.current.editingOriginalObj === t) cloned.set({ opacity: 1 });
        sb.current.clipboard = cloned;
        setPasteChip(true);
        clearTimeout(sb.current.pasteChipTimer);
        sb.current.pasteChipTimer = setTimeout(() => setPasteChip(false), 9000);
        return true;
    };

    /**
     * הדבקה כך שמרכז מה שהועתק נוחת בדיוק בנקודה. בלי נקודה — קצת ימינה
     * ולמטה מהמקור, כדי שההעתק לא יסתיר אותו.
     */
    const pasteAt = async (point) => {
        const clip = sb.current.clipboard;
        if (!clip || !fCanvas.current) return;
        const canvas = fCanvas.current;
        const cloned = await cloneObj(clip);
        canvas.discardActiveObject();
        exitNodeEditMode();
        if (point) cloned.setPositionByOrigin(new fabric.Point(point.x, point.y), 'center', 'center');
        else {
            cloned.set({ left: cloned.left + 30, top: cloned.top + 30 });
            clip.set({ left: clip.left + 30, top: clip.top + 30 });
        }
        cloned.set({ evented: true, selectable: true });
        if (typeOf(cloned) === 'activeselection') {
            cloned.canvas = canvas;
            const kids = cloned.getObjects ? cloned.getObjects() : [];
            kids.forEach((o) => canvas.add(o));
            cloned.setCoords();
            canvas.setActiveObject(cloned);
        } else {
            canvas.add(cloned);
            canvas.setActiveObject(cloned);
        }
        setMode('select');
        sb.current.wasAutoSelected = true;
        canvas.requestRenderAll();
        saveState();
    };

    const handleCopy = async () => {
        if (!contextMenu.target) return;
        await copyObject(contextMenu.target);
        setContextMenu({ visible: false, x: 0, y: 0, target: null });
        showToast('הועתק. לחיצה ארוכה על הלוח תדביק בדיוק שם');
    };

    const handleDuplicate = async () => {
        const t = realTarget(contextMenu.target);
        if (!t) return;
        const prevClip = sb.current.clipboard;
        await copyObject(t);
        await pasteAt(null);
        sb.current.clipboard = prevClip || sb.current.clipboard;
        setContextMenu((prev) => ({ ...prev, visible: false }));
    };

    const handleDeleteTarget = () => {
        const t = contextMenu.target;
        if (!t) return;
        const objToDelete = sb.current.editingOriginalObj || t;
        exitNodeEditMode();
        if (typeOf(t) === 'activeselection') {
            const kids = t.getObjects();
            fCanvas.current.discardActiveObject();
            kids.forEach((o) => fCanvas.current.remove(o));
        } else {
            fCanvas.current.remove(objToDelete);
            fCanvas.current.remove(t);
            fCanvas.current.discardActiveObject();
        }
        fCanvas.current.requestRenderAll();
        saveState();
        setContextMenu((prev) => ({ ...prev, visible: false }));
    };

    const handleGroupToggle = () => {
        const t = contextMenu.target;
        if (!t) return;
        const canvas = fCanvas.current;
        const type = typeOf(t);
        if (type === 'activeselection') {
            const kids = t.getObjects();
            canvas.discardActiveObject();
            kids.forEach((o) => canvas.remove(o));
            const g = new fabric.Group(kids);
            canvas.add(g);
            canvas.setActiveObject(g);
        } else if (type === 'group' && !t.customType) {
            const kids = t.removeAll ? t.removeAll() : t.getObjects();
            canvas.remove(t);
            kids.forEach((o) => canvas.add(o));
            canvas.setActiveObject(new fabric.ActiveSelection(kids, { canvas }));
        }
        canvas.requestRenderAll();
        saveState();
        setContextMenu((prev) => ({ ...prev, visible: false }));
    };

    /** סיבוב ברבע סיבוב והיפוך — הכרחיים לסידור רכיבים במעגל */
    const handleRotate = (deg) => {
        const t = realTarget(contextMenu.target);
        if (!t) return;
        exitNodeEditMode();
        const c = t.getCenterPoint();
        t.rotate(((t.angle || 0) + deg) % 360);
        t.setPositionByOrigin(c, 'center', 'center');
        t.setCoords();
        fCanvas.current.requestRenderAll();
        saveState();
    };
    const handleFlip = () => {
        const t = realTarget(contextMenu.target);
        if (!t) return;
        exitNodeEditMode();
        t.set('flipX', !t.flipX);
        fCanvas.current.requestRenderAll();
        saveState();
    };
    const handleLayer = (front) => {
        const t = realTarget(contextMenu.target);
        if (!t) return;
        if (front) fCanvas.current.bringObjectToFront(t); else fCanvas.current.sendObjectToBack(t);
        fCanvas.current.requestRenderAll();
        saveState();
        setContextMenu((prev) => ({ ...prev, visible: false }));
    };

    /** צבע לוח מהגדרות הלוח. נשמר מיד, ולא רק בציור הבא */
    const pickBoardColor = (c) => {
        setBoardColor(c);
        boardColorRef.current = c;
        if (onAutoSave) onAutoSave({ bg: c });
    };

    const patternColorRGB = getPatternContrastColor(boardColor);
    // פרטי היעד של תפריט ההקשר, מחושבים פעם אחת לרינדור
    const cmTarget = contextMenu.visible ? contextMenu.target : null;
    const cmType = cmTarget ? typeOf(cmTarget) : '';
    const cmHasInk = cmTarget ? (cmType === 'activeselection' ? cmTarget.getObjects() : [cmTarget]).some((o) => o.customType === 'ink') : false;
    const handleViewportPointerCancel = (e) => {
    // שים לב: לא מנקים את sb.current.longPressTimer כאן!
    // pointercancel מגיע לפני שהטיימר יורה — אם ננקה אותו, long press לא יעבוד לעולם
    if (sb.current.ignoredPointers.delete(e.pointerId)) { e.stopPropagation(); return; }
    if (sb.current.lassoPointer === e.pointerId) { sb.current.lassoPointer = null; lassoEnd(); }
    const ps = sb.current.penSession;
    if (ps && ps.id === e.pointerId) {
        e.stopPropagation();
        if (ps.inContact) penContactEnd(e);
        sb.current.penSession = null;
    }
    if (sb.current.fingerPan && sb.current.fingerPan.id === e.pointerId) sb.current.fingerPan = null;
    if (sb.current.perfectPointer === e.pointerId) sb.current.perfectPointer = null;
    sb.current.activePointers.delete(e.pointerId);
    if (sb.current.activePointers.size === 0) {
        sb.current.isPanning = false; setPanCursor(false); endViewGesture();
        sb.current.multiTouchStartTime = null;
        sb.current.multiTouchMoved = false;
        sb.current.multiTouchMaxFingers = 0;
        sb.current.multiTouchInitialPositions = new Map();
        sb.current.activePointers.clear();
        if (fCanvas.current) fCanvas.current.selection = boxSelectOn();
    }
};
    return (
        <div id="viewport" dir="ltr" ref={viewportRef} onContextMenu={handleNativeContextMenu}
            onPointerDownCapture={handleViewportPointerDown}
            onPointerMoveCapture={handleViewportPointerMove}
            onPointerUpCapture={handleViewportPointerUp}
            onPointerCancelCapture={handleViewportPointerCancel}
            onPointerLeave={handleViewportPointerLeave}
            style={{
                width: '100%', height: '100%', overflow: 'hidden',
                position: 'relative', cursor: 'default',
                touchAction: 'none'
            }}>
            <style>{`
            /* חסימת המחוות של הדפדפנים הניידים */
                body, html {
                    margin: 0;
                    padding: 0;
                    overflow: hidden; /* מונע כל גלילה טבעית */
                    overscroll-behavior-y: none; /* חוסם "משיכה לרענון" באנדרואיד וקפיציות ב-iOS */
                    overscroll-behavior-x: none; /* חוסם החלקה חזרה בהיסטוריה */
                }

                /* מוודאים שהקונטיינר הראשי שלך גם לא יאפשר מחוות */
                #viewport {
                    touch-action: none; /* ההוראה החשובה ביותר - מונעת כל טיפול טבעי במגע */
                }

                .math-wrapper { position: absolute; direction: ltr !important; unicode-bidi: isolate !important; display: flex; align-items: center; width: max-content; pointer-events: auto; border-radius: 8px; transition: 0.2s border, 0.2s background; border-bottom: 2px solid transparent; }
                .math-wrapper.active-wrapper { border-bottom: 2px solid rgba(74, 222, 128, 0.5); background: rgba(255, 255, 255, 0.05) !important; }
                math-field { background: transparent !important; box-shadow: none !important; border: none !important; transform: none !important; position: relative !important; padding: 5px; min-width: 30px; direction: ltr !important; }
                math-field::part(container) { background-color: transparent !important; box-shadow: none !important; border: none !important; }
                math-field::part(virtual-keyboard-toggle) { display: none !important; }
                .math-box { outline: none !important; }
                .cm-btn { display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(255,255,255,0.07); border: none; color: #e4e4e7; padding: 7px 10px; border-radius: 9px; cursor: pointer; transition: 0.15s; font-size: 13px; }
                .cm-btn:hover { background: rgba(255,255,255,0.15); }
                .cm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
                .cm-row { display: flex; justify-content: space-between; align-items: center; }
                .cm-accent { background: rgba(74,222,128,0.14); color: #4ade80; }
                .cm-danger { color: #f87171; background: rgba(248,113,113,0.1); }
            `}</style>

   {showBoardSettings && (
    <>
       <div data-ui style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
             onPointerDown={(e) => { e.stopPropagation(); setShowBoardSettings(false); setRevisions(null); }} />
        <div data-ui data-scrollable dir="rtl" style={{
            position: 'fixed',
            top: Math.max(10, Math.min(boardSettingsPos.y, window.innerHeight - 560)),
            maxHeight: 'calc(100dvh - 20px)', overflowY: 'auto',
            left: Math.max(10, Math.min(boardSettingsPos.x - 130, window.innerWidth - 280)),
            zIndex: 10001,
            background: 'rgb(18, 18, 20)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '20px',
            padding: '20px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
            color: 'white', width: '264px',
        }}>

            {/* צבע לוח */}
            <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>צבע לוח</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {[
                        { color: '#1e3d32', label: 'ירוק' },
                        { color: '#0f172a', label: 'כחול לילה' },
                        { color: '#1e1e2e', label: 'כחול כהה' },
                        { color: '#1a1a1a', label: 'שחור' },
                        { color: '#1c1917', label: 'חום' },
                        { color: '#1e1b4b', label: 'סגול' },
                        { color: '#14532d', label: 'ירוק בהיר' },
                        { color: '#431407', label: 'אדום כהה' },
                        { color: '#ffffff', label: 'לבן' },
                    ].map(p => (
                        <button key={p.color} title={p.label} onClick={() => pickBoardColor(p.color)} style={{
                            width: '28px', height: '28px', borderRadius: '8px',
                            background: p.color, cursor: 'pointer', transition: '0.15s',
                            border: boardColor === p.color ? '2px solid #4ade80' : '1px solid rgba(255,255,255,0.15)',
                            transform: boardColor === p.color ? 'scale(1.15)' : 'scale(1)',
                        }} />
                    ))}
                    <label title="צבע מותאם אישית" style={{ position: 'relative', cursor: 'pointer' }}>
                        <div style={{
                            width: '28px', height: '28px', borderRadius: '8px',
                            background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px',
                        }}>🎨</div>
                        <input type="color" value={boardColor} onChange={e => pickBoardColor(e.target.value)}
                            style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                    </label>
                </div>
            </div>

            {/* סוג לוח */}
            <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>סוג לוח</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {PAPER_TYPES.map(({ id, label }) => ({ type: id, label, icon: { none: '◻', grid: '▦', engineering: '▦', lines: '≡', dots: '⠿', isometric: '◬', semilog: '⫼' }[id] })).map(opt => (
                        <button key={opt.type} onClick={() => { setBoardPatternType(opt.type); if (onAutoSave) onAutoSave({ pattern: opt.type }); }} style={{
                            padding: '9px 12px', borderRadius: '10px', border: 'none',
                            background: boardPatternType === opt.type ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                            color: boardPatternType === opt.type ? '#4ade80' : '#a1a1aa',
                            outline: boardPatternType === opt.type ? '1px solid rgba(74,222,128,0.35)' : 'none',
                            cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px',
                            transition: '0.15s',
                        }}>
                            <span style={{ fontSize: '16px' }}>{opt.icon}</span> {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* המרה אוטומטית של משיכה לצורה */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>זיהוי צורות</div>
                <button
                    onClick={() => {
                        const next = !autoSnap;
                        setAutoSnap(next);
                        if (onAutoSave) onAutoSave({ autoSnap: next });
                    }}
                    style={{
                        width: '100%', padding: '10px 12px', borderRadius: '10px', border: 'none',
                        background: autoSnap ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                        outline: autoSnap ? '1px solid rgba(74,222,128,0.35)' : 'none',
                        color: autoSnap ? '#4ade80' : '#a1a1aa', cursor: 'pointer', fontSize: '13px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    }}
                >
                    <span>יישור צורה כשמשאירים את העט</span>
                    <span style={{
                        width: '34px', height: '20px', borderRadius: '10px', flexShrink: 0, padding: '2px',
                        background: autoSnap ? '#4ade80' : 'rgba(255,255,255,0.18)',
                        display: 'flex', alignItems: 'center',
                        justifyContent: autoSnap ? 'flex-end' : 'flex-start', transition: '0.15s',
                    }}>
                        <span style={{ width: '16px', height: '16px', borderRadius: '50%', background: autoSnap ? '#14532d' : '#71717a' }} />
                    </span>
                </button>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '7px', lineHeight: 1.5 }}>
                    הצורה מיושרת רק אם משאירים את העט במקום לרגע בסוף המשיכה. אם מרימים את העט מיד, הקו נשאר כפי שנכתב. כשהמתג כבוי אין יישור בכלל.
                </div>
                <div style={{ fontSize: '11px', color: '#71717a', margin: '14px 0 8px', fontWeight: 600 }}>יישור צורות</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px' }}>
                    {SNAP_LEVELS.map((lv) => (
                        <button key={lv.id} onClick={() => { setSnapLevel(lv.id); if (onAutoSave) onAutoSave({ snapLevel: lv.id }); }} style={{
                            padding: '8px 4px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '12px',
                            background: snapLevel === lv.id ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                            color: snapLevel === lv.id ? '#4ade80' : '#a1a1aa',
                            outline: snapLevel === lv.id ? '1px solid rgba(74,222,128,0.35)' : 'none',
                        }}>{lv.label}</button>
                    ))}
                </div>
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '7px', lineHeight: 1.5 }}>
                    {SNAP_LEVELS.find((l) => l.id === snapLevel)?.hint} ״בטל״ אחד אחרי יישור מחזיר את כתב היד המקורי.
                </div>
            </div>

            {/* זיהוי כתב יד מתמטי — מודל שרץ במכשיר */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, letterSpacing: '0.05em' }}>זיהוי נוסחאות בכתב יד</div>
                <div style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: 1.5 }}>
                    {mathInkState.state === 'ready' && 'המודל מוכן ועובד גם בלי רשת.'}
                    {mathInkState.state === 'loading' && `מוריד את המודל… ${Math.round((mathInkState.progress || 0) * 100)}%`}
                    {mathInkState.state === 'error' && 'ההורדה נכשלה. צריך חיבור לרשת בפעם הראשונה.'}
                    {mathInkState.state === 'idle' && 'המודל רץ במכשיר עצמו, בלי שרת ובלי מפתח. בשימוש הראשון יורדים כ־80 מגה־בייט, פעם אחת.'}
                </div>
            </div>

            {/* העט: S Pen, כפתור הצד ודחיית כף היד. נשמר במכשיר ולא בלוח */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>עט S Pen</div>
                <SettingToggle
                    on={isPenOnly(devicePrefs)}
                    label="רק העט כותב, האצבע מזיזה את הלוח"
                    onClick={() => updateDevicePrefs({ penOnly: !isPenOnly(devicePrefs) })}
                />
                <div style={{ fontSize: '11px', color: '#71717a', margin: '7px 0 12px', lineHeight: 1.5 }}>
                    כף היד שמונחת על המסך בזמן הכתיבה לא מציירת ולא מזיזה את הלוח. נדלק מעצמו בפעם הראשונה שמזוהה עט.
                </div>
                <div style={{ fontSize: '11px', color: '#71717a', margin: '0 0 8px', fontWeight: 600 }}>לחיצה על כפתור הצד</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px' }}>
                    {PEN_BUTTON_ACTIONS.map((a) => (
                        <button key={a.id} title={a.hint} onClick={() => updateDevicePrefs({ penButton: a.id })} style={{
                            padding: '8px 6px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '12px',
                            background: devicePrefs.penButton === a.id ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
                            color: devicePrefs.penButton === a.id ? '#4ade80' : '#a1a1aa',
                            outline: devicePrefs.penButton === a.id ? '1px solid rgba(74,222,128,0.35)' : 'none',
                        }}>{a.label}</button>
                    ))}
                </div>
                <div style={{ fontSize: '11px', color: '#71717a', margin: '7px 0 12px', lineHeight: 1.5 }}>
                    {PEN_BUTTON_ACTIONS.find((a) => a.id === devicePrefs.penButton)?.hint}.
                    {HOLD_ACTIONS.includes(devicePrefs.penButton) ? ' מחזיקים את הכפתור וכותבים; כשמרימים, העט חוזר לכלי הקודם.' : ''}
                    {' '}אם הכפתור פותח את Air command של סמסונג, אפשר לכבות אותו בהגדרות הטאבלט, תחת תכונות מתקדמות ואז S Pen.
                </div>
                <SettingToggle
                    on={devicePrefs.scratchErase}
                    label="קישקוש על כתב מוחק אותו"
                    onClick={() => updateDevicePrefs({ scratchErase: !devicePrefs.scratchErase })}
                />
                <div style={{ fontSize: '11px', color: '#71717a', margin: '7px 0 12px', lineHeight: 1.5 }}>
                    מקשקשים הלוך וחזור על מה שכתבת, בעט או בלורד, והכתב שמתחת נמחק. קישקוש על שטח ריק נשאר ציור. ״בטל״ מחזיר.
                </div>
                <SettingToggle on={penDebug} label="בדיקת כפתור העט" onClick={() => { setPenLog([]); setPenDebug((v) => !v); }} />
                <div style={{ fontSize: '11px', color: '#71717a', margin: '7px 0 12px', lineHeight: 1.5 }}>
                    מציג בפינת המסך מה הטאבלט שולח כשלוחצים על הכפתור. אם לא מופיע שום שינוי ב־buttons, הדפדפן לא מעביר את הכפתור לדף.
                </div>
                <SettingToggle
                    on={pressureInk}
                    label="דיו רגיש ללחץ ולהטיה"
                    onClick={() => {
                        const next = !pressureInk;
                        setPressureInk(next);
                        if (onAutoSave) onAutoSave({ pressureInk: next });
                    }}
                />
                <div style={{ fontSize: '11px', color: '#71717a', marginTop: '7px', lineHeight: 1.5 }}>
                    רוחב הקו משתנה לפי לחיצת העט והטייתו. בעכבר ובמגע, שאין בהם חיישן לחץ, הרוחב נגזר ממהירות הכתיבה.
                </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '4px 0 14px' }} />

            {/* גרסאות קודמות — רשת ביטחון מול אובדן עבודה */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>גרסאות קודמות</div>
                <button onClick={openRevisions} style={{
                    width: '100%', padding: '9px', borderRadius: '10px', border: 'none',
                    background: 'rgba(255,255,255,0.06)', color: '#a1a1aa',
                    cursor: 'pointer', fontSize: '13px', textAlign: 'center',
                }}>🕘 הצג גרסאות שמורות</button>
                {revisions && (
                    <div style={{ marginTop: '8px', maxHeight: '190px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {revisions.length === 0 && (
                            <div style={{ fontSize: '11px', color: '#71717a', lineHeight: 1.5, padding: '4px 2px' }}>
                                עוד לא נשמרו גרסאות ללוח הזה. גרסה נוצרת אחרי כמה דקות עבודה, וגם מיד כשחלק גדול מהתוכן נמחק.
                            </div>
                        )}
                        {revisions.map((r) => (
                            <button key={r.index} onClick={() => applyRevision(r.index)} style={{
                                width: '100%', padding: '8px 10px', borderRadius: '9px', border: 'none',
                                background: 'rgba(255,255,255,0.05)', color: '#d4d4d8', cursor: 'pointer',
                                fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px',
                            }}>
                                <span>{new Date(r.savedAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                <span style={{ color: '#71717a' }}>{r.size} פריטים</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '4px 0 14px' }} />

            {/* פעולות */}
            <button onClick={() => {
                if (fCanvas.current) { fCanvas.current.setViewportTransform([1,0,0,1,0,0]); syncCustomLayers(); }
                setShowBoardSettings(false); setRevisions(null);
            }} style={{
                width: '100%', padding: '9px', borderRadius: '10px', border: 'none',
                background: 'rgba(255,255,255,0.06)', color: '#a1a1aa',
                cursor: 'pointer', fontSize: '13px', marginBottom: '6px', textAlign: 'center',
            }}>🔍 אפס זום ל-100%</button>
        </div>
    </>
)}

{toast && (
                <div data-ui dir="rtl" style={{
                    position: 'fixed', bottom: '34px', left: '50%', transform: 'translateX(-50%)',
                    zIndex: 10002, padding: '11px 20px', borderRadius: '12px',
                    background: 'rgb(24, 24, 27)',
                    border: toast.tone === 'warn' ? '1px solid rgba(253,224,71,0.35)' : '1px solid rgba(255,255,255,0.12)',
                    color: toast.tone === 'warn' ? '#fde047' : '#e4e4e7',
                    fontSize: '14px', fontWeight: 500, pointerEvents: 'none',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.5)', maxWidth: '86vw', textAlign: 'center',
                }}>{toast.text}</div>
            )}

            {showRecorder && (
                <RecorderBar
                    status={recStatus}
                    elapsed={recElapsed}
                    recordings={recordings}
                    playing={playing}
                    playhead={playhead}
                    duration={playDuration}
                    driveReady={driveReady}
                    onStart={startRecording}
                    onStop={stopRecording}
                    onPause={pauseRecording}
                    onResume={resumeRecording}
                    onPlay={playRecording}
                    onStopPlay={stopPlayback}
                    onSeek={seekPlayback}
                    onDelete={deleteRecording}
                    onOpenDrive={() => onOpenDrive && onOpenDrive()}
                    onClose={() => {
                        if (recStatus === 'recording' || recStatus === 'paused') { showToast('עצור את ההקלטה לפני הסגירה', 'warn'); return; }
                        stopPlayback();
                        setShowRecorder(false);
                    }}
                />
            )}

            {penDebug && (
                <div data-ui dir="ltr" style={{
                    position: 'fixed', left: 10, bottom: 10, zIndex: 10003, background: 'rgb(0,0,0)', color: '#4ade80',
                    font: '12px/1.45 monospace', padding: '8px 10px', borderRadius: 10, pointerEvents: 'none', minWidth: 250,
                }}>
                    <div style={{ color: '#fde047' }}>press the pen button: hovering and touching</div>
                    {penLog.map((l, i) => <div key={i} style={{ opacity: 1 - i * 0.09 }}>{l}</div>)}
                </div>
            )}

            {solving && (
                <div data-ui dir="rtl" style={{
                    position: 'fixed', bottom: '34px', left: '50%', transform: 'translateX(-50%)',
                    zIndex: 10002, padding: '10px 18px', borderRadius: '12px',
                    background: 'rgb(24, 24, 27)',
                    border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80',
                    fontSize: '14px', fontWeight: 500, pointerEvents: 'none',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                }}>פותר את הביטוי…</div>
            )}

            {contextMenu.visible && (
                <div data-ui className="context-menu" dir="rtl" style={{ position: 'fixed', top: Math.max(10, Math.min(contextMenu.y, window.innerHeight - 330)), left: Math.max(10, Math.min(contextMenu.x, window.innerWidth - 250)), zIndex: 10000, background: 'rgb(24, 24, 27)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '12px', boxShadow: '0 16px 40px rgba(0,0,0,0.55)', color: 'white', display: 'flex', flexDirection: 'column', gap: '9px', width: '232px' }}>
                    {cmTarget && (
                        <>
                            <div style={{display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap'}}>
                                {['#f5f5f5', '#1a1a1a', '#fde047', '#4ade80', '#38bdf8', '#f472b6', '#fb923c'].map(c => (
                                    <button key={c} onClick={() => handleColorChange(c)} aria-label={`צבע ${c}`} style={{background: c, width: '22px', height: '22px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer'}} />
                                ))}
                                <label title="צבע מותאם אישית" style={{ position: 'relative', cursor: 'pointer' }}>
                                    <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', border: '1px solid rgba(255,255,255,0.3)' }} />
                                    <input type="color" value={typeof cmTarget.stroke === 'string' && cmTarget.stroke.startsWith('#') ? cmTarget.stroke : '#ffffff'} onChange={e => handleColorChange(e.target.value)}
                                        style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                                </label>
                            </div>
                            <div className="cm-row">
                                <span style={{fontSize: '13px', color: '#a1a1aa'}}>עובי</span>
                                <div style={{display: 'flex', gap: '4px'}}>
                                    <button onClick={() => handleThicknessChange(-1)} className="cm-btn" aria-label="דק יותר">−</button>
                                    <button onClick={() => handleThicknessChange(1)} className="cm-btn" aria-label="עבה יותר">+</button>
                                </div>
                            </div>
                            <div className="cm-grid">
                                <button onClick={handleCopy} className="cm-btn"><Icon name="copy" size={15} /> העתק</button>
                                <button onClick={handleDuplicate} className="cm-btn"><Icon name="plus" size={15} /> שכפל</button>
                                <button onClick={() => handleRotate(90)} className="cm-btn"><Icon name="rotate" size={15} /> סובב 90°</button>
                                <button onClick={handleFlip} className="cm-btn"><Icon name="flip" size={15} /> היפוך</button>
                                <button onClick={() => handleLayer(true)} className="cm-btn"><Icon name="to-front" size={15} /> לחזית</button>
                                <button onClick={() => handleLayer(false)} className="cm-btn"><Icon name="to-front" size={15} /> לרקע</button>
                            </div>
                            {cmHasInk && (
                                <button onClick={() => convertSelectionToMath(cmTarget)} className="cm-btn cm-accent">
                                    <Icon name="sigma" size={15} /> המר לטקסט
                                </button>
                            )}
                            {(cmType === 'activeselection' || (cmType === 'group' && !cmTarget.customType)) && (
                                <button onClick={handleGroupToggle} className="cm-btn">
                                    {cmType === 'activeselection' ? 'אגד לקבוצה' : 'פרק קבוצה'}
                                </button>
                            )}
                            <button onClick={handleDeleteTarget} className="cm-btn cm-danger"><Icon name="trash" size={15} /> מחק</button>
                        </>
                    )}
                    {!cmTarget && (
                        <>
                            <div style={{fontSize: '12px', color: '#aaa', fontWeight: 'bold'}}>פעולות לוח</div>
                            <button className="cm-btn" onClick={() => {
                                const mp = sb.current.menuPoint;
                                setContextMenu((prev) => ({ ...prev, visible: false }));
                                pasteAt(mp ? toScene(mp.x, mp.y) : null);
                            }}><Icon name="paste" size={15} /> הדבק כאן</button>
                            <button className="cm-btn" onClick={() => {
                                setContextMenu((prev) => ({ ...prev, visible: false }));
                                setBoardSettingsPos({ x: contextMenu.x, y: contextMenu.y });
                                setShowBoardSettings(true);
                            }}>הגדרות לוח</button>
                        </>
                    )}
                </div>
            )}

            {/* ── זיהוי נוסחה בכתב יד ── */}
            {inkChip && (
                <div data-ui className="board-chip" dir="rtl" role="status"
                    style={{ left: Math.max(10, Math.min(window.innerWidth - 10, inkChip.x)), top: inkChip.y, transform: `translate(-50%, ${inkChip.above ? '-100%' : '0'})` }}>
                    {inkChip.state === 'busy' && (
                        mathInkState.state === 'loading'
                            ? <><span className="chip-label">מוריד את מודל הזיהוי, פעם אחת בלבד</span><span className="chip-progress"><span style={{ width: `${Math.round((mathInkState.progress || 0) * 100)}%` }} /></span></>
                            : <span className="chip-label">מזהה את הנוסחה…</span>
                    )}
                    {inkChip.state === 'error' && <><span className="chip-label">לא הצלחתי לזהות. {inkChip.error === 'worker' || mathInkState.state === 'error' ? 'בשימוש הראשון צריך רשת.' : 'נסה לכתוב גדול יותר.'}</span><button onClick={() => runMathRecognition(sb.current.mathSession)}>נסה שוב</button><button onClick={dismissMathInk} aria-label="סגור"><Icon name="close" size={13} /></button></>}
                    {inkChip.state === 'ready' && (
                        <>
                            <span className="chip-tex" dir="ltr" dangerouslySetInnerHTML={{ __html: inkChip.html }} />
                            <button className="primary" onClick={() => acceptMathInk(false)}><Icon name="check" size={14} /> המר</button>
                            <button onClick={() => acceptMathInk(true)} title="המר ופתח לעריכה">ערוך</button>
                            <button onClick={dismissMathInk} title="השאר כתב יד" aria-label="השאר כתב יד"><Icon name="close" size={13} /></button>
                        </>
                    )}
                </div>
            )}

            {/* ── הדבקה ── */}
            {pasteChip && (
                <div data-ui className="board-chip" dir="rtl" style={{ left: '50%', bottom: 92, transform: 'translateX(-50%)' }}>
                    <span className="chip-label"><Icon name="copy" size={14} /> הועתק</span>
                    <button className={pasteArmed ? 'on' : ''} onClick={() => setPasteArmed((v) => !v)}>
                        <Icon name="paste" size={14} /> {pasteArmed ? 'הקש על הלוח במקום הרצוי' : 'הדבק במקום שאבחר'}
                    </button>
                    <button onClick={() => { setPasteChip(false); setPasteArmed(false); }} aria-label="סגור"><Icon name="close" size={13} /></button>
                </div>
            )}

            {/* ── סרגל החישוב מעל תיבת נוסחה ── */}
            {casBar && (
                <div data-ui className="board-chip cas-bar" dir="ltr" role="toolbar" aria-label="פעולות חישוב"
                    onPointerDown={(e) => e.preventDefault()}
                    style={{ left: Math.max(10, Math.min(window.innerWidth - 10, casBar.x)), top: casBar.y, transform: `translate(-50%, ${casBar.above ? '-100%' : '0'})` }}>
                    {CAS_ACTIONS.map((a) => (
                        <button key={a.id} className={a.he ? 'he' : ''} title={a.title} onClick={() => runCasOnActive(a.id)}>{a.label}</button>
                    ))}
                </div>
            )}

            {/* הקונטיינר עכשיו תופס את גודל המסך בדיוק */}
            <div id="board-container" style={{
    position: 'relative', width: '100%', height: '100%',
    background: `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${boardColor}, white 18%) 0%, ${boardColor} 100%)`,
    transition: '0.5s background'
}}>

    {/* שכבת הרקע. הגודל והמיקום מתעדכנים עם המצלמה ב־syncCustomLayers */}
    <div ref={patternBgRef} style={{
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage: patternStyle(boardPatternType, patternColorRGB, 1).image,
        backgroundSize: patternStyle(boardPatternType, patternColorRGB, 1).size,
    }} />
                <div ref={fabricWrapRef} style={{ position: 'absolute', top: 0, left: 0, zIndex: 1, width: '100%', height: '100%' }}>
                    <canvas id="fabric-canvas" ref={fabricCanvasElRef} />
                </div>
                {/* קנבס הציור יושב בצורה סטטית על המסך כדי לחסוך ביצועים */}
             <canvas id="drawing-canvas" ref={drawingCanvasRef}
                    className={`cursor-${mode}`}
                            style={{
                    position: 'absolute', top: 0, left: 0, zIndex: 2,
                    width: '100%', height: '100%',
                    touchAction: 'none', // קריטי
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    /* Apple Pencil תמיד יכול לצייר; אצבע רגילה רק ב-draw/erase/text */
                    pointerEvents: (mode === 'draw' || mode === 'erase' || mode === 'text' || mode === 'math' || mode === 'laser') ? 'auto' : 'none'
                }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                />
                {/* קו החיזוי של העט, מעל הדיו החי */}
                <canvas id="predict-canvas" ref={predictCanvasRef} aria-hidden="true"
                    style={{ position: 'absolute', top: 0, left: 0, zIndex: 2, pointerEvents: 'none' }} />
                {/* שכבת המתמטיקה מאופסת לגודל 0 כדי לא לתפוס מקום וירטואלי, האלמנטים בתוכה יקבלו מיקום מוחלט */}
                <div id="math-layer" ref={mathLayerRef} style={{ position: 'absolute', top: 0, left: 0, width: '0px', height: '0px', overflow: 'visible', pointerEvents: 'none', zIndex: 3 }}></div>
            </div>
        </div>
    );
});

export default Board;