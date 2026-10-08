import { createContext, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import katex from 'katex';
import Icon from './icons';
import { STAMPS, STAMP_CATEGORIES } from '../utils/stamps';
import { FORMULA_GROUPS, searchFormulas } from '../utils/formulas';
import { samplePlot } from '../utils/plot';
import { evaluate } from '../utils/exprEval';
import { PAPER_TYPES } from '../utils/patterns';
import {
    parseSI, formatSI, formatSILatex, parallel, series, divider, tauRC, tauRL, cutoffRC, cutoffRL,
    resonanceLC, seriesRLC, dbAmplitude, dbPower, fromDbAmplitude, fromDbPower, toPolar, toRect,
    BAND_COLORS, decodeBands, encodeBands, nearestStandard,
} from '../utils/eeCalc';

const TABS = [
    { id: 'stamps', label: 'רכיבים', icon: 'chip' },
    { id: 'formulas', label: 'נוסחאות', icon: 'book' },
    { id: 'calc', label: 'מחשבון', icon: 'calc' },
    { id: 'plot', label: 'גרף', icon: 'plot' },
    { id: 'paper', label: 'דף', icon: 'background' },
];

/** תצוגה מקדימה של סמל, מאותם נתיבים שיצוירו על הלוח */
function StampPreview({ stamp, color }) {
    const pad = 6;
    const vb = `${-pad} ${-pad - (stamp.id === 'led' ? 8 : 0)} ${stamp.w + pad * 2} ${stamp.h + pad * 2 + (stamp.id === 'led' ? 8 : 0)}`;
    return (
        <svg viewBox={vb} width="56" height="44" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {stamp.parts.map((p, i) => p.text
                ? <text key={i} x={p.x} y={p.y} fontSize={p.size || 18} fill={color} textAnchor="middle" dominantBaseline="central" fontStyle="italic" fontFamily="serif">{p.text}</text>
                : <path key={i} d={p.d} fill={p.fill ? color : 'none'} stroke={color} strokeWidth={p.fill ? 0.6 : Math.max(2.2, stamp.w / 40)} strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
    );
}

const Tex = ({ tex, display = false }) => {
    const html = useMemo(() => {
        try { return katex.renderToString(tex, { throwOnError: false, displayMode: display }); }
        catch { return tex; }
    }, [tex, display]);
    return <span className="stem-tex" dir="ltr" dangerouslySetInnerHTML={{ __html: html }} />;
};

/* ── גרירה מהפאנל אל הלוח ──
   אובייקט לא נכנס בלחיצה אלא נגרר, ונוחת בדיוק במקום שבו עזבו אותו. בעכבר
   ובעט הגרירה מתחילה אחרי כמה פיקסלים. במגע צריך להחזיק רגע לפני הגרירה,
   כדי שאפשר יהיה עדיין לגלול את הרשימה באצבע. */
const DragCtx = createContext(null);

function useDragBind() {
    const ctx = useContext(DragCtx);
    return ctx || (() => ({}));
}

function DragProvider({ children }) {
    const [ghost, setGhost] = useState(null);
    const [hint, setHint] = useState(false);
    const [st] = useState(() => ({ dragged: false, hintTimer: 0 }));
    const bind = useMemo(() => (drop, label) => ({
        className: 'stem-draggable',
        onClick: () => {
            if (st.dragged) { st.dragged = false; return; }
            setHint(true);
            clearTimeout(st.hintTimer);
            st.hintTimer = setTimeout(() => setHint(false), 2600);
        },
        onPointerDown: (e) => {
            if (e.button > 0) return;
            const id = e.pointerId, sx = e.clientX, sy = e.clientY, touch = e.pointerType === 'touch';
            let active = false, timer = 0;
            const start = () => { active = true; st.dragged = true; setGhost({ x: sx, y: sy, label }); };
            const stop = () => {
                clearTimeout(timer);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', cancel);
                window.removeEventListener('touchmove', block);
            };
            const move = (ev) => {
                if (ev.pointerId !== id) return;
                if (!active) {
                    const d = Math.hypot(ev.clientX - sx, ev.clientY - sy);
                    if (touch) { if (d > 10) stop(); return; }      // זז לפני ההחזקה: זו גלילה
                    if (d > 6) start(); else return;
                }
                setGhost({ x: ev.clientX, y: ev.clientY, label });
            };
            const block = (ev) => { if (active && ev.cancelable) ev.preventDefault(); };
            const up = (ev) => {
                if (ev.pointerId !== id) return;
                stop();
                setGhost(null);
                if (!active) return;
                const el = document.elementFromPoint(ev.clientX, ev.clientY);
                if (el && !el.closest('.stem-panel')) drop({ x: ev.clientX, y: ev.clientY });
                setTimeout(() => { st.dragged = false; }, 0);
            };
            const cancel = (ev) => { if (ev.pointerId !== id) return; stop(); setGhost(null); st.dragged = false; };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', cancel);
            window.addEventListener('touchmove', block, { passive: false });
            if (touch) timer = setTimeout(start, 280);
        },
    }), [st]);
    return (
        <DragCtx.Provider value={bind}>
            {children}
            {ghost && createPortal(<div className="stem-ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.label}</div>, document.body)}
            {hint && createPortal(<div className="stem-drag-hint" dir="rtl">גרור את האובייקט אל הלוח והרפה במקום שבו הוא צריך לשבת</div>, document.body)}
        </DragCtx.Provider>
    );
}

const dcls = (b, extra) => ({ ...b, className: `${extra || ''} ${b.className || ''}`.trim() });

function StampsTab({ color, onInsert }) {
    const bind = useDragBind();
    const [cat, setCat] = useState('circuit');
    const list = STAMPS.filter((s) => s.cat === cat);
    return (
        <>
            <div className="stem-chips">
                {STAMP_CATEGORIES.map((c) => (
                    <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.label}</button>
                ))}
            </div>
            <div className="stem-grid">
                {list.map((s) => (
                    <button key={s.id} {...dcls(bind((at) => onInsert(s.id, at), s.label), 'stem-stamp')} title={`גרור את ${s.label} אל הלוח`}>
                        <StampPreview stamp={s} color={color} />
                        <span>{s.label}</span>
                    </button>
                ))}
            </div>
            <p className="stem-note">הסמל נוחת על נקודת רשת, וההדקים שלו יושבים בדיוק על קווי הרשת. לשרטוט החוטים בחר בקלמר את <b>חוט מעגל</b> — כל קו יתיישר לקטעים אופקיים ואנכיים.</p>
        </>
    );
}

function FormulasTab({ onInsert }) {
    const bind = useDragBind();
    const [q, setQ] = useState('');
    const [open, setOpen] = useState('circuits');
    const groups = useMemo(() => searchFormulas(q), [q]);
    return (
        <>
            <input className="stem-search" placeholder="חיפוש נוסחה, למשל קבל או לפלס" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="stem-formulas">
                {groups.map((g) => {
                    const isOpen = q ? true : open === g.id;
                    return (
                        <div key={g.id} className="stem-group">
                            <button className="stem-group-head" onClick={() => setOpen(isOpen && !q ? null : g.id)} aria-expanded={isOpen}>
                                <span>{g.label}</span><span className="stem-count">{g.items.length}</span>
                            </button>
                            {isOpen && g.items.map((it) => (
                                <button key={it.name} {...dcls(bind((at) => onInsert(it.tex, at), it.name), 'stem-formula')} title="גרור את הנוסחה אל הלוח">
                                    <span className="stem-formula-name">{it.name}</span>
                                    <Tex tex={it.tex} />
                                </button>
                            ))}
                        </div>
                    );
                })}
                {groups.length === 0 && <p className="stem-note">לא נמצאה נוסחה מתאימה.</p>}
            </div>
            <p className="stem-note">{FORMULA_GROUPS.reduce((a, g) => a + g.items.length, 0)} נוסחאות. כל נוסחה נגררת ללוח ונכנסת כשדה עריכה, ואפשר להציב בה ולחשב.</p>
        </>
    );
}

/* ── מחשבון הנדסי ─────────────────────────────────────────────────── */

const Field = ({ label, value, onChange, unit, placeholder }) => (
    <label className="calc-field">
        <span>{label}</span>
        <input dir="ltr" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} inputMode="text" />
        {unit && <em>{unit}</em>}
    </label>
);

function Result({ label, text, tex, onInsert }) {
    const bind = useDragBind();
    return (
        <div className="calc-result">
            <span className="calc-result-label">{label}</span>
            <b dir="ltr">{text}</b>
            {tex && <button {...bind((at) => onInsert(tex, at), label)} title="גרור ללוח כנוסחה"><Icon name="grip" size={14} /></button>}
        </div>
    );
}

const ok = (...v) => v.every((x) => Number.isFinite(x));

function CalcTab({ onInsert }) {
    const [kind, setKind] = useState('res');
    const [s, setS] = useState({ list: '1k, 2.2k, 4.7k', vin: '12', r1: '10k', r2: '4.7k', r: '1k', c: '100n', l: '10m', f: '1k', ratio: '10', db: '20', re: '3', im: '4', mag: '5', deg: '53.13', bands: [1, 0, 2, 10], target: '4.7k', bandCount: 4 });
    const set = (k) => (v) => setS((o) => ({ ...o, [k]: v }));
    const n = (k) => parseSI(s[k]);

    const kinds = [
        ['res', 'נגדים'], ['div', 'מחלק מתח'], ['rc', 'RC ו־RL'], ['res-lc', 'תהודה'], ['z', 'עכבה'],
        ['db', 'דציבלים'], ['phasor', 'פאזור'], ['bands', 'קוד צבעים'],
    ];

    let body = null;
    if (kind === 'res') {
        const vals = s.list.split(/[,;\s]+/).map(parseSI).filter((v) => Number.isFinite(v) && v > 0);
        const ser = vals.length ? series(vals) : NaN, par = vals.length ? parallel(vals) : NaN;
        body = (<>
            <Field label="ערכים, מופרדים בפסיק" value={s.list} onChange={set('list')} placeholder="1k, 2.2k, 4.7k" />
            <Result label="בטור" text={formatSI(ser, 'Ω')} tex={ok(ser) && `R_{eq}=${formatSILatex(ser, '\\Omega')}`} onInsert={onInsert} />
            <Result label="במקביל" text={formatSI(par, 'Ω')} tex={ok(par) && `R_{\\parallel}=${formatSILatex(par, '\\Omega')}`} onInsert={onInsert} />
            {ok(par) && <Result label="ערך תקני E24 קרוב למקביל" text={formatSI(nearestStandard(par), 'Ω')} />}
        </>);
    } else if (kind === 'div') {
        const v = ok(n('vin'), n('r1'), n('r2')) ? divider(n('vin'), n('r1'), n('r2')) : NaN;
        body = (<>
            <Field label="מתח כניסה" value={s.vin} onChange={set('vin')} unit="V" />
            <Field label="R1 העליון" value={s.r1} onChange={set('r1')} unit="Ω" />
            <Field label="R2 התחתון" value={s.r2} onChange={set('r2')} unit="Ω" />
            <Result label="מתח יציאה" text={formatSI(v, 'V')} tex={ok(v) && `V_{out}=${formatSILatex(v, 'V')}`} onInsert={onInsert} />
        </>);
    } else if (kind === 'rc') {
        const R = n('r'), Cc = n('c'), L = n('l');
        body = (<>
            <Field label="R" value={s.r} onChange={set('r')} unit="Ω" />
            <Field label="C" value={s.c} onChange={set('c')} unit="F" />
            <Field label="L" value={s.l} onChange={set('l')} unit="H" />
            <Result label="τ של RC" text={formatSI(tauRC(R, Cc), 's')} tex={ok(R, Cc) && `\\tau_{RC}=${formatSILatex(tauRC(R, Cc), 's')}`} onInsert={onInsert} />
            <Result label="תדר קיטעון RC" text={formatSI(cutoffRC(R, Cc), 'Hz')} tex={ok(R, Cc) && `f_c=${formatSILatex(cutoffRC(R, Cc), 'Hz')}`} onInsert={onInsert} />
            <Result label="τ של RL" text={formatSI(tauRL(R, L), 's')} tex={ok(R, L) && `\\tau_{RL}=${formatSILatex(tauRL(R, L), 's')}`} onInsert={onInsert} />
            <Result label="תדר קיטעון RL" text={formatSI(cutoffRL(R, L), 'Hz')} tex={ok(R, L) && `f_c=${formatSILatex(cutoffRL(R, L), 'Hz')}`} onInsert={onInsert} />
        </>);
    } else if (kind === 'res-lc') {
        const L = n('l'), Cc = n('c'), R = n('r');
        const z = ok(L, Cc, R) ? seriesRLC(R, L, Cc, resonanceLC(L, Cc)) : null;
        body = (<>
            <Field label="L" value={s.l} onChange={set('l')} unit="H" />
            <Field label="C" value={s.c} onChange={set('c')} unit="F" />
            <Field label="R טורי" value={s.r} onChange={set('r')} unit="Ω" />
            <Result label="תדר תהודה" text={formatSI(resonanceLC(L, Cc), 'Hz')} tex={ok(L, Cc) && `f_0=${formatSILatex(resonanceLC(L, Cc), 'Hz')}`} onInsert={onInsert} />
            <Result label="ω0" text={formatSI(2 * Math.PI * resonanceLC(L, Cc), 'rad/s')} />
            {z && <Result label="גורם איכות Q" text={Number(z.q.toPrecision(3)).toString()} tex={`Q=${Number(z.q.toPrecision(3))}`} onInsert={onInsert} />}
            {z && <Result label="רוחב פס" text={formatSI(z.bw, 'Hz')} />}
        </>);
    } else if (kind === 'z') {
        const z = ok(n('r'), n('f')) ? seriesRLC(n('r'), Number.isFinite(n('l')) ? n('l') : 0, Number.isFinite(n('c')) ? n('c') : 0, n('f')) : null;
        body = (<>
            <p className="stem-note">R, L ו־C בטור, בתדר f. השאר את L או C ריקים כדי לוותר עליהם.</p>
            <Field label="R" value={s.r} onChange={set('r')} unit="Ω" />
            <Field label="L" value={s.l} onChange={set('l')} unit="H" />
            <Field label="C" value={s.c} onChange={set('c')} unit="F" />
            <Field label="f" value={s.f} onChange={set('f')} unit="Hz" />
            {z && <Result label="קרטזי" text={`${formatSI(z.re, '')} ${z.im < 0 ? '−' : '+'} j${formatSI(Math.abs(z.im), 'Ω')}`}
                tex={`Z=${formatSILatex(z.re)}${z.im < 0 ? '-' : '+'}j${formatSILatex(Math.abs(z.im), '\\Omega')}`} onInsert={onInsert} />}
            {z && <Result label="קוטבי" text={`${formatSI(z.mag, 'Ω')} ∠ ${z.deg.toFixed(2)}°`}
                tex={`Z=${formatSILatex(z.mag, '\\Omega')}\\angle${z.deg.toFixed(2)}^{\\circ}`} onInsert={onInsert} />}
        </>);
    } else if (kind === 'db') {
        const r = n('ratio'), d = Number(s.db);
        body = (<>
            <Field label="יחס" value={s.ratio} onChange={set('ratio')} />
            <Result label="יחס מתחים בדציבלים" text={`${dbAmplitude(r).toFixed(3)} dB`} tex={ok(r) && `20\\log_{10}${r}=${dbAmplitude(r).toFixed(2)}\\,\\mathrm{dB}`} onInsert={onInsert} />
            <Result label="יחס הספקים בדציבלים" text={`${dbPower(r).toFixed(3)} dB`} />
            <Field label="דציבלים" value={s.db} onChange={set('db')} unit="dB" />
            <Result label="יחס מתחים" text={Number(fromDbAmplitude(d).toPrecision(4)).toString()} />
            <Result label="יחס הספקים" text={Number(fromDbPower(d).toPrecision(4)).toString()} />
        </>);
    } else if (kind === 'phasor') {
        const p = toPolar(Number(s.re), Number(s.im));
        const r = toRect(Number(s.mag), Number(s.deg));
        body = (<>
            <div className="calc-row"><Field label="ממשי" value={s.re} onChange={set('re')} /><Field label="מדומה" value={s.im} onChange={set('im')} /></div>
            <Result label="קוטבי" text={`${Number(p.mag.toPrecision(4))} ∠ ${p.deg.toFixed(2)}°`} tex={ok(p.mag) && `${s.re}${Number(s.im) < 0 ? '' : '+'}${s.im}j=${Number(p.mag.toPrecision(4))}\\angle${p.deg.toFixed(2)}^{\\circ}`} onInsert={onInsert} />
            <div className="calc-row"><Field label="גודל" value={s.mag} onChange={set('mag')} /><Field label="זווית" value={s.deg} onChange={set('deg')} unit="°" /></div>
            <Result label="קרטזי" text={`${Number(r.re.toPrecision(4))} ${r.im < 0 ? '−' : '+'} j${Number(Math.abs(r.im).toPrecision(4))}`}
                tex={ok(r.re) && `${s.mag}\\angle${s.deg}^{\\circ}=${Number(r.re.toPrecision(4))}${r.im < 0 ? '-' : '+'}${Number(Math.abs(r.im).toPrecision(4))}j`} onInsert={onInsert} />
        </>);
    } else if (kind === 'bands') {
        const dec = decodeBands(s.bands);
        const target = parseSI(s.target);
        const enc = Number.isFinite(target) ? encodeBands(target, s.bandCount) : null;
        const setBand = (i, v) => setS((o) => { const b = [...o.bands]; b[i] = v; return { ...o, bands: b }; });
        const bandOptions = (i, len) => BAND_COLORS.map((c, ci) => ({ c, ci })).filter(({ c }) => {
            if (i < len - 2) return c.digit !== undefined;
            if (i === len - 2) return c.mul !== undefined;
            return c.tol !== undefined;
        });
        body = (<>
            <div className="seg-mini">
                {[4, 5].map((k) => <button key={k} className={s.bands.length === k ? 'on' : ''} onClick={() => setS((o) => ({ ...o, bands: k === 4 ? [1, 0, 2, 10] : [1, 0, 0, 1, 1], bandCount: k }))}>{k} פסים</button>)}
            </div>
            <div className="bands">
                {s.bands.map((b, i) => (
                    <select key={i} value={b} onChange={(e) => setBand(i, Number(e.target.value))} style={{ background: BAND_COLORS[b]?.hex, color: [0, 1, 7, 8].includes(b) ? '#fff' : '#111' }}>
                        {bandOptions(i, s.bands.length).map(({ c, ci }) => <option key={ci} value={ci}>{c.name}</option>)}
                    </select>
                ))}
            </div>
            <div className="resistor-art" aria-hidden="true">
                {s.bands.map((b, i) => <span key={i} style={{ background: BAND_COLORS[b]?.hex }} />)}
            </div>
            {dec && <Result label="ערך" text={`${formatSI(dec.ohms, 'Ω')}${dec.tol ? ` ±${dec.tol}%` : ''}`} tex={`R=${formatSILatex(dec.ohms, '\\Omega')}`} onInsert={onInsert} />}
            <Field label="ומהערך לפסים" value={s.target} onChange={set('target')} unit="Ω" />
            {enc && <div className="resistor-art" aria-label="פסי הצבע לערך">{enc.map((b, i) => <span key={i} title={BAND_COLORS[b]?.name} style={{ background: BAND_COLORS[b]?.hex }} />)}</div>}
            {enc && <p className="stem-note">{enc.map((b) => BAND_COLORS[b]?.name).join(' · ')}</p>}
        </>);
    }

    return (
        <>
            <div className="stem-chips">
                {kinds.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
            </div>
            <div className="calc-body">{body}</div>
            <p className="stem-note">אפשר לכתוב עם קידומות: 4.7k, 100n, 2.2u, וגם 4k7.</p>
        </>
    );
}

/* ── גרף ─────────────────────────────────────────────────────────── */

function PlotTab({ onInsert }) {
    const bind = useDragBind();
    const [fns, setFns] = useState('sin(x)\nexp(-x/4)cos(2x)');
    const [v, setV] = useState('x');
    const [from, setFrom] = useState('-2pi');
    const [to, setTo] = useState('2pi');
    const [autoY, setAutoY] = useState(true);
    const [yFrom, setYFrom] = useState('-2');
    const [yTo, setYTo] = useState('2');
    const [logX, setLogX] = useState(false);

    const spec = useMemo(() => {
        try {
            const list = fns.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
            if (!list.length) return { error: 'כתוב לפחות פונקציה אחת' };
            const xmin = evaluate(from), xmax = evaluate(to);
            const sp = { fns: list, variable: v, xmin, xmax, logX, xName: v };
            if (!autoY) { sp.ymin = evaluate(yFrom); sp.ymax = evaluate(yTo); }
            const sampled = samplePlot({ ...sp, samples: 260 });
            return { spec: sp, sampled };
        } catch (e) { return { error: e.message }; }
    }, [fns, v, from, to, autoY, yFrom, yTo, logX]);

    const W = 300, H = 170;
    const preview = spec.sampled && (() => {
        const { xmin, xmax, ymin, ymax, segments } = spec.sampled;
        const lx = (x) => (logX ? Math.log10(x) : x);
        const X = (x) => ((lx(x) - lx(xmin)) / (lx(xmax) - lx(xmin))) * W;
        const Y = (y) => H - ((y - ymin) / (ymax - ymin)) * H;
        const colors = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#c084fc', '#fb923c'];
        return (
            <svg className="plot-preview" viewBox={`0 0 ${W} ${H}`} width="100%" aria-label="תצוגה מקדימה של הגרף">
                <rect x="0" y="0" width={W} height={H} fill="none" stroke="currentColor" opacity="0.25" />
                {ymin < 0 && ymax > 0 && <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="currentColor" opacity="0.5" />}
                {!logX && xmin < 0 && xmax > 0 && <line y1="0" y2={H} x1={X(0)} x2={X(0)} stroke="currentColor" opacity="0.5" />}
                {segments.map((segs, i) => segs.map((seg, j) => (
                    <polyline key={`${i}-${j}`} fill="none" stroke={colors[i % colors.length]} strokeWidth="2"
                        points={seg.map((p) => `${X(p.x).toFixed(1)},${Math.max(-2, Math.min(H + 2, Y(p.y))).toFixed(1)}`).join(' ')} />
                )))}
            </svg>
        );
    })();

    return (
        <>
            <label className="calc-field col">
                <span>פונקציות, אחת בכל שורה</span>
                <textarea dir="ltr" rows={3} value={fns} onChange={(e) => setFns(e.target.value)} spellCheck={false} />
            </label>
            <div className="calc-row">
                <label className="calc-field"><span>משתנה</span>
                    <select value={v} onChange={(e) => setV(e.target.value)}><option value="x">x</option><option value="t">t</option><option value="w">ω (כתוב w)</option><option value="f">f</option></select>
                </label>
                <label className="pe-toggle sm"><input type="checkbox" checked={logX} onChange={(e) => { setLogX(e.target.checked); if (e.target.checked) { setFrom('1'); setTo('1e5'); setV('w'); } }} /><span>ציר לוגריתמי, לבודה</span></label>
            </div>
            <div className="calc-row">
                <Field label="מ" value={from} onChange={setFrom} />
                <Field label="עד" value={to} onChange={setTo} />
            </div>
            <label className="pe-toggle sm"><input type="checkbox" checked={autoY} onChange={(e) => setAutoY(e.target.checked)} /><span>טווח y אוטומטי</span></label>
            {!autoY && <div className="calc-row"><Field label="y מ" value={yFrom} onChange={setYFrom} /><Field label="עד" value={yTo} onChange={setYTo} /></div>}
            {spec.error ? <p className="stem-error">{spec.error}</p> : preview}
            <button {...dcls(bind((at) => spec.spec && onInsert(spec.spec, at), 'גרף'), 'stem-primary')} disabled={!spec.spec}>גרור את הגרף אל הלוח</button>
            <p className="stem-note">כפל מרומז עובד: 2x, 3sin(x), xe^(-x). יש גם u(t), rect, sinc, ln, log. בגרף בודה כתוב למשל 20log(1/sqrt(1+(w/1000)^2)).</p>
        </>
    );
}

/* ── דף ורשתות ──────────────────────────────────────────────────── */

function PaperTab({ pattern, onPattern, onInsertGrid, onPolar, onBode, onAxes }) {
    const bind = useDragBind();
    return (
        <>
            <div className="pe-label">רקע הלוח</div>
            <div className="paper-grid">
                {PAPER_TYPES.map((p) => (
                    <button key={p.id} className={`paper-btn paper-type-${p.id} ${pattern === p.id ? 'on' : ''}`} onClick={() => onPattern(p.id)}>
                        <span className="paper-swatch" />{p.label}
                    </button>
                ))}
            </div>
            <div className="pe-label" style={{ marginTop: 16 }}>הוספה ללוח</div>
            <div className="stem-list">
                <button onClick={onInsertGrid}><Icon name="grid" size={16} /> מערכת צירים עם משבצות</button>
                <button {...bind(onPolar, 'רשת קוטבית')}><Icon name="circle" size={16} /> רשת קוטבית — לפאזורים ולתבניות קרינה</button>
                <button {...bind(onBode, 'מסגרת בודה')}><Icon name="plot" size={16} /> מסגרת בודה — גודל ומופע</button>
                <button {...bind(onAxes, 'צירים תלת־ממדיים')}><Icon name="cube" size={16} /> צירים תלת־ממדיים</button>
            </div>
        </>
    );
}

/**
 * מגירת ההנדסה: רכיבים, דף נוסחאות, מחשבון, גרפים ורקעים. נפתחת מצד
 * המסך ולא כחלון באמצע, כדי שאפשר יהיה להמשיך לראות את הלוח ולעבוד.
 */
export default function StemPanel({ onClose, boardRef, inkColor, pattern, onPattern, onInsertGrid, initialTab = 'stamps', dockSide = 'top' }) {
    const [tab, setTab] = useState(initialTab);
    const b = () => boardRef.current;
    return (
        <aside className={`stem-panel dock-${dockSide}`} data-ui data-scrollable dir="rtl" aria-label="כלי הנדסה ופיזיקה">
            <header className="stem-head">
                <div className="stem-title">הנדסה ופיזיקה</div>
                <button className="stem-close" onClick={onClose} aria-label="סגור"><Icon name="close" size={18} /></button>
            </header>
            <nav className="stem-tabs">
                {TABS.map((t) => (
                    <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                        <Icon name={t.icon} size={17} /><span>{t.label}</span>
                    </button>
                ))}
            </nav>
            <DragProvider>
            <div className="stem-body">
                {tab === 'stamps' && <StampsTab color={inkColor} onInsert={(id, at) => b()?.insertStamp(id, at)} />}
                {tab === 'formulas' && <FormulasTab onInsert={(tex, at) => b()?.insertMath(tex, at)} />}
                {tab === 'calc' && <CalcTab onInsert={(tex, at) => b()?.insertMath(tex, at)} />}
                {tab === 'plot' && <PlotTab onInsert={(spec, at) => b()?.insertPlot(spec, at)} />}
                {tab === 'paper' && <PaperTab pattern={pattern} onPattern={onPattern} onInsertGrid={onInsertGrid} onPolar={(at) => b()?.insertPolarGrid(at)} onBode={(at) => b()?.insertBodeFrame(at)} onAxes={(at) => b()?.insertStamp('axes3d', at)} />}
            </div>
            </DragProvider>
        </aside>
    );
}
