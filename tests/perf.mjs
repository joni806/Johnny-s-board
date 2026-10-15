/* מדידת ביצועים: כותב הרבה משיכות וממדוד כמה זמן כל משיכה חוסמת את הדף.
 *     npm run build && node tests/perf.mjs [strokes]
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('../dist/', import.meta.url)); const PROF = process.env.PROF; const URL0 = process.env.URL0;
const T={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const s = createServer(async (q,r)=>{try{const p=normalize(join(root,decodeURIComponent(q.url.split('?')[0])));const f=(p.endsWith('/')||p.endsWith(String.fromCharCode(92)))?join(p,'index.html'):p;r.writeHead(200,{'Content-Type':T[extname(f)]||'application/octet-stream'});r.end(await readFile(f))}catch{r.writeHead(404);r.end()}});
await new Promise(r=>s.listen(0,r));
const N = +(process.argv[2] || 300); const PTS = +(process.argv[3] || 150); const SLOW = +(process.argv[4] || 1);
const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1280,height:800}});
const pg = await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
const cdp0 = await ctx.newCDPSession(pg); if (PROF) { await cdp0.send('Profiler.enable'); await cdp0.send('Profiler.setSamplingInterval',{interval:500}); }
await pg.goto(URL0 || `http://127.0.0.1:${s.address().port}/`,{waitUntil:'networkidle'});
await pg.locator('header .btn-create-new').click(); await pg.locator('.modal-actions .btn-create-new').click(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(400);
if (PROF) await cdp0.send('Profiler.start');
if (SLOW>1) await (await ctx.newCDPSession(pg)).send('Emulation.setCPUThrottlingRate',{rate:SLOW});
const res = await pg.evaluate(async ([N,PTS])=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const cv=document.getElementById('drawing-canvas');
  const ev=(t,x,y,b,p)=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:9,pointerType:'pen',pressure:p,buttons:b,button:t==='pointermove'?-1:0,isPrimary:true}));
  let longTasks=[]; try{ new PerformanceObserver(l=>{for(const e of l.getEntries())longTasks.push(e.duration)}).observe({entryTypes:['longtask']}); }catch{}
  const out=[];
  for(let i=0;i<N;i++){
    const ox=30+(i%22)*55, oy=40+(Math.floor(i/22)%14)*52+(Math.floor(i/308)*17);
    const t0=performance.now();
    ev('pointerdown',ox,oy,1,.5);
    for(let k=1;k<=PTS;k++) ev('pointermove',ox+k*35/PTS*1.0,oy+Math.sin(k/6)*14+k/PTS*20,1,.5);
    ev('pointerup',ox+35,oy+20,0,0);
    const t1=performance.now();
    // כמה זמן הדף חסום עד שהוא פנוי שוב (היסטוריה, שמירה)
    await new Promise(r=>requestAnimationFrame(()=>r())); await new Promise(r=>setTimeout(r,0));
    const t2=performance.now();
    out.push({i,stroke:t1-t0,settle:t2-t1});
    await sleep(40);
  }
  const lc=window.__pbCanvas.lowerCanvasEl; const snap=()=>{const d=lc.getContext('2d').getImageData(0,0,lc.width,lc.height).data; let h=0; for(let i=0;i<d.length;i+=4){h=(h*31+d[i]+d[i+1]*3+d[i+3]*7)|0;} return h;}; const hBefore=snap(); const t=performance.now(); window.__pbCanvas.renderAll(); const hAfter=snap(); const renderAll=performance.now()-t;
  const t3=performance.now(); const st=window.__pbCanvas.toObject(['customType']); const json=JSON.stringify(st); const ser=performance.now()-t3;
  return {same:hBefore===hAfter,out,longTasks,renderAll,ser,jsonKB:Math.round(json.length/1024),objs:window.__pbCanvas.getObjects().length};
}, [N,PTS]);
if (PROF) { const {profile}=await cdp0.send('Profiler.stop'); const self=new Map(); const byId=new Map(profile.nodes.map(n=>[n.id,n])); const dt=profile.timeDeltas; profile.samples.forEach((id,i)=>{const n=byId.get(id); const k=n.callFrame.functionName+' '+n.callFrame.url.split('/').pop()+':'+n.callFrame.lineNumber; self.set(k,(self.get(k)||0)+(dt[i]||0));});
 console.log([...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,22).map(([k,v])=>(v/1000).toFixed(0).padStart(7)+'ms '+k).join(String.fromCharCode(10))); }
const avg=(a)=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
for (const [a,z] of [[0,20],[N/4|0,N/4+20|0],[N/2|0,N/2+20|0],[N-20,N]]) {
  const seg=res.out.slice(a,z); console.log(`strokes ${a}-${z}: stroke ${avg(seg.map(x=>x.stroke)).toFixed(1)}ms, settle(max) ${Math.max(...seg.map(x=>x.settle)).toFixed(0)}ms`);
}
console.log('incremental render matches full render:',res.same); console.log('objs',res.objs,'renderAll ms',res.renderAll.toFixed(0),'serialize ms',res.ser.toFixed(0),'json KB',res.jsonKB);
const lt=res.longTasks; console.log('top longtasks',lt.slice().sort((a,b)=>b-a).slice(0,6).map(x=>x.toFixed(0)).join(',')); console.log('longtasks',lt.length,'max',Math.max(0,...lt).toFixed(0),'total',lt.reduce((a,b)=>a+b,0).toFixed(0));
console.log('errors',errs);
await b.close(); s.close();
