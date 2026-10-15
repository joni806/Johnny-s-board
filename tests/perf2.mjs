/* מדידת עלות כל סוג אירוע כשהלוח גדול. node tests/perf2.mjs [strokes] [slowdown] */
import { chromium } from 'playwright';
const N=+(process.argv[2]||800), SLOW=+(process.argv[3]||4), PROF=process.env.PROF;
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1280,height:800}}); const pg=await ctx.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.goto(process.env.URL0||'http://localhost:5199/',{waitUntil:'networkidle'});
await pg.locator('header .btn-create-new').click(); await pg.locator('.modal-actions .btn-create-new').click(); await pg.waitForSelector('#drawing-canvas'); await pg.waitForTimeout(500);
const cdp=await ctx.newCDPSession(pg);
await pg.evaluate(async(N)=>{ // ממלא את הלוח בכתב אמיתי דרך אירועי עט
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const cv=document.getElementById('drawing-canvas');
  const ev=(t,x,y,b,p)=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:9,pointerType:'pen',pressure:p,buttons:b,button:t==='pointermove'?-1:0,isPrimary:true}));
  let s=1; const rnd=()=>{s=(s*16807)%2147483647; return s/2147483647;};
  for(let i=0;i<N;i++){ const ox=40+rnd()*1150, oy=80+rnd()*650, a=rnd()*6.28, L=30+rnd()*50;
    ev('pointerdown',ox,oy,1,.5); for(let k=1;k<=60;k++){const t=k/60; ev('pointermove',ox+Math.cos(a)*L*t+Math.sin(k/4)*5,oy+Math.sin(a)*L*t+Math.cos(k/4)*5,1,.5);} ev('pointerup',ox+Math.cos(a)*L,oy+Math.sin(a)*L,0,0);
    if(i%50===0) await sleep(5);
  }
  await sleep(2500);
},N);
console.log('objects',await pg.evaluate(()=>window.__pbCanvas.getObjects().length));
if(SLOW>1) await cdp.send('Emulation.setCPUThrottlingRate',{rate:SLOW});
if(PROF){await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval',{interval:300}); await cdp.send('Profiler.start');}
const res=await pg.evaluate(async()=>{
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const cv=document.getElementById('drawing-canvas');
  const ev=(t,x,y,b,p=.5,type='pen')=>cv.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:11,pointerType:type,pressure:p,buttons:b,button:t==='pointermove'?-1:0,isPrimary:true}));
  const out={}; const time=async(name,fn)=>{const t=performance.now(); await fn(); out[name]=+(performance.now()-t).toFixed(1); await sleep(300);};
  const stroke=(y)=>{ev('pointerdown',100,y,1); for(let k=1;k<=60;k++) ev('pointermove',100+k*5,y+Math.sin(k/4)*6,1); ev('pointerup',400,y,0);};
  await time('write one stroke (60 moves) total',()=>stroke(400));
  await time('write one stroke again',()=>stroke(450));
  // רק pointerdown
  await time('pointerdown only',()=>{ev('pointerdown',500,300,1); ev('pointerup',500,300,0);});
  // תנועה בודדת
  ev('pointerdown',600,300,1); let tm=performance.now(); for(let k=1;k<=100;k++) ev('pointermove',600+k*2,300+Math.sin(k/3)*8,1); out['avg pointermove ms']=+((performance.now()-tm)/100).toFixed(2); ev('pointerup',800,300,0); await sleep(300);
  // undo
  await time('undo',()=>window.__pbBoard.undo());
  await time('redo',()=>window.__pbBoard.redo());
  // מחק
  window.__pbSetMode('erase'); await sleep(100);
  tm=performance.now(); ev('pointerdown',300,300,1); for(let k=1;k<=40;k++) ev('pointermove',300+k*10,300+Math.sin(k/3)*30,1); ev('pointerup',700,300,0); out['erase 40 moves ms']=+(performance.now()-tm).toFixed(1); await sleep(500);
  // בחירה
  window.__pbSetMode('select'); await sleep(100);
  tm=performance.now(); ev('pointerdown',200,200,1); for(let k=1;k<=30;k++) ev('pointermove',200+k*15,200+Math.sin(k/3)*100,1); ev('pointerup',650,200,0); out['lasso 30 moves ms']=+(performance.now()-tm).toFixed(1); await sleep(800);
  window.__pbSetMode('draw');
  // זום והזזה
  tm=performance.now(); for(let k=0;k<20;k++) cv.parentElement.parentElement.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-30,clientX:600,clientY:400,bubbles:true,cancelable:true})); await sleep(400); out['zoom end render+settle']=+(performance.now()-tm).toFixed(1);
  tm=performance.now(); window.__pbCanvas.renderAll(); out['renderAll']=+(performance.now()-tm).toFixed(1);
  return out;});
console.log(res);
if(PROF){const {profile}=await cdp.send('Profiler.stop'); const self=new Map(); const byId=new Map(profile.nodes.map(n=>[n.id,n])); profile.samples.forEach((id,i)=>{const n=byId.get(id); const k=n.callFrame.functionName+' '+n.callFrame.url.split('/').pop().split('?')[0]+':'+n.callFrame.lineNumber; self.set(k,(self.get(k)||0)+(profile.timeDeltas[i]||0));});
 console.log([...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>(v/1000).toFixed(0).padStart(7)+'ms '+k).join(String.fromCharCode(10)));}
console.log('errors',errs); await b.close();
