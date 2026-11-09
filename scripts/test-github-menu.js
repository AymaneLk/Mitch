'use strict';
// Opt-in real extension test. CDP setup/readback is confined to a disposable
// browser profile created by this process, never the user's browser.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {WebSocket}=require('ws');
const {BrowserBridge}=require('../browser-bridge');
const {prepareBrowserExtension}=require('../browser-install');
const {PlanTaskGuard}=require('../plan-task-guard');
const root=path.resolve(__dirname,'..'),outputRoot=path.join(root,'test-output'),reportFile=path.join(outputRoot,'github-menu-integration.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rounded=value=>Math.round(value*100)/100;
const unavailable=(message,code='browser_test_unavailable')=>Object.assign(Error(message),{unavailable:true,code});
const target=(role,name)=>({role,name,match:'exact'});
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
function insideOwnedProfile(directory){const resolved=path.resolve(directory),parent=path.resolve(outputRoot);return path.dirname(resolved).toLowerCase()===parent.toLowerCase()&&/^github-menu-profile-[A-Za-z0-9]+$/.test(path.basename(resolved))&&!fs.lstatSync(resolved).isSymbolicLink()&&path.dirname(fs.realpathSync(resolved)).toLowerCase()===fs.realpathSync(parent).toLowerCase();}
function compact(result){return {status:result?.status,verified:result?.verified,completed:result?.completed,attempted:result?.attempted,reason:result?.reason,source_reason:result?.source_reason,recovery_required:result?.recovery_required,outcome_unknown:result?.outcome_unknown,input_suppressed:result?.input_suppressed,stop_task:result?.stop_task,stats:result?.stats,steps:result?.steps,delivered_steps:result?.delivered_steps,observation:result?.observation&&{url:result.observation.url,document_id:result.observation.document_id,complete:result.observation.complete,controls:result.observation.controls},completion:result?.completion};}

async function run(){
  fs.mkdirSync(outputRoot,{recursive:true});
  const report={status:'running',version:require('../package.json').version,startedAt:new Date().toISOString(),scope:'Real Opera GX extension recovery from a GitHub-like profile menu with a mismatched next selector, then full-document navigation. Disposable profile and local owned fixture only. CDP performs fixture setup and independent readback. No user profile, pages, credentials, screenshots or model API calls.',rows:[],checks:[],modelRequests:0};
  let profile,extension,bridge,server,child,cdp,token='',phase='prepare',browserReady=false;
  const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
  try{
    const executables=[String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\138.0.6044.65\opera.exe`,String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX\opera.exe`],executable=executables.find(file=>fs.existsSync(file));
    if(!executable)throw unavailable('The expected Opera GX executable is not installed.');
    if(fs.realpathSync(outputRoot).toLowerCase()!==path.join(fs.realpathSync(root),'test-output').toLowerCase())throw Error('test-output must remain inside this workspace.');
    profile=fs.mkdtempSync(path.join(outputRoot,'github-menu-profile-'));assert.ok(insideOwnedProfile(profile));report.ownedProfile=profile;
    const userData=path.join(profile,'user-data');fs.mkdirSync(userData);token=randomBytes(32).toString('base64url');
    extension=prepareBrowserExtension({source:path.join(root,'browser-extension'),destination:path.join(profile,'extension'),token,port:22134});
    // Only this generated temporary manifest receives owned fixture permission.
    const manifestPath=path.join(extension.directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
    manifest.host_permissions=[...new Set([...(manifest.host_permissions||[]),'http://mitch-github.test/*','http://127.0.0.1/*'])];fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    bridge=new BrowserBridge({token,extensionId:extension.extensionId,port:22134,timeoutMs:15000});
    try{await bridge.start();}catch(error){if(error.code==='EADDRINUSE')throw unavailable('Test port 22134 is already occupied; no existing bridge will be replaced.','port_in_use');throw error;}
    const html=fs.readFileSync(path.join(root,'tests/github-menu-fixture.html'));
    server=http.createServer((req,res)=>{if(!/^(?:127\.0\.0\.1|mitch-github\.test):[0-9]+$/.test(String(req.headers.host||''))){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(req.url==='/control'?'<!doctype html><title>Unrelated owned control tab</title><h1>Unrelated control</h1>':html);});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;
    phase='launch';console.log(JSON.stringify({phase:'Launching disposable Opera GitHub-menu fixture'}));save();
    const args=[`--user-data-dir=${userData}`,`--load-extension=${extension.directory}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-default-apps','--disable-background-networking','--no-proxy-server','--host-resolver-rules=MAP mitch-github.test 127.0.0.1','--new-window','about:blank'];
    if(process.argv.includes('--headless'))args.unshift('--headless=new');child=spawn(executable,args,{windowsHide:true,stdio:'ignore',shell:false});let launchError;child.once('error',error=>{launchError=error;});
    const endpointFile=path.join(userData,'DevToolsActivePort');
    const endpoint=await waitFor(()=>{if(launchError)throw launchError;if(!fs.existsSync(endpointFile))return null;const [portLine,browserPath]=fs.readFileSync(endpointFile,'utf8').trim().split(/\r?\n/),debugPort=Number(portLine);if(!Number.isInteger(debugPort)||debugPort<1024||debugPort>65535||!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(browserPath))throw unavailable('Invalid endpoint in disposable profile.');return `ws://127.0.0.1:${debugPort}${browserPath}`;},20000,'New disposable Opera profile did not expose debugging.');
    cdp=new OwnedCDP(endpoint);await cdp.connect();report.browserProduct=(await cdp.call('Browser.getVersion')).product;report.headless=process.argv.includes('--headless');
    phase='pair';await waitFor(()=>{const status=bridge.status();return status.connected===1&&status.browsers.length===1&&status.browsers[0]==='opera';},20000,'Disposable test extension did not pair.');browserReady=true;
    const fixtureURL=`http://mitch-github.test:${port}/dashboard`,control=await cdp.call('Target.createTarget',{url:`http://127.0.0.1:${port}/control`}),fixture=await cdp.call('Target.createTarget',{url:fixtureURL});
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
    assert.equal(await evaluate('window.resetFixture()'),true);
    const context={activityScope:Symbol('owned-github-menu-task')},guard=new PlanTaskGuard();
    const issue=args=>guard.run('browser_execute_plan',context,()=>bridge.executePagePlan(args,context),args);
    const page=await observe(),initial=await read();
    assert.ok(page.controls.some(control=>control.role==='button'&&control.name==='Open user navigation menu'));
    phase='partial-menu-plan';
    const incorrect={snapshot:page.snapshot,steps:[
      {op:'click',target:target('button','Open user navigation menu')},
      {op:'click',target:target('link','Repositories'),timeout_ms:200}
    ],completion:[{target:target('heading','Your repositories'),condition:'exists'}]};
    const started=performance.now(),partial=await issue(incorrect);
    report.rows.push({phase,totalMs:rounded(performance.now()-started),result:compact(partial)});save();
    assert.equal(partial.status,'interrupted');assert.equal(partial.recovery_required,true);
    assert.notEqual(partial.outcome_unknown,true,'A known delivered menu click is not a lost input outcome.');
    assert.equal(partial.completed,1);assert.equal(partial.attempted,1);
    assert.ok(partial.observation?.controls.some(control=>control.role==='link'&&control.name==='Your repositories'),'Recovery must return the full actual menu, not only the empty mismatched selector.');
    assert.ok(partial.delivered_steps?.some(step=>step.op==='click'&&step.target?.name==='Open user navigation menu'),'The partial result must preserve the delivered prefix.');
    let actual=await read();assert.equal(actual.menuClicks,1);assert.equal(actual.repositoryClicks,0);assert.equal(actual.menuOpen,true);
    const crossed=await guard.run('computer_action',context,()=>assert.fail('A partial browser action must not replay through native input.'),{kind:'click',snapshot:'unused-native-snapshot',control_id:'unused',expected_name:'Open user navigation menu'});
    assert.equal(crossed.input_suppressed,true);assert.equal(crossed.code,'cross_route_replay_blocked');
    report.checks.push({name:'partial browser prefix cannot replay through native input',result:compact(crossed)});
    phase='prefix-replay-guard';
    const fresh=await observe(),blocked=await issue({...incorrect,snapshot:fresh.snapshot});
    assert.equal(blocked.input_suppressed,true,'A freshly observed snapshot cannot authorize replay of the delivered profile click.');
    actual=await read();assert.equal(actual.menuClicks,1);assert.equal(actual.menuOpen,true);
    report.checks.push({name:'delivered menu prefix is blocked across plans',result:compact(blocked)});save();
    phase='resume-to-full-navigation';
    const navigation={snapshot:fresh.snapshot,steps:[{op:'click',target:target('link','Your repositories')},{op:'wait',target:target('heading','Your repositories'),condition:'exists',timeout_ms:2000}],completion:[{target:target('heading','Your repositories'),condition:'exists'}]};
    const navigationStarted=performance.now(),navigated=await issue(navigation);
    report.rows.push({phase,totalMs:rounded(performance.now()-navigationStarted),result:compact(navigated)});save();
    await waitFor(async()=>{try{return await evaluate("location.pathname==='/repositories'&&Boolean(window.fixtureState)");}catch{return false;}},5000,'Owned repository document did not load.');
    actual=await read();assert.equal(actual.menuClicks,1);assert.equal(actual.repositoryClicks,1);assert.equal(actual.repositoryLoads,1);assert.notEqual(actual.documentMarker,initial.documentMarker,'The result must be a newly loaded document, not an SPA render.');
    assert.equal(navigated.outcome_unknown,true,'Lost page messaging must remain uncertain even after read-only recovery.');
    assert.equal(navigated.recovery_required,true);
    assert.ok(navigated.observation?.controls.some(control=>control.role==='heading'&&control.name==='Your repositories'),'A recovered destination observation must be available for read-only task completion review.');
    assert.equal(new URL(navigated.observation.url).pathname,'/repositories');
    phase='unknown-result-replay-guard';
    const replay=await issue({...navigation,snapshot:navigated.observation.snapshot});
    assert.equal(replay.input_suppressed,true);assert.equal(replay.stop_task,true);
    actual=await read();assert.equal(actual.repositoryClicks,1);assert.equal(actual.repositoryLoads,1);
    report.checks.push({name:'unknown navigation cannot dispatch another input',result:compact(replay)});
    report.independentReadback={...actual,documentMarkerChanged:true};
    const targets=await cdp.call('Target.getTargets');assert.ok(targets.targetInfos.some(item=>item.targetId===control.targetId&&item.url===`http://127.0.0.1:${port}/control`),'Unrelated owned control tab must remain.');report.controlRetained=true;
    report.summary={menuClicks:actual.menuClicks,repositoryClicks:actual.repositoryClicks,repositoryLoads:actual.repositoryLoads,fullDocumentNavigation:true,partialPlanRecovered:true,replayedInputs:0,actualModelRequests:0,note:'Controlled real-browser regression for a menu-label mismatch and navigation acknowledgement loss. Does not access a real GitHub account or estimate arbitrary-task accuracy.'};report.status='passed';
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
