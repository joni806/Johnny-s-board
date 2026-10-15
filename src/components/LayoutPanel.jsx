import { PAPER_SIZES, LAYOUT_MODES, normalizeLayout, pageSize, isStrip } from '../utils/pages';

/**
 * חלונית פריסת הלוח: אינסופי או דפים, גודל דף, כיוון, קנה מידה ועוד.
 * כל שינוי חל מיד על הלוח שמאחור, ללא כפתור "החל".
 */
export default function LayoutPanel({ layout, onChange, onClose, inline = false }) {
    const paged = layout.mode !== 'infinite';
    const set = (patch) => onChange(normalizeLayout({ ...layout, ...patch }));
    const paper = PAPER_SIZES.find((p) => p.id === layout.paper) || PAPER_SIZES[0];
    const size = pageSize(layout);
    const mm = (units) => Math.round(units / (96 / 25.4) / (layout.scale / 100));

    return (
        <div data-ui data-scrollable dir="rtl" className={`lp-panel${inline ? ' lp-inline' : ''}`} role={inline ? undefined : 'dialog'} aria-label="פריסת הלוח"
            onPointerDown={(e) => e.stopPropagation()}>
            {!inline && (
                <div className="lp-head">
                    <strong>פריסת הלוח</strong>
                    <button className="lp-x" onClick={onClose} aria-label="סגור">✕</button>
                </div>
            )}

            <div className="lp-label">סוג לוח</div>
            <div className="lp-modes">
                {LAYOUT_MODES.map((m) => (
                    <button key={m.id} className={layout.mode === m.id ? 'on' : ''} onClick={() => set({ mode: m.id })}>
                        <span className={`lp-ico lp-ico-${m.id}`} aria-hidden="true" />
                        {m.label}
                    </button>
                ))}
            </div>
            <div className="lp-hint">{LAYOUT_MODES.find((m) => m.id === layout.mode)?.hint}</div>

            {paged && (
                <>
                    <div className="lp-label">גודל דף</div>
                    <div className="lp-chips">
                        {PAPER_SIZES.map((p) => (
                            <button key={p.id} className={layout.paper === p.id ? 'on' : ''} onClick={() => set({ paper: p.id })}>{p.label}</button>
                        ))}
                    </div>
                    {paper.id === 'custom' && (
                        <div className="lp-custom">
                            <label>רוחב <input type="number" min="40" max="2000" value={layout.customW} onChange={(e) => set({ customW: e.target.value })} /> מ״מ</label>
                            <label>גובה <input type="number" min="40" max="2000" value={layout.customH} onChange={(e) => set({ customH: e.target.value })} /> מ״מ</label>
                        </div>
                    )}

                    <div className="lp-label">כיוון</div>
                    <div className="lp-two">
                        <button className={layout.orientation === 'portrait' ? 'on' : ''} onClick={() => set({ orientation: 'portrait' })}>
                            <span className="lp-page lp-portrait" aria-hidden="true" /> לאורך
                        </button>
                        <button className={layout.orientation === 'landscape' ? 'on' : ''} onClick={() => set({ orientation: 'landscape' })}>
                            <span className="lp-page lp-landscape" aria-hidden="true" /> לרוחב
                        </button>
                    </div>

                    <div className="lp-label">
                        <span>קנה מידה</span><span className="lp-val">{layout.scale}%</span>
                    </div>
                    <input className="lp-range" type="range" min="25" max="400" step="5" value={layout.scale}
                        onChange={(e) => set({ scale: e.target.value })} />
                    <div className="lp-hint">
                        דף של {mm(size.w)}×{mm(size.h)} מ״מ. קנה מידה גדול נותן דף רחב יותר, כך שהכתב נראה קטן ביחס אליו; קטן נותן דף קטן וכתב גדול.
                    </div>

                    {layout.mode !== 'single' && !isStrip(layout) && (
                        <>
                            <div className="lp-label">רווח בין דפים <span className="lp-val">{layout.gap}</span></div>
                            <input className="lp-range" type="range" min="0" max="120" step="4" value={layout.gap}
                                onChange={(e) => set({ gap: e.target.value })} />
                        </>
                    )}

                    {!isStrip(layout) && (
                        <label className="lp-check">
                            <input type="checkbox" checked={layout.numbers} onChange={(e) => set({ numbers: e.target.checked })} />
                            הצג מספרי דפים
                        </label>
                    )}
                </>
            )}
        </div>
    );
}
