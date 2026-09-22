import nerdamer from 'nerdamer';
import 'nerdamer/Algebra';
import 'nerdamer/Calculus';
import 'nerdamer/Solve';

/**
 * פתרון סימבולי של ביטוי ב־ascii-math.
 *
 * המודול טהור ואינו נוגע ב־DOM, כדי שיוכל לרוץ גם בתוך Web Worker וגם
 * בחוט הראשי כנפילה לאחור. הפרדה זו חשובה כי nerdamer עלול לרוץ שניות
 * ארוכות על ביטוי כבד, ואז הלוח קופא באמצע כתיבה.
 *
 * מחזיר { ok, resultLatex } או { ok: false, error }.
 */
export function solveAsciiMath(plainMath) {
    try {
        const parsed = nerdamer(plainMath);
        const vars = parsed.variables();
        let resultLatex;

        if (plainMath.includes('=')) {
            const targetVar = vars.length > 0 ? vars[0] : 'x';
            const solutions = nerdamer.solve(plainMath, targetVar);
            resultLatex = `\\Rightarrow ${targetVar} = ${solutions.toTeX()}`;
        } else if (vars.length > 0) {
            const targetVar = vars[0];
            const simplified = parsed.simplify().toTeX();
            const solutions = nerdamer.solve(plainMath, targetVar).toTeX();
            resultLatex = `= ${simplified} \\quad \\Rightarrow ${targetVar} = ${solutions}`;
        } else {
            resultLatex = `= ${parsed.evaluate().toTeX()}`;
        }
        return { ok: true, resultLatex };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
}
