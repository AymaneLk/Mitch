const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');let shapes=[],drawing=false,points=[];
const colors={green:'#83ef8c',yellow:'#ffdc69',blue:'#6bc5ff',red:'#ff6262'};
function render(){const dpr=window.devicePixelRatio||1;canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,innerWidth,innerHeight);for(const s of shapes)draw(s);if(points.length)draw({shape:'polyline',points,color:'red'});}
function draw(s){const x=(s.x||0)*innerWidth,y=(s.y||0)*innerHeight,x2=(s.x2||0)*innerWidth,y2=(s.y2||0)*innerHeight;ctx.strokeStyle=colors[s.color]||colors.green;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';ctx.shadowColor='#0007';ctx.shadowBlur=3;ctx.beginPath();
  if(s.points){s.points.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x*innerWidth,p.y*innerHeight);else ctx.lineTo(p.x*innerWidth,p.y*innerHeight);});if(s.shape==='polygon')ctx.closePath();}
  else if(s.shape==='circle')ctx.ellipse((x+x2)/2,(y+y2)/2,Math.max(3,Math.abs(x2-x)/2),Math.max(3,Math.abs(y2-y)/2),0,0,Math.PI*2);
  else if(s.shape==='rectangle')ctx.rect(Math.min(x,x2),Math.min(y,y2),Math.abs(x2-x),Math.abs(y2-y));
  else if(s.shape==='pointer'){ctx.arc(x,y,9,0,Math.PI*2);}
  else{ctx.moveTo(x,y);ctx.lineTo(x2,s.shape==='underline'?y:y2);if(s.shape==='arrow'){const a=Math.atan2(y2-y,x2-x);ctx.moveTo(x2-14*Math.cos(a-.5),y2-14*Math.sin(a-.5));ctx.lineTo(x2,y2);ctx.lineTo(x2-14*Math.cos(a+.5),y2-14*Math.sin(a+.5));}}
  ctx.stroke();if(s.label){ctx.shadowBlur=0;ctx.font='bold 15px Segoe UI';const width=ctx.measureText(s.label).width;ctx.fillStyle='#1d251de8';ctx.fillRect(Math.min(x,innerWidth-width-20),Math.max(3,y-30),width+14,25);ctx.fillStyle=colors[s.color]||colors.green;ctx.fillText(s.label,Math.min(x,innerWidth-width-20)+7,Math.max(20,y-12));}}
function point(e){return{x:Math.max(0,Math.min(1,e.clientX/innerWidth)),y:Math.max(0,Math.min(1,e.clientY/innerHeight))};}
canvas.onpointerdown=e=>{if(!drawing)return;points=[point(e)];canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(points.length&&points.length<5000){points.push(point(e));render();}};
canvas.onpointerup=async()=>{if(points.length>1){const stroke=points;points=[];await window.companion.ink(stroke);}else points=[];render();};
document.getElementById('done').onclick=()=>window.companion.drawMode(false);window.onkeydown=e=>{if(e.key==='Escape')window.companion.drawMode(false);};
window.companion.on('overlay',data=>{shapes=data.shapes;drawing=data.inkMode;document.body.classList.toggle('drawing',drawing);document.getElementById('toolbar').hidden=!drawing;render();});
window.onresize=render;window.exportMarks=()=>{render();return canvas.toDataURL('image/png');};render();
