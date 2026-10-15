/* מודד עצירות של החוט הראשי בין משיכות (שמירה, היסטוריה) בלוח שהולך וגדל.
 *     npm run build && node tests/stall.mjs [strokes] [movesPerStroke] [slowdown]
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
const N=+(process.argv[2]||500), M=+(process.argv[3]||200), SLOW=+(process.argv[4]||4);
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1280,height:800}}); const pg=await ctx.newPage();
await pg.goto(`http://127.0.0.1:${s.address().port}/`,{waitUntil:'networkidle'});
await pg.locator('header .btn-create-new').click(); await pg.locator('.modal-actions .btn-create-new').click(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(500);
await (await ctx.newCDPSession(pg)).send('Emulation.setCPUThrottlingRate',{rate:SLOW});
const res=await pg.evaluate(async([N,M])=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const cv=document.getElementById('drawing-canvas');
  const ev=(t,x,y,b,p)=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:9,pointerType:'pen',pressure:p,buttons:b,button:t==='pointermove'?-1:0,isPrimary:true}));
  const tasks=[]; new PerformanceObserver(l=>{for(const e of l.getEntries())tasks.push([e.startTime,e.duration])}).observe({entryTypes:['longtask']});
  const win=[]; let s=1; const rnd=()=>{s=(s*16807)%2147483647; return s/2147483647;};
  for(let i=0;i<N;i++){ const ox=40+rnd()*1100, oy=80+rnd()*620, a=rnd()*6.28, L=40+rnd()*80;
    const t0=performance.now();
    ev('pointerdown',ox,oy,1,.5); for(let k=1;k<=M;k++){const t=k/M; ev('pointermove',ox+Math.cos(a)*L*t+Math.sin(k/9)*6,oy+Math.sin(a)*L*t+Math.cos(k/9)*6,1,.3+.5*Math.sin(k/20)**2);} ev('pointerup',ox+Math.cos(a)*L,oy+Math.sin(a)*L,0,0);
    win.push([t0,performance.now()]);
    await sleep(350); }
  await sleep(3000);
  const stalls=tasks.filter(([st])=>!win.some(([a,b])=>st>=a-5&&st<=b+5)).map(([st,d])=>({at:Math.round(st),d:Math.round(d)}));
  const third=(k)=>stalls.filter(x=>{const idx=win.findIndex(w=>w[0]>x.at); const i=idx<0?N:idx; return i>=N*k/3&&i<N*(k+1)/3;});
  return {n:window.__pbCanvas.getObjects().length, stalls:stalls.length, worst:stalls.map(x=>x.d).sort((a,b)=>b-a).slice(0,8), byThird:[0,1,2].map(k=>{const t=third(k); return {count:t.length,max:Math.max(0,...t.map(x=>x.d))};})};
},[N,M]);
console.log(JSON.stringify(res)); await b.close(); s.close();
