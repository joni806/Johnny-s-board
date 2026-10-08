/* =====================================================================
 * mathKeyboard.js — לשונית "הנדסה" במקלדת המתמטית של MathLive
 * ---------------------------------------------------------------------
 * המקלדת המובנית של MathLive כללית. כאן נוספת לפניה לשונית עם מה
 * שסטודנט להנדסת חשמל ולפיזיקה כותב כל שיעור: j ופאזורים, אומגה,
 * נבלה, וקטורים ונקודות נגזרת, התמרות, מטריצות, ברה־קט ויחידות.
 * ===================================================================== */

const k = (latex, extra = {}) => ({ latex, ...extra });

export const ENGINEERING_LAYOUT = {
    label: 'הנדסה',
    tooltip: 'סימנים להנדסת חשמל ולפיזיקה',
    rows: [
        [
            k('j', { variants: ['i', '\\jmath'] }), k('\\omega', { variants: ['\\Omega', '\\omega_0'] }), k('\\angle'), k('\\phi', { variants: ['\\varphi', '\\Phi'] }),
            k('\\theta'), k('\\lambda'), k('\\tau'), k('\\mu', { variants: ['\\mu_0'] }), k('\\varepsilon', { variants: ['\\varepsilon_0'] }), k('\\hbar'),
        ],
        [
            k('\\vec{#0}', { label: 'v⃗' }), k('\\hat{#0}', { label: 'x̂' }), k('\\dot{#0}', { label: 'ẋ' }), k('\\ddot{#0}', { label: 'ẍ' }),
            k('\\nabla'), k('\\nabla\\cdot'), k('\\nabla\\times'), k('\\partial'),
            k('\\frac{d#?}{dt}', { label: 'd/dt' }), k('\\frac{\\partial #?}{\\partial #?}', { label: '∂/∂' }),
        ],
        [
            k('\\int_{#?}^{#?}', { variants: ['\\int', '\\iint', '\\iiint'] }), k('\\oint'), k('\\sum_{#?}^{#?}'), k('\\lim_{#?\\to#?}', { label: 'lim' }),
            k('\\mathcal{L}\\left\\{#0\\right\\}', { label: 'ℒ{ }' }), k('\\mathcal{F}\\left\\{#0\\right\\}', { label: 'ℱ{ }' }),
            k('e^{j\\omega t}'), k('\\overline{#0}', { label: 'x̄' }), k('#@^{*}', { label: 'z*' }), k('\\parallel', { label: '∥' }),
        ],
        [
            k('\\begin{pmatrix}#0 & #? \\\\ #? & #?\\end{pmatrix}', { label: '(2×2)' }),
            k('\\begin{pmatrix}#0 & #? & #?\\\\ #? & #? & #?\\\\ #? & #? & #?\\end{pmatrix}', { label: '(3×3)' }),
            k('\\begin{vmatrix}#0 & #? \\\\ #? & #?\\end{vmatrix}', { label: '|2×2|' }),
            k('\\langle #0|', { label: '⟨ψ|' }), k('|#0\\rangle', { label: '|ψ⟩' }),
            k('\\approx'), k('\\propto'), k('\\infty'), k('\\Re'), k('\\Im'),
        ],
        [
            k('\\Omega', { label: 'Ω' }), k('\\,\\mathrm{V}', { label: 'V' }), k('\\,\\mathrm{A}', { label: 'A' }), k('\\,\\mathrm{W}', { label: 'W' }),
            k('\\,\\mathrm{Hz}', { label: 'Hz' }), k('\\,\\mathrm{F}', { label: 'F' }), k('\\,\\mathrm{H}', { label: 'H' }),
            k('\\,\\mathrm{dB}', { label: 'dB' }), k('^{\\circ}', { label: '°' }), k('\\times10^{#?}', { label: '×10ⁿ' }),
        ],
    ],
};

let installed = false;

/** מוסיף את הלשונית פעם אחת, מיד אחרי לשונית המספרים */
export function installEngineeringKeyboard() {
    if (installed || typeof window === 'undefined' || !window.mathVirtualKeyboard) return;
    try {
        window.mathVirtualKeyboard.layouts = ['numeric', ENGINEERING_LAYOUT, 'symbols', 'alphabetic', 'greek'];
        installed = true;
    } catch { /* גרסת MathLive בלי תמיכה בפריסות מותאמות */ }
}
