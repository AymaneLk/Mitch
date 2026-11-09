'use strict';

// Real extension integration in a disposable, owned Opera profile. This script
// never discovers or attaches to an existing browser, user profile or tab.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {WebSocket}=require('ws');
const {AI}=require('../ai');
const {BrowserBridge}=require('../browser-bridge');
const {prepareBrowserExtension}=require('../browser-install');
const root=path.resolve(__dirname,'..'),outputRoot=path.join(root,'test-output'),reportFile=path.join(outputRoot,'browser-native-integration.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:null;};
const rounded=value=>Math.round(value*100)/100;
const progress=phase=>console.log(JSON.stringify({phase}));
const unavailable=(message,code='browser_test_unavailable')=>Object.assign(new Error(message),{unavailable:true,code});

class OwnedCDP {
  constructor(url){this.url=url;this.pending=new Map();this.nextId=0;}
  async connect(){
    this.socket=new WebSocket(this.url);this.socket.on('error',()=>{});
    this.socket.on('message',bytes=>{
      let message;try{message=JSON.parse(bytes.toString());}catch{return;}
      if(!message.id)return;
      const pending=this.pending.get(message.id);if(!pending)return;
      this.pending.delete(message.id);clearTimeout(pending.timer);
      if(message.error)pending.reject(Error(`Owned test browser rejected ${pending.method}: ${message.error.code}`));else pending.resolve(message.result);
    });
    this.socket.on('close',()=>{for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error('Owned test browser connection closed.'));}this.pending.clear();});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(unavailable('The disposable browser debugging endpoint did not connect.')),5000);
      this.socket.once('open',()=>{clearTimeout(timer);resolve();});this.socket.once('error',error=>{clearTimeout(timer);reject(error);});
    });
  }
  call(method,params={}){
    if(this.socket?.readyState!==WebSocket.OPEN)return Promise.reject(Error('Owned test browser is not connected.'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Owned test browser timed out during ${method}.`));},7000);
      this.pending.set(id,{resolve,reject,timer,method});this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  disconnect(){if(this.socket)this.socket.terminate();}
}

async function waitFor(predicate,timeoutMs,message){
  const deadline=Date.now()+timeoutMs;
  do{const result=await predicate();if(result)return result;await delay(100);}while(Date.now()<deadline);
  throw unavailable(message);
}
function insideOwnedProfile(directory){
  const resolved=path.resolve(directory),parent=path.resolve(outputRoot);
  return path.dirname(resolved).toLowerCase()===parent.toLowerCase()&&/^browser-native-profile-[A-Za-z0-9]+$/.test(path.basename(resolved))&&!fs.lstatSync(resolved).isSymbolicLink()&&path.dirname(fs.realpathSync(resolved)).toLowerCase()===fs.realpathSync(parent).toLowerCase();
}

async function run(){
  fs.mkdirSync(outputRoot,{recursive:true});
  const report={status:'running',version:require('../package.json').version,startedAt:new Date().toISOString(),scope:'Real Opera GX extension and browser APIs in a newly created disposable profile. Two local test pages per trial; an unrelated local control page must remain. No existing browser/profile, Gmail, user data, microphone, model API or screenshots. CDP is used only to set up owned fixtures and independently verify results.',rows:[]};
  let profile,extension,bridge,server,child,cdp,token='',phase='prepare',browserReady=false;
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  try{
    const executables=[String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\138.0.6044.65\opera.exe`,String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\opera.exe`];
    const executable=executables.find(file=>fs.existsSync(file));
    if(!executable)throw unavailable('The expected Opera GX executable is not installed.');
    if(fs.realpathSync(outputRoot).toLowerCase()!==path.join(fs.realpathSync(root),'test-output').toLowerCase())throw Error('The test-output directory must be inside this workspace.');
    profile=fs.mkdtempSync(path.join(outputRoot,'browser-native-profile-'));assert.ok(insideOwnedProfile(profile));report.ownedProfile=profile;
    const userData=path.join(profile,'user-data');fs.mkdirSync(userData);
    token=randomBytes(32).toString('base64url');
    extension=prepareBrowserExtension({source:path.join(root,'browser-extension'),destination:path.join(profile,'extension'),token});
    bridge=new BrowserBridge({token,extensionId:extension.extensionId,port:22133,timeoutMs:5000});
    try{await bridge.start();}catch(error){if(error.code==='EADDRINUSE')throw unavailable('Port 22133 is already in use. The test will not replace or connect to an existing Mitch bridge.','port_in_use');throw error;}
    const received=new Set();
    server=http.createServer((req,res)=>{
      const host=String(req.headers.host||'');
      if(!/^(?:127\.0\.0\.1|mitch-browser\.test):[0-9]+$/.test(host)){res.writeHead(404);res.end();return;}
      received.add(req.url);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});
      res.end('<!doctype html><meta charset="utf-8"><title>Mitch owned browser test</title><style>body{font:20px system-ui;padding:40px}</style><h1>Mitch browser performance test</h1><p>This disposable page contains no personal data.</p>');
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    phase='launch';progress('Launching an isolated Opera GX profile');save();
    const args=[`--user-data-dir=${userData}`,`--load-extension=${extension.directory}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-default-apps','--disable-background-networking','--no-proxy-server','--host-resolver-rules=MAP mitch-browser.test 127.0.0.1','--new-window','about:blank'];
    if(process.argv.includes('--headless'))args.unshift('--headless=new');
    child=spawn(executable,args,{windowsHide:true,stdio:'ignore',shell:false});
    let launchError;child.once('error',error=>{launchError=error;});
    const endpointFile=path.join(userData,'DevToolsActivePort');
    const endpoint=await waitFor(()=>{
      if(launchError)throw launchError;
      if(!fs.existsSync(endpointFile))return null;
      const [portLine,browserPath]=fs.readFileSync(endpointFile,'utf8').trim().split(/\r?\n/),debugPort=Number(portLine);
      if(!Number.isInteger(debugPort)||debugPort<1024||debugPort>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath))throw unavailable('The disposable profile returned an invalid debugging endpoint.');
      return `ws://127.0.0.1:${debugPort}${browserPath}`;
    },20000,'Opera did not expose debugging for the new disposable profile; no existing browser will be used.');
    cdp=new OwnedCDP(endpoint);await cdp.connect();
    const version=await cdp.call('Browser.getVersion');report.browserProduct=version.product;report.headless=process.argv.includes('--headless');
    phase='pair';progress('Waiting for the real test extension to pair');
    await waitFor(()=>{const status=bridge.status();return status.connected===1&&status.browsers.length===1&&status.browsers[0]==='opera';},20000,'Opera did not load and pair the unpacked extension in the disposable profile.');
    browserReady=true;
    const control=await cdp.call('Target.createTarget',{url:`http://127.0.0.1:${port}/control`});
    await waitFor(()=>received.has('/control'),5000,'The owned control page did not load.');
    phase='heartbeat';progress('Checking the real extension connection across its heartbeat');
    const firstSession=(await bridge.list({browser:'opera'})).session_id,firstConnection=[...bridge.clients][0];
    await delay(21000);
    const afterHeartbeat=await bridge.list({browser:'opera'});
    assert.equal(afterHeartbeat.session_id,firstSession,'Extension worker restarted instead of maintaining the original session.');
    assert.ok(bridge.clients.has(firstConnection),'Extension replaced its connection during the heartbeat check.');
    assert.equal(bridge.status().connected,1);report.heartbeat={waitMs:21000,sameSession:true,sameConnection:true,connected:true};
    let modelRequests=0,toolRows=[];
    const dispatch=async(name,args,context)=>{
      const started=performance.now();
      try{
        if(name==='browser_list_tabs')return await bridge.list(args,context);
        if(name==='browser_close_tabs')return await bridge.close(args,context);
        if(name==='browser_activate_tab')return await bridge.activate(args,context);
        throw Error(`Unexpected non-browser tool: ${name}`);
      }finally{toolRows.push({name,ms:rounded(performance.now()-started)});}
    };
    const ai=new AI(()=>({chatProvider:'deepseek',deepseekChatModel:'deepseek-flash',allowDesktop:true,allowScreen:false}),async()=>{throw Error('Credentials forbidden in native browser test.');},dispatch,async()=>{throw Error('Model network forbidden in native browser test.');},async()=>{throw Error('Credentials forbidden in native browser test.');});
    ai.request=async()=>{modelRequests++;throw Error('Model fallback is forbidden in this native browser test.');};
    phase='trials';progress('Measuring five real extension tab-close workflows');
    for(let trial=1;trial<=5;trial++){
      const targets=[];
      for(let index=1;index<=2;index++){
        const pathname=`/trial-${trial}-${index}`,created=await cdp.call('Target.createTarget',{url:`http://mitch-browser.test:${port}${pathname}`});targets.push(created.targetId);
        await waitFor(()=>received.has(pathname),5000,'An owned target page did not load through the test hostname mapping.');
      }
      await waitFor(async()=>{
        const ready=await bridge.list({browser:'opera'}),matches=ready.tabs.filter(tab=>{try{return new URL(tab.url).hostname==='mitch-browser.test';}catch{return false;}});
        return matches.length===2&&matches.every(tab=>!tab.navigating);
      },5000,'The two owned test tabs did not settle in the extension inventory.');
      toolRows=[];const beforeRequests=modelRequests,started=performance.now();
      const answer=await ai.chat('Close the two mitch-browser.test tabs in Opera GX',undefined,Symbol(`native-browser-${trial}`));
      const totalMs=rounded(performance.now()-started);
      assert.equal(answer,'Closed 2 mitch-browser.test tabs.');assert.equal(modelRequests,beforeRequests);assert.equal(ai.lastTaskTiming.route,'browser');
      assert.deepEqual(toolRows.map(tool=>tool.name),['browser_list_tabs','browser_close_tabs']);
      const fresh=await cdp.call('Target.getTargets'),pages=fresh.targetInfos.filter(target=>target.type==='page');
      assert.ok(targets.every(id=>!pages.some(target=>target.targetId===id)),'A selected test tab survived.');
      assert.ok(pages.some(target=>target.targetId===control.targetId&&target.url===`http://127.0.0.1:${port}/control`),'The unrelated owned control tab was closed or navigated.');
      report.rows.push({trial,listMs:toolRows[0].ms,closeMs:toolRows[1].ms,totalMs,modelRequests:modelRequests-beforeRequests,closedTabs:2,independentVerification:true,controlRetained:true});save();
      console.log(JSON.stringify({trial,totalMs,modelRequests:0,closedTabs:2,controlRetained:true}));
    }
    report.summary={trials:report.rows.length,medianTotalMs:median(report.rows.map(row=>row.totalMs)),minTotalMs:Math.min(...report.rows.map(row=>row.totalMs)),maxTotalMs:Math.max(...report.rows.map(row=>row.totalMs)),medianListMs:median(report.rows.map(row=>row.listMs)),medianCloseMs:median(report.rows.map(row=>row.closeMs)),modelRequests,verifiedClosures:report.rows.reduce((sum,row)=>sum+row.closedTabs,0)};
    report.status='passed';
  }catch(error){
    report.status=error.unavailable?'unavailable':'failed';report.phase=phase;report.error=String(error.message||error).replaceAll(token||'__no_token__','[REDACTED]').slice(0,500);if(error.code)report.code=error.code;
  }finally{
    if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.disconnect();}
    if(child&&child.exitCode===null&&child.signalCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null&&child.signalCode===null)child.kill();}
    if(bridge)await bridge.stop();
    if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    if(extension)try{fs.unlinkSync(path.join(extension.directory,'config.js'));}catch{}
    token='';
    if(profile){
      try{
        if(!insideOwnedProfile(profile))throw Error('Unexpected owned profile cleanup location.');
        fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});report.ownedProfileRemoved=true;
      }catch(error){report.ownedProfileRemoved=false;report.cleanupError=String(error.message).slice(0,250);}
    }
    report.browserPaired=browserReady;report.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,summary:report.summary,ownedProfileRemoved:report.ownedProfileRemoved,report:reportFile}));
    process.exitCode=report.status==='passed'?0:report.status==='unavailable'?2:1;
  }
}
if(require.main===module)run().catch(error=>{console.error(String(error.message));process.exitCode=1;});
module.exports={run};
