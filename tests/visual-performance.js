'use strict';

// Opt-in real local benchmark. Inputs are restricted to this process's fixture.
// Each mode performs the same task: focus an observed field and replace its text.
const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const label=process.argv[2]||'current',compound=process.argv.includes('--compound');
const sourceIndex=process.argv.indexOf('--source');
const source=sourceIndex>=0?path.resolve(process.argv[sourceIndex+1]):root;
const {CuaClient}=require(path.join(source,'cua-client'));
const {ComputerUse}=require(path.join(source,'computer-use'));
const {ComputerVisual}=require(path.join(source,'computer-visual'));
if(!/^[a-z0-9_-]{1,40}$/i.test(label))throw new Error('Invalid benchmark label.');
app.setPath('userData',path.join(root,'test-output','visual-performance-profile'));
const round=value=>Math.round(value*100)/100;
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{count:values.length,minMs:round(sorted[0]),medianMs:round(sorted[Math.floor(sorted.length/2)]),maxMs:round(sorted.at(-1))};};
app.whenReady().then(async()=>{
  let win;const client=new CuaClient(),raw=[];
  const original=client.call.bind(client);
  client.call=async(name,args)=>{const started=performance.now();try{return await original(name,args);}finally{raw.push({name,ms:performance.now()-started});}};
  const computer=new ComputerUse({client,getSettings:()=>({allowDesktop:true,allowScreen:true}),confirm:async()=>true});
  const visual=new ComputerVisual({computer});
  try{
    const title=`Pixie Speed Check ${process.pid}`;
    win=new BrowserWindow({title,width:760,height:640,frame:false,resizable:false,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    const area=screen.getPrimaryDisplay().workArea;win.setPosition(area.x+40,area.y+40);
    await win.loadFile(path.join(__dirname,'visual-fixture.html'));
    await win.webContents.executeJavaScript(`document.title=${JSON.stringify(title)}`);win.setTitle(title);win.show();win.focus();
    await new Promise(resolve=>setTimeout(resolve,150));
    const listed=await computer.listWindows({query:title}),target=listed.windows.find(item=>item.pid===process.pid&&item.title===title);
    assert.ok(target,'Only our own fixture can be used.');
    const geometry=await win.webContents.executeJavaScript('window.fixture.targets()');
    const point={x:geometry.text.x/geometry.width,y:geometry.text.y/geometry.height};
    const measurements=[];raw.length=0;
    for(let iteration=0;iteration<5;iteration++){
      let observed=await visual.observe({scope:'window',pid:target.pid,window_id:target.window_id});
      const value=`Speed check ${iteration} — سلام`,started=performance.now(),rawStart=raw.length;
      const input=async args=>{const result=await visual.input({snapshot:observed.snapshot,...args});assert.ok(['verified','unverified'].includes(result.status),JSON.stringify(result,(key,v)=>key==='_images'?undefined:v));assert.ok(result.snapshot);observed=result;};
      if(compound)await input({kind:'type',...point,text:value,replace:true});
      else{await input({kind:'click',...point});await input({kind:'hotkey',keys:['ctrl','a']});await input({kind:'type',text:value});}
      const elapsed=performance.now()-started;
      const state=await win.webContents.executeJavaScript('window.fixture.readState()');
      assert.equal(state.text,value,'Independent renderer readback must confirm exact replacement.');assert.equal(state.activeElement,'editor');
      measurements.push({iteration,durationMs:round(elapsed),nativeCalls:raw.length-rawStart});
    }
    const grouped=Object.fromEntries([...new Set(raw.map(row=>row.name))].map(name=>[name,stats(raw.filter(row=>row.name===name).map(row=>row.ms))]));
    const report={status:'passed',at:new Date().toISOString(),label,version:require(path.join(source,'package.json')).version,compound,iterations:5,agentCallsPerReplacement:compound?1:3,summary:stats(measurements.map(item=>item.durationMs)),rawSummary:grouped,measurements,scope:'Actual local input + fresh screenshots; no model or network calls. Exact text verified in our own isolated fixture.'};
    fs.writeFileSync(path.join(root,'test-output',`visual-performance-${label}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{visual.clear();await computer.stop();if(win&&!win.isDestroyed())win.destroy();}
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
