import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import * as fabricPkg from 'fabric';
import 'mathlive';
import { createGridGroup, createShape, buildRecognizedShape, isObjectNearPoint } from '../utils/canvasUtils';
import { recognizeShape, buildInkPath } from '../utils/recognition';
import { createInkStroke, samplePointer, paintInkStep } from '../utils/ink';
import { listRevisions, restoreRevision } from '../utils/storage';
import { createLaser } from '../utils/laser';
import { createRecorder, isRecordingSupported } from '../utils/recorder';
import { isConnected as driveIsConnected, onDriveChange, uploadRecording, downloadFile, deleteFile } from '../utils/drive';
import RecorderBar from './RecorderBar';
import { solveExpression, terminateMathWorker } from '../utils/mathEngine';

const fabric = fabricPkg.fabric || fabricPkg;

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

const Board = forwardRef(({ mode, drawColor, textColor, setMode, globalFontSize, projectId, initialData, onAutoSave, eraserSize = 20, onBoardColorChange, onOpenDrive }, ref) => {
    const fabricCanvasElRef = useRef(null);
    const drawingCanvasRef = useRef(null);
    const mathLayerRef = useRef(null);
    const viewportRef = useRef(null);
    const fCanvas = useRef(null);
    const patternBgRef = useRef(null);

    const [boardColor, setBoardColor] = useState(initialData?.bg || '#1e3d32');
    const [boardPatternType, setBoardPatternType] = useState(initialData?.pattern || 'grid');
    const [selectionType, setSelectionType] = useState('freehand');
    const selectionTypeRef = useRef(selectionType);
    useEffect(() => { selectionTypeRef.current = selectionType; }, [selectionType]);
    const [gridSize] = useState(40);
    // המרה אוטומטית של משיכה לצורה בהרמת העט. ניתן לכיבוי כדי לכתוב בכתב יד
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

    // החלפה אוטומטית של צבע עט כשרקע הלוח משתנה לבהיר/כהה
    useEffect(() => {
        if (!onBoardColorChange) return;
        const r = parseInt(boardColor.slice(1,3), 16) || 0;
        const g = parseInt(boardColor.slice(3,5), 16) || 0;
        const b = parseInt(boardColor.slice(5,7), 16) || 0;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        // רקע בהיר → עט שחור; רקע כהה → עט לבן
        if (luminance > 180) onBoardColorChange('#1a1a1a');
        else if (luminance < 60) onBoardColorChange('#f5f5f5');
    }, [boardColor]);

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

    const drawColorRef = useRef(drawColor);
    useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
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

const syncCustomLayers = () => {
        if (!fCanvas.current) return;
        const vpt = fCanvas.current.viewportTransform; 
        const zoom = fCanvas.current.getZoom(); // שליפת רמת הזום
        const transform = `matrix(${vpt[0]}, ${vpt[1]}, ${vpt[2]}, ${vpt[3]}, ${vpt[4]}, ${vpt[5]})`;
        
        // שכבת המתמטיקה זזה בהתאם למצלמה של פבריק
        if (mathLayerRef.current) {
            mathLayerRef.current.style.transform = transform;
            mathLayerRef.current.style.transformOrigin = '0 0';
        }

        // שכבת הרקע (משבצות/שורות/נקודות) מסתנכרנת עם הזום והתזוזה
        if (patternBgRef.current) {
            // הכפלת גודל המשבצת בזום הנוכחי
            patternBgRef.current.style.backgroundSize = `${gridSize * zoom}px ${gridSize * zoom}px`;
            // הזזת הרקע יחד עם המצלמה
            patternBgRef.current.style.backgroundPosition = `${vpt[4]}px ${vpt[5]}px`;
        }
        
        fCanvas.current.requestRenderAll(); 
    };
    useEffect(() => {
        syncCustomLayers();
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
            
            const ctx = drawingCanvasRef.current.getContext('2d');
            // setTransform ולא scale: scale מצטבר בכל שינוי גודל ומעוות את הציור
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
                fireMiddleClick: true, allowTouchScrolling: false, 
                stopContextMenu: true, renderOnAddRemove: false 
            });

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
                const target = opt.target || fCanvas.current.findTarget(opt.e);
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
                const c = getCanvasCoords(opt.e.clientX, opt.e.clientY);
                sb.current.lasso = {
                    screen: [{ x: c.screenX, y: c.screenY }],
                    scene: [{ x: c.virtualX, y: c.virtualY }],
                    moved: false, startX: opt.e.clientX, startY: opt.e.clientY,
                };
            });
            fCanvas.current.on('mouse:move', (opt) => {
                if (!sb.current.lasso) return;
                const c = getCanvasCoords(opt.e.clientX, opt.e.clientY);
                sb.current.lasso.screen.push({ x: c.screenX, y: c.screenY });
                sb.current.lasso.scene.push({ x: c.virtualX, y: c.virtualY });
                if (Math.hypot(opt.e.clientX - sb.current.lasso.startX, opt.e.clientY - sb.current.lasso.startY) > 6) {
                    sb.current.lasso.moved = true;
                }
                drawLasso(sb.current.lasso.screen);
            });
            fCanvas.current.on('mouse:up', () => {
                const lasso = sb.current.lasso;
                if (!lasso) return;
                sb.current.lasso = null;
                clearLasso();
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

        const handleResize = () => {
            if (fCanvas.current) {
                fCanvas.current.setWidth(window.innerWidth);
                fCanvas.current.setHeight(window.innerHeight);
                fCanvas.current.requestRenderAll();
            }
            updateDrawingCanvasResolution(window.innerWidth, window.innerHeight);
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
                if (e.code === 'KeyZ') { e.preventDefault(); undo(); }
                else if (e.code === 'KeyY') { e.preventDefault(); redo(); }
            }
        };
        
        window.addEventListener('keydown', handleKeyDown, { passive: false });
        const handleGlobalPointerGone = (e) => {
    if (!sb.current.activePointers.has(e.pointerId)) return;
    sb.current.activePointers.delete(e.pointerId);
    if (sb.current.activePointers.size === 0) {
        sb.current.isPanning = false; setPanCursor(false);
        sb.current.multiTouchStartTime = null;
        sb.current.multiTouchMoved = false;
        sb.current.multiTouchMaxFingers = 0;
        sb.current.multiTouchInitialPositions = new Map();
        if (fCanvas.current) fCanvas.current.selection = false;
    }
};
window.addEventListener('pointerup', handleGlobalPointerGone);
window.addEventListener('pointercancel', handleGlobalPointerGone);
        const closeMenu = (e) => { if (!e.target.closest('.context-menu')) setContextMenu(prev => ({...prev, visible: false})); };
        window.addEventListener('pointerdown', closeMenu);

        const viewport = viewportRef.current;
        const handleNativeWheel = (e) => {
            e.preventDefault(); 
            if (!fCanvas.current) return;
            if (e.ctrlKey || e.metaKey) { 
                let zoom = fCanvas.current.getZoom();
                zoom *= 0.999 ** e.deltaY;
                zoom = Math.max(0.1, Math.min(20, zoom));
                const rect = viewport.getBoundingClientRect();
                fCanvas.current.zoomToPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top }, zoom);
                
                // ← התוספת שלנו: עדכון דינמי של העיגולים תוך כדי זום בעכבר
                if (sb.current.editCircles.length > 0) {
                    sb.current.editCircles.forEach(c => {
                        c.set({ radius: 10 / zoom, strokeWidth: 2 / zoom });
                        c.setCoords();
                    });
                }
                
                syncCustomLayers();
            } else {
                const delta = new fabric.Point(-e.deltaX, -e.deltaY);
                fCanvas.current.relativePan(delta);
                syncCustomLayers();
            }
        };
        if (viewport) viewport.addEventListener('wheel', handleNativeWheel, { passive: false });

    // ... (הקוד של initCanvas ו-handleResize) ...

            // --- חסימת גלילה אגרסיבית למכשירים ניידים ---
            const preventNativeScroll = (e) => {
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
                window.removeEventListener('pointerdown', closeMenu);
                window.removeEventListener('pointerup', handleGlobalPointerGone);
window.removeEventListener('pointercancel', handleGlobalPointerGone);
                
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
    sb.current.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

// לחיצה ארוכה — רק אצבע אחת
    if (sb.current.activePointers.size === 1) {
        // ← זיהוי לחיצה כפולה למעבר מעיגולים כחולים → מסגרת לבנה
        const now = Date.now();
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
    sb.current.longPressFired = true; // ← הוסף את השורה הזו כאן!
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
    } else if (sb.current.clipboard) {
        // יש clipboard — מציג תפריט עם אפשרות הדבקה
        setContextMenu({ visible: true, x: cx, y: cy, target: null });
        setShowBoardSettings(false); setRevisions(null);
    } else {
        setBoardSettingsPos({ x: cx, y: cy });
        setShowBoardSettings(true);
        setContextMenu({ visible: false, x: 0, y: 0, target: null });
    }
}, 500);
    }

    if (sb.current.activePointers.size >= 2 || e.shiftKey) {
        // ביטול לחיצה ארוכה כשנוגעת אצבע שנייה
        if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }

        if (sb.current.activePointers.size === 2) {
            sb.current.multiTouchStartTime = Date.now();
            sb.current.multiTouchMoved = false;
            sb.current.multiTouchMaxFingers = 2;
            sb.current.multiTouchInitialPositions = new Map(sb.current.activePointers);

            const pts = Array.from(sb.current.activePointers.values());
            sb.current.pinchInitialDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            sb.current.pinchInitialZoom = fCanvas.current ? fCanvas.current.getZoom() : 1;
            
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
    if (sb.current.activePointers.has(e.pointerId)) sb.current.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // ביטול לחיצה ארוכה ודאבל קליק אם האצבע זזה (מונע התנגשות בזמן ציור קווים)
    if (sb.current.activePointers.size > 0) {
        const moved = Math.hypot(e.clientX - sb.current.longPressStartX, e.clientY - sb.current.longPressStartY);
        if (moved > 10) {
            if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }
            sb.current.lastTapTime = 0; // פוסל לחיצה כפולה כי המשתמש מצייר קו
        }
    }

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

       if (maxMovement > 10 || Math.abs(currentDist - sb.current.pinchInitialDist) > 8) {
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
                    fCanvas.current.zoomToPoint({ x: currentMidX - rect.left, y: currentMidY - rect.top }, newZoom);
                    if (sb.current.editCircles.length > 0) {
                        sb.current.editCircles.forEach(c => { c.set({ radius: 10 / newZoom, strokeWidth: 2 / newZoom }); c.setCoords(); });
                    }
                }
                const delta = new fabric.Point(currentMidX - sb.current.lastX, currentMidY - sb.current.lastY);
                fCanvas.current.relativePan(delta);
                syncCustomLayers();
                sb.current.lastX = currentMidX;
                sb.current.lastY = currentMidY;
            }
        }
        return;
    }

    // פאן אצבע + Shift (מחשב)
    if (sb.current.isPanning && fCanvas.current && sb.current.activePointers.size < 2) {
        e.stopPropagation();
        const delta = new fabric.Point(e.clientX - sb.current.lastX, e.clientY - sb.current.lastY);
        fCanvas.current.relativePan(delta);
        syncCustomLayers();
        sb.current.lastX = e.clientX; sb.current.lastY = e.clientY;
    }
};

const handleViewportPointerUp = (e) => {
    if (sb.current.longPressTimer) { clearTimeout(sb.current.longPressTimer); sb.current.longPressTimer = null; }
    sb.current.activePointers.delete(e.pointerId);
    
    if (sb.current.pinchingObjectModified) { saveState(); sb.current.pinchingObjectModified = false; }

        if (sb.current.activePointers.size === 0) {
            // כל האצבעות עלו — עכשיו בודקים טאפ
            const touchDuration = Date.now() - (sb.current.multiTouchStartTime || 0);
            const wasTap = !sb.current.multiTouchMoved && touchDuration < 300 && sb.current.multiTouchMaxFingers >= 2;

            if (wasTap && sb.current.multiTouchMaxFingers === 2) undo();
            else if (wasTap && sb.current.multiTouchMaxFingers >= 3) redo();

            // מאפסים הכל רק אחרי הבדיקה
            sb.current.isPanning = false; setPanCursor(false);
            sb.current.multiTouchStartTime = null;
            sb.current.multiTouchMoved = false;
            sb.current.multiTouchMaxFingers = 0;
            sb.current.multiTouchInitialPositions = new Map();
            sb.current.activePointers.clear();
            if (fCanvas.current) fCanvas.current.selection = false;

        } else if (sb.current.activePointers.size < 2) {
            // נשארה אצבע אחת — עוצרים פאן אבל שומרים את מידע הטאפ!
            sb.current.isPanning = false; setPanCursor(false);
            if (fCanvas.current) fCanvas.current.selection = false;
        }
    };


 const handleContextMenuAction = (clientX, clientY) => {
        if (!fCanvas.current) return;
        const pointer = fCanvas.current.getPointer({ clientX, clientY });
        let target = null;
        const objects = fCanvas.current.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) {
            if (objects[i].isEditHelper) continue;
            if (objects[i].containsPoint(pointer)) { target = objects[i]; break; }
        }
        
        if (target) {
            // לחיצה על צורה
            setContextMenu({ visible: true, x: clientX, y: clientY, target: target });
            setShowBoardSettings(false); setRevisions(null);
        } else if (sb.current.clipboard) {
            // לחיצה על הלוח ויש משהו מועתק
            setContextMenu({ visible: true, x: clientX, y: clientY, target: null });
            setShowBoardSettings(false); setRevisions(null);
        } else {
            // לחיצה על הלוח כשהכל ריק
            setShowBoardSettings(true);
            setBoardSettingsPos({ x: clientX, y: clientY });
            setContextMenu({ visible: false, x: 0, y: 0, target: null });
        }
    };

    const handleNativeContextMenu = (e) => { e.preventDefault(); handleContextMenuAction(e.clientX, e.clientY); };
    const getStrokeWidth = () => fCanvas.current ? 3 / fCanvas.current.getZoom() : 3;

    const buildLine = (p1, p2, color) => { let l = new fabric.Line([p1.x, p1.y, p2.x, p2.y], { stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', selectable: true, hasControls: true }); l.customType = 'line'; return l; };
    const buildArrow = (start, end, color) => { let angle = Math.atan2(end.y - start.y, end.x - start.x); let headlen = 20; const pathData = `M ${start.x} ${start.y} L ${end.x} ${end.y} L ${end.x - headlen * Math.cos(angle - Math.PI / 6)} ${end.y - headlen * Math.sin(angle - Math.PI / 6)} M ${end.x} ${end.y} L ${end.x - headlen * Math.cos(angle + Math.PI / 6)} ${end.y - headlen * Math.sin(angle + Math.PI / 6)}`; let p = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true }); p.customType = 'arrow'; return p; };
    const buildCurve = (start, cp, end, color) => { const pathData = `M ${start.x} ${start.y} Q ${cp.x} ${cp.y} ${end.x} ${end.y}`; let p = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', selectable: true }); p.customType = 'curve'; return p; };

  const handleDeleteTarget = () => {
        if (contextMenu.target) {
            const objToDelete = sb.current.editingOriginalObj || contextMenu.target;
            exitNodeEditMode(); 
            fCanvas.current.remove(objToDelete);
            fCanvas.current.remove(contextMenu.target); 
            fCanvas.current.discardActiveObject();
            fCanvas.current.requestRenderAll();
            saveState();
            setContextMenu(prev => ({...prev, visible: false}));
        }
    };

    // ← פונקציה חדשה שקושרת את הצורה לעיגולים הכחולים ומאפשרת לגרור את כולה
    const bindShapeEvents = (shape) => {
        shape.set({ 
            selectable: true, evented: true, hasControls: false, hasBorders: false, 
            opacity: 0.5, lockRotation: true, lockScalingX: true, lockScalingY: true 
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
                    opacity: 1, selectable: true, evented: true, hasControls: true, 
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
        fCanvas.current.remove(obj); 
        
        bindShapeEvents(newObj); // חיבור מחדש של אירועי הגרירה לצורה החדשה
        
        fCanvas.current.add(newObj);
        
        // הפתרון לקפיצות: להבטיח שהעיגולים הכחולים תמיד נשארים השכבה העליונה ביותר!
        // ברגע שהצורה החדשה נוצרה, נוודא שהיא לא מסתירה אותם וגונבת את הלחיצה.
        sb.current.editCircles.forEach(c => {
            if (typeof c.bringToFront === 'function') c.bringToFront();
            else if (typeof fCanvas.current.bringObjectToFront === 'function') fCanvas.current.bringObjectToFront(c);
            
            c.setCoords(); // קריטי: מעדכן את תיבת הלחיצה הבלתי נראית של העיגול כדי שהעכבר יזהה אותו
        });
        
        sb.current.editingOriginalObj = newObj;
    };

    const eraserSizeRef = useRef(eraserSize);
    useEffect(() => { eraserSizeRef.current = eraserSize; }, [eraserSize]);
    
    const autosaveTimerRef = useRef(null);
    
 // Apple Pencil barrel button → מצב מחק זמני
    const prevModeRef = useRef(null);
    // האם כפתור של העט לחוץ ברגע זה. בלי זה כל תפריט הקשר של העט, כולל
    // לחיצה ארוכה רגילה, היה מדליק את המחק בטעות.
    const penButtonRef = useRef(false);
    
    useEffect(() => {
        // ב-Safari/iPadOS, כפתור הצד של Apple Pencil מגיע כ-contextmenu event
        // עם e.pointerType === 'pen', לא כ-buttons & 32
        const handleBarrelDown = (e) => {
            if (e.pointerType !== 'pen') return;
            // שיטה 1: buttons & 32 (Chrome/Windows)
            const isBarrel = (e.buttons & 32) !== 0;
            // שיטה 2: button === 2 (Safari/iPadOS — כפתור ימני)
            const isRightClick = e.button === 2;
            if (isBarrel || isRightClick) {
                penButtonRef.current = true;
                if (modeRef.current !== 'erase') {
                    prevModeRef.current = modeRef.current;
                    setMode('erase');
                }
            }
        };

        const handleBarrelUp = (e) => {
            if (e.pointerType !== 'pen') return;
            const isBarrel = (e.buttons & 32) !== 0;
            const isRightClick = e.button === 2;
            // רק שחרר אם המחק היה פעיל ועכשיו הכפתור לא לחוץ
            if (!isBarrel && !isRightClick) {
                penButtonRef.current = false;
                if (prevModeRef.current !== null && modeRef.current === 'erase') {
                    setMode(prevModeRef.current);
                    prevModeRef.current = null;
                }
            }
        };

        // Safari מעלה contextmenu event כשלוחצים כפתור ימני עם עט —
        // חייבים לחסום אותו כדי שהתפריט לא יופיע
        const handlePenContextMenu = (e) => {
            if (e.pointerType !== 'pen') return;
            e.preventDefault();
            // רק כפתור צד שלחוץ בפועל מפעיל מחק. לחיצה ארוכה עם העט פותחת
            // את תפריט ההקשר, ואסור שהיא תחליף כלי מאחורי הגב של המשתמש.
            if (penButtonRef.current && modeRef.current !== 'erase') {
                e.stopPropagation();
                prevModeRef.current = modeRef.current;
                setMode('erase');
            }
        };

        window.addEventListener('pointerdown', handleBarrelDown, { passive: true });
        window.addEventListener('pointermove', handleBarrelDown, { passive: true });
        window.addEventListener('pointerup', handleBarrelUp, { passive: true });
        window.addEventListener('contextmenu', handlePenContextMenu); // ← לא passive!

        return () => {
            window.removeEventListener('pointerdown', handleBarrelDown);
            window.removeEventListener('pointermove', handleBarrelDown);
            window.removeEventListener('pointerup', handleBarrelUp);
            window.removeEventListener('contextmenu', handlePenContextMenu);
        };
    }, [setMode]);

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
            opacity: 1, selectable: true, evented: true, hasControls: true, hasBorders: true,
            lockRotation: false, lockScalingX: false, lockScalingY: false,
        });
        const state = { fabric: fCanvas.current.toObject(['customType', 'inkFilled', 'recTime', 'recId']), math: mathData };
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
                Promise.resolve(onAutoSave({
                    fabric: state.fabric, math: state.math,
                    bg: boardColor, pattern: boardPatternType, autoSnap, pressureInk,
                })).then((res) => {
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
            onAutoSave({ fabric: sb.current.lastState.fabric, math: sb.current.lastState.math, bg: boardColor, pattern: boardPatternType, autoSnap, pressureInk });
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

    // ניקוי בסגירת הלוח — מיקרופון פתוח או נגן שממשיך ברקע הם באג מציק
    useEffect(() => () => {
        if (sb.current.recTimer) clearInterval(sb.current.recTimer);
        if (sb.current.playTimer) clearInterval(sb.current.playTimer);
        if (sb.current.recorder) sb.current.recorder.abort();
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
        clearBoard: () => { deactivateBox(false); exitNodeEditMode(); fCanvas.current.clear(); mathLayerRef.current.innerHTML = ''; saveState(); },
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
        updateActiveColor: (newColor) => { if (sb.current.activeBox) { sb.current.activeBox.style.color = newColor; saveState(); } },
        setSelectionType: (type) => setSelectionType(type),
        updateGlobalFontSize: (delta) => { if (sb.current.activeBox) { let currentSize = parseFloat(sb.current.activeBox.style.fontSize) || 48; sb.current.activeBox.style.fontSize = Math.max(16, currentSize + delta) + 'px'; saveState(); } },
        addGrid: (cols, rows) => { const center = getCenterPos(); const grid = createGridGroup(cols, rows, drawColorRef.current); grid.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' }); fCanvas.current.add(grid); fCanvas.current.setActiveObject(grid); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); },
        addImage: (dataUrl) => { const imgEl = new Image(); imgEl.onload = () => { const center = getCenterPos(); const fabricImg = new fabric.Image(imgEl); fabricImg.scaleToWidth(400); fabricImg.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' }); fCanvas.current.add(fabricImg); fCanvas.current.setActiveObject(fabricImg); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); }; imgEl.src = dataUrl; },
    
       addShape: (type) => { 
            const center = getCenterPos(); 
            const obj = createShape(type, drawColorRef.current, center, getStrokeWidth()); 
            
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
        if (shouldSave) saveState();
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
            if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show();
            setTimeout(() => { 
                const rect = wrapper.getBoundingClientRect(); const safeHeight = window.innerHeight - 320; 
                if (rect.bottom > safeHeight && fCanvas.current) {
                    fCanvas.current.relativePan(new fabric.Point(0, -(rect.bottom - safeHeight + 60))); syncCustomLayers();
                }
            }, 400); 
        });
        
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
        const rect = drawingCanvasRef.current.getBoundingClientRect();
        
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

  const handlePointerDown = (e) => {
       if (sb.current.isPanning || sb.current.activePointers.size >= 2) return;
        if (sb.current.activeBox || (window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible)) { deactivateBox(); return; }
        if (!e.target.closest('.context-menu') && sb.current.editCircles.length > 0) exitNodeEditMode();

        // setPointerCapture הכרחי כדי שpointerUp יגיע תמיד גם אם האצבע יצאה מהcanvas
        // אבל רק ב-mouse/touch — לא ב-pen שמקבל capture אוטומטי
        if (e.pointerType !== 'pen' && e.target && e.target.setPointerCapture) {
            try { e.target.setPointerCapture(e.pointerId); } catch { /* דפדפן ללא תמיכה בלכידת מצביע */ }
        }

        // שימוש בפונקציה האחידה!
        const { screenX, screenY, virtualX, virtualY } = getCanvasCoords(e.clientX, e.clientY);
        const coords = { x: virtualX, y: virtualY };

        if (modeRef.current === 'select') { 
            const target = fCanvas.current.findTarget(e.nativeEvent);
            if (!target && sb.current.wasAutoSelected) { setMode('draw'); sb.current.wasAutoSelected = false; return; } return; 
        }
        
        if (modeRef.current === 'laser') {
            sb.current.drawing = true;
            sb.current.hasMovedEnoughToDraw = true;
            pushLaser(screenX, screenY);
            return;
        }

        if (modeRef.current === 'text') {
            const wrapper = createTextFieldDOM(`${virtualX - 340}px`, `${virtualY}px`, '', `${Math.round(globalFontSize * 0.62)}px`, textColorRef.current);
            mathLayerRef.current.appendChild(wrapper);
            wrapper.querySelector('textarea').focus();

        } else if (modeRef.current === 'math') {
            const wrapper = createMathFieldDOM(`${virtualX}px`, `${virtualY - 30}px`, '', `${globalFontSize}px`, textColorRef.current);
            mathLayerRef.current.appendChild(wrapper); wrapper.querySelector('math-field').focus();

        } else if (modeRef.current === 'draw' || modeRef.current === 'erase') {
            sb.current.drawing = true; 
            sb.current.hasSnapped = false; 
            sb.current.hasMovedEnoughToDraw = false; // ← איפוס המשתנה לפני שמתחילים לצייר
            sb.current.points = [coords]; 
            sb.current.liveObj = null;
            const ctx = drawingCanvasRef.current.getContext('2d'); 
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; 
            
            // ניקוי הקנבס לפי הגודל הנכון שלו
            ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height); 
            if (modeRef.current === 'erase') {
                sb.current.inkStroke = null;
                ctx.beginPath();
                ctx.moveTo(screenX, screenY);
                ctx.lineTo(screenX, screenY + 0.01);
                ctx.lineWidth = eraserSize || 20;
                ctx.strokeStyle = 'rgba(255,0,0,0.3)';
                ctx.stroke();
            } else {
                sb.current.inkStroke = createInkStroke({
                    baseWidth: getStrokeWidth(),
                    ...(pressureInkRef.current ? {} : { minRatio: 1, maxRatio: 1, tiltInfluence: 0, taperFloor: 1 }),
                });
                sb.current.inkStroke.push(samplePointer(e, virtualX, virtualY));
            }
        }
    };

 const handlePointerMove = (e) => {
        if (sb.current.isPanning || !sb.current.drawing || sb.current.activePointers.size >= 2) return;
        if (modeRef.current === 'laser') {
            const l = getCanvasCoords(e.clientX, e.clientY);
            pushLaser(l.screenX, l.screenY);
            return;
        }
            // ← הוסף: אל תתחיל ציור עד שזזת לפחות 5px (מונע התנגשות עם long press)
    if (sb.current.drawing && !sb.current.hasMovedEnoughToDraw) {
        const moved = Math.hypot(e.clientX - sb.current.longPressStartX, e.clientY - sb.current.longPressStartY);
        if (moved < 5) return;
        sb.current.hasMovedEnoughToDraw = true;
    }
        
        // שימוש באותה פונקציה אחידה בדיוק כמו בלחיצה!
        const { screenX, screenY, virtualX, virtualY } = getCanvasCoords(e.clientX, e.clientY);
        const coords = { x: virtualX, y: virtualY };
        const zoom = fCanvas.current.getZoom(); 
        
        if (sb.current.liveObj) {
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
        
        if (modeRef.current === 'erase') {
            ctx.lineTo(screenX, screenY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
        } else if (sb.current.inkStroke) {
            const vpt = fCanvas.current.viewportTransform;
            const toScreen = (p) => ({ x: p.x * zoom + vpt[4], y: p.y * zoom + vpt[5] });
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
            for (const step of steps) paintInkStep(ctx, step, toScreen, drawColorRef.current, zoom);
        }

        if (modeRef.current === 'erase') {
            const actualEraserRadius = (eraserSize || 20) / zoom;
            // מחיקת שדות מתמטיקה
            Array.from(mathLayerRef.current.children).forEach(wrapper => {
                const boxX = parseFloat(wrapper.style.left) + wrapper.offsetWidth / 2;
                const boxY = parseFloat(wrapper.style.top) + wrapper.offsetHeight / 2;
                if (Math.hypot(boxX - coords.x, boxY - coords.y) < Math.max(wrapper.offsetWidth, wrapper.offsetHeight) / 2 + actualEraserRadius) wrapper.remove();
            });
            // מחיקה לפי מגע בקו המתאר עצמו. קודם נבדקה חפיפת תיבות תוחמות,
            // ולכן מחיקה בפינה ריקה של משולש גדול מחקה את כל המשולש.
            const toRemove = [];
            fCanvas.current.getObjects().forEach(obj => {
                if (obj.isEditHelper) return;
                if (obj === sb.current.editingOriginalObj) return;
                if (isObjectNearPoint(obj, coords, actualEraserRadius)) toRemove.push(obj);
            });
            toRemove.forEach(obj => fCanvas.current.remove(obj));
            if (toRemove.length > 0) fCanvas.current.requestRenderAll();
            return;
        }

        // --- שטח מת למניעת שבירת הטיימר ---
        if (sb.current.points.length > 1) {
            const lastPt = sb.current.points[sb.current.points.length - 2]; 
            const dist = Math.hypot(coords.x - lastPt.x, coords.y - lastPt.y);
            if (dist > 2) { // מתאפס רק אם זזת משמעותית
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

        if (modeRef.current === 'laser') {
            // הזנב ממשיך לדעוך מעצמו אחרי ההרמה, ואין מה לשמור
            sb.current.drawing = false;
            return;
        }

        if (sb.current.isPanning) return; 
        if (sb.current.liveObj) {
            const obj = sb.current.liveObj;
           sb.current.liveObj = null;
            // המעבר האוטומטי לבחר בוטל כדי לא להפריע לציור
            // #2: שומרים מצב ביניים עם הדיו הגולמי לפני הצורה המיושרת
            const rawInk = sb.current.pendingRawInk; sb.current.pendingRawInk = null;
            if (rawInk) {
                fCanvas.current.remove(obj);
                fCanvas.current.add(rawInk);
                saveState(); flushHistory();
                fCanvas.current.remove(rawInk);
                fCanvas.current.add(obj);
            }
            saveState();
            // #1: לא נכנסים אוטומטית לעריכה — המשתמש יבחר את הצורה בלחיצה
        } else if (sb.current.drawing && !sb.current.hasSnapped && modeRef.current === 'draw') {
            // עד כה משיכה שהורמה מיד נשארה תמיד דיו גולמי, והמשתמש היה חייב
            // לעצור את העט באוויר 400 מילי־שניות כדי לקבל צורה נקייה.
            if (!(autoSnapRef.current && runRecognition('lift'))) convertToScribble();
        }
        if (modeRef.current === 'erase') saveState();
        sb.current.drawing = false; sb.current.points = []; sb.current.liveRebuild = null; clearTimeout(sb.current.snapTimeout);
        const cvs = drawingCanvasRef.current;
        if (cvs) cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
    };

    /**
     * בונה את הפונקציה שממשיכה לעצב את הצורה כל עוד העט עדיין על המסך.
     * קווים, חצים ועיקולים ממשיכים אחרי הקצה, מלבן ישר נאחז בפינה הנגדית,
     * וכל שאר הצורות משנות גודל באופן אחיד סביב המרכז.
     */
    const makeLiveRebuild = (result, anchor) => {
        const rebuild = (shape) => buildRecognizedShape(shape, drawColorRef.current, getStrokeWidth());

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
        if (result.type === 'rect' && Math.abs(result.angle || 0) < 1e-6) {
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

        // שינוי גודל אחיד — עובד לכל צורה, כולל מצולעים ומלבנים מסובבים
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
     * מריץ את מנוע הזיהוי על המשיכה הנוכחית.
     * trigger הוא 'dwell' כשהמשתמש עצר את העט במקום ובכך ביקש המרה, או
     * 'lift' כשהעט הורם. בהרמה הספים מחמירים, כדי שכתב יד קטן יישאר דיו.
     */
    const runRecognition = (trigger) => {
        if (!fCanvas.current || modeRef.current === 'erase') return false;
        if (!sb.current.points || sb.current.points.length < 5) return false;

        const zoom = fCanvas.current.getZoom() || 1;
        const strict = trigger === 'lift';
        const result = recognizeShape(sb.current.points, {
            scale: 1 / zoom,
            minSpan: strict ? 58 : 30,
            minStrokeLength: strict ? 95 : 45,
            minConfidence: strict ? 0.75 : 0.62,
        });
        if (!result) return false;

        const obj = buildRecognizedShape(result, drawColorRef.current, getStrokeWidth());
        if (!obj) return false;

        sb.current.hasSnapped = true;

        // #2: לוכדים את הדיו הגולמי לפני היישור, כדי שאפשר יהיה לחזור אליו ב"בטל"
        const rawInk = buildInkPathObject();

        const cvs = drawingCanvasRef.current;
        if (cvs) cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);

        if (trigger === 'dwell' && sb.current.drawing) {
            // הצורה נולדת מתחת לעט, והמשתמש ממשיך לעצב אותה עד ההרמה
            sb.current.liveObj = obj;
            sb.current.pendingRawInk = rawInk;
            sb.current.liveRebuild = makeLiveRebuild(result, sb.current.points[sb.current.points.length - 1]);
            fCanvas.current.add(obj);
        } else {
            // #2: קודם שומרים מצב היסטוריה עם הדיו הגולמי, ורק אחריו את הצורה המיושרת.
            // כך "בטל" ראשון מחזיר את הדיו לפני היישור, ו"בטל" שני מוחק אותו.
            if (rawInk) {
                fCanvas.current.add(rawInk);
                saveState(); flushHistory();
                fCanvas.current.remove(rawInk);
            }
            fCanvas.current.add(obj);
            saveState();
            // #1: הצורה לא נבחרת אוטומטית — המשתמש בוחר אותה בלחיצה עליה
        }
        fCanvas.current.requestRenderAll();
        sb.current.points = [];
        return true;
    };

    // בונה אובייקט דיו גולמי מהמשיכה הנוכחית, בלי להוסיף אותו ללוח ובלי לאפס דבר.
    const buildInkPathObject = () => {
        const zoom = fCanvas.current ? (fCanvas.current.getZoom() || 1) : 1;
        const color = drawColorRef.current;
        let pathObj = null;

        if (sb.current.inkStroke && !sb.current.inkStroke.isEmpty) {
            const pathData = sb.current.inkStroke.toPathData();
            if (pathData) {
                pathObj = new fabric.Path(pathData, {
                    fill: color, stroke: null, strokeWidth: 0,
                    strokeLineJoin: 'round', selectable: true, objectCaching: false,
                });
                pathObj.customType = 'ink';
                pathObj.inkFilled = true;
            }
        }

        if (!pathObj) {
            if (!sb.current.points || sb.current.points.length < 2) return null;
            const pathData = buildInkPath(sb.current.points, 0.9 / zoom);
            if (!pathData) return null;
            pathObj = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true });
            pathObj.customType = 'ink';
        }
        return pathObj;
    };

    const convertToScribble = () => {
        const pathObj = buildInkPathObject();
        if (!pathObj) { sb.current.points = []; sb.current.inkStroke = null; return; }
        fCanvas.current.add(pathObj); fCanvas.current.requestRenderAll(); saveState();
        sb.current.points = []; sb.current.inkStroke = null;
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
        
        ctx.setLineDash([7, 5]);
        ctx.lineWidth = 2; // מעט יותר עבה שיהיה ברור
        ctx.strokeStyle = 'rgba(74, 144, 226, 0.9)';
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

    const isObjInLasso = (obj, lassoPts) => {
        // 1. בדיקה אם מרכז הצורה עצמה נמצא בתוך הלולאה שציירת
        if (pointInPolygon(obj.getCenterPoint(), lassoPts)) return true;
        
        // 2. בדיקת חיתוך מדויקת עם הפיקסלים של הקו עצמו
        const step = Math.max(1, Math.floor(lassoPts.length / 40));
        for (let i = 0; i < lassoPts.length; i += step) {
            if (isObjectNearPoint(obj, lassoPts[i], 8)) return true;
        }
        return false;
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
    };

    const handleColorChange = (c) => {
        const t = contextMenu.target;
        if (!t) return;
        
        const applyColor = (obj) => {
            if (obj.inkFilled) { obj.set('fill', c); if (obj.strokeWidth) obj.set('stroke', c); }
            else obj.set('stroke', c);
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
            if (typeof t.addWithUpdate === 'function') t.addWithUpdate();
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

   const handleCopy = () => { 
        if (contextMenu.target) { 
            // מוודאים שאנחנו מעתיקים את הצורה המקורית אם היא בעריכה
            const targetToCopy = sb.current.editingOriginalObj || contextMenu.target;
            
            const processClone = (cloned) => {
                // מחזירים לאטימות מלאה למקרה שהצורה הועתקה באמצע עריכה
                cloned.set({ opacity: 1, selectable: true, evented: true, hasControls: true });
                sb.current.clipboard = cloned;
                // סוגר את התפריט רק אחרי שההעתקה הסתיימה בהצלחה
                setContextMenu({ visible: false, x: 0, y: 0, target: null });
            };

            // תומך ב-Fabric v6 (Promise) וב-v5 (Callback) + חובה להעתיק את תעודת הזהות!
            const result = targetToCopy.clone(['customType']);
            if (result && typeof result.then === 'function') {
                result.then(processClone);
            } else {
                targetToCopy.clone(processClone, ['customType']);
            }
        }
    };

   const handlePaste = () => { 
        if (sb.current.clipboard) { 
            const processPaste = (cloned) => { 
                fCanvas.current.discardActiveObject(); 
                
                // מזיזים את ההדבקה קצת ימינה ולמטה כדי שלא תסתיר את המקור
                cloned.set({ left: cloned.left + 30, top: cloned.top + 30, evented: true, selectable: true, opacity: 1 }); 
                fCanvas.current.add(cloned); 
                sb.current.clipboard.top += 30; 
                sb.current.clipboard.left += 30; 
                
                // ─── התוספת שלנו לחווית משתמש מושלמת ───
                setMode('select'); 
                sb.current.wasAutoSelected = true;
                // ─────────────────────────────────────────

             // הוספת הצורה החדשה מיד עם עיגולים כחולים (רק אם היא תומכת בזה)
                if (cloned.customType && isSmartShape(cloned)) {
                    enterNodeEditMode(cloned);
                } else {
                    fCanvas.current.setActiveObject(cloned);
                }
                
                fCanvas.current.requestRenderAll(); 
                saveState();
            };
            
            // תמיכה ב-Promises והעתקת ה-customType גם בזמן ההדבקה
            const result = sb.current.clipboard.clone(['customType']);
            if (result && typeof result.then === 'function') {
                result.then(processPaste);
            } else {
                sb.current.clipboard.clone(processPaste, ['customType']);
            }
        } 
        setContextMenu(prev => ({...prev, visible: false})); 
    };

    const handleDuplicate = () => {
        if (contextMenu.target) {
            const targetToCopy = sb.current.editingOriginalObj || contextMenu.target;
            const processClone = (cloned) => {
                cloned.set({ opacity: 1, selectable: true, evented: true, hasControls: true, left: cloned.left + 30, top: cloned.top + 30 });
                fCanvas.current.discardActiveObject();
                fCanvas.current.add(cloned);
                setMode('select');
                if (cloned.customType && isSmartShape(cloned)) enterNodeEditMode(cloned);
                else fCanvas.current.setActiveObject(cloned);
                fCanvas.current.requestRenderAll();
                saveState();
                setContextMenu(prev => ({...prev, visible: false}));
            };
            const result = targetToCopy.clone(['customType']);
            if (result && typeof result.then === 'function') result.then(processClone);
            else targetToCopy.clone(processClone, ['customType']);
        }
    };

    const handleGroupToggle = () => {
        if (!contextMenu.target) return;
        if (contextMenu.target.type === 'activeSelection') contextMenu.target.toGroup();
        else if (contextMenu.target.type === 'group') contextMenu.target.toActiveSelection();
        fCanvas.current.requestRenderAll();
        saveState();
        setContextMenu(prev => ({...prev, visible: false}));
    };

    const patternColorRGB = getPatternContrastColor(boardColor);
    const handleViewportPointerCancel = (e) => {
    // שים לב: לא מנקים את sb.current.longPressTimer כאן!
    // pointercancel מגיע לפני שהטיימר יורה — אם ננקה אותו, long press לא יעבוד לעולם
    sb.current.activePointers.delete(e.pointerId);
    if (sb.current.activePointers.size === 0) {
        sb.current.isPanning = false; setPanCursor(false);
        sb.current.multiTouchStartTime = null;
        sb.current.multiTouchMoved = false;
        sb.current.multiTouchMaxFingers = 0;
        sb.current.multiTouchInitialPositions = new Map();
        sb.current.activePointers.clear();
        if (fCanvas.current) fCanvas.current.selection = false;
    }
};
    return (
        <div id="viewport" dir="ltr" ref={viewportRef} onContextMenu={handleNativeContextMenu} 
            onPointerDownCapture={handleViewportPointerDown}
            onPointerMoveCapture={handleViewportPointerMove}
            onPointerUpCapture={handleViewportPointerUp}
            onPointerCancelCapture={handleViewportPointerCancel}
            style={{ 
                width: '100vw', height: '100vh', overflow: 'hidden', 
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
                .cm-btn { background: rgba(255,255,255,0.1); border: none; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: 0.2s; }
                .cm-btn:hover { background: rgba(255,255,255,0.2); }
            `}</style>
            
   {showBoardSettings && (
    <>
       <div data-ui style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
             onPointerDown={(e) => { e.stopPropagation(); setShowBoardSettings(false); setRevisions(null); }} />
        <div data-ui dir="rtl" style={{
            position: 'fixed',
            top: Math.min(boardSettingsPos.y, window.innerHeight - 520),
            left: Math.max(10, Math.min(boardSettingsPos.x - 130, window.innerWidth - 280)),
            zIndex: 10001,
            background: 'rgba(18, 18, 20, 0.97)',
            backdropFilter: 'blur(28px)',
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
                        <button key={p.color} title={p.label} onClick={() => setBoardColor(p.color)} style={{
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
                        <input type="color" value={boardColor} onChange={e => setBoardColor(e.target.value)}
                            style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                    </label>
                </div>
            </div>

            {/* סוג לוח */}
            <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>סוג לוח</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    {[
                        { type: 'none', label: 'חלק', icon: '◻' },
                        { type: 'grid', label: 'משובץ', icon: '▦' },
                        { type: 'lines', label: 'שורות', icon: '≡' },
                        { type: 'dots', label: 'נקודות', icon: '⠿' },
                    ].map(opt => (
                        <button key={opt.type} onClick={() => setBoardPatternType(opt.type)} style={{
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
                    <span>המרה אוטומטית בהרמת העט</span>
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
                    כשהמתג כבוי הצורה תיווצר רק אם תשהה את העט לרגע בסוף המשיכה. כך אפשר לכתוב בכתב יד בלי שהאותיות יומרו.
                </div>
            </div>

            {/* דיו רגיש ללחץ ולהטיה */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>עט</div>
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
                    background: 'rgba(24, 24, 27, 0.96)', backdropFilter: 'blur(20px)',
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

            {solving && (
                <div data-ui dir="rtl" style={{
                    position: 'fixed', bottom: '34px', left: '50%', transform: 'translateX(-50%)',
                    zIndex: 10002, padding: '10px 18px', borderRadius: '12px',
                    background: 'rgba(24, 24, 27, 0.96)', backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80',
                    fontSize: '14px', fontWeight: 500, pointerEvents: 'none',
                    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
                }}>פותר את הביטוי…</div>
            )}

            {contextMenu.visible && (
                <div data-ui className="context-menu" dir="rtl" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 10000, background: 'rgba(28, 28, 30, 0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', color: 'white', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '150px' }}>
                    {contextMenu.target ? (
                        <>
                          <div style={{fontSize: '12px', color: '#aaa', fontWeight: 'bold'}}>ערוך צורה</div>
                            
                            <div style={{display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center'}}>
                                {['#f5f5f5', '#fde047', '#4ade80', '#22d3ee', '#f472b6'].map(c => (
                                    <button key={c} onClick={() => handleColorChange(c)} style={{background: c, width: '22px', height: '22px', borderRadius: '50%', border: 'none', cursor: 'pointer'}} /> 
                                ))}
                                
                                {/* ── פלטת צבעים מותאמת אישית ── */}
                                <label title="צבע מותאם אישית" style={{ position: 'relative', cursor: 'pointer' }}>
                                    <div style={{
                                        width: '22px', height: '22px', borderRadius: '50%',
                                        background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                                        border: '1px solid rgba(255,255,255,0.3)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }} />
                                    <input 
                                        type="color" 
                                        value={contextMenu.target?.stroke || '#ffffff'} 
                                        onChange={e => handleColorChange(e.target.value)} 
                                        style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', width: '100%', height: '100%' }} 
                                    />
                                </label>
                            </div>

                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                <span style={{fontSize: '14px'}}>עובי קו:</span>
                                <div style={{display: 'flex', gap: '4px'}}>
                                    <button onClick={() => handleThicknessChange(-1)} className="cm-btn" style={{padding: '2px 8px'}}>-</button>
                                    <button onClick={() => handleThicknessChange(1)} className="cm-btn" style={{padding: '2px 8px'}}>+</button>
                                </div>
                            </div>
                            <div style={{display: 'flex', gap: '8px'}}>
                                <button onClick={handleCopy} className="cm-btn" style={{flex: 1}}>העתק</button>
                                <button onClick={handleDuplicate} className="cm-btn" style={{flex: 1}}>שכפל</button>
                                <button onClick={handleDeleteTarget} className="cm-btn" style={{flex: 1, color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)'}}>מחק</button>
                            </div>
                            {(contextMenu.target.type === 'activeSelection' || contextMenu.target.type === 'group') && (
                                <button onClick={handleGroupToggle} className="cm-btn" style={{width: '100%', marginTop: '8px'}}>
                                    {contextMenu.target.type === 'activeSelection' ? 'אגד קבוצה' : 'פרק קבוצה'}
                                </button>
                            )}
                        </>
                    ) : (
                        <>
                            <div style={{fontSize: '12px', color: '#aaa', fontWeight: 'bold'}}>פעולות לוח</div>
                            <button onClick={handlePaste} className="cm-btn">הדבק צורה</button>
                            <button onClick={() => {
                                setContextMenu(prev => ({...prev, visible: false}));
                                setBoardSettingsPos({ x: contextMenu.x, y: contextMenu.y });
                                setShowBoardSettings(true);
                            }} className="cm-btn" style={{marginTop: '4px'}}>הגדרות לוח (צבע/רשת)</button>
                        </>
                    )}
                </div>
            )}

            {/* הקונטיינר עכשיו תופס את גודל המסך בדיוק */}
            <div id="board-container" style={{
    position: 'relative', width: '100%', height: '100%',
    background: `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${boardColor}, white 18%) 0%, ${boardColor} 100%)`,
    transition: '0.5s background'
}}>

{boardPatternType !== 'none' && (
    <div ref={patternBgRef} style={{ /* הוספנו כאן את ה-ref */
        position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        backgroundImage:
            boardPatternType === 'grid'
                ? `linear-gradient(rgba(${patternColorRGB}, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(${patternColorRGB}, 0.15) 1px, transparent 1px)`
            : boardPatternType === 'lines'
                ? `linear-gradient(rgba(${patternColorRGB}, 0.15) 1px, transparent 1px)`
            : `radial-gradient(circle, rgba(${patternColorRGB}, 0.45) 1.5px, transparent 1.5px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: '0px 0px', /* נקודת התחלה חיונית לחישוב */
    }} />
)}
                <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 1, width: '100%', height: '100%' }}>
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
                {/* שכבת המתמטיקה מאופסת לגודל 0 כדי לא לתפוס מקום וירטואלי, האלמנטים בתוכה יקבלו מיקום מוחלט */}
                <div id="math-layer" ref={mathLayerRef} style={{ position: 'absolute', top: 0, left: 0, width: '0px', height: '0px', overflow: 'visible', pointerEvents: 'none', zIndex: 3 }}></div>
            </div>
        </div>
    );
});

export default Board;