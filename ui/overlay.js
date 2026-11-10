'use strict';
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');
let shapes = [], drawing = false, points = [], animationEnabled = true;
let latestSignature = '', entering = new Map(), frame = 0, audioContext = null;
const colors = {green:'#83ef8c',yellow:'#ffdc69',blue:'#6bc5ff',red:'#ff6262'};
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = t => 1-Math.pow(1-clamp(t,0,1),3);
function playCircleCue() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    if (audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
    const t=audioContext.currentTime, osc=audioContext.createOscillator(), gain=audioContext.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(560,t);
    osc.frequency.exponentialRampToValueAtTime(790,t+.095);
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.exponentialRampToValueAtTime(.038,t+.015);
    gain.gain.exponentialRampToValueAtTime(.0001,t+.19);
    osc.connect(gain).connect(audioContext.destination);
    osc.start(t); osc.stop(t+.205);
    osc.onended=()=>{osc.disconnect();gain.disconnect();};
  } catch { /* Screen marks must still work if audio is unavailable. */ }
}
function circleGeometry(s) {
  const x=clamp(Number(s.x)||0,0,1)*innerWidth, y=clamp(Number(s.y)||0,0,1)*innerHeight;
  const x2=clamp(Number(s.x2)||0,0,1)*innerWidth, y2=clamp(Number(s.y2)||0,0,1)*innerHeight;
  return {cx:(x+x2)/2,cy:(y+y2)/2,rx:Math.max(3,Math.abs(x2-x)/2),ry:Math.max(3,Math.abs(y2-y)/2),x,y,x2,y2};
}
function strokeEllipse(g,progress) {
  ctx.beginPath();
  ctx.ellipse(g.cx,g.cy,g.rx,g.ry,0,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);
}
function drawCircle(s,index,now,immediate=false) {
  const g=circleGeometry(s), start=entering.get(index);
  const progress=immediate||reducedMotion.matches||start===undefined?1:ease((now-start)/420);
  if(progress<=0)return;
  ctx.save();
  ctx.lineCap='round';ctx.lineJoin='round';
  strokeEllipse(g,progress);
  ctx.strokeStyle='rgba(0,0,0,.8)';ctx.lineWidth=7;ctx.shadowBlur=0;ctx.stroke();
  strokeEllipse(g,progress);
  ctx.strokeStyle='rgba(255,255,255,.36)';ctx.lineWidth=6.2;
  ctx.shadowColor='rgba(255,255,255,.75)';ctx.shadowBlur=11;ctx.stroke();
  strokeEllipse(g,progress);
  ctx.shadowBlur=0;ctx.strokeStyle='#f8f8f8';ctx.lineWidth=2.35;ctx.stroke();
  if(s.label && progress>.8) drawLabel(String(s.label).slice(0,90),g,clamp((progress-.8)/.2,0,1));
  ctx.restore();
}
function drawLabel(label,g,opacity) {
  ctx.save();ctx.globalAlpha*=opacity;
  const font='500 13px "Segoe UI",sans-serif';
  ctx.font=font;
  const w=Math.min(innerWidth-16,Math.ceil(ctx.measureText(label).width)+28),h=30;
  const x=clamp(g.cx+g.rx+13,8,Math.max(8,innerWidth-w-8));
  const y=clamp(g.cy-g.ry-35,8,Math.max(8,innerHeight-h-8));
  const anchorX=g.cx+g.rx,anchorY=g.cy-g.ry*.45;
  ctx.beginPath();ctx.moveTo(anchorX,anchorY);ctx.lineTo(x,y+h/2);
  ctx.strokeStyle='rgba(255,255,255,.68)';ctx.lineWidth=1;ctx.stroke();
  ctx.beginPath();ctx.roundRect(x,y,w,h,15);
  ctx.fillStyle='rgba(9,9,11,.95)';ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='#f7f7f8';ctx.textBaseline='middle';
  ctx.fillText(label,x+14,y+h/2,w-28);
  ctx.restore();
}
function drawOther(s) {
  const x=(s.x||0)*innerWidth,y=(s.y||0)*innerHeight,x2=(s.x2||0)*innerWidth,y2=(s.y2||0)*innerHeight;
  ctx.save();
  ctx.strokeStyle=colors[s.color]||colors.green;ctx.fillStyle=ctx.strokeStyle;
  ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='#0007';ctx.shadowBlur=3;ctx.beginPath();
  if(s.points){s.points.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x*innerWidth,p.y*innerHeight);else ctx.lineTo(p.x*innerWidth,p.y*innerHeight);});if(s.shape==='polygon')ctx.closePath();}
  else if(s.shape==='rectangle')ctx.rect(Math.min(x,x2),Math.min(y,y2),Math.abs(x2-x),Math.abs(y2-y));
  else if(s.shape==='pointer')ctx.arc(x,y,9,0,Math.PI*2);
  else{ctx.moveTo(x,y);ctx.lineTo(x2,s.shape==='underline'?y:y2);if(s.shape==='arrow'){const a=Math.atan2(y2-y,x2-x);ctx.moveTo(x2-14*Math.cos(a-.5),y2-14*Math.sin(a-.5));ctx.lineTo(x2,y2);ctx.lineTo(x2-14*Math.cos(a+.5),y2-14*Math.sin(a+.5));}}
  ctx.stroke();
  if(s.label){
    ctx.shadowBlur=0;ctx.font='bold 15px Segoe UI';
    const width=ctx.measureText(s.label).width;
    ctx.fillStyle='#1d251de8';ctx.fillRect(Math.min(x,innerWidth-width-20),Math.max(3,y-30),width+14,25);
    ctx.fillStyle=colors[s.color]||colors.green;
    ctx.fillText(s.label,Math.min(x,innerWidth-width-20)+7,Math.max(20,y-12));
  }
  ctx.restore();
}
function render(now=performance.now(),immediate=false) {
  const dpr=window.devicePixelRatio||1,w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);
  for(let i=0;i<shapes.length;i++){
    if(shapes[i].shape==='circle')drawCircle(shapes[i],i,now,immediate||!animationEnabled);
    else drawOther(shapes[i]);
  }
  if(points.length)drawOther({shape:'polyline',points,color:'red'});
}
function animate(now) {
  frame=0;render(now);
  if([...entering.values()].some(start=>now-start<430)&&!reducedMotion.matches)frame=requestAnimationFrame(animate);
  else entering.clear();
}
function schedule(){if(!frame)frame=requestAnimationFrame(animate);}
function point(e){return{x:clamp(e.clientX/innerWidth,0,1),y:clamp(e.clientY/innerHeight,0,1)};}
canvas.onpointerdown=e=>{if(!drawing)return;points=[point(e)];canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(points.length&&points.length<5000){points.push(point(e));render();}};
canvas.onpointerup=async()=>{if(points.length>1){const stroke=points;points=[];await window.companion.ink(stroke);}else points=[];render();};
document.getElementById('done').onclick=()=>window.companion.drawMode(false);
window.onkeydown=e=>{if(e.key==='Escape')window.companion.drawMode(false);};
window.companion.on('overlay',data=>{
  const next=Array.isArray(data.shapes)?data.shapes:[];
  const signature=next.length?JSON.stringify(next[next.length-1]):'';
  const changed=signature!==latestSignature;
  const newCircle=changed&&next.length&&next[next.length-1].shape==='circle';
  if(newCircle&&data.animate!==false){
    entering.clear();entering.set(next.length-1,performance.now());
    playCircleCue();
  } else if(changed) entering.clear();
  shapes=next;latestSignature=signature;drawing=!!data.inkMode;animationEnabled=data.animate!==false;
  document.body.classList.toggle('drawing',drawing);toolbar.hidden=!drawing;
  if(frame){cancelAnimationFrame(frame);frame=0;}
  render();if(newCircle&&animationEnabled&&!reducedMotion.matches)schedule();
});
window.onresize=()=>render();
window.exportMarks=()=>{render(performance.now(),true);return canvas.toDataURL('image/png');};
render();
