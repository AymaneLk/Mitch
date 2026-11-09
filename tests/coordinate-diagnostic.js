'use strict';
// Inputs are restricted to the small target in this process's own fixture.
const {app,BrowserWindow,screen,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {CuaClient}=require('../cua-client');
const {ComputerUse}=require('../computer-use');
const {ComputerVisual}=require('../computer-visual');
const directory=path.resolve(__dirname,'../test-output');
app.setPath('userData',path.join(directory,'coordinate-diagnostic-profile'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const client=new CuaClient(),computer=new ComputerUse({client,getSettings:()=>({allowDesktop:true,allowScreen:true}),confirm:async()=>true}),visual=new ComputerVisual({computer});
  const report={at:new Date().toISOString(),status:'running',displays:screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,scaleFactor:d.scaleFactor})),checks:[]};
  let win;
  try{
    for(const display of screen.getAllDisplays())for(const framed of [false,true]){
      const title=`Mitch coordinate check ${process.pid}`;
      win=new BrowserWindow({title,x:display.workArea.x+70,y:display.workArea.y+70,width:Math.min(1500,display.workArea.width-140),height:Math.min(850,display.workArea.height-140),frame:framed,show:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
      await win.loadURL('data:text/html,'+encodeURIComponent('<!doctype html><style>body{margin:0;background:#f3f0e9;font:20px sans-serif}#target{position:absolute;left:29px;bottom:75px;width:34px;height:34px;border-radius:50%;border:0;padding:0;background:#e600ad}p{margin:60px}</style><p>Mitch coordinate diagnostic — isolated target</p><button id="target" aria-label="Profile"></button><span style="position:absolute;left:78px;bottom:82px">Profile</span><script>window.hits=[];document.addEventListener("click",e=>window.hits.push({x:e.clientX,y:e.clientY,hit:e.target.id}));</script>'));
      await win.webContents.executeJavaScript(`document.title=${JSON.stringify(title)}`);
      win.setTitle(title);win.show();if(!win.isVisible())win.show();win.focus();await new Promise(r=>setTimeout(r,250));
      const listed=await computer.listWindows({query:title}),target=listed.windows.find(w=>w.pid===process.pid&&w.title===title);
      if(!target){const raw=await client.call('list_windows',{pid:process.pid,on_screen_only:false});throw new Error(JSON.stringify({pid:process.pid,listed,visible:win.isVisible(),bounds:win.getBounds(),raw}));}
      const geometry=await win.webContents.executeJavaScript('(()=>{const r=document.getElementById("target").getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,cx:r.x+r.width/2,cy:r.y+r.height/2}})()');
      const observed=await visual.observe({scope:'window',pid:target.pid,window_id:target.window_id});
      fs.writeFileSync(path.join(directory,`coordinate-${display.id}-${framed}.png`),Buffer.from(observed._images[0].data_url.split(',')[1],'base64'));
      const capture=visual.current.captureBounds,content=win.getContentBounds(),scale=display.scaleFactor,outer=win.getBounds();
      // Detect the solid blue fixture target in the actual returned PNG. The
      // independent DOM event readback must agree, including non-client borders.
      const bitmap=nativeImage.createFromDataURL(observed._images[0].data_url).toBitmap();
      let left=observed.width,top=observed.height,right=-1,bottom=-1;
      for(let y=0;y<observed.height;y++)for(let x=0;x<observed.width;x++){
        const offset=(y*observed.width+x)*4;
        if(Math.abs(bitmap[offset]-173)<4&&bitmap[offset+1]<4&&Math.abs(bitmap[offset+2]-230)<4){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      }
      assert.ok(right>left&&bottom>top,'Blue fixture target must be visible in the native image.');
      const box={left:left/(observed.width-1),top:top/(observed.height-1),right:right/(observed.width-1),bottom:bottom/(observed.height-1)};
      const result=await visual.input({snapshot:observed.snapshot,kind:'click',target_box:box});
      const hits=await win.webContents.executeJavaScript('window.hits');
      const last=hits.at(-1),entry={display:display.id,scale,framed,capture,outer,content,image:{width:observed.width,height:observed.height},box,targets:observed.targets,expected:{x:geometry.cx,y:geometry.cy},actual:last,status:result.status,error:last?{x:last.x-geometry.cx,y:last.y-geometry.cy}:null};
      report.checks.push(entry);fs.writeFileSync(path.join(directory,'coordinate-diagnostic.json'),JSON.stringify(report,null,2));
      assert.ok(last?.hit==='target',JSON.stringify(entry));assert.ok(Math.abs(entry.error.x)<=5&&Math.abs(entry.error.y)<=5,JSON.stringify(entry));
      win.destroy();win=null;
    }
    report.status='passed';
  }catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
  finally{visual.clear();await computer.stop();if(win&&!win.isDestroyed())win.destroy();fs.writeFileSync(path.join(directory,'coordinate-diagnostic.json'),JSON.stringify(report,null,2));}
  app.exit(report.status==='passed'?0:1);
}).catch(error=>{console.error(error);app.exit(1);});
