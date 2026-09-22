/* בדיקת קצה־לקצה בדפדפן אמיתי.
 *
 * דורשת בנייה ואת playwright:
 *     npm run build
 *     npm i -D playwright
 *     npx playwright install chromium
 *     node tests/smoke.test.mjs
 *
 * הבדיקה מציירת ריבוע ביד חופשית באמצעות אירועי מצביע אמיתיים, ואז קוראת
 * את מה שנשמר בפועל ב-IndexedDB. כך נבדקת כל השרשרת: קלט → זיהוי → אובייקט
 * Fabric → סריאליזציה → אחסון.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
                '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
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
await new Promise(r => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
// טעינת פונטים חיצוניים חסומה בארגז החול הזה — לא שגיאה של האפליקציה
page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL_CONNECTION_FAILED|fonts\.googleapis|fonts\.gstatic/.test(m.text())) errors.push('console: ' + m.text()); });

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log('PASS | ' + n); } else { fail++; console.log('FAIL | ' + n + ' ' + x); } };

await page.goto(url, { waitUntil: 'networkidle' });
check('הדף נטען והדשבורד מוצג', await page.locator('.dashboard-title').isVisible());

// יצירת לוח חדש
await page.locator('header .btn-create-new').click();
await page.waitForSelector('.modal-content');
check('חלון לוח חדש נפתח', await page.locator('.modal-title').isVisible());
await page.locator('.modal-actions .btn-create-new').click();
await page.waitForSelector('#drawing-canvas', { timeout: 5000 });
check('הלוח נפתח', await page.locator('#drawing-canvas').isVisible());

// ציור ריבוע ביד חופשית, עם רעש קל, דרך אירועי מצביע אמיתיים
async function stroke(points) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
  await page.mouse.up();
}
const square = [];
const c = [[400,250],[700,250],[700,550],[400,550],[400,250]];
for (let i = 1; i < c.length; i++) {
  for (let t = 0; t <= 1; t += 0.04) {
    square.push({ x: c[i-1][0] + (c[i][0]-c[i-1][0])*t + (Math.random()-0.5)*3,
                  y: c[i-1][1] + (c[i][1]-c[i-1][1])*t + (Math.random()-0.5)*3 });
  }
}
await stroke(square);
await page.waitForTimeout(2600);   // ממתין לשמירה האוטומטית המושהית

// קריאת מה שבאמת נשמר ב-IndexedDB — הבדיקה החזקה ביותר של כל השרשרת
const readProject = () => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return new Promise((res, rej) => {
    const rq = db.transaction('keyval', 'readonly').objectStore('keyval').openCursor();
    let found = null;
    rq.onsuccess = () => {
      const cur = rq.result;
      if (!cur) return res(found);
      // מאז טבעת הגרסאות יש במסד גם מפתחות jb_rev_, ואסור להחזיר אותם
      if (typeof cur.key === 'string' && cur.key.startsWith('jb_project_')) found = cur.value;
      cur.continue();
    };
    rq.onerror = () => rej(rq.error);
  });
});
const saved = await readProject();

check('הפרויקט נשמר ל-IndexedDB', !!saved && !!saved.fabric);
const objs = saved?.fabric?.objects || [];
console.log('       אובייקטים שנשמרו: ' + JSON.stringify(objs.map(o => o.type + '/' + (o.customType || '-'))));
check('המשיכה הומרה למלבן', objs.some(o => o.customType === 'rect' || o.type === 'Rect' || o.type === 'rect'), JSON.stringify(objs.map(o=>o.type)));
check('עיגולי העריכה לא נשמרו לקובץ', !objs.some(o => (o.fill === '#3b82f6')),
      'נמצאו ' + objs.filter(o => o.fill === '#3b82f6').length + ' עיגולים');
const rect = objs.find(o => (o.customType === 'rect'));
check('הצורה נשמרה אטומה ולא חצי שקופה', !rect || rect.opacity === 1, 'opacity=' + rect?.opacity);
check('הצורה נשמרה ניתנת לבחירה', !rect || rect.selectable !== false);
if (rect) console.log(`       מלבן שנשמר: ${Math.round(rect.width)}x${Math.round(rect.height)} zoom-space`);

// אחרי זיהוי האפליקציה עוברת למצב בחירה, ולכן חוזרים לכלי הציור
await page.locator('button[title="צייר"]').click();
check('חזרה לכלי הציור', await page.locator('button[title="צייר"]').evaluate(el => el.classList.contains('active')));

// קשקוש חופשי חייב להישאר דיו ולא להפוך לצורה
const scribble = [];
// תחום חסום, כדי שהקשקוש לא ישוטט אל אזור הבדיקות הבאות
let sx = 300, sy = 650;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
for (let i = 0; i < 60; i++) {
  sx = clamp(sx + (Math.random()-0.5)*26, 180, 460);
  sy = clamp(sy + (Math.random()-0.5)*26, 580, 740);
  scribble.push({ x: sx, y: sy });
}
await stroke(scribble);
await page.waitForTimeout(2400);
const saved2 = await readProject();
const objs2 = saved2?.fabric?.objects || [];
console.log('       אחרי קשקוש: ' + JSON.stringify(objs2.map(o => o.type + '/' + (o.customType || '-'))));
check('קשקוש נשמר כדיו חופשי ולא כצורה', objs2.some(o => o.customType === 'ink'), JSON.stringify(objs2.map(o=>o.customType)));

// ── מתג ההמרה האוטומטית ──
// לחיצה ארוכה על אזור ריק פותחת את הגדרות הלוח
await page.locator('button[title="צייר"]').click();
await page.mouse.move(1050, 680);
await page.mouse.down();
await page.waitForTimeout(750);
await page.mouse.up();
const toggle = page.locator('button', { hasText: 'המרה אוטומטית בהרמת העט' });
check('הגדרות הלוח נפתחות בלחיצה ארוכה', await toggle.isVisible());
if (await toggle.isVisible()) {
  // נבדק במפורש שהמתג אינו מוסתר על ידי שכבת סגירת התפריט שמאחוריו
  const hitOk = await toggle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === top || el.contains(top);
  });
  check('  המתג אינו חסום על ידי שכבה אחרת', hitOk);
  await toggle.evaluate((el) => el.click());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('button[title="צייר"]').click();
  // אותו ריבוע בדיוק, הפעם עם המתג כבוי — חייב להישאר דיו
  const sq2 = [];
  const k = [[820,180],[1060,180],[1060,420],[820,420],[820,180]];
  for (let i = 1; i < k.length; i++)
    for (let t = 0; t <= 1; t += 0.05)
      sq2.push({ x: k[i-1][0] + (k[i][0]-k[i-1][0])*t, y: k[i-1][1] + (k[i][1]-k[i-1][1])*t });
  await stroke(sq2);
  await page.waitForTimeout(2400);
  const saved3 = await readProject();
  const o3 = saved3?.fabric?.objects || [];
  console.log('       עם מתג כבוי: ' + JSON.stringify(o3.map(o => o.type + '/' + (o.customType || '-'))));
  check('מתג כבוי — ריבוע נשאר כתב יד', o3.filter(o => o.customType === 'rect').length === 1,
        JSON.stringify(o3.map(o=>o.customType)));
  check('ההעדפה נשמרה לפרויקט', saved3?.autoSnap === false, 'autoSnap=' + saved3?.autoSnap);
}

// ── דיו רגיש ללחץ ──
// הדיו נבנה כמתאר ממולא, כי stroke ב-Fabric הוא תמיד ברוחב אחיד
const inkObj = (saved2?.fabric?.objects || []).find(o => o.customType === 'ink');
check('דיו נשמר כמתאר ממולא ולא כקו ברוחב אחיד', !!inkObj && inkObj.inkFilled === true,
      'inkFilled=' + inkObj?.inkFilled);
check('לדיו יש צבע מילוי ולא צבע קו', !!inkObj && !!inkObj.fill && inkObj.fill !== 'transparent',
      'fill=' + inkObj?.fill);
check('נתיב הדיו סגור, כמו שמתאר צריך להיות',
      !!inkObj && Array.isArray(inkObj.path) && inkObj.path.some(seg => seg[0] === 'z' || seg[0] === 'Z'));

// ── טקסט עברי RTL ──
await page.locator('button[title="טקסט עברי"]').click();
await page.mouse.click(760, 640);
await page.waitForTimeout(250);
const ta = page.locator('textarea.hebrew-box');
check('שדה טקסט עברי נוצר', await ta.count() === 1, 'נמצאו ' + await ta.count());
if (await ta.count() === 1) {
  check('הכתיבה בשדה מימין לשמאל', await ta.evaluate(el => el.dir === 'rtl' || getComputedStyle(el).direction === 'rtl'));
  await ta.fill('שטף חשמלי דרך משטח סגור, לפי גאוס.');
  await page.locator('button[title="צייר"]').click();
  await page.waitForTimeout(3400);   // המתנה של 1000 מ"ש עד saveState ועוד 1500 עד הכתיבה
  const saved4 = await readProject();
  const textBox = (saved4?.math || []).find(m => m.kind === 'text');
  check('הטקסט העברי נשמר לפרויקט', !!textBox && textBox.value.includes('גאוס'),
        JSON.stringify((saved4?.math || []).map(m => m.kind)));
}

// ── מצב הצגה וסמן לייזר ──
const objsBeforeLaser = ((await readProject())?.fabric?.objects || []).length;
await page.locator('button[title="מצב הצגה"]').click();
await page.waitForTimeout(400);
check('סרגל ההצגה מוצג', await page.locator('button[title="לייזר"]').isVisible());
check('סרגל הכלים המלא מוסתר', await page.locator('button[title="מצב הצגה"]').count() === 0);
await stroke([{x:500,y:300},{x:560,y:330},{x:620,y:300},{x:680,y:340}]);
await page.waitForTimeout(1600);
const objsAfterLaser = ((await readProject())?.fabric?.objects || []).length;
check('הלייזר לא יוצר אובייקטים ולא נשמר', objsAfterLaser === objsBeforeLaser,
      `${objsBeforeLaser} → ${objsAfterLaser}`);
await page.locator('button[title="צא ממצב הצגה"]').click();
await page.waitForTimeout(400);
check('יציאה ממצב הצגה מחזירה את סרגל הכלים', await page.locator('button[title="מצב הצגה"]').isVisible());

// ── הקלטה חסומה עד חיבור לדרייב ──
await page.locator('button[title="הקלטה מסונכרנת"]').click();
await page.waitForTimeout(300);
check('סרגל ההקלטה נפתח', await page.locator('text=הקלטה מסונכרנת').first().isVisible());
check('בלי דרייב מוצגת בקשת חיבור ולא כפתור הקלטה',
      await page.locator('button', { hasText: 'חבר את גוגל דרייב' }).isVisible()
      && await page.locator('button', { hasText: 'התחל הקלטה' }).count() === 0);
await page.locator('button', { hasText: 'חבר את גוגל דרייב' }).click();
await page.waitForTimeout(400);
check('כפתור החיבור פותח את חלונית הדרייב', await page.locator('text=Client ID').first().isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape סוגר את חלונית הדרייב', await page.locator('input[placeholder*="apps.googleusercontent"]').count() === 0);
// סרגל ההקלטה נשאר פתוח מאחורי החלונית, וצריך לסגור גם אותו
await page.locator('button', { hasText: 'סגור' }).first().click().catch(() => {});
await page.waitForTimeout(300);

// ── גרסאות קודמות ──
await page.locator('button[title="צייר"]').click();
await page.mouse.move(1150, 720);
await page.mouse.down();
await page.waitForTimeout(750);
await page.mouse.up();
const revBtn = page.locator('button', { hasText: 'הצג גרסאות שמורות' });
check('כפתור הגרסאות קיים בהגדרות הלוח', await revBtn.isVisible());
if (await revBtn.isVisible()) {
  await revBtn.evaluate(el => el.click());
  await page.waitForTimeout(500);
  const hasList = await page.locator('button', { hasText: 'פריטים' }).count() > 0;
  const hasEmptyNote = await page.locator('text=עוד לא נשמרו גרסאות').count() > 0;
  check('רשימת הגרסאות נטענת', hasList || hasEmptyNote);
  await page.keyboard.press('Escape');
}

check('אין שגיאות ריצה בדפדפן', errors.length === 0, errors.slice(0,4).join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} עברו, ${fail} נכשלו`);
process.exit(fail ? 1 : 0);
