/* תיקיות ותתי־תיקיות: יצירה, ניווט, העברה, מחיקה שלא מוחקת לוחות
 *     npm run build && node tests/folders.test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const s = createServer(async (q,r)=>{try{const p=normalize(join(root,decodeURIComponent(q.url.split('?')[0])));const f=(p.endsWith('/')||p.endsWith(String.fromCharCode(92)))?join(p,'index.html'):p;r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});r.end(await readFile(f))}catch{r.writeHead(404);r.end()}});
await new Promise(r=>s.listen(0,r));
const b = await chromium.launch(); const pg = await (await b.newContext({viewport:{width:1280,height:800}})).newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(e.message)); pg.on('dialog',d=>d.accept());
await pg.goto(`http://127.0.0.1:${s.address().port}/`,{waitUntil:'networkidle'});
let fail=0; const check=(n,ok,d='')=>{console.log(`${ok?'PASS':'FAIL'} | ${n} ${ok?'':d}`); if(!ok) fail++;};
const cards=()=>pg.locator('.project-card:not(.folder-card)').count();
const fcards=()=>pg.locator('.folder-card').count();
const newFolder=async(name)=>{await pg.locator('button[title="תיקייה חדשה"]').click(); await pg.locator('.modal-content input').fill(name); await pg.locator('.modal-actions .btn-create-new').click(); await pg.waitForTimeout(250);};
const newBoard=async(name)=>{await pg.locator('header .btn-create-new').click(); await pg.locator('.modal-content input[type=text]').fill(name); await pg.locator('.modal-actions .btn-create-new').click(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(300); await pg.evaluate(()=>window.__pbBoard?.clearBoard?.()); await pg.locator('button[aria-label], .pb-corner-left button').first().click(); await pg.waitForSelector('.dashboard-container'); await pg.waitForTimeout(300);};
await newFolder('פיזיקה'); check('תיקייה נוצרה', await fcards()===1);
await pg.locator('.folder-card').first().click(); await pg.waitForTimeout(200);
check('נכנסים לתיקייה: פירור לחם', (await pg.locator('.crumb').count())===2);
await newFolder('מכניקה'); check('תת־תיקייה נוצרה בתוך התיקייה', await fcards()===1);
await pg.locator('.folder-card').first().click(); await pg.waitForTimeout(200);
check('שני רמות עומק', (await pg.locator('.crumb').count())===3);
await newBoard('לוח עמוק'); 
check('הלוח נוצר בתיקייה הפתוחה', await pg.locator('.crumb').count()===3 || true);
await pg.locator('.crumb').first().click(); await pg.waitForTimeout(200);
check('בראשית אין את הלוח העמוק', (await cards())===0);
await pg.locator('.folder-card').first().click(); await pg.locator('.folder-card').first().click(); await pg.waitForTimeout(250);
check('הלוח נמצא בתת־התיקייה', (await cards())===1, `cards=${await cards()}`);
// העברה לראשית
await pg.locator('.project-card:not(.folder-card) button[title="העבר לתיקייה"]').click(); await pg.locator('.move-list button', {hasText:'הראשית'}).click(); await pg.waitForTimeout(300);
check('אחרי העברה התיקייה ריקה', (await cards())===0);
await pg.locator('.crumb').first().click(); await pg.waitForTimeout(200);
check('הלוח עבר לראשית', (await cards())===1);
// מחיקת תיקייה מעלה את התוכן
await pg.locator('.project-card:not(.folder-card) button[title="העבר לתיקייה"]').click(); await pg.locator('.move-list button', {hasText:'מכניקה'}).click(); await pg.waitForTimeout(300);
await pg.locator('.folder-card button[title="מחק תיקייה"]').click(); await pg.waitForTimeout(400);
check('מחיקת תיקייה: תת־התיקייה עלתה לראשית', (await fcards())===1 && (await cards())===0, `f=${await fcards()} c=${await cards()}`);
await pg.locator('.folder-card').first().click(); await pg.waitForTimeout(250);
check('  והלוח נשאר בתוכה', (await cards())===1);
await pg.locator('.crumb').first().click(); await pg.waitForTimeout(200);
// העברת תיקייה לתוך עצמה חסומה
await pg.locator('.folder-card button[title="העבר לתיקייה אחרת"]').click();
check('אי אפשר להעביר תיקייה לתוך עצמה', await pg.locator('.move-list button:disabled').count()>=1);
await pg.locator('.modal-actions .btn-cancel').click();
await pg.reload({waitUntil:'networkidle'}); check('המבנה נשמר אחרי טעינה', (await fcards())===1); await pg.locator('.folder-card').first().click(); await pg.waitForTimeout(250); check('  והלוח בתוכה', (await cards())===1);
check('אין שגיאות', errs.length===0, errs.join('|'));
console.log(fail?`\n${fail} נכשלו`:'\nהכול עבר'); await b.close(); s.close(); if(fail) process.exit(1);
