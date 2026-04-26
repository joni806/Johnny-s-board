import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
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

    const modeRef = useRef(mode);
    useEffect(() => { modeRef.current = mode; }, [mode]);
    const drawColorRef = useRef(drawColor);
    useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
    const textColorRef = useRef(textColor);
    useEffect(() => { textColorRef.current = textColor; }, [textColor]);

    const s = useRef({
        drawing: false, 
        points: [], 
        snapTimeout: null, 
        hasSnapped: false,
        activeBox: null, 
        historyStack: [], 
        redoStack: [], 
        isLocked: false,
        isPanning: false, 
        lastX: 0, 
        lastY: 0
    }).current;

    useEffect(() => {
        setTimeout(() => {
            if (viewportRef.current) {
                viewportRef.current.scrollLeft = (BOARD_SIZE - window.innerWidth) / 2;
                viewportRef.current.scrollTop = (BOARD_SIZE - window.innerHeight) / 2;
            }
        }, 100);

        fCanvas.current = new fabric.Canvas(fabricCanvasElRef.current, {
            width: BOARD_SIZE, 
            height: BOARD_SIZE,
            selection: true, 
            isDrawingMode: false, 
            enableRetinaScaling: false
        });

        fCanvas.current.on('mouse:wheel', function(opt) {
            if (opt.e.ctrlKey || opt.e.metaKey) {
                let delta = opt.e.deltaY;
                let zoom = fCanvas.current.getZoom();
                zoom *= 0.999 ** delta;
                if (zoom > 20) zoom = 20;
                if (zoom < 0.1) zoom = 0.1;
                fCanvas.current.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
                opt.e.preventDefault();
                opt.e.stopPropagation();
            }
        });

        fCanvas.current.on('selection:cleared', () => {
            if (modeRef.current === 'select') {
                setMode('draw');
            }
        });

        setTimeout(saveState, 200);

        const handleKeyDown = async (e) => {
            if (s.activeBox) return; 

            if (e.code === 'Delete' || e.code === 'Backspace') {
                if (modeRef.current === 'select') {
                    const activeObjects = fCanvas.current.getActiveObjects();
                    if (activeObjects.length > 0) {
                        e.preventDefault();
                        activeObjects.forEach(obj => fCanvas.current.remove(obj));
                        fCanvas.current.discardActiveObject();
                        fCanvas.current.requestRenderAll();
                        saveState();
                    }
                }
            }
            if (e.ctrlKey || e.metaKey) {
                if (e.code === 'KeyZ') { 
                    e.preventDefault(); 
                    undo(); 
                }
                else if (e.code === 'KeyY') { 
                    e.preventDefault(); 
                    redo(); 
                }
            }
        };
        
        window.addEventListener('keydown', handleKeyDown, { passive: false });
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (fCanvas.current) fCanvas.current.dispose();
        };
    }, [setMode]);

    const saveState = () => {
        if (!fCanvas.current || s.isLocked) return;
        
        const mathData = Array.from(mathLayerRef.current.children).map(wrapper => {
            const mf = wrapper.querySelector('math-field');
            return { 
                left: wrapper.style.left, 
                top: wrapper.style.top, 
                value: mf ? mf.getValue() : '', 
                size: mf ? mf.style.fontSize : '48px', 
                color: mf ? mf.style.color : '#fff' 
            };
        });
        
        const state = { fabric: fCanvas.current.toObject(), math: mathData };
        s.historyStack.push(JSON.stringify(state));
        
        if (s.historyStack.length > 25) {
            s.historyStack.shift(); 
        }
        s.redoStack = []; 
    };

    const undo = () => {
        if (s.historyStack.length <= 1 || s.isLocked) return;
        s.isLocked = true;
        s.redoStack.push(s.historyStack.pop());
        const stateStr = s.historyStack[s.historyStack.length - 1];
        restore(JSON.parse(stateStr));
    };

    const redo = () => {
        if (s.redoStack.length === 0 || s.isLocked) return;
        s.isLocked = true;
        const stateStr = s.redoStack.pop();
        s.historyStack.push(stateStr);
        restore(JSON.parse(stateStr));
    };

    const restore = (state) => {
        deactivateBox(false);
        fCanvas.current.loadFromJSON(state.fabric, () => {
            fCanvas.current.requestRenderAll();
            mathLayerRef.current.innerHTML = '';
            state.math.forEach(data => { 
                mathLayerRef.current.appendChild(createMathFieldDOM(data.left, data.top, data.value, data.size, data.color)); 
            });
            setTimeout(() => { s.isLocked = false; }, 100);
        });
    };

    const getCenterPos = () => {
        if (!viewportRef.current) return { x: 5000, y: 5000 };
        const v = viewportRef.current;
        const zoom = fCanvas.current.getZoom();
        return { 
            x: (v.scrollLeft + window.innerWidth / 2) / zoom, 
            y: (v.scrollTop + window.innerHeight / 2) / zoom 
        };
    };

    useImperativeHandle(ref, () => ({
        undo, redo, 
        clearBoard: () => { 
            deactivateBox(false); 
            fCanvas.current.clear(); 
            mathLayerRef.current.innerHTML = ''; 
            saveState(); 
        },
       solveActiveBox: () => {
            if (!s.activeBox) {
                alert("לחץ קודם על המשוואה שאתה רוצה לפתור!");
                return;
            }

            let resultLatex = "";
            let latexEq = "";

            // שלב 1: חישוב מתמטי נקי (מופרד כדי לזהות שגיאות תחביר אמיתיות)
            try {
                const plainMath = s.activeBox.getValue('ascii-math');
                latexEq = s.activeBox.getValue('latex');
                
                const parsed = nerdamer(plainMath);
                const vars = parsed.variables();

                if (plainMath.includes('=')) {
                    const targetVar = vars.length > 0 ? vars[0] : 'x';
                    const solutions = nerdamer.solve(plainMath, targetVar);
                    resultLatex = `\\Rightarrow ${targetVar} = ` + solutions.toTeX(); 
                } else if (vars.length > 0) {
                    const targetVar = vars[0];
                    const simplified = parsed.simplify().toTeX();
                    const solutions = nerdamer.solve(plainMath, targetVar).toTeX();
                    resultLatex = `= ${simplified} \\quad \\Rightarrow ${targetVar} = ${solutions}`;
                } else {
                    const evaluated = parsed.evaluate().toTeX();
                    resultLatex = `= ` + evaluated; 
                }
            } catch (mathError) {
                console.error("Math Calculation Error:", mathError);
                alert("המחשבון לא הצליח לפתור את הביטוי הזה. ודא שהתחביר נכון ואין תווים חסרים.");
                return; // עוצרים את הפעולה ולא ממשיכים לעדכון התצוגה
            }

            // שלב 2: הזרקת התשובה לתצוגה הויזואלית 
            try {
                s.activeBox.setValue(`${latexEq} \\textcolor{#fde047}{\\; ${resultLatex}}`);
                s.activeBox.focus(); // מחזיר את הפוקוס בלי לנסות להריץ פקודות סמן חיצוניות
                saveState();
            } catch (uiError) {
                console.error("UI Update Error:", uiError);
                // שגיאות תצוגה שקטות לא יקפיצו הודעות למשתמש
            }
        },
        updateActiveColor: (newColor) => { 
            if (s.activeBox) { 
                s.activeBox.style.color = newColor; 
                saveState(); 
            } 
        },
        updateGlobalFontSize: (delta) => {
            if (s.activeBox) { 
                let currentSize = parseFloat(s.activeBox.style.fontSize) || 48;
                s.activeBox.style.fontSize = Math.max(16, currentSize + delta) + 'px'; 
                saveState();
            }
        },
        addGrid: (cols, rows) => {
            const center = getCenterPos();
            const grid = createGridGroup(cols, rows, drawColorRef.current);
            grid.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' });
            fCanvas.current.add(grid); 
            fCanvas.current.setActiveObject(grid); 
            setMode('select'); 
            fCanvas.current.requestRenderAll(); 
            saveState();
        },
        addImage: (dataUrl) => {
            const imgEl = new Image();
            imgEl.onload = () => {
                const center = getCenterPos();
                const fabricImg = new fabric.Image(imgEl);
                fabricImg.scaleToWidth(400); 
                fabricImg.set({ left: center.x, top: center.y, originX: 'center', originY: 'center' });
                fCanvas.current.add(fabricImg); 
                fCanvas.current.setActiveObject(fabricImg); 
                setMode('select'); 
                fCanvas.current.requestRenderAll(); 
                saveState();
            };
            imgEl.src = dataUrl;
        },
        addShape: (type) => {
            const center = getCenterPos();
            const obj = createShape(type, drawColorRef.current, center);

            if (obj) {
                fCanvas.current.add(obj);
                fCanvas.current.setActiveObject(obj);
                setMode('select');
                fCanvas.current.requestRenderAll();
                saveState();
            }
        }
    }));

    const deactivateBox = (shouldSave = true) => {
        if (!s.activeBox) return;
        s.activeBox.wrapper.classList.remove('active-wrapper');
        
        if (!s.activeBox.getValue().trim()) {
            s.activeBox.wrapper.remove(); 
        }
        
        s.activeBox.blur();
        if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide(); 
        
        s.activeBox = null;
        if (shouldSave) saveState();
    };

    const createMathFieldDOM = (left, top, value = '', size, color) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'math-wrapper'; 
        wrapper.style.left = left; 
        wrapper.style.top = top; 

        const mf = document.createElement('math-field'); 
        mf.className = 'math-box'; 
        mf.style.fontSize = size; 
        mf.style.color = color;
        mf.setValue(value); 
        mf.mathVirtualKeyboardPolicy = "manual"; 
        
        mf.wrapper = wrapper; 
        wrapper.appendChild(mf);

        mf.addEventListener('focusin', () => {
            if (s.activeBox !== mf) deactivateBox(false);
            s.activeBox = mf; 
            wrapper.classList.add('active-wrapper');
            
            if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.show();
            
            setTimeout(() => {
                const rect = wrapper.getBoundingClientRect();
                const safeHeight = window.innerHeight - 320;
                if (rect.bottom > safeHeight && viewportRef.current) {
                    viewportRef.current.scrollBy({ top: rect.bottom - safeHeight + 60, behavior: 'smooth' });
                }
            }, 400); 
        });

        mf.addEventListener('input', () => { 
            clearTimeout(s.snapTimeout); 
            s.snapTimeout = setTimeout(saveState, 1000); 
        });

        let isDragging = false; 
        let dragOffset = { x: 0, y: 0 };
        
        wrapper.addEventListener('pointerdown', (e) => {
            if (modeRef.current === 'select') {
                e.stopPropagation(); 
                isDragging = true;
                dragOffset = { x: e.clientX - parseFloat(wrapper.style.left), y: e.clientY - parseFloat(wrapper.style.top) };
                wrapper.style.cursor = 'grabbing'; 
                mf.style.cursor = 'grabbing'; 
                s.activeBox = mf; 
            }
        });

        window.addEventListener('pointermove', (e) => { 
            if (isDragging && modeRef.current === 'select') { 
                wrapper.style.left = (e.clientX - dragOffset.x) + 'px'; 
                wrapper.style.top = (e.clientY - dragOffset.y) + 'px'; 
            } 
        });
        
        window.addEventListener('pointerup', () => { 
            if (isDragging) { 
                isDragging = false; 
                wrapper.style.cursor = 'default'; 
                mf.style.cursor = 'text'; 
                saveState(); 
            } 
        });

        return wrapper;
    };

    const handlePointerDown = (e) => {
        if (e.shiftKey) {
            s.isPanning = true; 
            s.lastX = e.clientX; 
            s.lastY = e.clientY;
            if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'; 
            return;
        }
        
        if (s.activeBox || (window.mathVirtualKeyboard && window.mathVirtualKeyboard.visible)) { 
            deactivateBox(); 
            return; 
        }

        const rect = drawingCanvasRef.current.getBoundingClientRect();
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        const x = (e.nativeEvent.clientX - rect.left - vpt[4]) / zoom;
        const y = (e.nativeEvent.clientY - rect.top - vpt[5]) / zoom;
        const coords = { x, y };

        if (modeRef.current === 'select') { 
            setMode('draw'); 
            return; 
        }
        
        if (modeRef.current === 'text') { 
            const wrapper = createMathFieldDOM(x + 'px', (y - 30) + 'px', '', globalFontSize + 'px', textColorRef.current);
            mathLayerRef.current.appendChild(wrapper);
            wrapper.querySelector('math-field').focus();
        } else if (modeRef.current === 'draw' || modeRef.current === 'erase') {
            s.drawing = true; 
            s.hasSnapped = false; 
            s.points = [coords];
            
            const ctx = drawingCanvasRef.current.getContext('2d');
            ctx.lineCap = 'round'; 
            ctx.lineJoin = 'round';
            ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE); 
            ctx.beginPath(); 
            ctx.moveTo(coords.x, coords.y);
            
            if (modeRef.current === 'erase') { 
                ctx.lineWidth = 40 / zoom; 
                ctx.strokeStyle = 'rgba(255,0,0,0.3)'; 
            } else { 
                ctx.lineWidth = 3 / zoom; 
                ctx.strokeStyle = drawColorRef.current; 
            }
        }
    };

    const handlePointerMove = (e) => {
        if (s.isPanning) {
            if (viewportRef.current) { 
                viewportRef.current.scrollLeft -= (e.clientX - s.lastX); 
                viewportRef.current.scrollTop -= (e.clientY - s.lastY); 
            }
            s.lastX = e.clientX; 
            s.lastY = e.clientY; 
            return;
        }

        if (!s.drawing || s.hasSnapped) return;
        
        const rect = drawingCanvasRef.current.getBoundingClientRect();
        const zoom = fCanvas.current.getZoom();
        const vpt = fCanvas.current.viewportTransform;
        const coords = { x: (e.nativeEvent.clientX - rect.left - vpt[4]) / zoom, y: (e.nativeEvent.clientY - rect.top - vpt[5]) / zoom };
        
        const ctx = drawingCanvasRef.current.getContext('2d');
        s.points.push(coords); 
        ctx.lineTo(coords.x, coords.y); 
        ctx.stroke(); 
        ctx.beginPath(); 
        ctx.moveTo(coords.x, coords.y);
        
        if (modeRef.current === 'erase') {
            const eraserRadius = 20 / zoom;
            Array.from(mathLayerRef.current.children).forEach(wrapper => {
                const boxX = parseFloat(wrapper.style.left) + wrapper.offsetWidth / 2; 
                const boxY = parseFloat(wrapper.style.top) + wrapper.offsetHeight / 2;
                if (Math.hypot(boxX - coords.x, boxY - coords.y) < Math.max(wrapper.offsetWidth, wrapper.offsetHeight)/2 + eraserRadius) {
                    wrapper.remove();
                }
            });
            fCanvas.current.getObjects().forEach(obj => {
                const cx = obj.left + (obj.width * obj.scaleX) / 2; 
                const cy = obj.top + (obj.height * obj.scaleY) / 2;
                if (Math.hypot(cx - coords.x, cy - coords.y) < eraserRadius * 2) {
                    fCanvas.current.remove(obj);
                }
            });
            fCanvas.current.requestRenderAll(); 
            return;
        }
        
        clearTimeout(s.snapTimeout); 
        s.snapTimeout = setTimeout(recognizeAndConvertToFabric, 400);
    };

    const handlePointerUp = () => {
        if (s.isPanning) { 
            s.isPanning = false; 
            if (viewportRef.current) viewportRef.current.style.cursor = 'default'; 
            return; 
        }
        
        if (s.drawing && !s.hasSnapped && modeRef.current === 'draw') {
            convertToScribble();
        }
        
        if (modeRef.current === 'erase') {
            saveState();
        }
        
        s.drawing = false; 
        s.points = []; 
        clearTimeout(s.snapTimeout);
        drawingCanvasRef.current.getContext('2d').clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    };

    const convertToScribble = () => {
        if(s.points.length < 2) return;
        const pathData = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const pathObj = new fabric.Path(pathData, { fill: 'transparent', stroke: drawColorRef.current, strokeWidth: 3, strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true });
        fCanvas.current.add(pathObj); 
        fCanvas.current.requestRenderAll(); 
        saveState(); 
        s.points = [];
    };

    const recognizeAndConvertToFabric = () => {
        if (s.points.length < 15 || modeRef.current === 'erase' || s.hasSnapped) return;
        const start = s.points[0]; 
        const end = s.points[s.points.length - 1];
        
        let pathLength = 0; 
        for(let i=1; i<s.points.length; i++) {
            pathLength += Math.hypot(s.points[i].x - s.points[i-1].x, s.points[i].y - s.points[i-1].y);
        }
        
        const endDist = Math.hypot(end.x - start.x, end.y - start.y);
        
        let minX = Math.min(...s.points.map(p => p.x)); 
        let maxX = Math.max(...s.points.map(p => p.x)); 
        let minY = Math.min(...s.points.map(p => p.y)); 
        let maxY = Math.max(...s.points.map(p => p.y));
        let width = maxX - minX; 
        let height = maxY - minY;

        let objToAdd = null;
        let maxDistFromStart = 0; 
        let tipIndex = 0;
        
        for (let i = 0; i < s.points.length; i++) { 
            let d = Math.hypot(s.points[i].x - start.x, s.points[i].y - start.y); 
            if (d > maxDistFromStart) { 
                maxDistFromStart = d; 
                tipIndex = i; 
            } 
        }
        let tip = s.points[tipIndex];
        
        if (tipIndex > s.points.length * 0.6 && tipIndex < s.points.length - 5 && maxDistFromStart > 50) {
            let angle = Math.atan2(tip.y - start.y, tip.x - start.x); 
            let headlen = 20;
            const pathData = `M ${start.x} ${start.y} L ${tip.x} ${tip.y} L ${tip.x - headlen * Math.cos(angle - Math.PI / 6)} ${tip.y - headlen * Math.sin(angle - Math.PI / 6)} M ${tip.x} ${tip.y} L ${tip.x - headlen * Math.cos(angle + Math.PI / 6)} ${tip.y - headlen * Math.sin(angle + Math.PI / 6)}`;
            objToAdd = new fabric.Path(pathData, { fill: 'transparent', stroke: drawColorRef.current, strokeWidth: 3, strokeLineCap: 'round', strokeLineJoin: 'round' });
        } 
        else if (endDist / pathLength > 0.85) {
            objToAdd = new fabric.Line([start.x, start.y, end.x, end.y], { stroke: drawColorRef.current, strokeWidth: 3, strokeLineCap: 'round' });
        }
        else if (endDist < Math.max(width, height) * 0.25) { 
            const cx = minX + width / 2; 
            const cy = minY + height / 2; 
            let isEllipse = true;
            for(let p of s.points) { 
                let nx = (p.x - cx) / width; 
                let ny = (p.y - cy) / height; 
                if (Math.hypot(nx, ny) > 0.60) { 
                    isEllipse = false; 
                    break; 
                } 
            }
            if (isEllipse) {
                objToAdd = new fabric.Ellipse({ originX: 'center', originY: 'center', left: cx, top: cy, rx: width / 2, ry: height / 2, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3 });
            } else {
                objToAdd = new fabric.Rect({ originX: 'center', originY: 'center', left: cx, top: cy, width: width, height: height, fill: 'rgba(255, 255, 255, 0.01)', stroke: drawColorRef.current, strokeWidth: 3 });
            }
        } 
        else {
            let maxPerpDist = 0; 
            let extremePoint = null; 
            let A = end.y - start.y; 
            let B = -(end.x - start.x); 
            let C = end.x * start.y - end.y * start.x; 
            let denom = Math.hypot(A, B);
            
            for (let p of s.points) { 
                let dist = Math.abs(A * p.x + B * p.y + C) / denom; 
                if (dist > maxPerpDist) { 
                    maxPerpDist = dist; 
                    extremePoint = p; 
                } 
            }
            
            if (maxPerpDist > Math.max(50, endDist * 0.25) && endDist > 50) {
                let cpX = 2 * extremePoint.x - 0.5 * start.x - 0.5 * end.x; 
                let cpY = 2 * extremePoint.y - 0.5 * start.y - 0.5 * end.y; 
                const pathData = `M ${start.x} ${start.y} Q ${cpX} ${cpY} ${end.x} ${end.y}`;
                objToAdd = new fabric.Path(pathData, { fill: 'transparent', stroke: drawColorRef.current, strokeWidth: 3, strokeLineCap: 'round' });
            }
        }

        if (objToAdd) { 
            s.hasSnapped = true; 
            fCanvas.current.add(objToAdd); 
            fCanvas.current.setActiveObject(objToAdd); 
            setMode('select'); 
            fCanvas.current.requestRenderAll(); 
            drawingCanvasRef.current.getContext('2d').clearRect(0, 0, BOARD_SIZE, BOARD_SIZE); 
            saveState(); 
            s.points = []; 
        }
    };

    return (
        <div id="viewport" dir="ltr" ref={viewportRef} style={{ width: '100vw', height: '100vh', overflow: 'auto', position: 'relative', cursor: s.isPanning ? 'grabbing' : 'default' }}>
            <style>{`
                .math-wrapper { position: absolute; direction: ltr !important; unicode-bidi: isolate !important; display: flex; align-items: center; width: max-content; pointer-events: auto; border-radius: 8px; transition: 0.2s border, 0.2s background; border-bottom: 2px solid transparent; }
                .math-wrapper.active-wrapper { border-bottom: 2px solid rgba(74, 222, 128, 0.5); background: rgba(255, 255, 255, 0.05) !important; }
                math-field { background: transparent !important; box-shadow: none !important; border: none !important; transform: none !important; position: relative !important; padding: 5px; min-width: 30px; direction: ltr !important; }
                math-field::part(container) { background-color: transparent !important; box-shadow: none !important; border: none !important; }
                math-field::part(virtual-keyboard-toggle) { display: none !important; }
                .math-box { outline: none !important; }
            `}</style>
            <div id="board-container" style={{ position: 'relative', width: BOARD_SIZE + 'px', height: BOARD_SIZE + 'px', background: 'radial-gradient(circle, #2a5244 0%, #1e3d32 100%)' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
                    <canvas id="fabric-canvas" ref={fabricCanvasElRef} />
                </div>
                <canvas id="drawing-canvas" ref={drawingCanvasRef}
                    className={`cursor-${mode}`} width={BOARD_SIZE} height={BOARD_SIZE}
                    style={{ position: 'absolute', top: 0, left: 0, zIndex: 2, touchAction: 'none', pointerEvents: (mode === 'draw' || mode === 'erase' || mode === 'text') ? 'auto' : 'none' }}
                    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}
                />
                <div id="math-layer" ref={mathLayerRef} style={{ position: 'absolute', top: 0, left: 0, width: BOARD_SIZE + 'px', height: BOARD_SIZE + 'px', pointerEvents: 'none', zIndex: 3 }}></div>
            </div>
        </div>
    );
});

export default Board;