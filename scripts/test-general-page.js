'use strict';
// Opt-in real extension test. CDP setup/readback is confined to a disposable
// browser profile created by this process, never the user's browser.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {WebSocket}=require('ws');
const {BrowserBridge}=require('../browser-bridge');
const {prepareBrowserExtension}=require('../browser-install');
const root=path.resolve(__dirname,'..'),outputRoot=path.join(root,'test-output'),reportFile=path.join(outputRoot,'general-page-integration.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rounded=value=>Math.round(value*100)/100;
const unavailable=(message,code='browser_test_unavailable')=>Object.assign(Error(message),{unavailable:true,code});
const target=(role,name)=>({role,name,match:'exact'});
const plan={steps:[
  {op:'fill',target:target('textbox','Search'),text:'Alpha'},
  {op:'click',target:target('button','Search')},
  {op:'wait',target:target('button','Edit first result'),condition:'exists',timeout_ms:2500},
  {op:'click',target:target('button','Edit first result')},
  {op:'fill',target:target('textbox','Name'),text:'Alpha revised'},
  {op:'click',target:target('button','Save')},
  {op:'assert',target:target('button','Saved Alpha revised'),condition:'exists'}
],completion:[{target:target('button','Saved Alpha revised'),condition:'exists'}]};
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
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`Owned browser timed out during ${method}.`));},7000);this.pending.set(id,{resolve,reject,timer,method});this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  }
  disconnect(){this.socket?.terminate();}
}
async function waitFor(predicate,timeoutMs,message){const deadline=Date.now()+timeoutMs;do{const value=await predicate();if(value)return value;await delay(50);}while(Date.now()<deadline);throw unavailable(message);}
function insideOwnedProfile(directory){const resolved=path.resolve(directory),parent=path.resolve(outputRoot);return path.dirname(resolved).toLowerCase()===parent.toLowerCase()&&/^general-page-profile-[A-Za-z0-9]+$/.test(path.basename(resolved))&&!fs.lstatSync(resolved).isSymbolicLink()&&path.dirname(fs.realpathSync(resolved)).toLowerCase()===fs.realpathSync(parent).toLowerCase();}
function compact(result){return {status:result?.status,verified:result?.verified,completed:result?.completed,attempted:result?.attempted,reason:result?.reason,stats:result?.stats,steps:result?.steps,completion:result?.completion};}

async function run(){
  fs.mkdirSync(outputRoot,{recursive:true});
  const report={status:'running',version:require('../package.json').version,startedAt:new Date().toISOString(),scope:'Real Opera GX extension DOM plan execution on one local test page in a new disposable profile. The fixture recreates its controls between stages. Exact test-host permission is granted only in the temporary extension manifest. No user pages, saved profile, microphone, screenshots or model API calls. CDP only sets up and reads back owned fixtures.',rows:[],checks:[],modelRequests:0};
  let profile,extension,bridge,server,child,cdp,token='',phase='prepare',browserReady=false;
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  try{
    const executables=[String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\138.0.6044.65\opera.exe`,String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\opera.exe`],executable=executables.find(file=>fs.existsSync(file));
    if(!executable)throw unavailable('The expected Opera GX executable is not installed.');
    if(fs.realpathSync(outputRoot).toLowerCase()!==path.join(fs.realpathSync(root),'test-output').toLowerCase())throw Error('test-output must remain inside this workspace.');
    profile=fs.mkdtempSync(path.join(outputRoot,'general-page-profile-'));assert.ok(insideOwnedProfile(profile));report.ownedProfile=profile;
    const userData=path.join(profile,'user-data');fs.mkdirSync(userData);token=randomBytes(32).toString('base64url');
    extension=prepareBrowserExtension({source:path.join(root,'browser-extension'),destination:path.join(profile,'extension'),token,port:22134});
    // Only this generated temporary manifest receives owned fixture permission.
    const manifestPath=path.join(extension.directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    manifest.host_permissions=[...new Set([...(manifest.host_permissions||[]),'http://mitch-plan.test/*','http://127.0.0.1/*'])];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    bridge=new BrowserBridge({token,extensionId:extension.extensionId,port:22134,timeoutMs:15000});
    try{await bridge.start();}catch(error){if(error.code==='EADDRINUSE')throw unavailable('Test port 22134 is already occupied; no existing bridge will be replaced.','port_in_use');throw error;}
    const html=fs.readFileSync(path.join(root,'tests/general-plan-fixture.html'));
    server=http.createServer((req,res)=>{if(!/^(?:127\.0\.0\.1|mitch-plan\.test):[0-9]+$/.test(String(req.headers.host||''))){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;
    phase='launch';console.log(JSON.stringify({phase:'Launching disposable Opera general-plan fixture'}));save();
    const args=[`--user-data-dir=${userData}`,`--load-extension=${extension.directory}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-default-apps','--disable-background-networking','--no-proxy-server','--host-resolver-rules=MAP mitch-plan.test 127.0.0.1','--new-window','about:blank'];
    if(process.argv.includes('--headless'))args.unshift('--headless=new');child=spawn(executable,args,{windowsHide:true,stdio:'ignore',shell:false});let launchError;child.once('error',error=>{launchError=error;});
    const endpointFile=path.join(userData,'DevToolsActivePort');
    const endpoint=await waitFor(()=>{if(launchError)throw launchError;if(!fs.existsSync(endpointFile))return null;const [portLine,browserPath]=fs.readFileSync(endpointFile,'utf8').trim().split(/\r?\n/),debugPort=Number(portLine);if(!Number.isInteger(debugPort)||debugPort<1024||debugPort>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath))throw unavailable('Invalid endpoint in disposable profile.');return `ws://127.0.0.1:${debugPort}${browserPath}`;},20000,'New disposable Opera profile did not expose debugging.');
    cdp=new OwnedCDP(endpoint);await cdp.connect();report.browserProduct=(await cdp.call('Browser.getVersion')).product;report.headless=process.argv.includes('--headless');
    phase='pair';await waitFor(()=>{const status=bridge.status();return status.connected===1&&status.browsers.length===1&&status.browsers[0]==='opera';},20000,'Disposable test extension did not pair.');browserReady=true;
    const fixtureURL=`http://mitch-plan.test:${port}/fixture`,control=await cdp.call('Target.createTarget',{url:`http://127.0.0.1:${port}/control`}),fixture=await cdp.call('Target.createTarget',{url:fixtureURL});
    await cdp.call('Target.activateTarget',{targetId:fixture.targetId});
    const {sessionId}=await cdp.call('Target.attachToTarget',{targetId:fixture.targetId,flatten:true});
    const evaluate=async expression=>{const output=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(output.exceptionDetails)throw Error('Owned fixture evaluation failed.');return output.result?.value;};
    await waitFor(()=>evaluate('Boolean(window.fixtureState)'),5000,'Owned fixture did not become ready.');
    const read=()=>evaluate('JSON.parse(JSON.stringify(window.fixtureState))');
    const observe=async()=>{
      const deadline=Date.now()+2000;let last;
      do{
        const list=await bridge.list({browser:'opera'}),matches=list.tabs.filter(tab=>tab.url===fixtureURL);
        assert.equal(matches.length,1,'Only one exact owned fixture tab may be selected.');
        // An owned iframe can briefly make the tab report loading after reset.
        // Repeating a read refused before input is safe; plans are never retried.
        if(matches[0].navigating)last={status:'refused',code:'stale_target',message:'Owned fixture tab is navigating.'};
        else{
          const page=await bridge.observePage({snapshot:list.snapshot,tab_id:matches[0].tab_id});
          if(page.status==='observed'){assert.equal(page.complete,true,'Owned fixture must provide a complete observation.');return page;}
          last={status:page.status,code:page.code||page.reason,message:page.message};
          assert.ok(page.status==='refused'&&last.code==='stale_target'&&page.action_attempted===false,'Unexpected fixture read refusal: '+JSON.stringify(last));
        }
        await delay(50);
      }while(Date.now()<deadline);
      assert.fail('Owned fixture read did not settle within two seconds: '+JSON.stringify(last));
    };
    const reset=async mode=>{assert.equal(await evaluate(`window.resetFixture(${JSON.stringify(mode)})`),true);return observe();};
    phase='trials';
    for(let trial=1;trial<=5;trial++){
      const page=await reset('normal');assert.ok(page.controls.some(control=>control.name==='Search'));assert.ok(!page.controls.some(control=>control.name==='Edit first result'),'The plan must contain a future control.');
      const started=performance.now(),result=await bridge.executePagePlan({snapshot:page.snapshot,...plan},{activityScope:Symbol(`page-plan-${trial}`)}),totalMs=rounded(performance.now()-started);
      assert.equal(result.status,'completed',JSON.stringify(compact(result)));assert.equal(result.verified,true);
      const actual=await read();assert.equal(actual.query,'Alpha');assert.equal(actual.savedName,'Alpha revised');assert.deepEqual(actual.actions,['search','edit','save']);
      report.rows.push({trial,totalMs,scriptedPlanBatches:1,modelRequests:0,independentFixtureReadback:true,result:compact(result)});save();console.log(JSON.stringify({trial,totalMs,verified:true}));
    }
    phase='guards';let page=await reset('ambiguous');
    const duplicate=await bridge.executePagePlan({snapshot:page.snapshot,steps:[{op:'click',target:target('button','Search')}],completion:[{target:target('button','Search'),condition:'absent'}]},{activityScope:Symbol('page-plan-duplicate')});
    assert.equal(duplicate.status,'interrupted');assert.deepEqual((await read()).actions,[]);report.checks.push({name:'duplicate named controls are refused before clicking',result:compact(duplicate)});
    page=await reset('frame');
    const frame=await bridge.executePagePlan({snapshot:page.snapshot,steps:[{op:'click',target:target('button','Child-only action')}],completion:[{target:target('button','Child-only action'),condition:'absent'}]},{activityScope:Symbol('page-plan-frame')});
    assert.equal(frame.status,'interrupted');assert.deepEqual((await read()).actions,[]);report.checks.push({name:'unsupported child-frame target is not guessed',result:compact(frame)});
    page=await reset('normal');const abort=new AbortController();
    const pending=bridge.executePagePlan({snapshot:page.snapshot,steps:[{op:'fill',target:target('textbox','Search'),text:'Stop after fill'},{op:'wait',target:target('button','Never created'),condition:'exists',timeout_ms:5000},{op:'click',target:target('button','Search')}],completion:[{target:target('button','Edit first result'),condition:'exists'}]},{activityScope:Symbol('page-plan-cancel'),signal:abort.signal}).then(result=>({result:compact(result)}),error=>({code:error.code,message:error.message}));
    await waitFor(()=>evaluate("document.getElementById('field')?.value==='Stop after fill'"),5000,'Cancellation fixture did not reach its first delivered fill.');abort.abort();const stopped=await pending;
    await delay(200);assert.deepEqual((await read()).actions,[]);assert.equal(await evaluate("document.getElementById('field').value"),'Stop after fill');report.checks.push({name:'mid-plan cancellation prevents subsequent click',...stopped});
    const targets=await cdp.call('Target.getTargets');assert.ok(targets.targetInfos.some(item=>item.targetId===control.targetId&&item.url===`http://127.0.0.1:${port}/control`),'Unrelated owned control tab must remain.');report.controlRetained=true;
    const sorted=report.rows.map(row=>row.totalMs).sort((a,b)=>a-b);report.summary={trials:sorted.length,medianLocalPlanMs:sorted[Math.floor(sorted.length/2)],minLocalPlanMs:sorted[0],maxLocalPlanMs:sorted.at(-1),actualModelRequests:0,note:'Measured extension/DOM execution including fixture loading delay. Scripted plans exclude cloud planning latency; these fixtures do not estimate accuracy on arbitrary user tasks.'};report.status='passed';
  }catch(error){report.status=error.unavailable?'unavailable':'failed';report.phase=phase;report.error=String(error.message||error).replaceAll(token||'__none__','[REDACTED]').slice(0,1000);if(error.code)report.code=error.code;}
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
