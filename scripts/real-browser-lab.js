'use strict';
// Real public websites in an owned Opera profile. CDP is only the test harness:
// setup, consent dismissal, cleanup and independent readback. Mitch executes
// timed tasks through its actual extension and guarded dispatcher.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),{WebSocket}=require('ws');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'test-output');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,ms,label){const end=Date.now()+ms;let last;do{try{const value=await fn();if(value)return value;}catch(error){last=error;}await delay(100);}while(Date.now()<end);throw Error(label+(last?': '+last.message:''));}
class CDP{
  constructor(url){this.url=url;this.pending=new Map();this.serial=0;this.listeners=new Set();}
  async connect(){this.ws=new WebSocket(this.url);this.ws.on('error',()=>{});this.ws.on('message',bytes=>{let m;try{m=JSON.parse(bytes);}catch{return;}if(m.method)for(const fn of this.listeners)fn(m);const entry=this.pending.get(m.id);if(!entry)return;this.pending.delete(m.id);clearTimeout(entry.timer);m.error?entry.reject(Error(entry.method+': '+m.error.message)):entry.resolve(m.result);});this.ws.on('close',()=>{for(const e of this.pending.values()){clearTimeout(e.timer);e.reject(Error('Owned browser closed'));}this.pending.clear();});await new Promise((resolve,reject)=>{this.ws.once('open',resolve);this.ws.once('error',reject);});}
  call(method,params={},sessionId,timeout=15000){const id=++this.serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Owned browser timeout: '+method));},timeout);this.pending.set(id,{resolve,reject,timer,method});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
  close(){this.ws?.terminate();}
}
async function start({source=ROOT}={}){
  fs.mkdirSync(OUT,{recursive:true});assert.equal(fs.realpathSync(OUT).toLowerCase(),path.join(fs.realpathSync(ROOT),'test-output').toLowerCase());
  const profile=fs.mkdtempSync(path.join(OUT,'real-web-profile-')),userData=path.join(profile,'user-data');fs.mkdirSync(userData);
  const token=randomBytes(32).toString('base64url'),{prepareBrowserExtension}=require(path.join(source,'browser-install')),{BrowserBridge}=require(path.join(source,'browser-bridge'));
  const extension=prepareBrowserExtension({source:path.join(source,'browser-extension'),destination:path.join(profile,'extension'),token,port:22134});
  const manifestFile=path.join(extension.directory,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  manifest.host_permissions=['http://*/*','https://*/*'];fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
  const bridge=new BrowserBridge({token,extensionId:extension.extensionId,port:22134,timeoutMs:15000});let child,cdp;
  async function close(){if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.close();}await bridge.stop();if(child&&child.exitCode===null){await Promise.race([new Promise(r=>child.once('exit',r)),delay(1500)]);if(child.exitCode===null)child.kill();}try{fs.unlinkSync(path.join(extension.directory,'config.js'));}catch{}/* Keep only disposable profile evidence; no user profile is touched. */}
  try{
    await bridge.start();const parent=String.raw`C:\Users\aymane\AppData\Local\Programs\Opera GX`,executable=path.join(parent,'opera.exe');assert.ok(fs.existsSync(executable));
    child=spawn(executable,[`--user-data-dir=${userData}`,`--load-extension=${extension.directory}`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-default-apps','--disable-background-networking','--new-window','about:blank'],{windowsHide:true,stdio:'ignore',shell:false});
    const endpoint=await waitFor(()=>{const p=path.join(userData,'DevToolsActivePort');if(!fs.existsSync(p))return;const [port,browser]=fs.readFileSync(p,'utf8').trim().split(/\r?\n/);assert.match(browser,/^\/devtools\/browser\/[\w-]+$/);assert.ok(Number(port)>1024&&Number(port)<65536);return `ws://127.0.0.1:${port}${browser}`;},25000,'Owned Opera endpoint unavailable');
    cdp=new CDP(endpoint);await cdp.connect();await waitFor(()=>bridge.status().connected===1,20000,'Owned extension did not pair');
    const targets=()=>cdp.call('Target.getTargets').then(r=>r.targetInfos.filter(t=>t.type==='page'));
    const sessions=new Map();async function session(id){if(!sessions.has(id))sessions.set(id,cdp.call('Target.attachToTarget',{targetId:id,flatten:true}).then(r=>r.sessionId));return sessions.get(id);}
    async function evaluate(id,expression){assert.ok((await targets()).some(t=>t.targetId===id));const r=await cdp.call('Runtime.evaluate',{expression:auditScript+';'+expression,returnByValue:true,awaitPromise:true,timeout:1000},await session(id),1500);if(r.exceptionDetails)throw Error('Independent browser read failed');return r.result?.value;}
    const audit=[],audited=new Set(),auditScript=`(()=>{if(window.__mitchBenchmarkObserver)return;window.__mitchBenchmarkObserver=true;let timer,last='';const read=()=>{try{const u=new URL(location.href);if(!['www.youtube.com','github.com'].includes(u.hostname))return;const query=u.searchParams.get(u.hostname==='github.com'?'q':'search_query');if(!query)return;const selector=u.hostname==='github.com'?'div.search-title a':'ytd-video-renderer a#video-title';const links=[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length&&!e.closest('ytd-ad-slot-renderer,ytd-promoted-video-renderer')).map(e=>({title:e.textContent.trim(),href:e.href}));if(!links.length)return;const value=JSON.stringify({url:location.href,query,links});if(last!==value){last=value;window.mitchBenchmarkReadback(value);}}catch{}};new MutationObserver(read).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});const frame=()=>{read();requestAnimationFrame(frame);};requestAnimationFrame(frame);read();})()`;
    async function installAudit(id){if(audited.has(id))return;audited.add(id);try{const sid=await session(id);await cdp.call('Page.enable',{},sid);await cdp.call('Runtime.enable',{},sid);await cdp.call('Runtime.addBinding',{name:'mitchBenchmarkReadback'},sid);await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:auditScript},sid);await evaluate(id,auditScript);}catch{}}
    cdp.listeners.add(m=>{if(m.method==='Target.targetCreated'&&m.params.targetInfo.type==='page')void installAudit(m.params.targetInfo.targetId);if(m.method==='Runtime.bindingCalled'&&m.params.name==='mitchBenchmarkReadback')try{const value=JSON.parse(m.params.payload);audit.push(value);if(audit.length>500)audit.shift();}catch{}});
    await cdp.call('Target.setDiscoverTargets',{discover:true});
    async function navigate(id,url){await cdp.call('Page.navigate',{url},await session(id));}
    async function reset(url='https://www.youtube.com/'){const previous=await targets();audit.length=0;const {targetId}=await cdp.call('Target.createTarget',{url});for(const t of previous){await cdp.call('Target.closeTarget',{targetId:t.targetId});sessions.delete(t.targetId);}await cdp.call('Target.activateTarget',{targetId});if(url==='about:blank'){let last;try{await waitFor(async()=>{const list=last=await bridge.list({browser:'opera'});const eligible=list.tabs.filter(t=>!t.pinned);return list.complete&&eligible.length===1&&eligible[0].url==='about:'&&!eligible[0].navigating;},5000,'Owned tab reset');}catch(error){error.message+=' '+JSON.stringify(last?.tabs);throw error;}}return targetId;}
    async function screenshot(id,file){const r=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},await session(id));fs.writeFileSync(file,Buffer.from(r.data,'base64'));}
    return {profile,bridge,cdp,audit,targets,evaluate,navigate,reset,screenshot,close,version:(await cdp.call('Browser.getVersion')).product};
  }catch(error){await close();throw error;}
}
const independent=`(()=>{const visible=e=>!!(e&&e.getClientRects().length),u=new URL(location.href),videos=[...document.querySelectorAll('ytd-video-renderer')].filter(visible).flatMap(e=>{const a=e.querySelector('a#video-title');return a?[{title:a.textContent.trim(),href:a.href}]:[]}),v=document.querySelector('video');return {url:location.href,title:document.title,ready:document.readyState,query:u.searchParams.get('search_query'),heading:document.querySelector('h1')?.textContent.trim(),search:document.querySelector('input[name="search_query"]')?.value,videos:videos.slice(0,8),media:v?{paused:v.paused,currentTime:v.currentTime,readyState:v.readyState,duration:Number.isFinite(v.duration)?v.duration:null,ended:v.ended,ad:!!document.querySelector('.ad-showing,.ad-interrupting')}:null,buttons:[...document.querySelectorAll('button')].filter(visible).slice(0,40).map(e=>({text:e.textContent.trim().slice(0,120),label:e.getAttribute('aria-label')}))};})()`;
async function consent(lab,id){
  const state=await lab.evaluate(id,independent);if(!/consent\.(?:youtube|google)\.com/.test(state.url)&&!state.buttons.some(b=>/Reject all|Tout refuser/i.test(b.text)))return false;
  // Setup only, before task timing: reject optional cookies by observed label.
  const labels=state.buttons.filter(b=>/^(Reject all|Tout refuser)$/.test(b.text));if(labels.length!==1)throw Error('Cookie consent needs an unambiguous Reject all button');
  await lab.evaluate(id,`(()=>{const b=[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(labels[0].text)});if(b.length!==1)throw Error('Consent changed');b[0].click();return true;})()`);return true;
}
module.exports={start,waitFor,delay,independent,consent,ROOT,OUT};
