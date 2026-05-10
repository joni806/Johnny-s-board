import React, { useState, useRef, useEffect } from 'react';

const Icon = ({ name, size = 20 }) => {
    const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
    switch (name) {
        case 'draw': return <svg {...props}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>;
        case 'erase': return <svg {...props}><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>;
        case 'text': return <svg {...props}><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>;
        case 'select': return <svg {...props}><path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/></svg>;
        case 'ans': return <svg {...props}><path d="M4 14l6-6 4 4 6-6"/><path d="M14 6h6v6"/><path d="M4 20h16"/></svg>;
        case 'add': return <svg {...props}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
        case 'clear': return <svg {...props}><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
        case 'image': return <svg {...props}><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>;
        case 'grid': return <svg {...props}><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>;
        case 'desmos': return <svg {...props} viewBox="0 0 24 24"><path d="M4 4h16v16H4z M4 12h16 M12 4v16 M6 10l2-2l2 2 M18 10l-2-2l-2 2"/></svg>;
        case 'home': return <svg {...props}><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
        case 'undo': return <svg {...props}><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>;
        case 'redo': return <svg {...props}><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>;
        case 'rect': return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>;
        case 'circle': return <svg {...props}><circle cx="12" cy="12" r="8"/></svg>;
        case 'ellipse': return <svg {...props}><ellipse cx="12" cy="12" rx="10" ry="6"/></svg>;
        case 'half-circle': return <svg {...props}><path d="M 4 12 A 8 8 0 0 1 20 12 Z"/></svg>;
        case 'triangle': return <svg {...props}><polygon points="12,4 20,20 4,20"/></svg>;
        case 'right-triangle': return <svg {...props}><polygon points="4,4 4,20 20,20"/></svg>;
        case 'diamond': return <svg {...props}><polygon points="12,4 20,12 12,20 4,12"/></svg>;
        case 'pentagon': return <svg {...props}><polygon points="12,4 20,10 17,20 7,20 4,10"/></svg>;
        case 'hexagon': return <svg {...props}><polygon points="12,4 20,8 20,16 12,20 4,16 4,8"/></svg>;
        case 'heptagon': return <svg {...props}><polygon points="12,4 19,8 20,15 15,20 9,20 4,15 5,8"/></svg>;
        case 'octagon': return <svg {...props}><polygon points="8,4 16,4 20,8 20,16 16,20 8,20 4,16 4,8"/></svg>;
        case 'decagon': return <svg {...props}><circle cx="12" cy="12" r="8" strokeDasharray="2 2"/></svg>;
        case 'parallelogram': return <svg {...props}><polygon points="8,6 20,6 16,18 4,18"/></svg>;
        case 'trapezoid': return <svg {...props}><polygon points="8,6 16,6 20,18 4,18"/></svg>;
        case 'star-4': return <svg {...props}><polygon points="12,4 14,10 20,12 14,14 12,20 10,14 4,12 10,10"/></svg>;
        case 'star-5': return <svg {...props}><polygon points="12,4 14.5,10 21,10 16,14 18,20 12,16 6,20 8,14 3,10 9.5,10"/></svg>;
        case 'star-6': return <svg {...props}><polygon points="12,4 14,9 20,12 14,15 12,20 10,15 4,12 10,9"/></svg>;
        case 'arrow-right': return <svg {...props}><polygon points="4,9 12,9 12,5 20,12 12,19 12,15 4,15"/></svg>;
        case 'arrow-left': return <svg {...props}><polygon points="20,9 12,9 12,5 4,12 12,19 12,15 20,15"/></svg>;
        case 'arrow-up': return <svg {...props}><polygon points="9,20 9,12 5,12 12,4 19,12 15,12 15,20"/></svg>;
        case 'arrow-down': return <svg {...props}><polygon points="9,4 9,12 5,12 12,20 19,12 15,12 15,4"/></svg>;
        case 'math-plus': return <svg {...props}><path d="M10,4 v6 h-6 v4 h6 v6 h4 v-6 h6 v-4 h-6 v-6 z"/></svg>;
        case 'math-minus': return <svg {...props}><path d="M4,10 h16 v4 h-16 z"/></svg>;
        case 'math-multiply': return <svg {...props}><path d="M6,6 l12,12 M18,6 l-12,12"/></svg>;
        case 'heart': return <svg {...props}><path d="M20.8,4.6a5.5,5.5 0 0,0-7.8,0l-1,1l-1,-1a5.5,5.5 0 0,0-7.8,7.8l1,1l7.8,7.8l7.8,-7.8l1,-1a5.5,5.5 0 0,0 0,-7.8z"/></svg>;
        case 'cylinder': return <svg {...props}><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4,6 v12 a8,3 0 0,0 16,0 v-12"/></svg>;
        case 'cube': return <svg {...props}><polygon points="12,3 20,7 20,15 12,19 4,15 4,7"/><polyline points="4,7 12,11 20,7"/><polyline points="12,19 12,11"/></svg>;
        case 'lightning': return <svg {...props}><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>;
        case 'moon': return <svg {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
        case 'cloud': return <svg {...props}><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>;
        case 'speech-bubble': return <svg {...props}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
        default: return null;
    }
};

export default function Toolbar({ mode, setMode, drawColor, setDrawColor, textColor, setTextColor, globalFontSize, setGlobalFontSize, boardRef, onBack, eraserSize, setEraserSize }) {
    const colors = ['#1a1a1a', '#f5f5f5', '#fde047', '#4ade80', '#22d3ee', '#f472b6'];
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showDesmos, setShowDesmos] = useState(false);
    const menuRef = useRef(null);
    const fileInputRef = useRef(null);
    const colorPickerRef = useRef(null);
    // --- הוסף את הבלוק הזה לכאן ---
    const dragRef = useRef({ isDown: false, startX: 0, scrollLeft: 0 });

    const handleToolbarPointerDown = (e) => {
        dragRef.current.isDown = true;
        dragRef.current.startX = e.pageX - e.currentTarget.offsetLeft;
        dragRef.current.scrollLeft = e.currentTarget.scrollLeft;
    };

    const handleToolbarPointerLeave = () => { dragRef.current.isDown = false; };
    const handleToolbarPointerUp = () => { dragRef.current.isDown = false; };

    const handleToolbarPointerMove = (e) => {
        if (!dragRef.current.isDown) return;
        e.preventDefault();
        const x = e.pageX - e.currentTarget.offsetLeft;
        const walk = (x - dragRef.current.startX) * 1.5; // המכפיל קובע את מהירות הגלילה
        e.currentTarget.scrollLeft = dragRef.current.scrollLeft - walk;
    };

    const act = (fn, ...args) => boardRef.current && boardRef.current[fn](...args);

    // ─── Desmos init ──────────────────────────────────────────────────────────
    useEffect(() => {
        let calcInstance = null;
        if (showDesmos) {
            const initDesmos = () => {
                const elt = document.getElementById('desmos-calculator');
                if (elt && window.Desmos) {
                    calcInstance = window.Desmos.GraphingCalculator(elt, {
                        expressions: true,
                        keypad: true,
                        settingsMenu: true,
                        // Force LTR inside Desmos
                        language: 'he',
                    });
                    // Ensure the element itself is LTR after Desmos injects its DOM
                    elt.setAttribute('dir', 'ltr');
                }
            };
            if (!document.getElementById('desmos-api-script')) {
                const script = document.createElement('script');
                script.id = 'desmos-api-script';
                script.src = "https://www.desmos.com/api/v1.8/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6&lang=he";
                script.async = true;
                script.onload = initDesmos;
                document.head.appendChild(script);
            } else {
                setTimeout(initDesmos, 50);
            }
        }
        return () => { if (calcInstance) calcInstance.destroy(); };
    }, [showDesmos]);

   // ─── Close add-menu on outside click ─────────────────────────────────────
    useEffect(() => {
        const handleClickOutside = (e) => {
            // הוספנו תנאי שבודק אם הלחיצה הייתה בתוך התפריט עצמו
            if (menuRef.current && !menuRef.current.contains(e.target) && !e.target.closest('.pro-menu')) {
                setShowAddMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (f) => act('addImage', f.target.result);
            reader.readAsDataURL(file);
        }
        setShowAddMenu(false);
    };

    const handleAddGrid = () => {
        const cols = prompt("כמה משבצות בציר X?", "10");
        const rows = prompt("כמה משבצות בציר Y?", "10");
        if (cols && rows) act('addGrid', parseInt(cols), parseInt(rows));
        setShowAddMenu(false);
    };

    const activeColor = mode === 'text' ? textColor : drawColor;
    const handleColorChange = (c) => {
        if (mode === 'text') setTextColor(c); else setDrawColor(c);
        act('updateActiveColor', c);
    };

    const shapeCategories = [
        { title: 'מצולעים (Polygons)', shapes: ['rect', 'triangle', 'right-triangle', 'diamond', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon', 'parallelogram', 'trapezoid'] },
        { title: 'מעוגלים וכוכבים', shapes: ['circle', 'ellipse', 'half-circle', 'star-4', 'star-5', 'star-6'] },
        { title: 'חצים מתקדמים', shapes: ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down'] },
        { title: 'מתמטיקה ותרשימים', shapes: ['math-plus', 'math-minus', 'math-multiply', 'cylinder', 'cube', 'heart', 'lightning', 'moon', 'cloud', 'speech-bubble'] }
    ];

    // ─── Shared glass-panel style ─────────────────────────────────────────────
    const glassPanel = {
        background: 'rgba(28, 28, 30, 0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.09)',
        borderRadius: '14px',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
    };

    return (
        <>
            {/* ── CSS ──────────────────────────────────────────────────────── */}
            <style>{`
                /* ── Toolbar buttons ── */
                .pro-toolbar {
                    display: flex; align-items: center; gap: 6px; padding: 7px;
                }
                .pro-btn {
                    display: flex; justify-content: center; align-items: center;
                    background: transparent; border: none; color: #a1a1aa;
                    width: 38px; height: 38px; border-radius: 10px;
                    cursor: pointer; transition: all 0.18s ease; flex-shrink: 0;
                }
                .pro-btn.with-text { width: auto; padding: 0 14px; gap: 7px; font-size: 13px; font-weight: 500; }
                .pro-btn:hover  { background: rgba(255,255,255,0.09); color: #fff; }
                .pro-btn.active { background: rgba(74,222,128,0.15); color: #4ade80; }
                .pro-btn-danger:hover  { background: rgba(239,68,68,0.15); color: #ef4444; }
                .pro-btn-desmos:hover  { background: rgba(59,130,246,0.15); color: #60a5fa; }
                .pro-btn-ans   { color: #fde047; }
                .pro-btn-ans:hover { background: rgba(253,224,71,0.15); color: #fef08a; }
                .pro-btn-home  { color: #a1a1aa; }
                .pro-btn-home:hover { background: rgba(255,255,255,0.09); color: #fff; }
                .pro-btn-nav   { color: #a1a1aa; }
                .pro-btn-nav:hover { background: rgba(255,255,255,0.09); color: #fff; }

                .pro-divider { width: 1px; height: 22px; background: rgba(255,255,255,0.1); margin: 0 2px; flex-shrink: 0; }

              /* ── Add-shapes dropdown ── */
                .pro-menu {
                    position: absolute; top: 65px; left: 50%; transform: translateX(-50%);
                    background: rgba(22,22,24,0.97); backdrop-filter: blur(24px);
                    border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;
                    box-shadow: 0 20px 48px rgba(0,0,0,0.55); padding: 14px;
                    width: min(350px, 92vw); max-height: 65vh; overflow-y: auto;
                    color: #fff; z-index: 9000;
                }
                .pro-menu-category { font-size: 11px; color: #71717a; margin: 14px 0 7px 4px; font-weight: 600; text-align: right; }
                .shape-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; }
                .shape-icon-btn {
                    display: flex; justify-content: center; align-items: center;
                    background: transparent; border: 1px solid transparent;
                    color: #e4e4e7; padding: 9px 0; border-radius: 8px;
                    cursor: pointer; transition: 0.18s;
                }
                .shape-icon-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); transform: scale(1.1); color: #4ade80; }
                .pro-menu::-webkit-scrollbar { width: 5px; }
                .pro-menu::-webkit-scrollbar-track { background: transparent; }
                .pro-menu::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 10px; }

                /* ── Responsive: compact toolbar on narrow screens ── */
                @media (max-width: 600px) {
                    .pro-toolbar { gap: 3px; padding: 5px; }
                    .pro-btn { width: 32px; height: 32px; border-radius: 8px; }
                    .pro-btn.with-text { padding: 0 8px; font-size: 12px; }
                    .pro-divider { margin: 0 1px; height: 18px; }
                    .pro-side-btn { width: 36px !important; height: 36px !important; }
                }
                @media (max-width: 380px) {
                    .pro-btn { width: 28px; height: 28px; }
                    .pro-side-btn { width: 30px !important; height: 30px !important; }
                }

                /* ── Desmos modal overlay ── */
                .desmos-overlay {
                    position: fixed; inset: 0;
                    background: rgba(0,0,0,0.65);
                    z-index: 9999;
                    display: flex; justify-content: center; align-items: center;
                    backdrop-filter: blur(8px);
                    /* CRITICAL: force LTR so Desmos keyboard renders correctly */
                    direction: ltr;
                    unicode-bidi: isolate;
                }
                .desmos-window {
                    /* Responsive: never exceed viewport, leave room for mobile chrome */
                    width: min(92vw, 1100px);
                    height: min(88vh, 820px);
                    background: #fff;
                    border-radius: 18px;
                    position: relative;
                    box-shadow: 0 24px 64px rgba(0,0,0,0.55);
                    display: flex; flex-direction: column; overflow: hidden;
                    direction: ltr;
                }
                .desmos-header {
                    background: #1c1c1e;
                    padding: 11px 18px;
                    display: flex; justify-content: space-between; align-items: center;
                    flex-shrink: 0;
                    /* Header text is Hebrew → RTL, but the div itself stays LTR */
                }
                #desmos-calculator {
                    flex: 1; width: 100%; min-height: 0;
                    direction: ltr !important;
                }
            `}</style>

            {/* ── Desmos modal ──────────────────────────────────────────────── */}
            {showDesmos && (
                <div className="desmos-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowDesmos(false); }}>
                    <div className="desmos-window">
                        <div className="desmos-header">
                            {/* Close on the LEFT so it's natural in LTR layout */}
                            <button
                                onClick={() => setShowDesmos(false)}
                                style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', padding: '5px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}
                            >
                                ✕
                            </button>
                            {/* Title on the right (Hebrew) */}
                            <span style={{ fontWeight: 700, color: '#fff', fontSize: '1.05rem', direction: 'rtl' }}>
                                מחשבון גרפי (Desmos)
                            </span>
                        </div>
                        {/* This div MUST be dir="ltr" — Desmos injects its virtual keyboard here */}
                        <div id="desmos-calculator" dir="ltr" />
                    </div>
                </div>
            )}

            {/* ── Home button — top left ────────────────────────────────────── */}
            {onBack && (
                <div style={{ position: 'fixed', top: 16, left: 16, zIndex: 1000 }}>
                    <button
                        title="חזרה לבחירת הלוחות"
                        className="pro-btn pro-btn-home pro-side-btn"
                        onClick={onBack}
                        style={{ ...glassPanel, width: 42, height: 42, borderRadius: 12 }}
                    >
                        <Icon name="home" size={18} />
                    </button>
                </div>
            )}

            {/* ── Undo / Redo — top right ───────────────────────────────────── */}
            <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000, display: 'flex', gap: 8 }}>
                <button
                    title="בטל (Ctrl+Z)"
                    className="pro-btn pro-btn-nav pro-side-btn"
                    onClick={() => act('undo')}
                    style={{ ...glassPanel, width: 42, height: 42, borderRadius: 12 }}
                >
                    <Icon name="undo" size={18} />
                </button>
                <button
                    title="בצע שוב (Ctrl+Y)"
                    className="pro-btn pro-btn-nav pro-side-btn"
                    onClick={() => act('redo')}
                    style={{ ...glassPanel, width: 42, height: 42, borderRadius: 12 }}
                >
                    <Icon name="redo" size={18} />
                </button>
            </div>

            {/* ── Main toolbar — top centre ─────────────────────────────────── */}
            <div
                style={{
                    position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    zIndex: 1000,
                    maxWidth: 'calc(100vw - 130px)',
                }}
            >
             {/* Main Toolbar - ללא עטיפת גלילה, שימוש באירועים ידניים */}
                    <div className="pro-toolbar" 
                         onPointerDown={handleToolbarPointerDown}
                         onPointerLeave={handleToolbarPointerLeave}
                         onPointerUp={handleToolbarPointerUp}
                         onPointerMove={handleToolbarPointerMove}
                         style={{ ...glassPanel, overflowX: 'hidden', touchAction: 'none', maxWidth: '100%', width: 'max-content', cursor: 'grab' }}>
                        
                        <button title="צייר"        className={`pro-btn ${mode==='draw'   ? 'active':''}`} onClick={() => { setMode('draw');   setShowAddMenu(false); }}><Icon name="draw"   /></button>
                        <button title="מחק"         className={`pro-btn ${mode==='erase'  ? 'active':''}`} onClick={() => { setMode('erase');  setShowAddMenu(false); }}><Icon name="erase"  /></button>
                        <button title="טקסט"        className={`pro-btn ${mode==='text'   ? 'active':''}`} onClick={() => { setMode('text');   setShowAddMenu(false); }}><Icon name="text"   /></button>
                        <button title="בחר / ערוך" className={`pro-btn ${mode==='select' ? 'active':''}`} onClick={() => { setMode('select'); setShowAddMenu(false); }}><Icon name="select" /></button>

                        <div className="pro-divider" />

                        <button title="פתור משוואה (Ans)" className="pro-btn pro-btn-ans" onClick={() => act('solveActiveBox')}><Icon name="ans" /></button>

                        <div className="pro-divider" />

                        <button title="מחשבון גרפי (Desmos)" className="pro-btn pro-btn-desmos" onClick={() => setShowDesmos(true)}><Icon name="desmos" /></button>

                        <div className="pro-divider" />

                        {/* כפתור הוספת הצורות - ללא התפריט הענק בתוכו */}
                        <div style={{ position: 'relative' }} ref={menuRef}>
                            <button className={`pro-btn with-text ${showAddMenu ? 'active' : ''}`} onClick={() => setShowAddMenu(!showAddMenu)}>
                                <Icon name="add" />
                            </button>
                        </div>

                        <div className="pro-divider" />

                        <button title="נקה לוח" className="pro-btn pro-btn-danger" onClick={() => act('clearBoard')}><Icon name="clear" /></button>
                    </div>

                    {/* ── התפריט נשלף החוצה לכאן, הרחק מפס הגלילה ── */}
                    {showAddMenu && (
                        <div className="pro-menu" dir="rtl">
                            <div style={{ display: 'flex', gap: 7 }}>
                                <button className="pro-btn with-text" style={{ flex: 1, background: 'rgba(255,255,255,0.05)' }} onClick={() => fileInputRef.current.click()}><Icon name="image" size={16} /> תמונה</button>
                                <button className="pro-btn with-text" style={{ flex: 1, background: 'rgba(255,255,255,0.05)' }} onClick={handleAddGrid}><Icon name="grid" size={16} /> צירים</button>
                            </div>
                            {shapeCategories.map((cat, idx) => (
                                <div key={idx}>
                                    <div className="pro-menu-category">{cat.title}</div>
                                    <div className="shape-grid">
                                        {cat.shapes.map(shape => (
                                            <button key={shape} title={shape} className="shape-icon-btn" onClick={() => { act('addShape', shape); setShowAddMenu(false); }}>
                                                <Icon name={shape} size={18} />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}


               {/* Color row (draw / text / erase mode) */}
                {(mode === 'draw' || mode === 'text' || mode === 'erase') && (
                    <div className="pro-toolbar" 
                         onPointerDown={handleToolbarPointerDown}
                         onPointerLeave={handleToolbarPointerLeave}
                         onPointerUp={handleToolbarPointerUp}
                         onPointerMove={handleToolbarPointerMove}
                         style={{ ...glassPanel, padding: '5px 10px', overflowX: 'hidden', touchAction: 'none', maxWidth: '100%', width: 'max-content', cursor: 'grab' }}>
                        {mode === 'erase' ? (
                            /* ── Eraser size controls ── */
                            <>
                                <span style={{ color: '#a1a1aa', fontSize: 13, fontWeight: 600, paddingRight: 4, whiteSpace: 'nowrap' }}>עובי:</span>
                                {[10, 20, 40, 70, 110].map(sz => (
                                    <button
                                        key={sz}
                                        title={`${sz}px`}
                                        onClick={() => setEraserSize && setEraserSize(sz)}
                                        style={{
                                            width: 20 + sz * 0.18, height: 20 + sz * 0.18,
                                            maxWidth: 36, maxHeight: 36,
                                            borderRadius: '50%', flexShrink: 0,
                                            background: eraserSize === sz ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.15)',
                                            border: eraserSize === sz ? '2px solid white' : '2px solid transparent',
                                            cursor: 'pointer', transition: '0.18s', margin: '0 3px',
                                        }}
                                    />
                                ))}
                            </>
                        ) : (
                            /* ── Draw / Text color controls ── */
                            <>
                                {colors.map(c => (
                                    <button
                                        key={c}
                                        style={{
                                            background: c, width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                                            border: activeColor === c ? '2px solid white' : '2px solid transparent',
                                            boxShadow: activeColor === c ? '0 0 0 2px rgba(255,255,255,0.25)' : 'none',
                                            cursor: 'pointer', transition: '0.18s', margin: '0 3px',
                                        }}
                                        onClick={() => handleColorChange(c)}
                                    />
                                ))}
                                {/* Custom color picker */}
                                <label
                                    title="בחר צבע מותאם אישית"
                                    style={{ position: 'relative', cursor: 'pointer', margin: '0 3px', flexShrink: 0 }}
                                >
                                    <div style={{
                                        width: 22, height: 22, borderRadius: '50%',
                                        background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                                        border: colors.includes(activeColor) ? '2px solid transparent' : '2px solid white',
                                        boxShadow: colors.includes(activeColor) ? 'none' : '0 0 0 2px rgba(255,255,255,0.25)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }} />
                                    <input
                                        ref={colorPickerRef}
                                        type="color"
                                        value={activeColor}
                                        onChange={e => handleColorChange(e.target.value)}
                                        style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                                    />
                                </label>
                                {mode === 'text' && (
                                    <>
                                        <div className="pro-divider" />
                                        <button className="pro-btn" style={{ width: 'auto', padding: '0 7px', fontSize: 14, fontWeight: 700, color: '#fff' }} onClick={() => { setGlobalFontSize(prev => prev + 5); act('updateGlobalFontSize', 5); }}>A+</button>
                                        <button className="pro-btn" style={{ width: 'auto', padding: '0 7px', fontSize: 14, fontWeight: 700, color: '#fff' }} onClick={() => { setGlobalFontSize(prev => Math.max(16, prev - 5)); act('updateGlobalFontSize', -5); }}>A-</button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleImageUpload} />
        </>
    );
}