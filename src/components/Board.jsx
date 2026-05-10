import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import * as fabricPkg from 'fabric';
import 'mathlive'; 
import { createGridGroup, createShape } from '../utils/canvasUtils';
import nerdamer from 'nerdamer';
import 'nerdamer/Algebra';
import 'nerdamer/Calculus';
import 'nerdamer/Solve';

const fabric = fabricPkg.fabric || fabricPkg;
const getPatternContrastColor = (hexColor) => {
    if (!hexColor || !hexColor.startsWith('#')) return '255, 255, 255';
    let r = parseInt(hexColor.slice(1, 3), 16) || 0;
    let g = parseInt(hexColor.slice(3, 5), 16) || 0;
    let b = parseInt(hexColor.slice(5, 7), 16) || 0;
    let luminance = (0.299 * r + 0.587 * g + 0.114 * b);
    return luminance > 140 ? '0, 0, 0' : '255, 255, 255';
};

const Board = forwardRef(({ mode, drawColor, textColor, setMode, globalFontSize, projectId, initialData, onAutoSave, onBack, eraserSize = 20, onBoardColorChange }, ref) => {
    const fabricCanvasElRef = useRef(null);
    const drawingCanvasRef = useRef(null);
    const mathLayerRef = useRef(null);
    const viewportRef = useRef(null);
    const fCanvas = useRef(null);
    const patternBgRef = useRef(null);

    const [boardColor, setBoardColor] = useState(initialData?.bg || '#1e3d32');
    const [boardPatternType, setBoardPatternType] = useState(initialData?.pattern || 'grid');
    const [gridSize, setGridSize] = useState(40);
    const [showBoardSettings, setShowBoardSettings] = useState(false);
    const [boardSettingsPos, setBoardSettingsPos] = useState({ x: 0, y: 0 });
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null });

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
        if (mode !== 'select') s.wasAutoSelected = false;
    }, [mode]);

    const drawColorRef = useRef(drawColor);
    useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
    const textColorRef = useRef(textColor);
    useEffect(() => { textColorRef.current = textColor; }, [textColor]);

const s = useRef({
    drawing: false, points: [], snapTimeout: null, hasSnapped: false, activeBox: null, 
    historyStack: [], redoStack: [], isLocked: false, isPanning: false, lastX: 0, lastY: 0,
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
}).current;

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
            ctx.scale(dpr, dpr); // מסנכרן את יחס הציור כדי למנוע עיוותים
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
                selection: true, isDrawingMode: false, 
                enableRetinaScaling: true, 
                fireMiddleClick: true, allowTouchScrolling: false, 
                stopContextMenu: true, renderOnAddRemove: false 
            });

// --- כניסה אוטומטית לעיגולים הכחולים בלחיצה רגילה (בחירה) ---
            fCanvas.current.on('selection:created', (opt) => {
                if (s.isEnteringNodeEdit || s.forceBoundingBox) return;
                const target = opt.selected[0];
                if (target && isSmartShape(target)) {
                    enterNodeEditMode(target);
                }
            });

            fCanvas.current.on('selection:updated', (opt) => {
                if (s.isEnteringNodeEdit || s.forceBoundingBox) return;
                const target = opt.selected[0];
                if (target && isSmartShape(target)) {
                    enterNodeEditMode(target);
                }
            });

            // --- לחיצה כפולה להחלפה בין עיגולים למסגרת לבנה ---
            fCanvas.current.on('mouse:dblclick', (opt) => {
                const target = opt.target || fCanvas.current.findTarget(opt.e);
                if (target && isSmartShape(target)) {
                    if (s.editCircles.length > 0 && s.editingOriginalObj === target) {
                        // אם אנחנו בעיגולים כחולים -> עוברים למסגרת לבנה
                        s.forceBoundingBox = true;
                        exitNodeEditMode();
                        fCanvas.current.setActiveObject(target);
                        fCanvas.current.requestRenderAll();
                        setTimeout(() => { s.forceBoundingBox = false; }, 200); // משחרר את החסימה מיד אחרי ההחלפה
                    } else if (s.editCircles.length === 0) {
                        // אם אנחנו במסגרת הלבנה -> חוזרים לעיגולים הכחולים
                        enterNodeEditMode(target);
                    }
                }
            });

            // יציאה ממצב עיגולים → חזרה לציור בלחיצה בודדת על הלוח
            fCanvas.current.on('mouse:up', (opt) => {
                if (!opt.target && s.editCircles.length > 0 && !s.longPressFired) {
                    clearTimeout(s.singleTapExitTimer);
                    s.singleTapExitTimer = setTimeout(() => {
                        if (s.editCircles.length > 0) {
                            exitNodeEditMode();
                            setMode('draw');
                            s.wasAutoSelected = false;
                        }
                    }, 250);
                }
                s.longPressFired = false;
            });

            fCanvas.current.on('selection:cleared', () => {
                if (s.isEnteringNodeEdit) return; 
                if (s.isSelectingEditCircle || s.isSelectingShape) return; 
                exitNodeEditMode();
                if (modeRef.current === 'select' && s.wasAutoSelected && s.editCircles.length === 0) {
                    setMode('draw'); s.wasAutoSelected = false;
                }
            });

            // טעינת מידע קיים - חובה לעטוף בטיימר כדי למנוע קריסה של Fabric
            if (initialData && initialData.fabric) {
                setTimeout(() => {
                    s.isLocked = true;
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
            if (s.activeBox) return; 
            if (e.code === 'Escape') { exitNodeEditMode(); setContextMenu({ visible: false, x: 0, y: 0, target: null }); }
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
    if (!s.activePointers.has(e.pointerId)) return;
    s.activePointers.delete(e.pointerId);
    if (s.activePointers.size === 0) {
        s.isPanning = false;
        s.multiTouchStartTime = null;
        s.multiTouchMoved = false;
        s.multiTouchMaxFingers = 0;
        s.multiTouchInitialPositions = new Map();
        if (fCanvas.current) fCanvas.current.selection = true;
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
                if (s.editCircles.length > 0) {
                    s.editCircles.forEach(c => {
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
    s.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

// לחיצה ארוכה — רק אצבע אחת
    if (s.activePointers.size === 1) {
        // ← זיהוי לחיצה כפולה למעבר מעיגולים כחולים → מסגרת לבנה
        const now = Date.now();
        const timeSinceLastTap = now - s.lastTapTime;
        const tapDist = Math.hypot(e.clientX - s.lastTapX, e.clientY - s.lastTapY);
        s.lastTapTime = now;
        s.lastTapX = e.clientX;
        s.lastTapY = e.clientY;

        if (timeSinceLastTap < 350 && tapDist < 40 && s.editCircles.length > 0) {
            clearTimeout(s.singleTapExitTimer); // ← הוסף את השורה הזו
            s.singleTapExitTimer = null;        // ← הוסף את השורה הזו
            if (s.longPressTimer) { clearTimeout(s.longPressTimer); s.longPressTimer = null; }
            const editedObj = s.editingOriginalObj;
            exitNodeEditMode();
            if (editedObj && fCanvas.current) {
                fCanvas.current.setActiveObject(editedObj);
                fCanvas.current.requestRenderAll();
            }
            return; // לא ממשיכים הלאה במידה וזיהינו לחיצה כפולה
        }

        s.longPressStartX = e.clientX;
        s.longPressStartY = e.clientY;
        
        // שומרים את המיקום בצד, כי React מנקה את האירוע אחרי ההשהיה
        const cx = e.clientX;
        const cy = e.clientY;

     s.longPressTimer = setTimeout(() => {
    s.longPressTimer = null;
    s.longPressFired = true; // ← הוסף את השורה הזו כאן!
    s.drawing = false;
    s.points = [];
    s.hasMovedEnoughToDraw = false;
    clearTimeout(s.snapTimeout);
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
        if (objects[i].containsPoint(fabricPoint)) {
            target = objects[i];
            break;
        }
    }

    if (target) {
        setContextMenu({ visible: true, x: cx, y: cy, target });
        setShowBoardSettings(false);
    } else if (s.clipboard) {
        // יש clipboard — מציג תפריט עם אפשרות הדבקה
        setContextMenu({ visible: true, x: cx, y: cy, target: null });
        setShowBoardSettings(false);
    } else {
        setBoardSettingsPos({ x: cx, y: cy });
        setShowBoardSettings(true);
        setContextMenu({ visible: false, x: 0, y: 0, target: null });
    }
}, 500);
    }

    if (s.activePointers.size >= 2 || e.shiftKey) {
        // ביטול לחיצה ארוכה כשנוגעת אצבע שנייה
        if (s.longPressTimer) { clearTimeout(s.longPressTimer); s.longPressTimer = null; }

        if (s.activePointers.size === 2) {
            s.multiTouchStartTime = Date.now();
            s.multiTouchMoved = false;
            s.multiTouchMaxFingers = 2;
            s.multiTouchInitialPositions = new Map(s.activePointers);

            // אתחול פינץ'
            const pts = Array.from(s.activePointers.values());
            s.pinchInitialDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            s.pinchInitialZoom = fCanvas.current ? fCanvas.current.getZoom() : 1;
        }
        if (s.activePointers.size > s.multiTouchMaxFingers) {
            s.multiTouchMaxFingers = s.activePointers.size;
        }

        s.drawing = false;
        if (drawingCanvasRef.current) (() => { const _c = drawingCanvasRef.current; if(_c) _c.getContext("2d").clearRect(0,0,_c.width,_c.height); })();
        if (fCanvas.current) { fCanvas.current.discardActiveObject(); fCanvas.current.selection = false; }
        const pts = Array.from(s.activePointers.values());
        s.lastX = (pts[0].x + pts[1].x) / 2;
        s.lastY = (pts[0].y + pts[1].y) / 2;
    }
};

const handleViewportPointerMove = (e) => {
    if (s.activePointers.has(e.pointerId)) s.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

// ביטול לחיצה ארוכה אם האצבע זזה
    if (s.longPressTimer) {
        const moved = Math.hypot(e.clientX - s.longPressStartX, e.clientY - s.longPressStartY);
        if (moved > 15) { clearTimeout(s.longPressTimer); s.longPressTimer = null; }
    }

    // פינץ' + פאן — שתי אצבעות
    if (s.activePointers.size === 2 && fCanvas.current) {
        const pts = Array.from(s.activePointers.values());
        const currentMidX = (pts[0].x + pts[1].x) / 2;
        const currentMidY = (pts[0].y + pts[1].y) / 2;
        const currentDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

        // בדיקה אם זה מחווה (לא טאפ)
        let maxMovement = 0;
        s.activePointers.forEach((pos, id) => {
            const initial = s.multiTouchInitialPositions.get(id);
            if (initial) { const d = Math.hypot(pos.x - initial.x, pos.y - initial.y); if (d > maxMovement) maxMovement = d; }
        });

        if (maxMovement > 10 || Math.abs(currentDist - s.pinchInitialDist) > 8) {
            s.multiTouchMoved = true;
            s.isPanning = true;
        }

        if (s.multiTouchMoved) {
            const rect = viewportRef.current.getBoundingClientRect();

          // זום פינץ' (ללא הגבלה)
            if (s.pinchInitialDist > 5) {
                const newZoom = Math.max(0.02, Math.min(100, s.pinchInitialZoom * (currentDist / s.pinchInitialDist)));
                fCanvas.current.zoomToPoint({ x: currentMidX - rect.left, y: currentMidY - rect.top }, newZoom);
                
                // ← התוספת שלנו: עדכון דינמי של העיגולים תוך כדי צביטה במסך
                if (s.editCircles.length > 0) {
                    s.editCircles.forEach(c => {
                        c.set({ radius: 10 / newZoom, strokeWidth: 2 / newZoom });
                        c.setCoords();
                    });
                }
            }
            // פאן לפי תנועת נקודת האמצע
            const delta = new fabric.Point(currentMidX - s.lastX, currentMidY - s.lastY);
            fCanvas.current.relativePan(delta);
            syncCustomLayers();

            s.lastX = currentMidX;
            s.lastY = currentMidY;
        }
        return;
    }

    // פאן אצבע + Shift (מחשב)
    if (s.isPanning && fCanvas.current && s.activePointers.size < 2) {
        e.stopPropagation();
        const delta = new fabric.Point(e.clientX - s.lastX, e.clientY - s.lastY);
        fCanvas.current.relativePan(delta);
        syncCustomLayers();
        s.lastX = e.clientX; s.lastY = e.clientY;
    }
};

const handleViewportPointerUp = (e) => {
    if (s.longPressTimer) { clearTimeout(s.longPressTimer); s.longPressTimer = null; }
    s.activePointers.delete(e.pointerId);

        if (s.activePointers.size === 0) {
            // כל האצבעות עלו — עכשיו בודקים טאפ
            const touchDuration = Date.now() - (s.multiTouchStartTime || 0);
            const wasTap = !s.multiTouchMoved && touchDuration < 300 && s.multiTouchMaxFingers >= 2;

            if (wasTap && s.multiTouchMaxFingers === 2) undo();
            else if (wasTap && s.multiTouchMaxFingers >= 3) redo();

            // מאפסים הכל רק אחרי הבדיקה
            s.isPanning = false;
            s.multiTouchStartTime = null;
            s.multiTouchMoved = false;
            s.multiTouchMaxFingers = 0;
            s.multiTouchInitialPositions = new Map();
            s.activePointers.clear();
            if (fCanvas.current) fCanvas.current.selection = true;

        } else if (s.activePointers.size < 2) {
            // נשארה אצבע אחת — עוצרים פאן אבל שומרים את מידע הטאפ!
            s.isPanning = false;
            if (fCanvas.current) fCanvas.current.selection = true;
        }
    };


 const handleContextMenuAction = (clientX, clientY) => {
        if (!fCanvas.current) return;
        const pointer = fCanvas.current.getPointer({ clientX, clientY });
        let target = null;
        const objects = fCanvas.current.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) { if (objects[i].containsPoint(pointer)) { target = objects[i]; break; } }
        
        if (target) {
            // לחיצה על צורה
            setContextMenu({ visible: true, x: clientX, y: clientY, target: target });
            setShowBoardSettings(false);
        } else if (s.clipboard) {
            // לחיצה על הלוח ויש משהו מועתק
            setContextMenu({ visible: true, x: clientX, y: clientY, target: null });
            setShowBoardSettings(false);
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
            const objToDelete = s.editingOriginalObj || contextMenu.target;
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

        shape.on('mousedown', () => { s.isSelectingShape = true; });
        shape.on('mouseup', () => { s.isSelectingShape = false; });

        let lastLeft = shape.left;
        let lastTop = shape.top;

        shape.on('moving', () => {
            const dx = shape.left - lastLeft;
            const dy = shape.top - lastTop;
            s.editCircles.forEach(c => {
                c.set({ left: c.left + dx, top: c.top + dy });
                c.setCoords();
            });
            lastLeft = shape.left;
            lastTop = shape.top;
        });

        shape.on('modified', () => { saveState(); });
    };

    const exitNodeEditMode = () => {
        if (s.editCircles.length > 0) {
            s.editCircles.forEach(c => fCanvas.current.remove(c)); s.editCircles = [];
            if (s.editingOriginalObj) { 
                s.editingOriginalObj.set({ 
                    opacity: 1, selectable: true, evented: true, hasControls: true, 
                    lockRotation: false, lockScalingX: false, lockScalingY: false 
                }); 
                
                s.editingOriginalObj.off('mousedown');
                s.editingOriginalObj.off('mouseup');
                s.editingOriginalObj.off('moving');
                s.editingOriginalObj.off('modified');
                
                fCanvas.current.discardActiveObject(); 
                s.editingOriginalObj = null; 
            }
            fCanvas.current.requestRenderAll();
        }
    };

   const enterNodeEditMode = (obj) => {
        s.isEnteringNodeEdit = true; 
        exitNodeEditMode(); 
        s.editingOriginalObj = obj;
        
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
                strokeWidth: 2 / currentZoom, hasControls: false, hasBorders: false, selectable: true 
            });
            circle.on('mousedown', () => { s.isSelectingEditCircle = true; });
            circle.on('mouseup', () => { s.isSelectingEditCircle = false; });
            circle.on('moving', () => { onDrag(circle); fCanvas.current.requestRenderAll(); });
            circle.on('modified', () => { saveState(); });
            fCanvas.current.add(circle); 
            s.editCircles.push(circle); 
            return circle;
        };

        // 1. טיפול בכל צורה שיש לה נקודות
        if (obj.points) {
            const nodes = [];
            obj.points.forEach((p) => {
                const absP = getAbs(p);
                const n = makeNode(absP.x, absP.y, () => {
                    const absolutePoints = nodes.map(nd => ({ x: nd.left, y: nd.top }));
                    updateNodeGeometry(new fabric.Polygon(absolutePoints, { 
                        fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, 
                        strokeLineJoin: 'round', customType: obj.customType 
                    }));
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
            const center = obj.getPointByOrigin('center', 'center'); const rx = obj.rx * obj.scaleX; const ry = obj.ry * obj.scaleY;
            const rN = makeNode(center.x + rx, center.y, (c) => {
                const newRx = Math.max(1, Math.abs(c.left - center.x)); lN.set({ left: center.x - newRx, top: center.y }); lN.setCoords();
                updateNodeGeometry(new fabric.Ellipse({ originX: 'center', originY: 'center', left: center.x, top: center.y, rx: newRx, ry: Math.max(1, Math.abs(bN.top - center.y)), fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'ellipse' }));
            });
            const lN = makeNode(center.x - rx, center.y, (c) => {
                const newRx = Math.max(1, Math.abs(c.left - center.x)); rN.set({ left: center.x + newRx, top: center.y }); rN.setCoords();
                updateNodeGeometry(new fabric.Ellipse({ originX: 'center', originY: 'center', left: center.x, top: center.y, rx: newRx, ry: Math.max(1, Math.abs(bN.top - center.y)), fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'ellipse' }));
            });
            const bN = makeNode(center.x, center.y + ry, (c) => {
                const newRy = Math.max(1, Math.abs(c.top - center.y)); tN.set({ left: center.x, top: center.y - newRy }); tN.setCoords();
                updateNodeGeometry(new fabric.Ellipse({ originX: 'center', originY: 'center', left: center.x, top: center.y, rx: Math.max(1, Math.abs(rN.left - center.x)), ry: newRy, fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'ellipse' }));
            });
            const tN = makeNode(center.x, center.y - ry, (c) => {
                const newRy = Math.max(1, Math.abs(c.top - center.y)); bN.set({ left: center.x, top: center.y + newRy }); bN.setCoords();
                updateNodeGeometry(new fabric.Ellipse({ originX: 'center', originY: 'center', left: center.x, top: center.y, rx: Math.max(1, Math.abs(rN.left - center.x)), ry: newRy, fill: obj.fill, stroke: color, strokeWidth: obj.strokeWidth, customType: 'ellipse' }));
            });
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
        s.isEnteringNodeEdit = false; 
    };

  const updateNodeGeometry = (newObj) => {
        const obj = s.editingOriginalObj; 
        fCanvas.current.remove(obj); 
        
        bindShapeEvents(newObj); // חיבור מחדש של אירועי הגרירה לצורה החדשה
        
        fCanvas.current.add(newObj);
        
        // הפתרון לקפיצות: להבטיח שהעיגולים הכחולים תמיד נשארים השכבה העליונה ביותר!
        // ברגע שהצורה החדשה נוצרה, נוודא שהיא לא מסתירה אותם וגונבת את הלחיצה.
        s.editCircles.forEach(c => {
            if (typeof c.bringToFront === 'function') c.bringToFront();
            else if (typeof fCanvas.current.bringObjectToFront === 'function') fCanvas.current.bringObjectToFront(c);
            
            c.setCoords(); // קריטי: מעדכן את תיבת הלחיצה הבלתי נראית של העיגול כדי שהעכבר יזהה אותו
        });
        
        s.editingOriginalObj = newObj;
    };

    const eraserSizeRef = useRef(eraserSize);
    useEffect(() => { eraserSizeRef.current = eraserSize; }, [eraserSize]);
    
    const autosaveTimerRef = useRef(null);
    
    // Apple Pencil barrel button → מצב מחק זמני
    const prevModeRef = useRef(null);
    
    useEffect(() => {
        const handleBarrelButton = (e) => {
            // כפתור הצד של Apple Pencil = e.button === 5 (eraser) או pointerType === 'pen' + buttons & 32
            if (e.pointerType !== 'pen') return;
            const isBarrelPressed = (e.buttons & 32) !== 0;
            if (isBarrelPressed && modeRef.current !== 'erase') {
                prevModeRef.current = modeRef.current;
                setMode('erase');
            }
        };
        const handleBarrelRelease = (e) => {
            if (e.pointerType !== 'pen') return;
            const isBarrelPressed = (e.buttons & 32) !== 0;
            if (!isBarrelPressed && prevModeRef.current !== null && modeRef.current === 'erase') {
                setMode(prevModeRef.current);
                prevModeRef.current = null;
            }
        };
        window.addEventListener('pointerdown', handleBarrelButton, { passive: true });
        window.addEventListener('pointermove', handleBarrelButton, { passive: true });
        window.addEventListener('pointerup', handleBarrelRelease, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', handleBarrelButton);
            window.removeEventListener('pointermove', handleBarrelButton);
            window.removeEventListener('pointerup', handleBarrelRelease);
        };
    }, [setMode]);

    const saveState = () => {
        if (!fCanvas.current || s.isLocked) return;
        const mathData = Array.from(mathLayerRef.current.children).map(wrapper => {
            const mf = wrapper.querySelector('math-field');
            return { left: wrapper.style.left, top: wrapper.style.top, value: mf ? mf.getValue() : '', size: mf ? mf.style.fontSize : '48px', color: mf ? mf.style.color : '#fff' };
        });
        const state = { fabric: fCanvas.current.toObject(['customType']), math: mathData };
        
        s.historyStack.push(JSON.stringify(state)); 
        if (s.historyStack.length > 25) s.historyStack.shift(); 
        s.redoStack = []; 

        // מנגנון Debounce לשמירה אוטומטית מקומית (IndexedDB)
        if (onAutoSave) {
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = setTimeout(() => {
                onAutoSave({ fabric: state.fabric, math: state.math, bg: boardColor, pattern: boardPatternType });
            }, 1500); // מחכה 1.5 שניות של חוסר פעילות לפני כתיבה למסד הנתונים
        }
    };

    const undo = () => {
        if (s.historyStack.length <= 1 || s.isLocked) return;
        exitNodeEditMode(); s.isLocked = true; s.redoStack.push(s.historyStack.pop());
        restore(JSON.parse(s.historyStack[s.historyStack.length - 1]));
    };

    const redo = () => {
        if (s.redoStack.length === 0 || s.isLocked) return;
        exitNodeEditMode(); s.isLocked = true; const stateStr = s.redoStack.pop();
        s.historyStack.push(stateStr); restore(JSON.parse(stateStr));
    };

const restore = (state) => {
    deactivateBox(false);

    let done = false;
    const finish = () => {
        if (done) return; // מונע הרצה כפולה
        done = true;
        fCanvas.current.requestRenderAll();
        mathLayerRef.current.innerHTML = '';
        state.math.forEach(data => {
            mathLayerRef.current.appendChild(
                createMathFieldDOM(data.left, data.top, data.value, data.size, data.color)
            );
        });
        s.isLocked = false; // ← משחרר את הנעילה!
    };

    // תמיכה בשתי גרסאות של Fabric:
    // v5 = callback, v6 = Promise
    const result = fCanvas.current.loadFromJSON(state.fabric, finish);
    if (result && typeof result.then === 'function') {
        result.then(finish).catch(finish);
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
        clearBoard: () => { deactivateBox(false); exitNodeEditMode(); fCanvas.current.clear(); mathLayerRef.current.innerHTML = ''; saveState(); },
        solveActiveBox: () => {
            if (!s.activeBox) { alert("לחץ קודם על המשוואה שאתה רוצה לפתור!"); return; }
            let resultLatex = ""; let latexEq = "";
            try {
                const plainMath = s.activeBox.getValue('ascii-math'); latexEq = s.activeBox.getValue('latex');
                const parsed = nerdamer(plainMath); const vars = parsed.variables();
                if (plainMath.includes('=')) {
                    const targetVar = vars.length > 0 ? vars[0] : 'x';
                    const solutions = nerdamer.solve(plainMath, targetVar); resultLatex = `\\Rightarrow ${targetVar} = ` + solutions.toTeX(); 
                } else if (vars.length > 0) {
                    const targetVar = vars[0]; const simplified = parsed.simplify().toTeX();
                    const solutions = nerdamer.solve(plainMath, targetVar).toTeX();
                    resultLatex = `= ${simplified} \\quad \\Rightarrow ${targetVar} = ${solutions}`;
                } else { resultLatex = `= ` + parsed.evaluate().toTeX(); }
            } catch (mathError) { console.error("Math Calculation Error:", mathError); alert("המחשבון לא הצליח לפתור את הביטוי הזה."); return; }
            try { s.activeBox.setValue(`${latexEq} \\textcolor{#fde047}{\\; ${resultLatex}}`); s.activeBox.focus(); saveState(); } catch (uiError) {}
        },
        updateActiveColor: (newColor) => { if (s.activeBox) { s.activeBox.style.color = newColor; saveState(); } },
        updateGlobalFontSize: (delta) => { if (s.activeBox) { let currentSize = parseFloat(s.activeBox.style.fontSize) || 48; s.activeBox.style.fontSize = Math.max(16, currentSize + delta) + 'px'; saveState(); } },
        addGrid: (cols, rows) => { const center = getCenterPos(); const grid = createGridGroup(cols, rows, drawColorRef.current); grid.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' }); fCanvas.current.add(grid); fCanvas.current.setActiveObject(grid); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); },
        addImage: (dataUrl) => { const imgEl = new Image(); imgEl.onload = () => { const center = getCenterPos(); const fabricImg = new fabric.Image(imgEl); fabricImg.scaleToWidth(400); fabricImg.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' }); fCanvas.current.add(fabricImg); fCanvas.current.setActiveObject(fabricImg); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); }; imgEl.src = dataUrl; },
    
       addShape: (type) => { 
            const center = getCenterPos(); 
            const obj = createShape(type, drawColorRef.current, center, getStrokeWidth()); 
            
            if (obj) { 
                fCanvas.current.add(obj); 
                setMode('select'); 
                s.wasAutoSelected = true; 
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
        if (!s.activeBox) return;
        s.activeBox.wrapper.classList.remove('active-wrapper');
        if (!s.activeBox.getValue().trim()) s.activeBox.wrapper.remove(); 
        s.activeBox.blur(); if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide(); 
        s.activeBox = null; if (shouldSave) saveState();
    };

    const createMathFieldDOM = (left, top, value = '', size, color) => {
        const wrapper = document.createElement('div'); wrapper.className = 'math-wrapper'; wrapper.style.left = left; wrapper.style.top = top; 
        const mf = document.createElement('math-field'); mf.className = 'math-box'; mf.style.fontSize = size; mf.style.color = color; mf.setValue(value); mf.mathVirtualKeyboardPolicy = "manual"; mf.wrapper = wrapper; wrapper.appendChild(mf);
        
        mf.addEventListener('focusin', () => {
            if (s.activeBox !== mf) deactivateBox(false);
            s.activeBox = mf; wrapper.classList.add('active-wrapper');
            if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show();
            setTimeout(() => { 
                const rect = wrapper.getBoundingClientRect(); const safeHeight = window.innerHeight - 320; 
                if (rect.bottom > safeHeight && fCanvas.current) {
                    fCanvas.current.relativePan(new fabric.Point(0, -(rect.bottom - safeHeight + 60))); syncCustomLayers();
                }
            }, 400); 
        });
        
        mf.addEventListener('input', () => { clearTimeout(s.snapTimeout); s.snapTimeout = setTimeout(saveState, 1000); });
        let isDragging = false; let dragOffset = { x: 0, y: 0 };
        
        wrapper.addEventListener('pointerdown', (e) => { 
            if (modeRef.current === 'select') { 
                e.stopPropagation(); isDragging = true; 
                dragOffset = { x: e.clientX - parseFloat(wrapper.style.left), y: e.clientY - parseFloat(wrapper.style.top) }; 
                wrapper.style.cursor = 'grabbing'; mf.style.cursor = 'grabbing'; s.activeBox = mf; 
            }
        });
        window.addEventListener('pointermove', (e) => { if (isDragging && modeRef.current === 'select') { wrapper.style.left = (e.clientX - dragOffset.x) + 'px'; wrapper.style.top = (e.clientY - dragOffset.y) + 'px'; } });
        window.addEventListener('pointerup', () => { if (isDragging) { isDragging = false; wrapper.style.cursor = 'default'; mf.style.cursor = 'text'; saveState(); } });
        
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

  const handlePointerDown = (e) => {
       if (s.isPanning || s.activePointers.size >= 2) return;
        if (s.activeBox || (window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible)) { deactivateBox(); return; }
        if (!e.target.closest('.context-menu') && s.editCircles.length > 0) exitNodeEditMode();

        // setPointerCapture הכרחי כדי שpointerUp יגיע תמיד גם אם האצבע יצאה מהcanvas
        // אבל רק ב-mouse/touch — לא ב-pen שמקבל capture אוטומטי
        if (e.pointerType !== 'pen' && e.target && e.target.setPointerCapture) {
            try { e.target.setPointerCapture(e.pointerId); } catch(err){}
        }

        // שימוש בפונקציה האחידה!
        const { screenX, screenY, virtualX, virtualY } = getCanvasCoords(e.clientX, e.clientY);
        const coords = { x: virtualX, y: virtualY };

        if (modeRef.current === 'select') { 
            const target = fCanvas.current.findTarget(e.nativeEvent);
            if (!target && s.wasAutoSelected) { setMode('draw'); s.wasAutoSelected = false; return; } return; 
        }
        
        if (modeRef.current === 'text') { 
            const wrapper = createMathFieldDOM(virtualX + 'px', (virtualY - 30) + 'px', '', globalFontSize + 'px', textColorRef.current);
            mathLayerRef.current.appendChild(wrapper); wrapper.querySelector('math-field').focus();
       
        } else if (modeRef.current === 'draw' || modeRef.current === 'erase') {
            s.drawing = true; 
            s.hasSnapped = false; 
            s.hasMovedEnoughToDraw = false; // ← איפוס המשתנה לפני שמתחילים לצייר
            s.points = [coords]; 
            s.liveObj = null;
            const ctx = drawingCanvasRef.current.getContext('2d'); 
            ctx.lineCap = 'round'; ctx.lineJoin = 'round'; 
            
            // ניקוי הקנבס לפי הגודל הנכון שלו
            ctx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height); 
            ctx.beginPath(); 
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(screenX, screenY + 0.01);
            
            if (modeRef.current === 'erase') { ctx.lineWidth = eraserSize || 20; ctx.strokeStyle = 'rgba(255,0,0,0.3)'; } 
            else { ctx.lineWidth = 3; ctx.strokeStyle = drawColorRef.current; }
            ctx.stroke();
        }
    };

 const handlePointerMove = (e) => {
        if (s.isPanning || !s.drawing || s.activePointers.size >= 2) return;
            // ← הוסף: אל תתחיל ציור עד שזזת לפחות 5px (מונע התנגשות עם long press)
    if (s.drawing && !s.hasMovedEnoughToDraw) {
        const moved = Math.hypot(e.clientX - s.longPressStartX, e.clientY - s.longPressStartY);
        if (moved < 5) return;
        s.hasMovedEnoughToDraw = true;
    }
        
        // שימוש באותה פונקציה אחידה בדיוק כמו בלחיצה!
        const { screenX, screenY, virtualX, virtualY } = getCanvasCoords(e.clientX, e.clientY);
        const coords = { x: virtualX, y: virtualY };
        const zoom = fCanvas.current.getZoom(); 
        
        if (s.liveObj) {
            fCanvas.current.remove(s.liveObj);
            
            if (s.liveObjType === 'line') s.liveObj = buildLine(s.liveObjProps.start, coords, drawColorRef.current);
            else if (s.liveObjType === 'arrow') s.liveObj = buildArrow(s.liveObjProps.start, coords, drawColorRef.current);
            else if (s.liveObjType === 'curve') {
                let cpX = 2 * s.liveObjProps.extremePoint.x - 0.5 * s.liveObjProps.start.x - 0.5 * coords.x; 
                let cpY = 2 * s.liveObjProps.extremePoint.y - 0.5 * s.liveObjProps.start.y - 0.5 * coords.y; 
                s.liveObj = buildCurve(s.liveObjProps.start, {x: cpX, y: cpY}, coords, drawColorRef.current);
            }
            else if (s.liveObjType === 'ellipse') {
                let newRx = Math.max(1, Math.abs(coords.x - s.liveObjProps.cx) + s.liveObjProps.offsetRx); 
                let newRy = Math.max(1, Math.abs(coords.y - s.liveObjProps.cy) + s.liveObjProps.offsetRy);
                s.liveObj = new fabric.Ellipse({ originX: 'center', originY: 'center', left: s.liveObjProps.cx, top: s.liveObjProps.cy, rx: newRx, ry: newRy, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: getStrokeWidth(), customType: 'ellipse' });
            }
            else if (s.liveObjType === 'rect') {
                let vX = coords.x + s.liveObjProps.offsetX; let vY = coords.y + s.liveObjProps.offsetY; 
                let newL = Math.min(s.liveObjProps.anchorX, vX); let newT = Math.min(s.liveObjProps.anchorY, vY);
                let w = Math.max(1, Math.abs(vX - s.liveObjProps.anchorX)); let h = Math.max(1, Math.abs(vY - s.liveObjProps.anchorY));
                s.liveObj = new fabric.Rect({ originX: 'left', originY: 'top', left: newL, top: newT, width: w, height: h, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: getStrokeWidth(), customType: 'rect' });
            }
            else if (s.liveObjType === 'triangle') {
                let vX = coords.x + s.liveObjProps.offsetX; let vY = coords.y + s.liveObjProps.offsetY;
                s.liveObj = new fabric.Polygon([s.liveObjProps.baseLeft, s.liveObjProps.baseRight, {x: vX, y: vY}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: getStrokeWidth(), strokeLineJoin: 'round', customType: 'triangle' });
            }
            
            fCanvas.current.add(s.liveObj); 
            fCanvas.current.requestRenderAll(); 
            return;
        }

        if (s.hasSnapped) return;
        const ctx = drawingCanvasRef.current.getContext('2d'); 
        s.points.push(coords); 
        
        ctx.lineTo(screenX, screenY); 
        ctx.stroke(); 
        ctx.beginPath(); 
        ctx.moveTo(screenX, screenY);
        
        if (modeRef.current === 'erase') {
            const actualEraserRadius = (eraserSize || 20) / zoom;
            // מחיקת שדות מתמטיקה
            Array.from(mathLayerRef.current.children).forEach(wrapper => {
                const boxX = parseFloat(wrapper.style.left) + wrapper.offsetWidth / 2;
                const boxY = parseFloat(wrapper.style.top) + wrapper.offsetHeight / 2;
                if (Math.hypot(boxX - coords.x, boxY - coords.y) < Math.max(wrapper.offsetWidth, wrapper.offsetHeight) / 2 + actualEraserRadius) wrapper.remove();
            });
            // מחיקת אובייקטים של Fabric בבדיקת חיתוך אמיתית
            const toRemove = [];
            fCanvas.current.getObjects().forEach(obj => {
                if (obj.opacity === 0.5) return; // עיגולי עריכה
                // בדיקה אם נקודת המחק חוצה את אזור האובייקט (עם שוליים לפי רדיוס המחק)
                const objBounds = obj.getBoundingRect(true);
                const eraserLeft = coords.x - actualEraserRadius;
                const eraserRight = coords.x + actualEraserRadius;
                const eraserTop = coords.y - actualEraserRadius;
                const eraserBottom = coords.y + actualEraserRadius;
                // בדיקת חפיפת מלבנים
                if (eraserRight >= objBounds.left && eraserLeft <= objBounds.left + objBounds.width &&
                    eraserBottom >= objBounds.top && eraserTop <= objBounds.top + objBounds.height) {
                    toRemove.push(obj);
                }
            });
            toRemove.forEach(obj => fCanvas.current.remove(obj));
            if (toRemove.length > 0) fCanvas.current.requestRenderAll();
            return;
        }

        // --- שטח מת למניעת שבירת הטיימר ---
        if (s.points.length > 1) {
            const lastPt = s.points[s.points.length - 2]; 
            const dist = Math.hypot(coords.x - lastPt.x, coords.y - lastPt.y);
            if (dist > 2) { // מתאפס רק אם זזת משמעותית
                clearTimeout(s.snapTimeout);
                s.snapTimeout = setTimeout(recognizeAndConvertToFabric, 400);
            }
        } else {
            clearTimeout(s.snapTimeout);
            s.snapTimeout = setTimeout(recognizeAndConvertToFabric, 400);
        }
    };

    const handlePointerUp = (e) => {
        if (e && e.pointerType !== 'pen' && e.target && e.target.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch(err){}
        }

        if (s.isPanning) return; 
        if (s.liveObj) {
            const obj = s.liveObj;
            s.liveObj = null;
            setMode('select');
            s.wasAutoSelected = true;
            saveState();
            enterNodeEditMode(obj); // פותח עיגולים במקום מסגרת לבנה
        } else if (s.drawing && !s.hasSnapped && modeRef.current === 'draw') convertToScribble();
        if (modeRef.current === 'erase') saveState();
        s.drawing = false; s.points = []; clearTimeout(s.snapTimeout);
        const cvs = drawingCanvasRef.current;
        if (cvs) cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
    };

    const convertToScribble = () => {
        if(s.points.length < 2) return;
        const pathData = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const pathObj = new fabric.Path(pathData, { fill: 'transparent', stroke: drawColorRef.current, strokeWidth: getStrokeWidth(), strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true });
        fCanvas.current.add(pathObj); fCanvas.current.requestRenderAll(); saveState(); s.points = [];
    };

    const recognizeAndConvertToFabric = () => {
        if (s.points.length < 15 || modeRef.current === 'erase' || s.hasSnapped) return;
        const start = s.points[0]; const end = s.points[s.points.length - 1]; let pathLength = 0; for(let i=1; i<s.points.length; i++) pathLength += Math.hypot(s.points[i].x - s.points[i-1].x, s.points[i].y - s.points[i-1].y);
        const endDist = Math.hypot(end.x - start.x, end.y - start.y); let minX = Math.min(...s.points.map(p => p.x)); let maxX = Math.max(...s.points.map(p => p.x)); let minY = Math.min(...s.points.map(p => p.y)); let maxY = Math.max(...s.points.map(p => p.y)); let width = maxX - minX; let height = maxY - minY;
        let objToAdd = null; let objType = null; let objProps = {}; let maxDistFromStart = 0; let tipIndex = 0;
        for (let i = 0; i < s.points.length; i++) { let d = Math.hypot(s.points[i].x - start.x, s.points[i].y - start.y); if (d > maxDistFromStart) { maxDistFromStart = d; tipIndex = i; } }
        let tip = s.points[tipIndex];
        
        if (tipIndex > s.points.length * 0.6 && tipIndex < s.points.length - 5 && maxDistFromStart > 50) { objToAdd = buildArrow(start, tip, drawColorRef.current); objType = 'arrow'; objProps = { start: start }; } 
        else if (endDist / pathLength > 0.85) { objToAdd = buildLine(start, end, drawColorRef.current); objType = 'line'; objProps = { start: start }; }
        else if (endDist < Math.max(width, height) * 0.25) { 
            const cx = minX + width / 2; const cy = minY + height / 2; let isEllipse = true;
            for(let p of s.points) { if (Math.hypot((p.x - cx) / width, (p.y - cy) / height) > 0.65) { isEllipse = false; break; } }
            if (isEllipse) { let rx = width / 2; let ry = height / 2; let offsetRx = rx - Math.abs(end.x - cx); let offsetRy = ry - Math.abs(end.y - cy); objToAdd = new fabric.Ellipse({ originX: 'center', originY: 'center', left: cx, top: cy, rx: rx, ry: ry, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: getStrokeWidth() }); objToAdd.customType = 'ellipse'; objType = 'ellipse'; objProps = { cx: cx, cy: cy, offsetRx: offsetRx, offsetRy: offsetRy }; 
            } else { let topPoints = s.points.filter(p => p.y < minY + height * 0.2); let bottomPoints = s.points.filter(p => p.y > maxY - height * 0.2); let topWidth = topPoints.length > 0 ? Math.max(...topPoints.map(p=>p.x)) - Math.min(...topPoints.map(p=>p.x)) : 0; let bottomWidth = bottomPoints.length > 0 ? Math.max(...bottomPoints.map(p=>p.x)) - Math.min(...bottomPoints.map(p=>p.x)) : 0;
                if (bottomWidth > width * 0.5 && topWidth < width * 0.4) { let offsetX = cx - end.x; let offsetY = minY - end.y; objToAdd = new fabric.Polygon([{x: cx, y: minY}, {x: maxX, y: maxY}, {x: minX, y: maxY}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: getStrokeWidth() }); objToAdd.customType = 'triangle'; objType = 'triangle'; objProps = { baseLeft: {x: minX, y: maxY}, baseRight: {x: maxX, y: maxY}, offsetX: offsetX, offsetY: offsetY }; } else { let anchorX = (end.x > cx) ? minX : maxX; let anchorY = (end.y > cy) ? minY : maxY; let cornerX = (end.x > cx) ? maxX : minX; let cornerY = (end.y > cy) ? maxY : minY; let offsetX = cornerX - end.x; let offsetY = cornerY - end.y; objToAdd = new fabric.Rect({ originX: 'left', originY: 'top', left: minX, top: minY, width: width, height: height, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: getStrokeWidth() }); objToAdd.customType = 'rect'; objType = 'rect'; objProps = { anchorX: anchorX, anchorY: anchorY, offsetX: offsetX, offsetY: offsetY }; }
            }
        } 
        else { let maxPerpDist = 0; let extremePoint = null; let A = end.y - start.y; let B = -(end.x - start.x); let C = end.x * start.y - end.y * start.x; let denom = Math.hypot(A, B); for (let p of s.points) { let dist = Math.abs(A * p.x + B * p.y + C) / denom; if (dist > maxPerpDist) { maxPerpDist = dist; extremePoint = p; } }
            if (maxPerpDist > Math.max(50, endDist * 0.25) && endDist > 50) { let cpX = 2 * extremePoint.x - 0.5 * start.x - 0.5 * end.x; let cpY = 2 * extremePoint.y - 0.5 * start.y - 0.5 * end.y; objToAdd = buildCurve(start, {x: cpX, y: cpY}, end, drawColorRef.current); objType = 'curve'; objProps = { start: start, extremePoint: extremePoint }; }
        }

      if (objToAdd) { 
            s.hasSnapped = true; const liveTypes = ['line', 'arrow', 'curve', 'ellipse', 'rect', 'triangle'];
            if (s.drawing && objType && liveTypes.includes(objType)) { 
                s.liveObj = objToAdd; s.liveObjType = objType; s.liveObjProps = objProps; fCanvas.current.add(s.liveObj); 
            } else { 
                fCanvas.current.add(objToAdd); 
                setMode('select'); 
                s.wasAutoSelected = true; 
                saveState(); 
                enterNodeEditMode(objToAdd); // פותח עיגולים במקום מסגרת לבנה
            }
            (() => { const _c = drawingCanvasRef.current; if(_c) _c.getContext("2d").clearRect(0,0,_c.width,_c.height); })(); 
            fCanvas.current.requestRenderAll(); 
            s.points = []; 
        }
    };

    const handleColorChange = (c) => { if (contextMenu.target) { contextMenu.target.set('stroke', c); fCanvas.current.requestRenderAll(); saveState(); }};
    const handleThicknessChange = (delta) => { if (contextMenu.target) { let w = contextMenu.target.strokeWidth || 3; contextMenu.target.set('strokeWidth', Math.max(1, w + delta)); fCanvas.current.requestRenderAll(); saveState(); }};
   const handleCopy = () => { 
        if (contextMenu.target) { 
            // מוודאים שאנחנו מעתיקים את הצורה המקורית אם היא בעריכה
            const targetToCopy = s.editingOriginalObj || contextMenu.target;
            
            const processClone = (cloned) => {
                // מחזירים לאטימות מלאה למקרה שהצורה הועתקה באמצע עריכה
                cloned.set({ opacity: 1, selectable: true, evented: true, hasControls: true });
                s.clipboard = cloned;
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
        if (s.clipboard) { 
            const processPaste = (cloned) => { 
                fCanvas.current.discardActiveObject(); 
                
                // מזיזים את ההדבקה קצת ימינה ולמטה כדי שלא תסתיר את המקור
                cloned.set({ left: cloned.left + 30, top: cloned.top + 30, evented: true, selectable: true, opacity: 1 }); 
                fCanvas.current.add(cloned); 
                s.clipboard.top += 30; 
                s.clipboard.left += 30; 
                
                // ─── התוספת שלנו לחווית משתמש מושלמת ───
                setMode('select'); 
                s.wasAutoSelected = true;
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
            const result = s.clipboard.clone(['customType']);
            if (result && typeof result.then === 'function') {
                result.then(processPaste);
            } else {
                s.clipboard.clone(processPaste, ['customType']);
            }
        } 
        setContextMenu(prev => ({...prev, visible: false})); 
    };

    const patternColorRGB = getPatternContrastColor(boardColor);
    const handleViewportPointerCancel = (e) => {
    // שים לב: לא מנקים את s.longPressTimer כאן!
    // pointercancel מגיע לפני שהטיימר יורה — אם ננקה אותו, long press לא יעבוד לעולם
    s.activePointers.delete(e.pointerId);
    if (s.activePointers.size === 0) {
        s.isPanning = false;
        s.multiTouchStartTime = null;
        s.multiTouchMoved = false;
        s.multiTouchMaxFingers = 0;
        s.multiTouchInitialPositions = new Map();
        s.activePointers.clear();
        if (fCanvas.current) fCanvas.current.selection = true;
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
                position: 'relative', cursor: s.isPanning ? 'grabbing' : 'default',
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
       <div style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
             onPointerDown={(e) => { e.stopPropagation(); setShowBoardSettings(false); }} />
        <div dir="rtl" style={{
            position: 'fixed',
            top: Math.min(boardSettingsPos.y, window.innerHeight - 420),
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

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '4px 0 14px' }} />

            {/* פעולות */}
            <button onClick={() => {
                if (fCanvas.current) { fCanvas.current.setViewportTransform([1,0,0,1,0,0]); syncCustomLayers(); }
                setShowBoardSettings(false);
            }} style={{
                width: '100%', padding: '9px', borderRadius: '10px', border: 'none',
                background: 'rgba(255,255,255,0.06)', color: '#a1a1aa',
                cursor: 'pointer', fontSize: '13px', marginBottom: '6px', textAlign: 'center',
            }}>🔍 אפס זום ל-100%</button>
        </div>
    </>
)}

{contextMenu.visible && (
                <div className="context-menu" dir="rtl" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 10000, background: 'rgba(28, 28, 30, 0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', color: 'white', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '150px' }}>
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
                                <button onClick={handleDeleteTarget} className="cm-btn" style={{flex: 1, color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)'}}>מחק</button>
                            </div>
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
                    pointerEvents: (mode === 'draw' || mode === 'erase' || mode === 'text') ? 'auto' : 'none' 
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