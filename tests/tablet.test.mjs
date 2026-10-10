/* בדיקת טאבלט: אירועי מגע אמיתיים דרך Chrome DevTools, כמו באנדרואיד, ואירועי
 * העט כפי ש־Chrome באנדרואיד שולח אותם — כולל contextmenu מוקדם כשכפתור הצד לחוץ.
 *     npm run build && node tests/tablet.test.mjs
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
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1280,height:800}, hasTouch:true, isMobile:true});
const pg = await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.goto(`http://127.0.0.1:${s.address().port}/`,{waitUntil:'networkidle'});
await pg.locator('header .btn-create-new').tap(); await pg.locator('.modal-actions .btn-create-new').tap(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(400);
const cdp = await ctx.newCDPSession(pg);
const touch = async (pts) => {
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pts[0][0],y:pts[0][1]}]});
  for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p[0],y:p[1]}]}); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await pg.waitForTimeout(200);
};
const line=(x0,y0,x1,y1,n=20)=>Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,y0+(y1-y0)*i/n+6*Math.sin(i)]);
await touch(line(300,300,520,300)); await touch(line(300,500,520,500));
let fail = 0; const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} | ${n} ${ok ? '' : d}`); if (!ok) fail++; };
check('שני קווים במגע', (await pg.evaluate(()=>window.__pbCanvas.getObjects().length)) === 2);
await pg.evaluate(()=>window.__pbSetMode('select')); await pg.waitForTimeout(200);
const poly=[[260,260],[600,260],[600,350],[260,350],[260,262]]; const path=[];
for(let i=1;i<poly.length;i++)for(let k=0;k<10;k++)path.push([poly[i-1][0]+(poly[i][0]-poly[i-1][0])*k/10,poly[i-1][1]+(poly[i][1]-poly[i-1][1])*k/10]);
await touch(path);
check('לאסו במגע בוחר רק את מה שבפנים', (await pg.evaluate(()=>{const a=window.__pbCanvas.getActiveObject();return a?(a.getObjects?a.getObjects().length:1):0})) === 1);
check('  והתפריט נפתח מעצמו', (await pg.locator('.context-menu').count()) === 1);

await pg.evaluate(()=>{window.__pbCanvas.discardActiveObject(); window.__pbSetMode('draw');}); await pg.waitForTimeout(200);
const r = await pg.evaluate(async()=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const cv=document.getElementById('drawing-canvas');
  const ev=(t,x,y,b,p)=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:9,pointerType:'pen',pressure:p,buttons:b,button:t==='pointermove'?-1:0,isPrimary:true}));
  const cm=(x,y)=>cv.dispatchEvent(new PointerEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:'pen',button:-1}));
  const n=()=>window.__pbCanvas.getObjects().length;
  const out={start:n()};
  // button held: contextmenu right after the first move, then the stroke crosses the second line
  ev('pointerdown',420,450,1,.4); ev('pointermove',420,455,1,.4); cm(420,450);
  for(let y=460;y<560;y+=5){ev('pointermove',420,y,1,.4);await sleep(4)} ev('pointerup',420,560,0,0); await sleep(200);
  out.afterButton=n(); out.mode=document.querySelector('.pb-btn.active .pb-btn-label')?.innerText;
  // normal long press (late contextmenu) must not erase
  ev('pointerdown',700,200,1,.4); await sleep(600); cm(700,200);
  for(let x=700;x<800;x+=5){ev('pointermove',x,200,1,.4);await sleep(4)} ev('pointerup',800,200,0,0); await sleep(200);
  out.afterLateLongPress=n();
  return out;
});
check('כפתור העט (contextmenu מוקדם) מוחק ולא מצייר', r.afterButton === 3, JSON.stringify(r));
check('  ואחרי ההרמה העט חוזר לכתוב', r.mode === 'עט');
check('לחיצה ארוכה רגילה לא נחשבת לכפתור', r.afterLateLongPress === 4, JSON.stringify(r));
check('אין שגיאות ריצה', errs.length === 0, errs.join(' | '));
await b.close(); s.close();
process.exit(fail ? 1 : 0);
