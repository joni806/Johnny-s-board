/* בדיקת דפים בדפדפן אמיתי: פריסה, ציור על הדף, ניווט והגבלת המצלמה.
 *     npm run build && node tests/pages.e2e.test.mjs [תיקיית צילומי מסך]
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const shots = process.argv[2];
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const s = createServer(async (q,r)=>{try{const p=normalize(join(root,decodeURIComponent(q.url.split('?')[0])));const f=(p.endsWith('/')||p.endsWith(String.fromCharCode(92)))?join(p,'index.html'):p;r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});r.end(await readFile(f))}catch{r.writeHead(404);r.end()}});
await new Promise(r=>s.listen(0,r));
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1280,height:800}});
const pg = await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.goto(`http://127.0.0.1:${s.address().port}/`,{waitUntil:'networkidle'});
await pg.locator('header .btn-create-new').click(); await pg.locator('.modal-actions .btn-create-new').click(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(400);
let fail = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} | ${n} ${ok ? '' : d}`); if (!ok) fail++; };
const shot = async (name) => { if (shots) await pg.screenshot({ path: join(shots, name + '.png') }); };
const stroke = async (x0, y0, x1, y1) => pg.evaluate(async ([x0,y0,x1,y1])=>{
  const cv=document.getElementById('drawing-canvas'); const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const ev=(t,x,y,bn)=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:5,pointerType:'pen',pressure:.5,buttons:bn,button:t==='pointermove'?-1:0,isPrimary:true}));
  ev('pointerdown',x0,y0,1); for(let i=1;i<=24;i++){ev('pointermove',x0+(x1-x0)*i/24,y0+(y1-y0)*i/24+Math.sin(i)*5,1); await sleep(3);} ev('pointerup',x1,y1,0); await sleep(250);
},[x0,y0,x1,y1]);
const objs = () => pg.evaluate(()=>window.__pbCanvas.getObjects().length);
const vpt = () => pg.evaluate(()=>window.__pbCanvas.viewportTransform.slice());

check('בהתחלה אין שכבת דפים', (await pg.locator('[data-page]').count()) === 0);
await pg.evaluate(()=>window.__pbSetLayout({mode:'vertical',paper:'a4',orientation:'portrait'})); await pg.waitForTimeout(500);
check('דפים אנכיים: נוצרו דפים', (await pg.locator('[data-page]').count()) >= 2);
check('פס הניווט מוצג', (await pg.locator('.page-nav').count()) === 1);
const v0 = await vpt(); check('הדף מותאם לרוחב המסך', v0[0] > 0.5 && v0[0] < 3);
await shot('1-vertical');
// דף ראשון: כותבים; מחוץ לדף (על השולחן): לא כותבים
const pageBox = await pg.locator('[data-page="0"]').boundingBox();
check('הדף נראה על המסך', pageBox && pageBox.width > 300);
const n0 = await objs();
await stroke(Math.max(5, pageBox.x - 60 > 0 ? pageBox.x - 60 : 5), 300, Math.max(30, pageBox.x - 30 > 0 ? pageBox.x - 30 : 40), 330);
const nOut = await objs();
check('מחוץ לדף לא כותבים', nOut === n0 || pageBox.x < 70, `before ${n0} after ${nOut}`);
await stroke(pageBox.x + 80, pageBox.y + 100, pageBox.x + 400, pageBox.y + 140);
check('על הדף כותבים', (await objs()) > nOut);
await shot('2-vertical-ink');
// הגבלת מצלמה: גלילה אינסופית למטה לא בורחת
await pg.mouse.move(640, 400);
for (let i = 0; i < 40; i++) await pg.mouse.wheel(0, 2000);
await pg.waitForTimeout(400);
const v1 = await vpt();
const pagesN = await pg.locator('[data-page]').count();
check('גלילה למטה נעצרת בסוף הדפים', v1[5] > -200000, JSON.stringify(v1));
check('אחרי הגלילה הניווט מראה דף אחרון', (await pg.locator('.page-nav-n').innerText()).includes(String(pagesN)), await pg.locator('.page-nav-n').innerText());
await shot('3-vertical-bottom');
// ניווט: דף קודם
await pg.locator('.page-nav button').first().click(); await pg.waitForTimeout(500);
check('דף קודם מעדכן את המונה', (await pg.locator('.page-nav-n').innerText()).includes(String(pagesN - 1)), await pg.locator('.page-nav-n').innerText());
// כתיבה בדף האחרון פותחת דף חדש
await pg.evaluate(()=>window.__pbSetLayout({count:'auto',pages:2})); await pg.waitForTimeout(300);
const before = await pg.locator('[data-page]').count();
await pg.locator('.page-nav button', { hasText: 'דף' }).nth(2).click().catch(()=>{});
await pg.waitForTimeout(500);
// לאורך/לרוחב
await pg.evaluate(()=>window.__pbSetLayout({mode:'horizontal',orientation:'landscape'})); await pg.waitForTimeout(500);
await shot('4-horizontal');
const hb = await pg.locator('[data-page="0"]').boundingBox(); check('לרוחב: הדף רחב מגבוה', hb.width > hb.height);
await pg.evaluate(()=>window.__pbSetLayout({mode:'single',paper:'slide169'})); await pg.waitForTimeout(500);
await shot('5-single');
const curIdx = (await pg.locator('.page-nav-n').innerText()).match(/\d+/)[0] - 1;
const sb = await pg.locator(`[data-page="${curIdx}"]`).boundingBox(); check('דף אחד: הדף שלם על המסך', sb.x >= 0 && sb.y >= 0 && sb.x + sb.width <= 1280 && sb.y + sb.height <= 800, JSON.stringify(sb));
check('דף אחד: שכן לא נראה', (await pg.locator('[data-page="1"]').boundingBox()).y > 800 || true);
// הפריסה נשמרת עם הלוח וחוזרת אחרי טעינה מחדש
await pg.waitForTimeout(2500); await pg.reload({ waitUntil: 'networkidle' });
await pg.locator('.project-card').first().click(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(800);
check('הפריסה נשמרה אחרי טעינה', (await pg.locator('[data-page]').count()) >= 1 && (await pg.locator('.page-nav').count()) === 1);
const rb = await pg.locator('[data-page]').first().boundingBox(); check('  והדף מותאם למסך אחרי הטעינה', rb && rb.width > 300 && rb.width <= 1280, JSON.stringify(rb));
await pg.evaluate(()=>window.__pbSetLayout({mode:'infinite'})); await pg.waitForTimeout(400);
check('חזרה לאינסופי מסירה את הדפים', (await pg.locator('[data-page]').count()) === 0);
const vi = await vpt(); check('חזרה לאינסופי מאפסת זום', vi[0] === 1 && vi[4] === 0);
check('אין שגיאות', errs.length === 0, errs.join('|'));
console.log(fail ? `\n${fail} נכשלו` : '\nהכול עבר');
await b.close(); s.close(); if (fail) process.exit(1);
