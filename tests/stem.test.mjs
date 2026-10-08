/* בדיקות לכלי ההנדסה: מחשב הביטויים, המחשבון ההנדסי והתמרת לפלס ההפוכה.
   הרצה:  node tests/stem.test.mjs                                         */
import { compile, evaluate } from '../src/utils/exprEval.js';
import { parseSI, formatSI, parallel, series, divider, cutoffRC, resonanceLC, seriesRLC, decodeBands, encodeBands, nearestStandard, toPolar, toRect } from '../src/utils/eeCalc.js';
import { inverseLaplace, polyRoots, fitRational } from '../src/utils/laplace.js';
import { runCas, splitTerms } from '../src/utils/solveMath.js';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS | ${name}`); }
  else { fail++; console.log(`FAIL | ${name} ${extra}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/* ── מחשב ביטויים ── */
check('קדימות פעולות', near(evaluate('2+3*4^2'), 50));
check('חזקה ימנית', near(evaluate('2^3^2'), 512));
check('מינוס אונרי מול חזקה', near(evaluate('-2^2'), -4));
check('כפל מרומז 2x', near(compile('2x')(3), 6));
check('כפל מרומז 3sin(x)', near(compile('3sin(x)')(Math.PI / 2), 3));
check('כפל מרומז בסוגריים', near(compile('2(x+1)(x-1)')(3), 16));
check('שמות מודבקים xsin(x)', near(compile('xsin(x)')(Math.PI / 2), Math.PI / 2));
check('pi ו-e', near(evaluate('pi') , Math.PI) && near(evaluate('e^1'), Math.E));
check('ln ו-log', near(evaluate('ln(e)'), 1) && near(evaluate('log(1000)'), 3));
check('פונקציית מדרגה', compile('u(t)', ['t'])(-1) === 0 && compile('u(t)', ['t'])(2) === 1);
check('סימן שורש ותו כפל', near(evaluate('√(16)×2'), 8));
check('ערך מוחלט', near(compile('|x-5|')(2), 3));
check('עצרת', near(evaluate('5!'), 120));
let threw = false; try { compile('2+*3'); } catch { threw = true; }
check('שגיאת תחביר נזרקת', threw);
threw = false; try { compile('foo(x)'); } catch { threw = true; }
check('פונקציה לא מוכרת נזרקת', threw);

/* ── מחשבון הנדסי ── */
check('4.7k', parseSI('4.7k') === 4700);
check('4k7 כתיב אירופי', near(parseSI('4k7'), 4700));
check('100nF', near(parseSI('100nF'), 1e-7));
check('2.2µH', near(parseSI('2.2µH'), 2.2e-6));
check('1M מגה מול 1m מילי', parseSI('1M') === 1e6 && near(parseSI('1m'), 1e-3));
check('10kΩ', parseSI('10kΩ') === 10000);
check('קלט שגוי מחזיר NaN', Number.isNaN(parseSI('abc')));
check('עיצוב 4700 Ω', formatSI(4700, 'Ω') === '4.7 kΩ', formatSI(4700, 'Ω'));
check('עיצוב 1.59e-4', formatSI(1.5915e-4, 's') === '159 µs', formatSI(1.5915e-4, 's'));
check('נגדים במקביל', near(parallel([1000, 1000]), 500));
check('נגדים בטור', series([100, 220]) === 320);
check('מחלק מתח', near(divider(10, 1000, 1000), 5));
check('תדר קיטעון RC', near(cutoffRC(1000, 1e-6), 159.1549, 1e-5));
check('תהודה LC', near(resonanceLC(1e-3, 1e-6), 5032.92, 1e-5));
const z = seriesRLC(10, 1e-3, 1e-6, 5032.92);
check('RLC בתהודה — עכבה ממשית', Math.abs(z.im) < 0.01 && near(z.mag, 10, 1e-3));
check('קוד צבעים: חום שחור אדום זהב = 1k', (() => { const d = decodeBands([1, 0, 2, 10]); return d && d.ohms === 1000 && d.tol === 5; })());
check('קוד צבעים הפוך: 4.7k', JSON.stringify(encodeBands(4700)) === JSON.stringify([4, 7, 2, 10]), JSON.stringify(encodeBands(4700)));
check('ערך תקני קרוב', nearestStandard(4600) === 4700 && nearestStandard(1050, 'E12') === 1000, `${nearestStandard(4600)} ${nearestStandard(1050, 'E12')}`);
const pol = toPolar(3, 4), rec = toRect(5, 53.1301);
check('פאזור קרטזי לקוטבי והפוך', near(pol.mag, 5) && near(pol.deg, 53.1301, 1e-5) && near(rec.re, 3, 1e-5) && near(rec.im, 4, 1e-5));

/* ── שורשים והתמרה הפוכה ── */
const roots = polyRoots([1, -6, 11, -6]).map((r) => r.re).sort((a, b) => a - b);
check('שורשי (s-1)(s-2)(s-3)', near(roots[0], 1) && near(roots[1], 2) && near(roots[2], 3));

/** בודק התמרה הפוכה מול פתרון ידוע בכמה נקודות זמן */
const ilt = (name, num, den, f) => {
  let res, ok = true, worst = 0;
  try { res = inverseLaplace(num, den); } catch (e) { check(name, false, e.message); return; }
  for (const t of [0.1, 0.5, 1, 2.3]) {
    const err = Math.abs(res.evaluate(t) - f(t));
    worst = Math.max(worst, err);
    if (err > 1e-6) ok = false;
  }
  check(name, ok, `שגיאה ${worst.toExponential(2)} | ${res.latex}`);
  console.log(`       f(t) = ${res.latex}`);
  return res;
};
ilt('1/(s(s+2))', [1], [1, 2, 0], (t) => 0.5 - 0.5 * Math.exp(-2 * t));
ilt('3/((s+2)^2+9) — הדוגמה שהמנוע הסימבולי טעה בה', [3], [1, 4, 13], (t) => Math.exp(-2 * t) * Math.sin(3 * t));
ilt('(s+1)/(s^2+3s+2)', [1, 1], [1, 3, 2], (t) => Math.exp(-2 * t));
ilt('1/(s+1)^2 — קוטב כפול', [1], [1, 2, 1], (t) => t * Math.exp(-t));
ilt('1/(s+1)^3 — קוטב משולש', [1], [1, 3, 3, 1], (t) => (t * t / 2) * Math.exp(-t));
ilt('s/(s^2+4)', [1, 0], [1, 0, 4], (t) => Math.cos(2 * t));
ilt('(2s+3)/(s^3+2s^2+5s) — RLC עם מדרגה', [2, 3], [1, 2, 5, 0], (t) => {
  // פירוק ידני: 3/5 /s + (−3/5 s + 4/5)/(s²+2s+5)
  return 0.6 + Math.exp(-t) * (-0.6 * Math.cos(2 * t) + (0.8 + 0.6) / 2 * Math.sin(2 * t));
});
const withDelta = inverseLaplace([1, 3], [1, 2]);
check('חלק פולינומי נותן דלתא', withDelta.latex.includes('\\delta'), withDelta.latex);

/* ── פעולות CAS על תיבת נוסחה ── */
const cas = (name, action, expr, expect) => {
  const r = runCas(action, expr, 'F');
  const ok = r.ok && (typeof expect === 'string' ? r.latex.includes(expect) : expect(r.latex));
  check(name, ok, r.ok ? r.latex : r.error);
};
cas('לפלס של e^{-2t}sin3t בצורה פרושה', 'laplace', 'e^(-2t)sin (3t)', '\\frac{3}{s^{2} + 4s + 13}');
cas('לפלס של סכום — עוקף את באג הכפל של nerdamer', 'laplace', 'sin(2t)+3', '\\frac{3s^{2} + 2s + 12}{s^{3} + 4s}');
cas('לפלס עם u(t)', 'laplace', '5u(t)e^(-t)', '\\frac{5}{s + 1}');
cas('לפלס הפוך דרך הקטבים', 'ilaplace', '(3)/((s+2)^2+9)', 'e^{-2t}\\,\\sin(3t)');
cas('שברים חלקיים', 'partfrac', '(1)/(s^2+3s+2)', '\\frac{1}{s + 1} - \\frac{1}{s + 2}');
cas('נגזרת', 'diff', 'x^2sin(x)', '\\cos');
cas('אינטגרל לא מסוים', 'integrate', 'x e^x', '+ C');
cas('דטרמיננטה', 'det', '((1,2),(3,4))', '= -2');
cas('מטריצה הופכית', 'inv', '((1,2),(3,4))', 'pmatrix');
cas('פירוק לגורמים', 'factor', 'x^2-5x+6', 'x-2');
cas('ערך מספרי', 'evaluate', 'sqrt(2)pi', '4.44288');
check('פיצול איברים מכבד מינוס אונרי', JSON.stringify(splitTerms('-a+b^-2-c*(-d)')) === JSON.stringify([{ sign: -1, text: 'a' }, { sign: 1, text: 'b^-2' }, { sign: -1, text: 'c*(-d)' }]));
const fr = fitRational((s) => 3 / ((s + 2) ** 2 + 9));
check('שחזור פונקציה רציונלית', fr && fr.den.length === 3 && Math.abs(fr.den[1] - 4) < 1e-9 && Math.abs(fr.den[2] - 13) < 1e-9);

console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
