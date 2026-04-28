import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import * as fabricPkg from 'fabric';
import 'mathlive'; 
import { createGridGroup, createShape } from '../utils/canvasUtils';
import nerdamer from 'nerdamer';
import 'nerdamer/Algebra';
import 'nerdamer/Calculus';
import 'nerdamer/Solve';

const fabric = fabricPkg.fabric || fabricPkg;
const BOARD_SIZE = 10000; 

const Board = forwardRef(({ mode, drawColor, textColor, setMode, globalFontSize }, ref) => {
    const fabricCanvasElRef = useRef(null);
    const drawingCanvasRef = useRef(null);
    const mathLayerRef = useRef(null);
    const viewportRef = useRef(null);
    const fCanvas = useRef(null);

    const [boardBg, setBoardBg] = useState('radial-gradient(circle, #2a5244 0%, #1e3d32 100%)');
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, target: null });

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
        activePointers: new Map() 
    }).current;

   const syncCustomLayers = () => {
        if (!fCanvas.current) return;
        const vpt = fCanvas.current.viewportTransform; 
        const transform = `matrix(${vpt[0]}, ${vpt[1]}, ${vpt[2]}, ${vpt[3]}, ${vpt[4]}, ${vpt[5]})`;
        
        if (drawingCanvasRef.current) {
            drawingCanvasRef.current.style.transform = transform;
            drawingCanvasRef.current.style.transformOrigin = '0 0';
        }
        if (mathLayerRef.current) {
            mathLayerRef.current.style.transform = transform;
            mathLayerRef.current.style.transformOrigin = '0 0';
        }
        
        // ---> התיקון: מכריחים את פבריק לצייר את המסך מחדש מיד אחרי הזזת המצלמה <---
        fCanvas.current.requestRenderAll(); 
    };

    useEffect(() => {
        setTimeout(() => {
            if (fCanvas.current) {
                const zoom = fCanvas.current.getZoom();
                const vpt = fCanvas.current.viewportTransform;
                vpt[4] = -(BOARD_SIZE * zoom - window.innerWidth) / 2;
                vpt[5] = -(BOARD_SIZE * zoom - window.innerHeight) / 2;
                fCanvas.current.requestRenderAll();
                syncCustomLayers();
            }
        }, 100);

        fCanvas.current = new fabric.Canvas(fabricCanvasElRef.current, {
            width: BOARD_SIZE, height: BOARD_SIZE, selection: true, isDrawingMode: false, 
            enableRetinaScaling: false, fireMiddleClick: true, allowTouchScrolling: false, 
            stopContextMenu: true, renderOnAddRemove: false 
        });

        fCanvas.current.on('mouse:dblclick', (opt) => {
            const target = opt.target || fCanvas.current.findTarget(opt.e);
            if (target && target.customType) enterNodeEditMode(target);
        });

        fCanvas.current.on('selection:cleared', () => {
            if (s.isEnteringNodeEdit) return; 
            exitNodeEditMode();
            if (modeRef.current === 'select' && s.wasAutoSelected && s.editCircles.length === 0) {
                setMode('draw'); s.wasAutoSelected = false;
            }
        });

        setTimeout(saveState, 200);

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
                syncCustomLayers();
            } else { 
                const delta = new fabric.Point(-e.deltaX, -e.deltaY);
                fCanvas.current.relativePan(delta);
                syncCustomLayers();
            }
        };
        if (viewport) viewport.addEventListener('wheel', handleNativeWheel, { passive: false });

        // ---- ההגנה האגרסיבית נגד השתלטות של iPadOS על אירועי מגע ו-Scribble ----
        const dCanvas = drawingCanvasRef.current;
        const preventAppleGestures = (e) => {
            // חוסם רק כשבאמת מנסים לצייר/למחוק עם אצבע/עט בודד
            if ((modeRef.current === 'draw' || modeRef.current === 'erase') && e.touches && e.touches.length === 1) {
                e.preventDefault();
            }
        };

        if (dCanvas) {
            dCanvas.addEventListener('touchstart', preventAppleGestures, { passive: false });
            dCanvas.addEventListener('touchmove', preventAppleGestures, { passive: false });
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('pointerdown', closeMenu);
            if (viewport) viewport.removeEventListener('wheel', handleNativeWheel);
            if (dCanvas) {
                dCanvas.removeEventListener('touchstart', preventAppleGestures);
                dCanvas.removeEventListener('touchmove', preventAppleGestures);
            }
            if (fCanvas.current) fCanvas.current.dispose();
        };
    }, [setMode]);

    const handleViewportPointerDown = (e) => {
        s.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (s.activePointers.size === 2 || e.shiftKey) {
            s.isPanning = true;
            s.drawing = false; 
            if (drawingCanvasRef.current) drawingCanvasRef.current.getContext('2d').clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
            if (fCanvas.current) { fCanvas.current.discardActiveObject(); fCanvas.current.selection = false; }
            const pts = Array.from(s.activePointers.values());
            s.lastX = s.activePointers.size === 2 ? (pts[0].x + pts[1].x) / 2 : e.clientX;
            s.lastY = s.activePointers.size === 2 ? (pts[0].y + pts[1].y) / 2 : e.clientY;
        }
    };

    const handleViewportPointerMove = (e) => {
        if (s.activePointers.has(e.pointerId)) s.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (s.isPanning && fCanvas.current) {
            e.stopPropagation(); 
            let currentX = e.clientX; let currentY = e.clientY;
            if (s.activePointers.size === 2) {
                const pts = Array.from(s.activePointers.values());
                currentX = (pts[0].x + pts[1].x) / 2; currentY = (pts[0].y + pts[1].y) / 2;
            }
            const delta = new fabric.Point(currentX - s.lastX, currentY - s.lastY);
            fCanvas.current.relativePan(delta);
            syncCustomLayers();
            s.lastX = currentX; s.lastY = currentY;
        }
    };

    const handleViewportPointerUp = (e) => {
        s.activePointers.delete(e.pointerId);
        if (s.isPanning && s.activePointers.size < 2 && !e.shiftKey) {
            s.isPanning = false;
            s.activePointers.clear(); 
            if (fCanvas.current) fCanvas.current.selection = true; 
        }
    };

    const triggerContextMenu = (clientX, clientY) => {
        if (!fCanvas.current) return;
        const pointer = fCanvas.current.getPointer({ clientX, clientY });
        let target = null;
        const objects = fCanvas.current.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) { if (objects[i].containsPoint(pointer)) { target = objects[i]; break; } }
        setContextMenu({ visible: true, x: clientX, y: clientY, target: target });
    };

    const handleNativeContextMenu = (e) => { e.preventDefault(); triggerContextMenu(e.clientX, e.clientY); };

    const buildLine = (p1, p2, color) => { let l = new fabric.Line([p1.x, p1.y, p2.x, p2.y], { stroke: color, strokeWidth: 3, strokeLineCap: 'round', selectable: true, hasControls: true }); l.customType = 'line'; return l; };
    const buildArrow = (start, end, color) => { let angle = Math.atan2(end.y - start.y, end.x - start.x); let headlen = 20; const pathData = `M ${start.x} ${start.y} L ${end.x} ${end.y} L ${end.x - headlen * Math.cos(angle - Math.PI / 6)} ${end.y - headlen * Math.sin(angle - Math.PI / 6)} M ${end.x} ${end.y} L ${end.x - headlen * Math.cos(angle + Math.PI / 6)} ${end.y - headlen * Math.sin(angle + Math.PI / 6)}`; let p = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: 3, strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true }); p.customType = 'arrow'; return p; };
    const buildCurve = (start, cp, end, color) => { const pathData = `M ${start.x} ${start.y} Q ${cp.x} ${cp.y} ${end.x} ${end.y}`; let p = new fabric.Path(pathData, { fill: 'transparent', stroke: color, strokeWidth: 3, strokeLineCap: 'round', selectable: true }); p.customType = 'curve'; return p; };

    const exitNodeEditMode = () => {
        if (s.editCircles.length > 0) {
            s.editCircles.forEach(c => fCanvas.current.remove(c)); s.editCircles = [];
            if (s.editingOriginalObj) { s.editingOriginalObj.set({ opacity: 1, selectable: true, evented: true, hasControls: true }); fCanvas.current.setActiveObject(s.editingOriginalObj); s.editingOriginalObj = null; }
            fCanvas.current.requestRenderAll();
        }
    };

    const enterNodeEditMode = (obj) => {
        s.isEnteringNodeEdit = true; exitNodeEditMode(); s.editingOriginalObj = obj;
        obj.set({ selectable: false, evented: false, hasControls: false, opacity: 0.5 }); fCanvas.current.discardActiveObject();
        const color = obj.stroke; const m = obj.calcTransformMatrix();
        const getAbs = (p) => fabric.util.transformPoint({ x: p.x - (obj.pathOffset ? obj.pathOffset.x : 0), y: p.y - (obj.pathOffset ? obj.pathOffset.y : 0) }, m);

        const makeNode = (x, y, onDrag) => {
            const circle = new fabric.Circle({ left: x, top: y, originX: 'center', originY: 'center', radius: 10, fill: '#3b82f6', stroke: '#ffffff', strokeWidth: 2, hasControls: false, hasBorders: false, selectable: true });
            circle.on('moving', () => { onDrag(circle); fCanvas.current.requestRenderAll(); });
            circle.on('modified', () => { saveState(); }); fCanvas.current.add(circle); s.editCircles.push(circle); return circle;
        };

        if (obj.customType === 'triangle' && obj.points) {
            const p0 = getAbs(obj.points[0]); const p1 = getAbs(obj.points[1]); const p2 = getAbs(obj.points[2]);
            const topN = makeNode(p0.x, p0.y, (c) => updateNodeGeometry(new fabric.Polygon([{x: c.left, y: c.top}, {x: brN.left, y: brN.top}, {x: blN.left, y: blN.top}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'triangle' })));
            const brN = makeNode(p1.x, p1.y, (c) => updateNodeGeometry(new fabric.Polygon([{x: topN.left, y: topN.top}, {x: c.left, y: c.top}, {x: blN.left, y: blN.top}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'triangle' })));
            const blN = makeNode(p2.x, p2.y, (c) => updateNodeGeometry(new fabric.Polygon([{x: topN.left, y: topN.top}, {x: brN.left, y: brN.top}, {x: c.left, y: c.top}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'triangle' })));
        } else if (obj.customType === 'rect') {
            const tl = obj.getPointByOrigin('left', 'top'); const br = obj.getPointByOrigin('right', 'bottom');
            const tlN = makeNode(tl.x, tl.y, (c) => {
                let newL = Math.min(c.left, brN.left); let newT = Math.min(c.top, brN.top); let newW = Math.abs(brN.left - c.left); let newH = Math.abs(brN.top - c.top);
                updateNodeGeometry(new fabric.Rect({ originX: 'left', originY: 'top', left: newL, top: newT, width: newW, height: newH, fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'rect' }));
            });
            const brN = makeNode(br.x, br.y, (c) => {
                let newL = Math.min(tlN.left, c.left); let newT = Math.min(tlN.top, c.top); let newW = Math.abs(c.left - tlN.left); let newH = Math.abs(c.top - tlN.top);
                updateNodeGeometry(new fabric.Rect({ originX: 'left', originY: 'top', left: newL, top: newT, width: newW, height: newH, fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'rect' }));
            });
        } else if (obj.customType === 'curve' && obj.path) {
            const pStart = getAbs({x: obj.path[0][1], y: obj.path[0][2]}); const pCp = getAbs({x: obj.path[1][1], y: obj.path[1][2]}); const pEnd = getAbs({x: obj.path[1][3], y: obj.path[1][4]});
            const sN = makeNode(pStart.x, pStart.y, (c) => updateNodeGeometry(buildCurve({x: c.left, y: c.top}, {x: cpN.left, y: cpN.top}, {x: eN.left, y: eN.top}, color)));
            const cpN = makeNode(pCp.x, pCp.y, (c) => updateNodeGeometry(buildCurve({x: sN.left, y: sN.top}, {x: c.left, y: c.top}, {x: eN.left, y: eN.top}, color)));
            const eN = makeNode(pEnd.x, pEnd.y, (c) => updateNodeGeometry(buildCurve({x: sN.left, y: sN.top}, {x: cpN.left, y: cpN.top}, {x: c.left, y: c.top}, color)));
        } else if (obj.customType === 'arrow' && obj.path) {
            const pStart = getAbs({x: obj.path[0][1], y: obj.path[0][2]}); const pEnd = getAbs({x: obj.path[1][1], y: obj.path[1][2]});
            const sN = makeNode(pStart.x, pStart.y, (c) => updateNodeGeometry(buildArrow({x: c.left, y: c.top}, {x: eN.left, y: eN.top}, color)));
            const eN = makeNode(pEnd.x, pEnd.y, (c) => updateNodeGeometry(buildArrow({x: sN.left, y: sN.top}, {x: c.left, y: c.top}, color)));
        } else if (obj.customType === 'line') {
            const pts = obj.calcLinePoints(); const p1 = fabric.util.transformPoint({ x: pts.x1, y: pts.y1 }, m); const p2 = fabric.util.transformPoint({ x: pts.x2, y: pts.y2 }, m);
            const sN = makeNode(p1.x, p1.y, (c) => updateNodeGeometry(buildLine({x: c.left, y: c.top}, {x: eN.left, y: eN.top}, color)));
            const eN = makeNode(p2.x, p2.y, (c) => updateNodeGeometry(buildLine({x: sN.left, y: sN.top}, {x: c.left, y: c.top}, color)));
        } else if (obj.customType === 'ellipse') {
            const center = obj.getPointByOrigin('center', 'center'); const rx = obj.rx * obj.scaleX; const ry = obj.ry * obj.scaleY;
            const rN = makeNode(center.x + rx, center.y, (c) => updateNodeGeometry(new fabric.Ellipse({ originX: 'center', originY: 'center', left: center.x, top: center.y, rx: Math.max(1, Math.abs(c.left - center.x)), ry: Math.max(1, Math.abs(bN.top - center.y)), fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'ellipse' })));
            const bN = makeNode(center.x, center.y + ry, (c) => updateNodeGeometry(new fabric.Ellipse({ originX: 'center', originY: 'center', left: center.x, top: center.y, rx: Math.max(1, Math.abs(rN.left - center.x)), ry: Math.max(1, Math.abs(c.top - center.y)), fill: 'rgba(255, 255, 255, 0.01)', stroke: color, strokeWidth: 3, customType: 'ellipse' })));
        }
        fCanvas.current.requestRenderAll(); s.isEnteringNodeEdit = false; 
    };

    const updateNodeGeometry = (newObj) => {
        const obj = s.editingOriginalObj; const index = fCanvas.current.getObjects().indexOf(obj);
        fCanvas.current.remove(obj); newObj.set({ selectable: false, evented: false, hasControls: false, opacity: 0.5 }); fCanvas.current.add(newObj);
        if (index > -1 && typeof fCanvas.current.moveTo === 'function') fCanvas.current.moveTo(newObj, index);
        else if (index > -1 && typeof newObj.moveTo === 'function') newObj.moveTo(index);
        s.editingOriginalObj = newObj;
    };

    const saveState = () => {
        if (!fCanvas.current || s.isLocked) return;
        const mathData = Array.from(mathLayerRef.current.children).map(wrapper => {
            const mf = wrapper.querySelector('math-field');
            return { left: wrapper.style.left, top: wrapper.style.top, value: mf ? mf.getValue() : '', size: mf ? mf.style.fontSize : '48px', color: mf ? mf.style.color : '#fff' };
        });
        const state = { fabric: fCanvas.current.toObject(['customType']), math: mathData };
        s.historyStack.push(JSON.stringify(state)); if (s.historyStack.length > 25) s.historyStack.shift(); s.redoStack = []; 
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
        fCanvas.current.loadFromJSON(state.fabric, () => {
            fCanvas.current.requestRenderAll(); mathLayerRef.current.innerHTML = '';
            state.math.forEach(data => { mathLayerRef.current.appendChild(createMathFieldDOM(data.left, data.top, data.value, data.size, data.color)); });
            setTimeout(() => { s.isLocked = false; }, 100);
        });
    };

    const getCenterPos = () => {
        if (!fCanvas.current) return { x: BOARD_SIZE/2, y: BOARD_SIZE/2 };
        const vpt = fCanvas.current.viewportTransform; const zoom = fCanvas.current.getZoom();
        return { x: (-vpt[4] + window.innerWidth / 2) / zoom, y: (-vpt[5] + window.innerHeight / 2) / zoom };
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
        addShape: (type) => { const center = getCenterPos(); const obj = createShape(type, drawColorRef.current, center); if (obj) { fCanvas.current.add(obj); fCanvas.current.setActiveObject(obj); setMode('select'); fCanvas.current.requestRenderAll(); saveState(); } }
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

    const handlePointerDown = (e) => {
        if (s.isPanning) return; 
        if (s.activeBox || (window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible)) { deactivateBox(); return; }
        if (!e.target.closest('.context-menu') && s.editCircles.length > 0) exitNodeEditMode();

        // נעילת המצביע לקנבס - הכרחי למכשירי מגע ועט
        if (e.target && e.target.setPointerCapture) {
            try { e.target.setPointerCapture(e.pointerId); } catch(err){}
        }

        const rect = drawingCanvasRef.current.getBoundingClientRect(); const zoom = fCanvas.current.getZoom(); 
        const x = (e.nativeEvent.clientX - rect.left) / zoom; const y = (e.nativeEvent.clientY - rect.top) / zoom; const coords = { x, y };

        if (modeRef.current === 'select') { 
            const target = fCanvas.current.findTarget(e.nativeEvent);
            if (!target && s.wasAutoSelected) { setMode('draw'); s.wasAutoSelected = false; return; } return; 
        }
        
        if (modeRef.current === 'text') { 
            const wrapper = createMathFieldDOM(x + 'px', (y - 30) + 'px', '', globalFontSize + 'px', textColorRef.current);
            mathLayerRef.current.appendChild(wrapper); wrapper.querySelector('math-field').focus();
        } else if (modeRef.current === 'draw' || modeRef.current === 'erase') {
            s.drawing = true; s.hasSnapped = false; s.points = [coords]; s.liveObj = null;
            const ctx = drawingCanvasRef.current.getContext('2d'); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE); ctx.beginPath(); ctx.moveTo(coords.x, coords.y);
            
            // תוספת קריטית לנקודה מיידית בטפיחת עט
            ctx.lineTo(coords.x, coords.y + 0.01);
            
            if (modeRef.current === 'erase') { ctx.lineWidth = 40 / zoom; ctx.strokeStyle = 'rgba(255,0,0,0.3)'; } else { ctx.lineWidth = 3 / zoom; ctx.strokeStyle = drawColorRef.current; }
            ctx.stroke();
        }
    };

    const handlePointerMove = (e) => {
        if (s.isPanning || !s.drawing) return; 
        const rect = drawingCanvasRef.current.getBoundingClientRect(); const zoom = fCanvas.current.getZoom(); 
        const coords = { x: (e.nativeEvent.clientX - rect.left) / zoom, y: (e.nativeEvent.clientY - rect.top) / zoom };
        
        if (s.liveObj) {
            fCanvas.current.remove(s.liveObj);
            if (s.liveObjType === 'line') s.liveObj = buildLine(s.liveObjProps.start, coords, drawColorRef.current);
            else if (s.liveObjType === 'arrow') s.liveObj = buildArrow(s.liveObjProps.start, coords, drawColorRef.current);
            else if (s.liveObjType === 'curve') {
                let cpX = 2 * s.liveObjProps.extremePoint.x - 0.5 * s.liveObjProps.start.x - 0.5 * coords.x; let cpY = 2 * s.liveObjProps.extremePoint.y - 0.5 * s.liveObjProps.start.y - 0.5 * coords.y; 
                s.liveObj = buildCurve(s.liveObjProps.start, {x: cpX, y: cpY}, coords, drawColorRef.current);
            }
            else if (s.liveObjType === 'ellipse') {
                let newRx = Math.max(1, Math.abs(coords.x - s.liveObjProps.cx) + s.liveObjProps.offsetRx); let newRy = Math.max(1, Math.abs(coords.y - s.liveObjProps.cy) + s.liveObjProps.offsetRy);
                s.liveObj = new fabric.Ellipse({ originX: 'center', originY: 'center', left: s.liveObjProps.cx, top: s.liveObjProps.cy, rx: newRx, ry: newRy, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3, customType: 'ellipse' });
            }
            else if (s.liveObjType === 'rect') {
                let vX = coords.x + s.liveObjProps.offsetX; let vY = coords.y + s.liveObjProps.offsetY; let newL = Math.min(s.liveObjProps.anchorX, vX); let newT = Math.min(s.liveObjProps.anchorY, vY);
                let w = Math.max(1, Math.abs(vX - s.liveObjProps.anchorX)); let h = Math.max(1, Math.abs(vY - s.liveObjProps.anchorY));
                s.liveObj = new fabric.Rect({ originX: 'left', originY: 'top', left: newL, top: newT, width: w, height: h, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3, customType: 'rect' });
            }
            else if (s.liveObjType === 'triangle') {
                let vX = coords.x + s.liveObjProps.offsetX; let vY = coords.y + s.liveObjProps.offsetY;
                s.liveObj = new fabric.Polygon([s.liveObjProps.baseLeft, s.liveObjProps.baseRight, {x: vX, y: vY}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3, strokeLineJoin: 'round', customType: 'triangle' });
            }
            fCanvas.current.add(s.liveObj); fCanvas.current.requestRenderAll(); return;
        }

        if (s.hasSnapped) return;
        const ctx = drawingCanvasRef.current.getContext('2d'); s.points.push(coords); ctx.lineTo(coords.x, coords.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(coords.x, coords.y);
        
        if (modeRef.current === 'erase') {
            const eraserRadius = 20 / zoom;
            Array.from(mathLayerRef.current.children).forEach(wrapper => {
                const boxX = parseFloat(wrapper.style.left) + wrapper.offsetWidth / 2; const boxY = parseFloat(wrapper.style.top) + wrapper.offsetHeight / 2;
                if (Math.hypot(boxX - coords.x, boxY - coords.y) < Math.max(wrapper.offsetWidth, wrapper.offsetHeight)/2 + eraserRadius) wrapper.remove();
            });
            fCanvas.current.getObjects().forEach(obj => {
                if (obj.opacity === 0.5) return;
                const cx = obj.left + (obj.width * obj.scaleX) / 2; const cy = obj.top + (obj.height * obj.scaleY) / 2;
                if (Math.hypot(cx - coords.x, cy - coords.y) < eraserRadius * 2) fCanvas.current.remove(obj);
            });
            fCanvas.current.requestRenderAll(); return;
        }
        clearTimeout(s.snapTimeout); s.snapTimeout = setTimeout(recognizeAndConvertToFabric, 400); 
    };

    const handlePointerUp = (e) => {
        // שחרור נעילת המצביע
        if (e && e.target && e.target.releasePointerCapture) {
            try { e.target.releasePointerCapture(e.pointerId); } catch(err){}
        }

        if (s.isPanning) return; 
        if (s.liveObj) { fCanvas.current.setActiveObject(s.liveObj); setMode('select'); s.wasAutoSelected = true; saveState(); s.liveObj = null;
        } else if (s.drawing && !s.hasSnapped && modeRef.current === 'draw') convertToScribble();
        if (modeRef.current === 'erase') saveState();
        s.drawing = false; s.points = []; clearTimeout(s.snapTimeout);
        drawingCanvasRef.current.getContext('2d').clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    };

    const convertToScribble = () => {
        if(s.points.length < 2) return;
        const pathData = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const pathObj = new fabric.Path(pathData, { fill: 'transparent', stroke: drawColorRef.current, strokeWidth: 3, strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true });
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
            if (isEllipse) { let rx = width / 2; let ry = height / 2; let offsetRx = rx - Math.abs(end.x - cx); let offsetRy = ry - Math.abs(end.y - cy); objToAdd = new fabric.Ellipse({ originX: 'center', originY: 'center', left: cx, top: cy, rx: rx, ry: ry, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3 }); objToAdd.customType = 'ellipse'; objType = 'ellipse'; objProps = { cx: cx, cy: cy, offsetRx: offsetRx, offsetRy: offsetRy }; 
            } else { let topPoints = s.points.filter(p => p.y < minY + height * 0.2); let bottomPoints = s.points.filter(p => p.y > maxY - height * 0.2); let topWidth = topPoints.length > 0 ? Math.max(...topPoints.map(p=>p.x)) - Math.min(...topPoints.map(p=>p.x)) : 0; let bottomWidth = bottomPoints.length > 0 ? Math.max(...bottomPoints.map(p=>p.x)) - Math.min(...bottomPoints.map(p=>p.x)) : 0;
                if (bottomWidth > width * 0.5 && topWidth < width * 0.4) { let offsetX = cx - end.x; let offsetY = minY - end.y; objToAdd = new fabric.Polygon([{x: cx, y: minY}, {x: maxX, y: maxY}, {x: minX, y: maxY}], { fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3 }); objToAdd.customType = 'triangle'; objType = 'triangle'; objProps = { baseLeft: {x: minX, y: maxY}, baseRight: {x: maxX, y: maxY}, offsetX: offsetX, offsetY: offsetY }; } else { let anchorX = (end.x > cx) ? minX : maxX; let anchorY = (end.y > cy) ? minY : maxY; let cornerX = (end.x > cx) ? maxX : minX; let cornerY = (end.y > cy) ? maxY : minY; let offsetX = cornerX - end.x; let offsetY = cornerY - end.y; objToAdd = new fabric.Rect({ originX: 'left', originY: 'top', left: minX, top: minY, width: width, height: height, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3 }); objToAdd.customType = 'rect'; objType = 'rect'; objProps = { anchorX: anchorX, anchorY: anchorY, offsetX: offsetX, offsetY: offsetY }; }
            }
        } 
        else { let maxPerpDist = 0; let extremePoint = null; let A = end.y - start.y; let B = -(end.x - start.x); let C = end.x * start.y - end.y * start.x; let denom = Math.hypot(A, B); for (let p of s.points) { let dist = Math.abs(A * p.x + B * p.y + C) / denom; if (dist > maxPerpDist) { maxPerpDist = dist; extremePoint = p; } }
            if (maxPerpDist > Math.max(50, endDist * 0.25) && endDist > 50) { let cpX = 2 * extremePoint.x - 0.5 * start.x - 0.5 * end.x; let cpY = 2 * extremePoint.y - 0.5 * start.y - 0.5 * end.y; objToAdd = buildCurve(start, {x: cpX, y: cpY}, end, drawColorRef.current); objType = 'curve'; objProps = { start: start, extremePoint: extremePoint }; }
        }

        if (objToAdd) { 
            s.hasSnapped = true; const liveTypes = ['line', 'arrow', 'curve', 'ellipse', 'rect', 'triangle'];
            if (s.drawing && objType && liveTypes.includes(objType)) { s.liveObj = objToAdd; s.liveObjType = objType; s.liveObjProps = objProps; fCanvas.current.add(s.liveObj); } else { fCanvas.current.add(objToAdd); fCanvas.current.setActiveObject(objToAdd); setMode('select'); s.wasAutoSelected = true; saveState(); }
            drawingCanvasRef.current.getContext('2d').clearRect(0, 0, BOARD_SIZE, BOARD_SIZE); fCanvas.current.requestRenderAll(); s.points = []; 
        }
    };

    const handleColorChange = (c) => { if (contextMenu.target) { contextMenu.target.set('stroke', c); fCanvas.current.requestRenderAll(); saveState(); }};
    const handleThicknessChange = (delta) => { if (contextMenu.target) { let w = contextMenu.target.strokeWidth || 3; contextMenu.target.set('strokeWidth', Math.max(1, w + delta)); fCanvas.current.requestRenderAll(); saveState(); }};
    const handleCopy = () => { if (contextMenu.target) { contextMenu.target.clone((cloned) => { s.clipboard = cloned; setContextMenu(prev => ({...prev, visible: false})); }); }};
    const handlePaste = () => { if (s.clipboard) { s.clipboard.clone((cloned) => { fCanvas.current.discardActiveObject(); cloned.set({ left: cloned.left + 20, top: cloned.top + 20, evented: true }); fCanvas.current.add(cloned); s.clipboard.top += 20; s.clipboard.left += 20; fCanvas.current.setActiveObject(cloned); fCanvas.current.requestRenderAll(); saveState(); }); } setContextMenu(prev => ({...prev, visible: false})); };

    return (
        <div id="viewport" dir="ltr" ref={viewportRef} onContextMenu={handleNativeContextMenu} 
            onPointerDownCapture={handleViewportPointerDown}
            onPointerMoveCapture={handleViewportPointerMove}
            onPointerUpCapture={handleViewportPointerUp}
            onPointerCancelCapture={handleViewportPointerUp}
            style={{ 
                width: '100vw', height: '100vh', overflow: 'hidden', 
                position: 'relative', cursor: s.isPanning ? 'grabbing' : 'default',
                touchAction: 'none' 
            }}>
            <style>{`
                .math-wrapper { position: absolute; direction: ltr !important; unicode-bidi: isolate !important; display: flex; align-items: center; width: max-content; pointer-events: auto; border-radius: 8px; transition: 0.2s border, 0.2s background; border-bottom: 2px solid transparent; }
                .math-wrapper.active-wrapper { border-bottom: 2px solid rgba(74, 222, 128, 0.5); background: rgba(255, 255, 255, 0.05) !important; }
                math-field { background: transparent !important; box-shadow: none !important; border: none !important; transform: none !important; position: relative !important; padding: 5px; min-width: 30px; direction: ltr !important; }
                math-field::part(container) { background-color: transparent !important; box-shadow: none !important; border: none !important; }
                math-field::part(virtual-keyboard-toggle) { display: none !important; }
                .math-box { outline: none !important; }
                .cm-btn { background: rgba(255,255,255,0.1); border: none; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: 0.2s; }
                .cm-btn:hover { background: rgba(255,255,255,0.2); }
            `}</style>
            
            {contextMenu.visible && (
                <div className="context-menu" dir="rtl" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 10000, background: 'rgba(28, 28, 30, 0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', color: 'white', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '150px' }}>
                    {contextMenu.target ? (
                        <>
                            <div style={{fontSize: '12px', color: '#aaa', fontWeight: 'bold'}}>ערוך צורה</div>
                            <div style={{display: 'flex', gap: '6px', justifyContent: 'center'}}>
                                {['#f5f5f5', '#fde047', '#4ade80', '#22d3ee', '#f472b6'].map(c => <button key={c} onClick={() => handleColorChange(c)} style={{background: c, width: '22px', height: '22px', borderRadius: '50%', border: 'none', cursor: 'pointer'}} /> )}
                            </div>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                <span style={{fontSize: '14px'}}>עובי קו:</span>
                                <div style={{display: 'flex', gap: '4px'}}>
                                    <button onClick={() => handleThicknessChange(-1)} className="cm-btn" style={{padding: '2px 8px'}}>-</button>
                                    <button onClick={() => handleThicknessChange(1)} className="cm-btn" style={{padding: '2px 8px'}}>+</button>
                                </div>
                            </div>
                            <button onClick={handleCopy} className="cm-btn">העתק</button>
                        </>
                    ) : (
                        <>
                            <div style={{fontSize: '12px', color: '#aaa', fontWeight: 'bold'}}>אפשרויות לוח</div>
                            <button onClick={handlePaste} className="cm-btn" disabled={!s.clipboard} style={{opacity: s.clipboard ? 1 : 0.5}}>הדבק</button>
                            <div style={{fontSize: '12px', color: '#aaa', marginTop: '4px', fontWeight: 'bold'}}>צבע רקע:</div>
                            <div style={{display: 'flex', gap: '6px', justifyContent: 'center'}}>
                                <button onClick={() => setBoardBg('radial-gradient(circle, #2a5244 0%, #1e3d32 100%)')} style={{background: '#2a5244', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #fff', cursor: 'pointer'}}/>
                                <button onClick={() => setBoardBg('#1e1e1e')} style={{background: '#1e1e1e', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #fff', cursor: 'pointer'}}/>
                                <button onClick={() => setBoardBg('#0f172a')} style={{background: '#0f172a', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #fff', cursor: 'pointer'}}/>
                            </div>
                        </>
                    )}
                </div>
            )}

            <div id="board-container" style={{ position: 'relative', width: BOARD_SIZE + 'px', height: BOARD_SIZE + 'px', background: boardBg, transition: '0.5s background' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
                    <canvas id="fabric-canvas" ref={fabricCanvasElRef} />
                </div>
                <canvas id="drawing-canvas" ref={drawingCanvasRef}
                    className={`cursor-${mode}`} width={BOARD_SIZE} height={BOARD_SIZE}
                    style={{ 
                        position: 'absolute', top: 0, left: 0, zIndex: 2, 
                        touchAction: 'none', 
                        WebkitTouchCallout: 'none', // מבטל תפריטי רפאים באייפד
                        WebkitUserSelect: 'none', // חוסם בחירת טקסט בטעות
                        pointerEvents: (mode === 'draw' || mode === 'erase' || mode === 'text') ? 'auto' : 'none' 
                    }}
                    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
                />
                <div id="math-layer" ref={mathLayerRef} style={{ position: 'absolute', top: 0, left: 0, width: BOARD_SIZE + 'px', height: BOARD_SIZE + 'px', pointerEvents: 'none', zIndex: 3 }}></div>
            </div>
        </div>
    );
});

export default Board;