'use strict';
// Real extension integration confined to a new owned Opera profile and a local
// HTTP fixture. CDP sets up and independently reads only this owned browser.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),{WebSocket}=require('ws');
const {BrowserBridge}=require('../browser-bridge'),{prepareBrowserExtension}=require('../browser-install');
const {runGuardedTaskProgram}=require('../task-program-runner');
const root=path.resolve(__dirname,'..'),outputRoot=path.join(root,'test-output'),reportFile=path.join(outputRoot,'browser-navigation-integration.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),rounded=value=>Math.round(value*100)/100;
const unavailable=(message,code='browser_test_unavailable')=>Object.assign(Error(message),{unavailable:true,code});
const target=(role,name)=>({role,name,match:'exact'}),exists=(role,name)=>({target:target(role,name),condition:'exists'});
class OwnedCDP {
  constructor(url){this.url=url;this.pending=new Map();this.nextId=0;}
  async connect(){
    this.socket=new WebSocket(this.url);this.socket.on('error',()=>{});
    this.socket.on('message',bytes=>{let message;try{message=JSON.parse(bytes.toString());}catch{return;}const entry=this.pending.get(message.id);if(!entry)return;this.pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(`Owned browser rejected ${entry.method}: ${message.error.code}`)):entry.resolve(message.result);});
    this.socket.on('close',()=>{for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(Error('Owned browser connection closed.'));}this.pending.clear();});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(unavailable('Owned browser endpoint did not connect.')),5000);this.socket.once('open',()=>{clearTimeout(timer);resolve();});this.socket.once('error',error=>{clearTimeout(timer);reject(error);});});
  }
  call(method,params={},sessionId){
    if(this.socket?.readyState!==WebSocket.OPEN)return Promise.reject(Error('Owned browser is not connected.'));
    const id=++this.nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Owned browser timed out during ${method}.`));},7000);this.pending.set(id,{resolve,reject,timer,method});this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  }
  disconnect(){this.socket?.terminate();}
}
async function waitFor(predicate,timeoutMs,message){const deadline=Date.now()+timeoutMs;do{const value=await predicate();if(value)return value;await delay(50);}while(Date.now()<deadline);throw unavailable(message);}
function insideOwnedProfile(directory){const resolved=path.resolve(directory),parent=path.resolve(outputRoot);return path.dirname(resolved).toLowerCase()===parent.toLowerCase()&&/^browser-navigation-profile-[A-Za-z0-9]+$/.test(path.basename(resolved))&&!fs.lstatSync(resolved).isSymbolicLink()&&path.dirname(fs.realpathSync(resolved)).toLowerCase()===fs.realpathSync(parent).toLowerCase();}
function compact(result){return {status:result?.status,verified:result?.verified,reason:result?.reason,code:result?.code,action_attempted:result?.action_attempted,outcome_unknown:result?.outcome_unknown,navigation:result?.navigation,steps:result?.steps,delivered_steps:result?.delivered_steps,observation:result?.observation&&{url:result.observation.url,document_id:result.observation.document_id,complete:result.observation.complete,controls:result.observation.controls},timing:result?.timing};}
function fixture(pathname){
  const match=/^\/(start|done|opened|workflow-start|workflow-done|workflow-opened|control)(?:-([0-9]+))?$/.exec(pathname);if(!match)return null;
  const page=match[1],trial=match[2]||'0',start=page==='start'||page==='workflow-start',workflow=page.startsWith('workflow');
  const title=page==='control'?'Mitch unrelated owned page':start?(workflow?'Mitch workflow start':'Mitch navigation start'):(page.includes('opened')?'Mitch opened page':'Mitch navigation done');
  const body=start?`<h1>Owned navigation start</h1><a href="/${workflow?'workflow-done':'done'}-${trial}">Open report</a>`:`<h1>${page==='control'?'Unrelated control':page.includes('opened')?'New page ready':'Report ready'}</h1><p id="proof">Owned proof ${page} ${trial}</p>`;
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:20px system-ui;padding:40px}a{display:inline-block;padding:20px}</style><main>${body}</main>`;
}
async function run(){
  fs.mkdirSync(outputRoot,{recursive:true});
  const report={status:'running',version:require('../package.json').version,startedAt:new Date().toISOString(),scope:'Real Opera GX extension 1.2.0: same-origin observed-link full-document navigation, explicit owned-URL tab creation, and guarded workflow execution. New disposable profile with exact local fixture permission only; no user tabs, cloud, screenshots, credentials or microphone. CDP only sets up and independently verifies owned fixtures.',rows:[],modelRequests:0};
  let profile,extension,bridge,server,child,cdp,token='',phase='prepare',browserReady=false;
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  try{
    const executable=[String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\138.0.6044.65\opera.exe`,String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\opera.exe`].find(file=>fs.existsSync(file));
    if(!executable)throw unavailable('The expected Opera GX executable is not installed.');
    if(fs.realpathSync(outputRoot).toLowerCase()!==path.join(fs.realpathSync(root),'test-output').toLowerCase())throw Error('test-output must remain inside this workspace.');
    profile=fs.mkdtempSync(path.join(outputRoot,'browser-navigation-profile-'));assert.ok(insideOwnedProfile(profile));report.ownedProfile=profile;
    const userData=path.join(profile,'user-data');fs.mkdirSync(userData);token=randomBytes(32).toString('base64url');
    extension=prepareBrowserExtension({source:path.join(root,'browser-extension'),destination:path.join(profile,'extension'),token,port:22136});
    const manifestPath=path.join(extension.directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    assert.equal(manifest.version,'1.2.0');report.extensionVersion=manifest.version;
    manifest.host_permissions=[...new Set([...(manifest.host_permissions||[]),'http://mitch-navigation.test/*','http://127.0.0.1/*'])];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    bridge=new BrowserBridge({token,extensionId:extension.extensionId,port:22136,timeoutMs:15000});
    const bridgeRequest=bridge.request.bind(bridge);
    bridge.request=async(...args)=>{const result=await bridgeRequest(...args);if(args[1]==='page.open_tab')report.lastOwnedOpenResult=result;return result;};
    try{await bridge.start();}catch(error){if(error.code==='EADDRINUSE')throw unavailable('Test port 22136 is occupied; no existing bridge will be replaced.','port_in_use');throw error;}
    const received=[];
    server=http.createServer((req,res)=>{
      if(!/^(?:127\.0\.0\.1|mitch-navigation\.test):[0-9]+$/.test(String(req.headers.host||''))){res.writeHead(404);res.end();return;}
      const html=fixture(req.url);if(!html){res.writeHead(404);res.end();return;}received.push(req.url);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(html);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port,origin=`http://mitch-navigation.test:${port}`;
    phase='launch';console.log(JSON.stringify({phase:'Launching disposable Opera navigation fixture'}));save();
    const args=[`--user-data-dir=${userData}`,`--load-extension=${extension.directory}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-default-apps','--disable-background-networking','--enable-logging=stderr','--no-proxy-server','--host-resolver-rules=MAP mitch-navigation.test 127.0.0.1','--new-window','about:blank'];
    if(process.argv.includes('--headless'))args.unshift('--headless=new');child=spawn(executable,args,{windowsHide:true,stdio:['ignore','ignore','pipe'],shell:false});let launchError;child.once('error',error=>{launchError=error;});
    child.once('exit',(code,signal)=>{report.launcherExit={code,signal};});
    child.stderr.on('data',bytes=>{const text=bytes.toString().replaceAll(token,'[REDACTED]');report.launchDiagnostics=((report.launchDiagnostics||'')+text).slice(-6000);});
    const endpointFile=path.join(userData,'DevToolsActivePort');
    const endpoint=await waitFor(()=>{if(launchError)throw launchError;if(!fs.existsSync(endpointFile))return null;const [portLine,browserPath]=fs.readFileSync(endpointFile,'utf8').trim().split(/\r?\n/),debugPort=Number(portLine);if(!Number.isInteger(debugPort)||debugPort<1024||debugPort>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath))throw unavailable('Invalid endpoint in disposable profile.');return `ws://127.0.0.1:${debugPort}${browserPath}`;},20000,'New disposable Opera profile did not expose debugging.');
    cdp=new OwnedCDP(endpoint);await cdp.connect();report.browserProduct=(await cdp.call('Browser.getVersion')).product;report.headless=process.argv.includes('--headless');
    const initialTargets=(await cdp.call('Target.getTargets')).targetInfos;report.initialOwnedTargets=initialTargets.map(row=>({type:row.type,url:row.url}));save();
    phase='pair';await waitFor(()=>{if(cdp.socket?.readyState!==WebSocket.OPEN)throw unavailable('Owned browser disconnected before its extension paired.');const status=bridge.status();return status.connected===1&&status.navigationCapable===1&&status.browsers.length===1&&status.browsers[0]==='opera';},20000,'Disposable navigation-capable extension did not pair.');browserReady=true;
    const controlURL=`http://127.0.0.1:${port}/control`,control=await cdp.call('Target.createTarget',{url:controlURL});
    async function observe(url){return waitFor(async()=>{const list=await bridge.list({browser:'opera'}),matches=list.tabs.filter(tab=>tab.url===url);if(matches.length!==1||matches[0].navigating)return null;const page=await bridge.observePage({snapshot:list.snapshot,tab_id:matches[0].tab_id});if(page.status==='refused'&&page.action_attempted===false)return null;assert.equal(page.status,'observed',JSON.stringify(compact(page)));assert.equal(page.complete,true);return page;},7000,'Owned page did not expose complete settled controls.');}
    async function verify(url,expectedText){
      const fresh=await cdp.call('Target.getTargets'),matches=fresh.targetInfos.filter(row=>row.type==='page'&&row.url===url);assert.equal(matches.length,1,'Exactly one owned destination must exist.');
      const {sessionId}=await cdp.call('Target.attachToTarget',{targetId:matches[0].targetId,flatten:true});
      try{const result=await cdp.call('Runtime.evaluate',{expression:'({url:location.href,text:document.body.innerText,ready:document.readyState})',returnByValue:true},sessionId);assert.equal(result.exceptionDetails,undefined);assert.equal(result.result.value.url,url);assert.ok(result.result.value.text.includes(expectedText));assert.equal(result.result.value.ready,'complete');}
      finally{await cdp.call('Target.detachFromTarget',{sessionId});}
      return matches[0].targetId;
    }
    const addRow=(kind,started,result,extra={})=>{report.rows.push({kind,totalMs:rounded(performance.now()-started),independentFixtureReadback:true,...extra,result:compact(result)});save();console.log(JSON.stringify({kind,totalMs:report.rows.at(-1).totalMs,verified:result.verified}));};
    phase='follow-link';
    for(let trial=1;trial<=3;trial++){
      const startURL=`${origin}/start-${trial}`,destination=`${origin}/done-${trial}`;
      const created=await cdp.call('Target.createTarget',{url:startURL});await cdp.call('Target.activateTarget',{targetId:created.targetId});const page=await observe(startURL);
      assert.ok(page.controls.some(control=>control.role==='link'&&control.name==='Open report'));
      const started=performance.now(),result=await bridge.followLink({snapshot:page.snapshot,target:target('link','Open report'),completion:[exists('heading','Report ready')]},{activityScope:Symbol('navigation-'+trial)});
      assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);assert.equal(result.observation.complete,true);assert.notEqual(result.observation.document_id,page.document_id);assert.equal(result.observation.url,destination);
      assert.equal(await verify(destination,`Owned proof done ${trial}`),created.targetId,'Navigation must retain the exact tab');assert.equal(received.filter(path=>path===`/done-${trial}`).length,1);
      addRow('follow_link',started,result,{trial,freshDocument:true,sameTab:true,singleNavigation:true});
    }
    phase='open-tab';
    for(let trial=1;trial<=3;trial++){
      const url=`${origin}/opened-${trial}`,list=await bridge.list({browser:'opera'}),started=performance.now();
      const result=await bridge.openTab({snapshot:list.snapshot,url},{activityScope:Symbol('open-'+trial)});
      assert.equal(result.status,'opened',JSON.stringify(compact(result)));assert.equal(result.verified,true);assert.equal(result.observation.complete,true);assert.equal(result.observation.url,url);
      await verify(url,`Owned proof opened ${trial}`);assert.equal(received.filter(path=>path===`/opened-${trial}`).length,1);addRow('open_tab',started,result,{trial,singleCreation:true});
    }
    phase='workflow';
    const startURL=`${origin}/workflow-start-1`,created=await cdp.call('Target.createTarget',{url:startURL});await cdp.call('Target.activateTarget',{targetId:created.targetId});const before=await observe(startURL);
    const dispatch=async(name,args,context)=>{
      if(name==='browser_list_tabs')return bridge.list(args,context);
      if(name==='browser_read_page')return bridge.observePage(args,context);
      if(name==='browser_follow_link')return bridge.followLink(args,context);
      if(name==='browser_open_tab')return bridge.openTab(args,context);
      throw Error('Unexpected tool in owned browser workflow: '+name);
    };
    const scope={kind:'browser',hostname:'mitch-navigation.test',browser:'opera',title:'Mitch workflow start'};
    const workflow={version:1,steps:[{op:'bind',target:scope},{op:'follow_link',target:target('link','Open report'),completion:[exists('heading','Report ready')]}],completion:[exists('heading','Report ready')]};
    let started=performance.now(),result=await runGuardedTaskProgram({program:workflow,dispatch,context:{activityScope:Symbol('workflow-navigation')}});
    assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);assert.equal(result.observation.complete,true);assert.notEqual(result.observation.document_id,before.document_id);await verify(`${origin}/workflow-done-1`,'Owned proof workflow-done 1');addRow('workflow_follow_link',started,result);
    const openWorkflow={version:1,steps:[{op:'bind',target:{...scope,title:'Explicit owned new page',open_if_missing:true,url:`${origin}/workflow-opened-1`}}],completion:[exists('heading','New page ready')]};
    started=performance.now();result=await runGuardedTaskProgram({program:openWorkflow,dispatch,context:{activityScope:Symbol('workflow-open')}});
    assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);assert.equal(result.observation.complete,true);await verify(`${origin}/workflow-opened-1`,'Owned proof workflow-opened 1');addRow('workflow_open_tab',started,result);
    const finalTargets=await cdp.call('Target.getTargets');assert.ok(finalTargets.targetInfos.some(row=>row.targetId===control.targetId&&row.url===controlURL));report.controlRetained=true;
    report.summary=Object.fromEntries([...new Set(report.rows.map(row=>row.kind))].map(kind=>{const values=report.rows.filter(row=>row.kind===kind).map(row=>row.totalMs).sort((a,b)=>a-b);return [kind,{trials:values.length,medianMs:values[Math.floor(values.length/2)],minMs:values[0],maxMs:values.at(-1)}];}));
    report.note='Local browser and workflow execution, including independent readback; scripted requests exclude speech and model latency. These fixtures do not estimate arbitrary-task accuracy.';report.status='passed';
  }catch(error){
    report.status=error.unavailable?'unavailable':'failed';report.phase=phase;report.error=String(error.message||error).replaceAll(token||'__none__','[REDACTED]').slice(0,1600);if(error.code)report.code=error.code;
    if(bridge)report.bridgeStatus=bridge.status();
    if(cdp&&phase==='open-tab')try{report.ownedOpenTargets=(await cdp.call('Target.getTargets')).targetInfos.filter(row=>row.type==='page').map(row=>({url:row.url,title:row.title}));}catch{}
    if(cdp&&phase==='pair')try{
      const targets=(await cdp.call('Target.getTargets')).targetInfos;report.ownedDebugTargets=targets.map(row=>({type:row.type,url:row.url}));
      const worker=targets.find(row=>row.type==='service_worker'&&row.url===`chrome-extension://${extension.extensionId}/worker.js`);
      if(worker){const {sessionId}=await cdp.call('Target.attachToTarget',{targetId:worker.targetId,flatten:true});const diagnostic=await cdp.call('Runtime.evaluate',{expression:'({version:chrome.runtime.getManifest().version,port:globalThis.MITCH_BROWSER_CONFIG?.port,ready:typeof ready!=="undefined"?ready:null,status:typeof status!=="undefined"?status:null,browser:typeof browserName==="function"?browserName():null})',returnByValue:true},sessionId);report.workerDiagnostic=diagnostic.result?.value;await cdp.call('Target.detachFromTarget',{sessionId});}
    }catch(diagnosticError){report.diagnosticError=String(diagnosticError.message).replaceAll(token||'__none__','[REDACTED]').slice(0,500);}
  }
  finally{
    if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.disconnect();}
    if(child&&child.exitCode===null&&child.signalCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null&&child.signalCode===null)child.kill();}
    if(bridge)await bridge.stop();if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    if(extension)try{fs.unlinkSync(path.join(extension.directory,'config.js'));}catch{}token='';
    if(profile)try{if(!insideOwnedProfile(profile))throw Error('Unexpected disposable profile cleanup location.');fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});report.ownedProfileRemoved=true;}catch(error){report.ownedProfileRemoved=false;report.cleanupError=String(error.message).slice(0,250);}
    report.browserPaired=browserReady;report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,summary:report.summary,ownedProfileRemoved:report.ownedProfileRemoved,report:reportFile}));process.exitCode=report.status==='passed'?0:report.status==='unavailable'?2:1;
  }
}
if(require.main===module)run().catch(error=>{console.error(String(error.message));process.exitCode=1;});
module.exports={run};
