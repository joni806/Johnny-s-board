import { recognizeShape } from '../src/utils/recognition.js';
let seed = 7;
function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
const j=(a)=>(rnd()-0.5)*2*a;
function samp(fn,n,noise){const p=[];for(let i=0;i<n;i++){let t=i/(n-1);t=Math.max(0,Math.min(1,t+0.07*Math.sin(t*Math.PI*3)));const q=fn(t);p.push({x:q.x+j(noise),y:q.y+j(noise)});}return p;}
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function poly(v,closed,n,noise){const l=closed?[...v,v[0]]:v;const L=[];let T=0;for(let i=1;i<l.length;i++){const d=Math.hypot(l[i].x-l[i-1].x,l[i].y-l[i-1].y);L.push(d);T+=d;}
return samp((t)=>{let x=t*T;for(let i=0;i<L.length;i++){if(x<=L[i]||i===L.length-1)return lerp(l[i],l[i+1],Math.min(1,x/L[i]));x-=L[i];}return l[l.length-1];},n,noise);}
const reg=(cx,cy,r,k,rot=0)=>Array.from({length:k},(_,i)=>{const a=rot+2*Math.PI*i/k;return{x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)};});
const rect=(cx,cy,w,h,ang=0)=>[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].map(([x,y])=>({x:cx+x*Math.cos(ang)-y*Math.sin(ang),y:cy+x*Math.sin(ang)+y*Math.cos(ang)}));

const shapes = (nz)=>[
 ['line', samp(t=>({x:120+300*t,y:200}),80,nz)],
 ['rect', poly(rect(300,300,200,200),true,150,nz)],
 ['rect', poly(rect(300,300,240,160,Math.PI/7),true,150,nz)],
 ['circle', samp(t=>({x:300+120*Math.cos(t*2*Math.PI),y:300+120*Math.sin(t*2*Math.PI)}),140,nz)],
 ['ellipse', samp(t=>({x:300+200*Math.cos(t*2*Math.PI),y:300+90*Math.sin(t*2*Math.PI)}),150,nz)],
 ['polygon', poly(reg(300,300,150,3,-Math.PI/2),true,140,nz)],
 ['polygon', poly(reg(300,300,150,5,-Math.PI/2),true,170,nz)],
 ['polygon', poly(reg(300,300,150,6,0),true,180,nz)],
 ['arrow', (()=>{const s=samp(t=>({x:120+280*t,y:300}),70,nz);const tip={x:400,y:300};return [...s,...samp(t=>lerp(tip,{x:355,y:262},t),18,nz)];})()],
 ['curve', samp(t=>({x:120+300*t,y:300-110*Math.sin(t*Math.PI)}),90,nz)],
 ['polyline', poly([{x:150,y:150},{x:260,y:380},{x:370,y:150}],false,110,nz)],
];
for (const nz of [1,2,3,4,5,7]) {
  let ok=0, out=[];
  for (const [exp,pts] of shapes(nz)) {
    const r = recognizeShape(pts,{scale:1});
    const got = r?r.type:'ink';
    if (got===exp) ok++; else out.push(`${exp}→${got}`);
  }
  console.log(`רעש ${nz}px: ${ok}/11  ${out.join(', ')}`);
}
// כתב יד קטן — אסור שיזוהה כצורה
const hw = [
 ['אות l', samp(t=>({x:200,y:200+22*t}),18,0.6)],
 ['אות o', samp(t=>({x:200+9*Math.cos(t*2*Math.PI),y:200+11*Math.sin(t*2*Math.PI)}),20,0.6)],
 ['ספרה 7', poly([{x:200,y:200},{x:224,y:200},{x:210,y:228}],false,22,0.7)],
 ['אות v', poly([{x:200,y:200},{x:210,y:222},{x:220,y:200}],false,20,0.6)],
];
for (const [name,pts] of hw) {
  const r = recognizeShape(pts,{scale:1});
  console.log(`${name}: ${r?r.type:'דיו חופשי ✓'}`);
}
