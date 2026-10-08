/* בדיקת קצה־לקצה לכל השדרוגים: קלמר, יישור צורות, מחק חלקי, הדבקה,
 * סרגל צבעים, עגינה לשני הצדדים, מגירת ההנדסה וסרגל החישוב.
 *
 *     npm run build && node tests/features.test.mjs
 *
 * מודל זיהוי כתב היד נטען מקבצים מקומיים כשמוגדר TEXO_DIR, למשל:
 *     TEXO_DIR=/path/to/Texo-web/models/model node tests/features.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const root = new URL('../dist/', import.meta.url).pathname;
const server = createServer(async (req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    const file = p.endsWith('/') ? join(p, 'index.html') : p;
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const SHOTS = process.env.SHOTS || null;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
const TEXO = process.env.TEXO_DIR;
if (TEXO) {
  await context.route(/huggingface\.co\/alephpi\/FormulaNet\/resolve\/main\/(.+)$/, async (route) => {
    const m = /resolve\/main\/(.+)$/.exec(route.request().url());
    try { route.fulfill({ status: 200, body: await readFile(join(TEXO, m[1])), headers: { 'content-type': 'application/octet-stream' } }); }
    catch { route.fulfill({ status: 404, body: '' }); }
  });
}
const page = await context.newPage();
let onnxRequests = 0;
page.on('request', (r) => { if (/\.onnx(\?|$)/.test(r.url())) onnxRequests++; });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'warning' && process.env.DEBUG) console.log('warn: ' + m.text());
  if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.g|404 \(Not Found\)|desmos/.test(m.text())) errors.push('console: ' + m.text());
});

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('PASS | ' + n); } else { fail++; console.log('FAIL | ' + n + ' ' + x); } };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function stroke(points, { steps = 1, hold = 0 } = {}) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps });
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
}
let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const trace = (verts, closed = true, per = 22, noise = 2) => {
  const list = closed ? [...verts, verts[0]] : verts;
  const out = [];
  for (let i = 1; i < list.length; i++) for (let k = 0; k < per; k++) {
    const t = k / per;
    out.push({ x: list[i - 1].x + (list[i].x - list[i - 1].x) * t + (rnd() - 0.5) * noise, y: list[i - 1].y + (list[i].y - list[i - 1].y) * t + (rnd() - 0.5) * noise });
  }
  out.push(list[list.length - 1]);
  return out;
};
/** מצב הלוח החי, ישירות מ־Fabric דרך ה־DOM */
const objects = () => page.evaluate(() => {
  const el = document.querySelector('#fabric-canvas');
  const c = el && (el.__canvas || window.__pbCanvas);
  if (!c) return null;
  return c.getObjects().filter((o) => !o.isEditHelper).map((o) => ({
    type: o.type, customType: o.customType, penKind: o.penKind, opacity: o.opacity, square: !!o.square,
    w: Math.round(o.width * (o.scaleX || 1)), h: Math.round(o.height * (o.scaleY || 1)), nodes: Array.isArray(o.inkNodes) ? o.inkNodes.length : 0,
    left: Math.round(o.getBoundingRect().left), top: Math.round(o.getBoundingRect().top), dash: o.dashStyle || null, stampId: o.stampId || null,
  }));
});
const clearBoard = async () => { await page.evaluate(() => window.__pbBoard?.clearBoard()); await page.waitForTimeout(150); };

await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('header .btn-create-new').click();
await page.locator('.modal-actions .btn-create-new').click();
await page.waitForSelector('#drawing-canvas');
await page.waitForTimeout(500);
check('הסרגל החדש מוצג', await page.locator('.pb-dock').isVisible());
check('שלושה עטים בלבד כברירת מחדל', (await page.locator('[role=radiogroup] .pb-btn:not(.pb-add)').count()) === 3);
check('  עט, לורד ומדגיש', (await page.locator('[role=radiogroup] .pb-btn-label').allInnerTexts()).join(',') === 'עט,לורד,מדגיש');
check('סרגל צבעים נפרד מתחת לסרגל הכלים', (await page.locator('.pb-colorbar .pb-swatch').count()) === 7);
const dockBox = await page.locator('.pb-dock').boundingBox();
const barBox = await page.locator('.pb-colorbar').boundingBox();
check('  והוא ממוקם מתחת לסרגל', barBox.y >= dockBox.y + dockBox.height - 2);
check('יש גישה לקנבס לבדיקות', Array.isArray(await objects()));
await shot('01-board');

/* ── 1. ריבוע מרושל הופך לריבוע ── */
const sloppy = () => trace([{ x: 400, y: 300 }, { x: 612, y: 288 }, { x: 622, y: 492 }, { x: 396, y: 506 }]);
await stroke(sloppy());                       // הרמה מיידית: נשאר דיו
await page.waitForTimeout(400);
let rawObjs = await objects();
check('הרמת עט בלי השהיה לא מיישרת', rawObjs.length === 1 && rawObjs[0].customType === 'ink', JSON.stringify(rawObjs));
await clearBoard();
await stroke(sloppy(), { hold: 700 });         // השהיה בסוף: מיושר
await page.waitForTimeout(300);
let objs = await objects();
const sq = objs.find((o) => o.customType === 'rect');
check('ריבוע מרושל נשמר כמלבן', !!sq, JSON.stringify(objs));
check('  ושני צלעותיו שוות — ריבוע', sq && Math.abs(sq.w - sq.h) < 2, sq ? `${sq.w}x${sq.h}` : '');
check('שבב הפירושים מופיע', await page.locator('.board-chip').first().isVisible());
await shot('02-snap-chip');
await page.locator('.board-chip button', { hasText: 'כפי שצויר' }).click();
await page.waitForTimeout(200);
objs = await objects();
check('מעבר לפירוש "כפי שצויר" מחליף לצורה העקומה', objs.some((o) => o.customType === 'polygon') && !objs.some((o) => o.customType === 'rect'), JSON.stringify(objs.map((o) => o.customType)));
await page.locator('.board-chip button', { hasText: 'ריבוע' }).click();
await page.waitForTimeout(150);
objs = await objects();
check('  וחזרה לריבוע בהקשה', objs.some((o) => o.customType === 'rect'));
await clearBoard();

/* ── 2. מדגיש ── */
const pens = page.locator('[role=radiogroup] .pb-btn:not(.pb-add)');
let hlIndex = -1;
for (let i = 0; i < await pens.count(); i++) {
  const t = await pens.nth(i).getAttribute('title');
  if (t && t.startsWith('מדגיש')) { hlIndex = i; break; }
}
await stroke(trace([{ x: 300, y: 400 }, { x: 700, y: 405 }], false, 40, 1));    // דיו רגיל
await page.waitForTimeout(150);
await pens.nth(hlIndex).click();
await stroke(trace([{ x: 280, y: 402 }, { x: 720, y: 398 }], false, 40, 3), { hold: 600 });
await page.waitForTimeout(200);
objs = await objects();
const hl = objs.findIndex((o) => o.penKind === 'highlighter');
const inkI = objs.findIndex((o) => o.penKind !== 'highlighter');
check('המדגיש נוצר שקוף', hl >= 0 && objs[hl].opacity < 0.5, JSON.stringify(objs));
check('  ונכנס מתחת לכתב', hl >= 0 && inkI >= 0 && hl < inkI, `hl=${hl} ink=${inkI}`);
await shot('03-highlighter');
await clearBoard();

/* ── 3. מחק חלקי ── */
await pens.nth(0).click();
// משיכה גלית, כדי שתישאר דיו ולא תתיישר לקו
await stroke(Array.from({ length: 50 }, (_, i) => ({ x: 300 + i * 10, y: 300 + 26 * Math.sin(i / 3) })));
await page.waitForTimeout(150);
objs = await objects();
check('משיכה נשמרה עם קו אמצע למחק', objs.length === 1 && objs[0].nodes > 20, JSON.stringify(objs));
await page.keyboard.press('e');
await stroke([{ x: 550, y: 380 }, { x: 550, y: 230 }], { steps: 8 });
await page.waitForTimeout(200);
objs = await objects();
check('מחק חלקי חותך את הקו לשניים', objs.length === 2 && objs.every((o) => o.customType === 'ink'), JSON.stringify(objs));
await shot('04-partial-erase');
await clearBoard();

/* ── 4. העתקה והדבקה במקום הלחיצה ── */
await pens.nth(0).click();
await stroke(trace([{ x: 300, y: 250 }, { x: 400, y: 250 }, { x: 400, y: 350 }, { x: 300, y: 350 }]), { hold: 700 });
await page.waitForTimeout(250);
await page.locator('.board-chip button[aria-label="סגור"]').first().click().catch(() => {});
await page.mouse.click(400, 300);         // הקשה כפולה בוחרת את הצורה
await page.mouse.click(400, 300);
await page.waitForTimeout(250);
const evalCopy = await page.evaluate(async () => {
  const c = window.__pbCanvas; const o = c.getObjects().find((x) => x.customType === 'rect' || x.customType === 'polygon');
  return !!o;
});
check('יש צורה להעתיק', evalCopy);
await page.evaluate(() => { const c = window.__pbCanvas; const o = c.getObjects().find((x) => !x.isEditHelper); c.setActiveObject(o); });
await page.keyboard.press('Control+c');
await page.waitForTimeout(150);
check('שבב ההדבקה מופיע אחרי העתקה', await page.locator('.board-chip', { hasText: 'הועתק' }).isVisible());
// לחיצה ארוכה על מקום ריק, כשיש משהו מועתק, פותחת תפריט עם הדבקה במקום הלחיצה
await page.keyboard.press('Escape');
await page.evaluate(() => window.__pbSetMode('draw'));
await page.waitForTimeout(100);
await page.mouse.move(900, 500);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(200);
check('לחיצה ארוכה לא פותחת גלגל', (await page.locator('.qw-center').count()) === 0);
check('לחיצה ארוכה פותחת תפריט הדבקה', await page.locator('.context-menu button', { hasText: 'הדבק כאן' }).isVisible());
await shot('05-paste-menu');
await page.locator('.context-menu button', { hasText: 'הדבק כאן' }).click();
await page.waitForTimeout(250);
objs = await objects();
const pasted = objs.filter((o) => o.customType === 'rect' || o.customType === 'polygon');
const near = pasted.some((o) => Math.abs(o.left + o.w / 2 - 900) < 30 && Math.abs(o.top + o.h / 2 - 500) < 30);
check('הדבקה נוחתת בדיוק במקום הלחיצה', pasted.length === 2 && near, JSON.stringify(pasted));
// Ctrl+V מדביק במקום הסמן
await page.mouse.move(700, 650);
await page.keyboard.press('Control+v');
await page.waitForTimeout(250);
objs = await objects();
check('Ctrl+V מדביק במקום הסמן', objs.filter((o) => o.customType === 'rect' || o.customType === 'polygon').some((o) => Math.abs(o.left + o.w / 2 - 700) < 30 && Math.abs(o.top + o.h / 2 - 650) < 30));
await page.keyboard.press('Escape');
await clearBoard();

/* ── 5. עט נוסף וצבע ── */
await page.evaluate(() => window.__pbSetMode?.('draw'));
await page.waitForTimeout(100);
await pens.nth(0).click();          // העט כבר פעיל — הקשה אחת פותחת את ההגדרות
await page.waitForTimeout(200);
check('הקשה שנייה על עט פעיל פותחת הגדרות', await page.locator('.pb-popover .pe').isVisible());
await shot('06-pen-options');
await page.keyboard.press('Escape');
await page.locator('.pb-add').click();
check('תפריט ההוספה מציע נוסחאות, חוט ומקווקו', (await page.locator('.pe-pick').count()) === 3);
await shot('06b-add-pen');
await page.locator('.pe-pick', { hasText: 'קו מקווקו' }).click();
check('עט מקווקו נוסף לסרגל', (await pens.count()) === 4);
// בחירת צבע בסרגל הצבעים
await page.locator('.pb-swatch[aria-label="צבע #f472b6"]').click();
await stroke(trace([{ x: 300, y: 500 }, { x: 700, y: 520 }, { x: 760, y: 640 }], false, 30, 1.5));
await page.waitForTimeout(200);
objs = await objects();
check('עט מקווקו מצייר קו מקווקו', objs.some((o) => o.dash === 'dashed'), JSON.stringify(objs));
const dashColor = await page.evaluate(() => { const o = window.__pbCanvas.getObjects().find((x) => x.dashStyle === 'dashed'); return o && o.stroke; });
check('  בצבע שנבחר בסרגל הצבעים', dashColor === '#f472b6', String(dashColor));
// צורה בצבע שנבחר
await page.evaluate(() => window.__pbBoard.addShape('circle'));
const shapeColor = await page.evaluate(() => { const c = window.__pbCanvas.getObjects().filter((x) => !x.isEditHelper); const o = c[c.length - 1]; return o.stroke; });
check('צורה נוצרת בצבע שנבחר', shapeColor === '#f472b6', String(shapeColor));
// במצב בחירה, שינוי צבע צובע את מה שמסומן
await page.locator('.pb-swatch[aria-label="צבע #4ade80"]').click();
await page.waitForTimeout(300);
const recolored = await page.evaluate(() => { const c = window.__pbCanvas.getObjects().filter((x) => !x.isEditHelper); const o = c[c.length - 1]; return o.stroke; });
check('בחירת צבע צובעת את הצורה המסומנת', recolored === '#4ade80', String(recolored));
// הסרת העט המקווקו
await page.evaluate(() => window.__pbSetMode?.('draw'));
await pens.nth(3).click();
await page.locator('.pb-popover .pe-footer .danger').click();
check('עט שנוסף אפשר להסיר', (await pens.count()) === 3);
await page.locator('.pb-swatch[aria-label="צבע #f5f5f5"]').click();
await clearBoard();

/* ── 6. הזזת הסרגל לשני הצדדים, בעכבר ובמגע ── */
const grip = page.locator('.pb-grip');
const dragGrip = async (x, y) => {
  const gb = await grip.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move((gb.x + x) / 2, (gb.y + y) / 2, { steps: 8 });
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};
await dragGrip(20, 420);
check('גרירה לקצה השמאלי מעגנת אותו אנכית', await page.locator('.pb-wrap.side-left.vertical').isVisible());
const lb = await page.locator('.pb-wrap').boundingBox();
check('  והסרגל נשאר בתוך המסך', lb.x >= 0 && lb.x + lb.width <= 1280 && lb.y >= 0 && lb.y + lb.height <= 800, JSON.stringify(lb));
await shot('07-dock-left');
await dragGrip(1262, 420);
check('גרירה לקצה הימני מעגנת אותו אנכית', await page.locator('.pb-wrap.side-right.vertical').isVisible());
await dragGrip(640, 786);
check('גרירה לתחתית מעגנת אותו למטה', await page.locator('.pb-wrap.side-bottom').isVisible());
await dragGrip(640, 30);
check('גרירה למעלה מחזירה אותו למעלה', await page.locator('.pb-wrap.side-top').isVisible());
// גרירה אופקית בגובה הסרגל עצמו, אל הצד השמאלי
await dragGrip(25, 40);
check('גרירה אופקית לקצה השמאלי עובדת גם מהסרגל העליון', await page.locator('.pb-wrap.side-left').isVisible());
// גרירה במגע אמיתי, דרך CDP
const cdp = await context.newCDPSession(page);
const touchDrag = async (x, y) => {
  const gb = await grip.boundingBox();
  const sx = gb.x + gb.width / 2, sy = gb.y + gb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 14; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + (x - sx) * i / 14, y: sy + (y - sy) * i / 14 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
};
await touchDrag(1262, 400);
check('גרירה במגע לצד ימין', await page.locator('.pb-wrap.side-right').isVisible());
await touchDrag(18, 400);
check('גרירה במגע לצד שמאל', await page.locator('.pb-wrap.side-left').isVisible());
// מיקום מתפריט עוד, לשמאליים וימניים
await page.locator('.pb-btn[aria-label^="עוד"]').click();
await page.locator('.pe-sides button[aria-label="סרגל ימין"]').click();
check('בחירת מיקום מהתפריט: ימין', await page.locator('.pb-wrap.side-right').isVisible());
await page.locator('.pb-btn[aria-label^="עוד"]').click();
await page.locator('.pe-sides button[aria-label="סרגל שמאל"]').click();
check('בחירת מיקום מהתפריט: שמאל', await page.locator('.pb-wrap.side-left').isVisible());
await grip.click();
await page.waitForTimeout(100);
check('הקשה על הידית מכווצת את הסרגל', await page.locator('.pb-wrap.collapsed').isVisible());
await grip.click();
await page.locator('.pb-btn[aria-label^="עוד"]').click();
await page.locator('.pe-sides button[aria-label="סרגל למעלה"]').click();
await page.waitForTimeout(100);

/* ── 7. מגירת ההנדסה ── */
await page.locator('.pb-btn.pb-stem').click();
check('מגירת ההנדסה נפתחת', await page.locator('.stem-panel').isVisible());
await shot('08-stem-stamps');
const dragTo = async (loc, x, y) => {
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 20, { steps: 3 });
  await page.mouse.move(x, y, { steps: 8 });
  const ghost = await page.locator('.stem-ghost').count();
  await page.mouse.up();
  await page.waitForTimeout(200);
  return ghost;
};
await page.locator('.stem-stamp', { hasText: 'נגד' }).first().click();
await page.waitForTimeout(150);
objs = await objects();
check('לחיצה על רכיב לא מוסיפה אותו, רק מסבירה שצריך לגרור', !objs.some((o) => o.stampId === 'resistor') && (await page.locator('.stem-drag-hint').count()) === 1);
const ghostSeen = await dragTo(page.locator('.stem-stamp', { hasText: 'נגד' }).first(), 640, 560);
objs = await objects();
const dropped = await page.evaluate(() => { const o = window.__pbCanvas.getObjects().find((x) => x.stampId === 'resistor'); if (!o) return null; const c = o.getCenterPoint(); const z = window.__pbCanvas.getZoom(); const v = window.__pbCanvas.viewportTransform; const r = document.getElementById('viewport').getBoundingClientRect(); return { x: c.x * z + v[4] + r.left, y: c.y * z + v[5] + r.top }; });
check('רכיב נגד נגרר ללוח', objs.some((o) => o.stampId === 'resistor') && ghostSeen === 1, JSON.stringify(objs));
check('הרכיב נחת במקום ההרפיה', dropped && Math.abs(dropped.x - 640) < 40 && Math.abs(dropped.y - 560) < 40, JSON.stringify(dropped));
await page.locator('.stem-tabs button', { hasText: 'נוסחאות' }).click();
await page.locator('.stem-search').fill('תהודה');
await shot('09-stem-formulas');
await dragTo(page.locator('.stem-formula').first(), 600, 600);
check('נוסחה מהדף נוספה כשדה עריכה', (await page.locator('#math-layer math-field').count()) === 1);
await page.locator('.stem-tabs button', { hasText: 'מחשבון' }).click();
await page.locator('.stem-chips button', { hasText: 'תהודה' }).click();
const resText = await page.locator('.calc-result').first().innerText();
check('מחשבון התהודה מחשב', /kHz|Hz/.test(resText), resText);
await shot('10-stem-calc');
await page.locator('.stem-tabs button', { hasText: 'גרף' }).click();
await shot('11-stem-plot');
await dragTo(page.locator('.stem-primary'), 700, 560);
objs = await objects();
check('גרף וקטורי נוסף ללוח', objs.some((o) => o.customType === 'plot'));
await page.locator('.stem-tabs button', { hasText: 'דף' }).click();
await page.locator('.paper-btn', { hasText: 'הנדסי' }).click();
await page.waitForTimeout(150);
const bg = await page.evaluate(() => document.querySelector('#board-container > div').style.backgroundImage);
check('רקע הנדסי עם ארבע שכבות קווים', (bg.match(/linear-gradient/g) || []).length === 4, bg.slice(0, 80));
await page.locator('.stem-close').click();
await shot('12-after-stem');

/* ── מסגרת עם ארבע פינות ── */
await clearBoard();
await page.evaluate(() => window.__pbBoard.insertStamp('resistor'));
await page.evaluate(() => window.__pbBoard.insertStamp('capacitor', { x: 760, y: 500 }));
await page.waitForTimeout(150);
const ctl = await page.evaluate(() => { const o = window.__pbCanvas.getActiveObject(); return Object.keys(o.controls).sort().join(','); });
check('למסגרת ארבע פינות וידית סיבוב, בלי ידיות אמצע', ctl === 'bl,br,mtr,tl,tr', ctl);
const cornerDrag = async (dx, dy, via) => {
  const info = await page.evaluate(() => {
    const c = window.__pbCanvas, o = c.getActiveObject(); o.setCoords();
    const p = o.oCoords.br; const r = c.upperCanvasEl.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, sx: o.scaleX, sy: o.scaleY };
  });
  await page.mouse.move(info.x, info.y);
  await page.mouse.down();
  const path = via ? [via, { x: dx, y: dy }] : [{ x: dx, y: dy }];
  let from = { x: 0, y: 0 };
  for (const to of path) { for (let i = 1; i <= 10; i++) await page.mouse.move(info.x + from.x + (to.x - from.x) * i / 10, info.y + from.y + (to.y - from.y) * i / 10); from = to; }
  await page.mouse.up();
  const after = await page.evaluate(() => { const o = window.__pbCanvas.getActiveObject(); return { sx: o.scaleX, sy: o.scaleY }; });
  return { before: { sx: info.sx, sy: info.sy }, after };
};
await page.evaluate(() => { const c = window.__pbCanvas; c.setActiveObject(c.getObjects().find((x) => x.stampId === 'resistor')); c.requestRenderAll(); });
const rx = await cornerDrag(60, 2);
check('גרירת פינה לרוחב מותחת רק לרוחב', rx.after.sx > rx.before.sx * 1.2 && Math.abs(rx.after.sy - rx.before.sy) < 0.001, JSON.stringify(rx));
const ry = await cornerDrag(2, 60);
check('גרירת פינה לאורך מותחת רק לאורך', ry.after.sy > ry.before.sy * 1.2 && Math.abs(ry.after.sx - ry.before.sx) < 0.001, JSON.stringify(ry));
const rd = await cornerDrag(50, 50);
check('גרירת פינה באלכסון מותחת את שני הצירים יחד', rd.after.sx > rd.before.sx * 1.05 && rd.after.sy > rd.before.sy * 1.05, JSON.stringify(rd));
const rv = await cornerDrag(3, 70, { x: 70, y: 3 });
check('הכיוון מתעדכן תוך כדי גרירה: הצידה ואז למטה מותח בסוף רק לאורך', Math.abs(rv.after.sx - rv.before.sx) < 0.001 && rv.after.sy > rv.before.sy * 1.2, JSON.stringify(rv));
const frames = await page.evaluate(() => {
  const c = window.__pbCanvas; const objs = c.getObjects().filter((x) => !x.isEditHelper);
  const sel = new (window.__pbFabric?.ActiveSelection || Object.getPrototypeOf(c.getActiveObject()).constructor)(objs, { canvas: c });
  let childCalls = 0; objs.forEach((o) => { const f = o._renderControls; o._renderControls = function (...a) { childCalls++; return f.apply(this, a); }; });
  c.setActiveObject(sel); c.renderAll();
  return { n: objs.length, childCalls };
});
check('בבחירה מרובה אין מסגרת נפרדת לכל אובייקט', frames.n >= 2 && frames.childCalls === 0, JSON.stringify(frames));
await clearBoard();
await clearBoard();

/* ── 8. סרגל חישוב על נוסחה ── */
await page.evaluate(() => window.__pbBoard?.insertMath('\\frac{3}{(s+2)^2+9}'));
await page.waitForTimeout(150);
await page.locator('#math-layer math-field').first().click();
await page.waitForTimeout(500);
check('סרגל החישוב מופיע מעל נוסחה פעילה', await page.locator('.cas-bar').isVisible());
await shot('13-cas-bar');
await page.locator('.cas-bar button', { hasText: 'ℒ⁻¹' }).click();
await page.waitForFunction(() => document.querySelectorAll('#math-layer math-field').length >= 2, null, { timeout: 8000 }).catch(() => {});
const latexes = await page.evaluate(() => Array.from(document.querySelectorAll('#math-layer math-field')).map((m) => m.getValue('latex')));
check('לפלס הפוך נכתב כשורה חדשה ונכון', latexes.some((l) => /e\^\{-2t\}/.test(l) && /sin/.test(l)), JSON.stringify(latexes));
await shot('14-cas-result');
await page.keyboard.press('Escape');
await clearBoard();

/* ── 9. חוט מעגל ── */
await page.evaluate(() => window.__pbSetMode?.('draw'));
await page.waitForTimeout(100);
await page.locator('.pb-add').click();
await page.locator('.pe-pick', { hasText: 'עט חוט' }).click();
await stroke(trace([{ x: 300, y: 300 }, { x: 520, y: 312 }, { x: 515, y: 520 }], false, 30, 3));
await page.waitForTimeout(200);
const wire = await page.evaluate(() => {
  const o = window.__pbCanvas.getObjects().find((x) => x.wire);
  return o ? o.points.map((q) => [q.x, q.y]) : null;
});
check('חוט מעגל מתיישר לקטעים ניצבים', !!wire && wire.length === 3 && wire[0][1] === wire[1][1] && wire[1][0] === wire[2][0], JSON.stringify(wire));
check('  והקודקודים נצמדים לחצי משבצת', !!wire && wire.every(([x, y]) => x % 20 === 0 && y % 20 === 0));
await pens.nth(3).click();
await page.locator('.pb-popover .pe-footer .danger').click();
await pens.nth(0).click();
await clearBoard();

/* ── 10. כפתורים מתחלפים ── */
await page.evaluate(() => window.__pbSetMode?.('draw'));
const btn = (name) => page.locator(`.pb-btn[aria-label^="${name}"]`);
await btn('מחק').click();
check('מחק חלקי נבחר ראשון', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'מחק');
await btn('מחק').click();
check('הקשה נוספת מחליפה למחיקת קו', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'קו שלם' && (await page.locator('.pb-popover').count()) === 0);
await btn('מחק').click();
check('  וחוזר חלילה', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'מחק');
await btn('בחירה').click();
await btn('בחירה').click();
check('בחירה מתחלפת בין לאסו למלבן', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'מלבן');
await btn('טקסט').click();
check('כפתור אחד לטקסט ולנוסחה: ראשית טקסט', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'טקסט');
await btn('טקסט').click();
check('  והקשה נוספת הופכת לנוסחה', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'נוסחה' && (await page.evaluate(() => document.querySelectorAll('.pb-btn').length)) > 0);
await btn('נוסחה').click();
check('  וחוזר לטקסט', (await page.locator('.pb-btn.active .pb-btn-label').innerText()) === 'טקסט');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__pbSetMode?.('draw'));
await clearBoard();

/* ── 11. מדגיש עבה כברירת מחדל ── */
await pens.nth(2).click();
await page.waitForTimeout(100);
await stroke(trace([{ x: 300, y: 400 }, { x: 700, y: 404 }], false, 40, 1), { hold: 600 });
await page.waitForTimeout(250);
const hlw = await page.evaluate(() => { const o = window.__pbCanvas.getObjects().find((x) => x.penKind === 'highlighter'); return o ? (o.strokeWidth || o.height) * (o.scaleY || 1) : 0; });
check('המדגיש עבה כברירת מחדל', hlw >= 36, String(hlw));
await pens.nth(2).click();
await page.waitForTimeout(150);
const sliderMax = await page.locator('.pb-popover .pe-range').first().getAttribute('max');
check('  ואפשר להגדיל אותו עד 140', sliderMax === '140', sliderMax);
await page.keyboard.press('Escape');
await pens.nth(0).click();
await clearBoard();

/* ── 12. הקשה בשתי אצבעות מבטלת, בשלוש מבצעת שוב ── */
const tt = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const touchSquiggle = async () => {
  await tt('touchStart', [{ x: 300, y: 300 }]);
  for (let i = 1; i <= 20; i++) await tt('touchMove', [{ x: 300 + i * 10, y: 300 + Math.sin(i / 2) * 30 }]);
  await tt('touchEnd', []);
  await page.waitForTimeout(400);
};
const fingers = async (n, gap, hold) => {
  const base = [{ x: 600, y: 520, id: 1 }, { x: 690, y: 520, id: 2 }, { x: 780, y: 520, id: 3 }];
  for (let k = 1; k <= n; k++) { await tt('touchStart', base.slice(0, k)); await page.waitForTimeout(gap); }
  await page.waitForTimeout(hold);
  for (let k = n - 1; k >= 1; k--) { await tt('touchEnd', base.slice(0, k)); await page.waitForTimeout(20); }
  await tt('touchEnd', []);
  await page.waitForTimeout(700);
};
const settingsOpen = async () => (await page.locator('text=צבע לוח').count()) > 0;
await touchSquiggle();
let n0 = (await objects()).length;
await fingers(2, 30, 120);
check('הקשה בשתי אצבעות מבטלת', (await objects()).length === n0 - 1 && !(await settingsOpen()), `${n0} -> ${(await objects()).length}`);
await fingers(3, 30, 100);
check('הקשה בשלוש אצבעות מבצעת שוב', (await objects()).length === n0 && !(await settingsOpen()));
await fingers(2, 30, 120);
await touchSquiggle();
n0 = (await objects()).length;
await fingers(2, 100, 120);       // הקשה איטית יותר, עם הנחה לא סימולטנית
check('  גם הקשה איטית ולא סימולטנית מבטלת', (await objects()).length === n0 - 1 && !(await settingsOpen()), `${n0} -> ${(await objects()).length}`);
await clearBoard();

/* ── 13. זיהוי כתב יד מתמטי, כשהמודל זמין מקומית ── */
if (TEXO) {
  await page.locator('.pb-add').click();
  await page.locator('.pe-pick', { hasText: 'עט נוסחאות' }).click();
  await page.waitForSelector('.mi-card', { timeout: 4000 }).catch(() => {});
  check('בחירה ראשונה בעט הנוסחאות מציעה הורדה', await page.locator('.mi-card').isVisible());
  await page.locator('.mi-card button', { hasText: 'הורד עכשיו' }).click();
  await page.waitForSelector('.mi-ok', { timeout: 90000 }).catch(() => {});
  check('  ומראה התקדמות עד שהמודל מוכן', await page.locator('.mi-ok').count() > 0 || await page.locator('.mi-card').count() === 0);
  await page.waitForTimeout(1600);
  check('  והקבצים הגדולים ירדו פעם אחת בלבד', onnxRequests === 2, String(onnxRequests));
  // x בשתי משיכות, ואחריו 2 קטן כמעריך
  await stroke([{ x: 400, y: 380 }, { x: 470, y: 470 }], { steps: 12 });
  await stroke([{ x: 470, y: 380 }, { x: 400, y: 470 }], { steps: 12 });
  const two = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    if (t < 0.6) { const a = Math.PI * (1.1 - 1.3 * t / 0.6); two.push({ x: 482 + 16 + 16 * Math.cos(a), y: 350 + 12 - 12 * Math.sin(a) }); }
    else two.push({ x: 482 + (t - 0.6) / 0.4 * 32, y: 382 });
  }
  await stroke(two, { steps: 2 });
  await page.waitForSelector('.board-chip .chip-tex', { timeout: 60000 }).catch(() => {});
  const tex = await page.locator('.board-chip .chip-tex').innerText().catch(() => '');
  check('כתב יד מתמטי זוהה', tex.length > 0, tex);
  await shot('15-mathink');
  await page.locator('.board-chip button.primary').click().catch(() => {});
  await page.waitForTimeout(250);
  const conv = await page.evaluate(() => Array.from(document.querySelectorAll('#math-layer math-field')).map((m) => m.getValue('latex')));
  check('  והומר לשדה נוסחה', conv.length === 1 && /2/.test(conv[0]), JSON.stringify(conv));
}

check('אין שגיאות ריצה', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} עברו, ${fail} נכשלו`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
