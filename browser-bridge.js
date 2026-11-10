'use strict';
const http=require('node:http');
const {randomUUID,timingSafeEqual,createHash}=require('node:crypto');
const profileRevision=client=>createHash('sha256').update(JSON.stringify([client.browser,client.clientId,client.sessionId])).digest('hex');
const {WebSocket,WebSocketServer}=require('ws');
const {validatePlan,testCondition,matchControls,normalizeRole}=require('./action-plan');
const {toolDiagnostics}=require('./task-timing');
const publicSites=require('./public-site-task');
const {approveActions}=require('./action-approval');
const BROWSERS=new Set(['opera','chrome','edge']);
const MAX_PAYLOAD=512*1024,MAX_TABS=5000,SNAPSHOT_TTL=30000;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function fault(code,message,attempted=false){return Object.assign(new Error(message),{code,refused:!attempted,...(attempted?{action_attempted:true,outcome_unknown:true}:{})});}
function check(context={}){context.signal?.throwIfAborted();context.assertActive?.();}
function safeURL(value){if(!value)return '';const url=new URL(value);if(!['http:','https:'].includes(url.protocol))return url.protocol;url.username='';url.password='';url.search='';url.hash='';return url.href;}
function inventory(value){
  if(!Array.isArray(value)||value.length>MAX_TABS)throw fault('invalid_browser_result','The browser returned an invalid tab inventory.');
  const ids=new Set();
  return value.map(tab=>{
    if(!tab||!integer(tab.id)||!integer(tab.windowId)||ids.has(tab.id)||typeof tab.url!=='string'||tab.url.length>8192||typeof tab.title!=='string'||tab.title.length>8192||typeof tab.active!=='boolean'||typeof tab.pinned!=='boolean'||tab.incognito!==false||tab.windowType!=='normal'||(tab.pendingUrl!==undefined&&(typeof tab.pendingUrl!=='string'||tab.pendingUrl.length>8192)))throw fault('invalid_browser_result','The browser returned incomplete, duplicate or ineligible tab records.');
    try{safeURL(tab.url);if(tab.pendingUrl)safeURL(tab.pendingUrl);}catch{throw fault('invalid_browser_result','The browser returned an invalid tab URL.');}
    ids.add(tab.id);
    return {id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title,active:tab.active,pinned:tab.pinned,incognito:false,windowType:'normal',...(tab.pendingUrl?{pendingUrl:tab.pendingUrl}:{})};
  });
}
class BrowserBridge {
  constructor({token,extensionId,port=22133,timeoutMs=5000,onStatus,confirm}){
    if(typeof token!=='string'||token.length<32||token.length>512)throw new TypeError('A strong browser pairing token is required.');
    if(typeof extensionId!=='string'||!/^[a-p]{32}$/.test(extensionId))throw new TypeError('Invalid browser extension identity.');
    if(!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(timeoutMs)||timeoutMs<20||timeoutMs>30000)throw new TypeError('Invalid browser bridge limits.');
    Object.assign(this,{token,extensionId,port,timeoutMs,onStatus,confirm});this.clients=new Set();this.sockets=new Set();this.pending=new Map();this.snapshots=new Map();this.pageSnapshots=new Map();this.partialPlans=new Map();this.uncertain=new Map();this.defaultScope=Symbol('browser-bridge');this.server=null;this.started=false;
  }
  status(){const clients=[...this.clients].filter(client=>client.ws.readyState===WebSocket.OPEN);return {running:this.started,port:this.port,connected:clients.length,pageCapable:clients.filter(client=>client.pages).length,pageAccess:clients.filter(client=>client.pages&&client.pageAccess).length,recoveryCapable:clients.filter(client=>client.pageRecovery).length,navigationCapable:clients.filter(client=>client.pageNavigation).length,publicSiteCapable:clients.filter(client=>client.publicSites).length,browsers:[...new Set(clients.map(client=>client.browser))]};}
  publishStatus(){try{this.onStatus?.(this.status());}catch{}}
  async start(){
    if(this.started)return this.status();
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      this.wss=new WebSocketServer({noServer:true,maxPayload:MAX_PAYLOAD,perMessageDeflate:false});
      this.server=http.createServer((_req,res)=>{res.writeHead(404,{'Content-Length':'0'});res.end();});
      this.server.on('upgrade',(req,socket,head)=>{
        const allowed=req.method==='GET'&&req.url==='/mitch-browser'&&req.headers.host===`127.0.0.1:${this.port}`&&req.headers.origin===`chrome-extension://${this.extensionId}`&&req.socket.remoteAddress==='127.0.0.1';
        if(!allowed){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
        this.wss.handleUpgrade(req,socket,head,ws=>this.connect(ws));
      });
      await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(this.port,'127.0.0.1',()=>{this.server.removeListener('error',reject);this.port=this.server.address().port;resolve();});});
      this.started=true;
      this.publishStatus();
      this.heartbeat=setInterval(()=>{for(const ws of this.sockets){if(ws.mitchAlive===false){ws.terminate();continue;}ws.mitchAlive=false;if(ws.readyState===WebSocket.OPEN)ws.ping();}},20000);this.heartbeat.unref();
      return this.status();
    })();
    try{return await this.starting;}catch(error){await this.stop();throw error;}finally{this.starting=null;}
  }
  connect(ws){
    const client={ws,ready:false,epoch:0};this.sockets.add(ws);ws.mitchAlive=true;
    const authTimer=setTimeout(()=>ws.close(1008,'Authentication required'),5000);authTimer.unref();
    ws.on('pong',()=>{ws.mitchAlive=true;});
    ws.on('error',()=>{});
    ws.on('close',()=>{clearTimeout(authTimer);this.sockets.delete(ws);this.clients.delete(client);this.invalidate(client);this.publishStatus();for(const pending of [...this.pending.values()])if(pending.client===client)pending.fail(fault('browser_disconnected','The browser connection closed.',pending.mutation&&pending.sent));});
    ws.on('message',(bytes,binary)=>{
      let message;try{if(binary)throw Error();message=JSON.parse(bytes.toString('utf8'));if(!message||typeof message!=='object'||Array.isArray(message))throw Error();}catch{ws.close(1008,'Invalid protocol message');return;}
      if(!client.ready){
        const supplied=typeof message.token==='string'?Buffer.from(message.token):Buffer.alloc(0),expected=Buffer.from(this.token);
        if(message.type!=='hello'||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)||!id(message.clientId)||!id(message.sessionId)||!BROWSERS.has(message.browser)){ws.close(1008,'Pairing failed');return;}
        clearTimeout(authTimer);Object.assign(client,{ready:true,clientId:message.clientId,sessionId:message.sessionId,browser:message.browser,pages:Array.isArray(message.capabilities)&&message.capabilities.includes('pages'),pageAccess:message.pageAccess===true,pageRecovery:Array.isArray(message.capabilities)&&message.capabilities.includes('page-recovery-v1'),pageNavigation:Array.isArray(message.capabilities)&&message.capabilities.includes('page-navigation-v1'),publicSites:Array.isArray(message.capabilities)&&message.capabilities.includes('public-sites-v1')});
        // A new connection for this exact profile supersedes its old socket.
        for(const old of this.clients)if(old.clientId===client.clientId&&old.browser===client.browser){this.clients.delete(old);this.invalidate(old);old.ws.close(1000,'Profile reconnected');}
        this.clients.add(client);ws.send(JSON.stringify({type:'ready'}));this.publishStatus();return;
      }
      // JS-visible traffic also keeps the extension service worker alive;
      // control-frame pings alone only prove that the socket is responsive.
      if(message.type==='ping'&&Object.keys(message).length===1){ws.send(JSON.stringify({type:'pong'}));return;}
      if(message.type==='pong'&&Object.keys(message).length===1)return;
      if(message.type==='page_access'&&typeof message.enabled==='boolean'&&Object.keys(message).length===2){client.pageAccess=message.enabled;if(!message.enabled)for(const [key,entry]of this.pageSnapshots)if(entry.client===client)this.pageSnapshots.delete(key);this.publishStatus();return;}
      if(message.type!=='result'||!id(message.id)){ws.close(1008,'Invalid result message');return;}
      const pending=this.pending.get(message.id);
      if(!pending)return; // Late cancelled results never execute or settle another operation.
      if(pending.client!==client){ws.close(1008,'Wrong request owner');return;}
      pending.succeed(message.result);
    });
  }
  invalidate(client){client.epoch++;for(const map of [this.snapshots,this.pageSnapshots])for(const [key,snapshot] of map)if(snapshot.client===client)map.delete(key);}
  client(browser){
    if(browser!==undefined&&!BROWSERS.has(browser))throw fault('invalid_browser','Choose Opera, Chrome or Edge.');
    const matches=[...this.clients].filter(client=>(browser===undefined||client.browser===browser)&&client.ws.readyState===WebSocket.OPEN);
    if(matches.length===0)throw fault('browser_unavailable',browser?`The Mitch browser extension is not connected in ${browser}.`:'The Mitch browser extension is not connected.');
    if(matches.length!==1)throw fault('ambiguous_browser','More than one browser profile is connected. Select one profile before acting.');
    return matches[0];
  }
  request(client,method,args,context={},mutation=false,timeoutMs=this.timeoutMs){
    check(context);
    if(!this.clients.has(client)||client.ws.readyState!==WebSocket.OPEN)throw fault('browser_disconnected','The browser connection is unavailable.');
    const requestId=randomUUID(),deadline=Date.now()+timeoutMs;
    return new Promise((resolve,reject)=>{
      let settled=false,timer;
      const pending={client,mutation,sent:false};
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);context.signal?.removeEventListener('abort',aborted);this.pending.delete(requestId);error?reject(error):resolve(result);};
      const cancel=()=>{if(pending.sent&&client.ws.readyState===WebSocket.OPEN)try{client.ws.send(JSON.stringify({type:'cancel',id:requestId}));}catch{}};
      const aborted=()=>{cancel();finish(fault('browser_cancelled','The browser operation was stopped.',mutation&&pending.sent));};
      pending.fail=error=>finish(error);pending.succeed=result=>{try{check(context);finish(null,result);}catch{aborted();}};
      this.pending.set(requestId,pending);
      context.signal?.addEventListener('abort',aborted,{once:true});
      timer=setTimeout(()=>{cancel();finish(fault('browser_timeout','The browser operation did not finish before its deadline.',mutation&&pending.sent));},timeoutMs);timer.unref();
      try{check(context);pending.sent=true;client.ws.send(JSON.stringify({id:requestId,type:'command',method,args,deadline}),error=>{if(error)finish(fault('browser_disconnected','The browser command could not be confirmed.',mutation));});}
      catch(error){finish(error.action_attempted?error:fault('browser_cancelled','The browser operation could not be dispatched.',mutation&&pending.sent));}
    });
  }
  observe(client,tabs){
    const snapshot=randomUUID();
    for(const [key,entry] of this.snapshots)if(Date.now()-entry.created>SNAPSHOT_TTL)this.snapshots.delete(key);
    if(this.snapshots.size>=128)this.snapshots.delete(this.snapshots.keys().next().value);
    this.snapshots.set(snapshot,{client,sessionId:client.sessionId,created:Date.now(),tabs:new Map(tabs.map(tab=>[tab.id,tab]))});
    return {status:'ok',snapshot,browser:client.browser,session_id:client.sessionId,profile_revision:profileRevision(client),complete:true,tabs:tabs.map(tab=>({tab_id:tab.id,window_id:tab.windowId,url:safeURL(tab.url),title:tab.title.slice(0,500),active:tab.active,pinned:tab.pinned,...(tab.pendingUrl?{navigating:true}:{})}))};
  }
  async list({browser}={},context={}){
    check(context);const client=this.client(browser),epoch=client.epoch;
    if([...this.pending.values()].some(request=>request.client===client&&request.mutation))throw fault('browser_busy','Wait for the current browser operation to finish.');
    const result=await this.request(client,'tabs.list',{},context);
    check(context);
    if(epoch!==client.epoch||!this.clients.has(client))throw fault('stale_browser_session','The browser changed during inspection. Read its tabs again.');
    if(result?.status!=='ok'||result.complete===false||result.truncated||result.degraded)throw fault('invalid_browser_result','The browser did not return a complete tab inventory.');
    return this.observe(client,inventory(result.tabs));
  }
  select(snapshot,ids,context){
    check(context);
    const entry=this.snapshots.get(snapshot);
    if(!entry||Date.now()-entry.created>SNAPSHOT_TTL||!this.clients.has(entry.client)||entry.sessionId!==entry.client.sessionId)throw fault('stale_browser_snapshot','The tab list is stale. Read the browser tabs again.');
    if(!Array.isArray(ids)||ids.length<1||ids.length>20||ids.some(value=>!integer(value))||new Set(ids).size!==ids.length)throw fault('invalid_browser_targets','Choose one to twenty distinct observed tab IDs.');
    const tabs=ids.map(tabId=>entry.tabs.get(tabId));
    if(tabs.some(tab=>!tab||tab.pinned||tab.incognito||tab.windowType!=='normal'||!tab.url||tab.pendingUrl))throw fault('invalid_browser_targets','A selected tab is missing, pinned, private or navigating. Read the tabs again before acting.');
    const scope=context.activityScope??this.defaultScope,blocked=this.uncertain.get(scope);
    if(tabs.some(tab=>blocked?.has(this.signature(entry.client,tab))))throw fault('browser_outcome_unknown','This tab already received an operation with an unknown outcome. Do not repeat it in this task.');
    return {...entry,selected:tabs};
  }
  signature(client,tab){return JSON.stringify([client.clientId,client.sessionId,tab.id,tab.windowId,tab.url]);}
  markUncertain(client,tabs,context){const scope=context.activityScope??this.defaultScope;let blocked=this.uncertain.get(scope);if(!blocked){blocked=new Set();this.uncertain.set(scope,blocked);}for(const tab of tabs)blocked.add(this.signature(client,tab));if(this.uncertain.size>128)this.uncertain.delete(this.uncertain.keys().next().value);}
  async mutate(method,{snapshot,ids},context={}){
    const {client,selected}=this.select(snapshot,ids,context);
    if([...this.pending.values()].some(request=>request.client===client&&request.mutation))throw fault('browser_busy','Wait for the current browser operation to finish.');
    this.invalidate(client);
    const args={expectedTabs:selected.map(({id,windowId,url,pinned})=>({id,windowId,url,pinned})),allowPinned:false};
    let result,tabs,responseReceived=false;
    try{
      result=await this.request(client,method,args,context,true);
      responseReceived=true;
      if(result?.status==='refused'&&result.verified===false&&result.action_attempted===false&&result.outcome_unknown!==true){
        const code=typeof result.code==='string'&&/^[a-z0-9_]{1,80}$/.test(result.code)?result.code:'browser_refused';
        return {status:'refused',verified:false,refused:true,action_attempted:false,code,message:'The browser refused the action before sending input. Read its tabs again before continuing.'};
      }
      if(result?.complete===false||result?.truncated||result?.degraded)throw fault('invalid_browser_result','The browser result inventory is incomplete.');
      tabs=inventory(result?.tabs);
      check(context);
      if(!this.clients.has(client))throw fault('browser_disconnected','The browser connection changed during the operation.',true);
    }catch(error){
      if(responseReceived||error.action_attempted||error.code==='invalid_browser_result'){
        this.markUncertain(client,selected,context);
        return {status:'unverified',verified:false,action_attempted:true,outcome_unknown:true,message:'The browser operation was attempted, but its result is unknown. Inspect the tabs; do not repeat the action.'};
      }
      throw error;
    }
    const observation=this.observe(client,tabs);
    const closed=method==='tabs.close',actualClosed=selected.filter(tab=>!tabs.some(current=>current.id===tab.id)).map(tab=>tab.id);
    const active=selected.length===1&&tabs.find(tab=>tab.id===selected[0].id&&tab.windowId===selected[0].windowId&&tab.url===selected[0].url&&!tab.pendingUrl&&tab.active);
    const claimedClosed=Array.isArray(result.closedIds)&&result.closedIds.length===selected.length&&new Set(result.closedIds).size===selected.length&&result.closedIds.every(value=>ids.includes(value));
    const verified=result.verified===true&&!result.outcome_unknown&&(closed?result.status==='closed'&&claimedClosed&&actualClosed.length===selected.length:result.status==='activated'&&result.activeId===selected[0].id&&result.windowFocused===true&&!!active);
    if(verified)return {status:closed?'closed':'activated',verified:true,...(closed?{closed_ids:actualClosed}:{active_id:selected[0].id}),observation};
    // Even a 'refused' response must not erase fresh evidence of partial input.
    const refused=result.status==='refused'&&result.verified===false&&!result.outcome_unknown&&actualClosed.length===0;
    if(!refused)this.markUncertain(client,selected,context);
    return {status:refused?'refused':'unverified',verified:false,...(refused?{refused:true}:{action_attempted:true,outcome_unknown:true}),...(closed?{closed_ids:actualClosed}:{}),observation,message:refused?'The browser refused the action. Read the current tabs before continuing.':'The browser result is incomplete or uncertain. Do not repeat the operation.'};
  }
  close({snapshot,tab_ids},context={}){return this.mutate('tabs.close',{snapshot,ids:tab_ids},context);}
  activate({snapshot,tab_id},context={}){return this.mutate('tabs.activate',{snapshot,ids:[tab_id]},context);}
  pageFrame(client,tab,frame,frameTarget){
    // Only structured, bounded page state crosses into model context. The raw
    // URL remains private for identity checks; query strings are not reported.
    if(!frame||typeof frame.snapshot!=='string'||frame.snapshot.length>160||typeof frame.document_id!=='string'||frame.document_id.length>160||typeof frame.url!=='string'||frame.url.length>8192||!Array.isArray(frame.controls)||frame.controls.length>300||typeof frame.complete!=='boolean')throw fault('invalid_page_result','The page returned invalid controls.');
    let url;try{url=new URL(frame.url);if(!['http:','https:'].includes(url.protocol)||url.origin!==new URL(frameTarget?.url||tab.url).origin||(frameTarget&&frame.url!==frameTarget.url))throw Error();}catch{throw fault('page_scope_changed','The page moved outside the observed origin.');}
    const controls=frame.controls.map(control=>{
      if(!control||typeof control.id!=='string'||control.id.length>160||typeof control.name!=='string'||control.name.length>12000||typeof control.role!=='string'||control.role.length>100)throw fault('invalid_page_result','The page returned an invalid control.');
      const row={id:control.id,name:control.name.slice(0,1000),role:control.role};
      if(Array.isArray(control.ancestors))row.ancestors=control.ancestors.slice(0,8).filter(a=>typeof a?.name==='string'&&typeof a?.role==='string').map(a=>({name:a.name.slice(0,300),role:a.role.slice(0,60)}));
      for(const key of ['enabled','editable','protected','checked','selected','focused'])if(typeof control[key]==='boolean')row[key]=control[key];
      if(typeof control.value==='string'&&!control.protected)row.value=control.value.slice(0,12000);
      if(Array.isArray(control.options)&&!control.protected)row.options=control.options.slice(0,100).filter(option=>option&&typeof option.name==='string'&&typeof option.value==='string').map(option=>({name:option.name.slice(0,500),value:option.value.slice(0,1000),selected:option.selected===true}));
      return row;
    });
    const snapshot=randomUUID();
    for(const [key,value] of this.pageSnapshots)if(Date.now()-value.created>SNAPSHOT_TTL)this.pageSnapshots.delete(key);
    if(this.pageSnapshots.size>=64)this.pageSnapshots.delete(this.pageSnapshots.keys().next().value);
    const frames=Array.isArray(frame.frames)?frame.frames.filter(f=>Number.isSafeInteger(f?.frame_id)&&f.frame_id>0&&typeof f.browser_document_id==='string'&&f.browser_document_id.length<=160&&typeof f.url==='string'&&f.url.length<=8192&&/^https?:/.test(f.url)).slice(0,16):[];
    const observation={...(frameTarget?{frame_id:frameTarget.frame_id,frame_url:safeURL(frame.url)}:{}),...(frames.length?{frames:frames.map(f=>({frame_id:f.frame_id,url:safeURL(f.url),title:String(f.title||'').slice(0,200)}))}:{}),status:'observed',source:'browser_dom',snapshot,browser:client.browser,session_id:client.sessionId,profile_revision:profileRevision(client),tab_id:tab.id,window_id:tab.windowId,url:safeURL(frameTarget?tab.url:frame.url),document_id:frame.document_id,complete:frame.complete,controls,revision:frame.revision,top_frame_only:true,has_iframes:frame.has_iframes===true,untrusted_page_data:true};
    this.pageSnapshots.set(snapshot,{client,sessionId:client.sessionId,created:Date.now(),tab:{...tab,url:frameTarget?tab.url:frame.url},frames,frameTarget,frame:{snapshot:frame.snapshot,document_id:frame.document_id},observation});
    return observation;
  }
  pageReady(client,tab,context){
    check(context);
    if(!client.pageRecovery)throw fault('page_adapter_update_required','Reload the Mitch Browser Bridge extension to apply the navigation recovery update before using webpage actions.');
    if(!client.pages)throw fault('page_adapter_unavailable','Reload the Mitch Browser Bridge extension to enable page controls.');
    if([...this.pending.values()].some(request=>request.client===client&&request.mutation))throw fault('browser_busy','Wait for the current browser operation to finish.');
    const blocked=this.uncertain.get(context.activityScope??this.defaultScope);
    if(blocked?.has(`page:${client.browser}:${client.clientId}:${tab.id}`))throw fault('browser_outcome_unknown','A page action has an unknown outcome. Do not repeat it in this task.');
  }
  async observePage({snapshot,tab_id,selector,frame_id},context={}){
    // A fresh page receipt already binds this exact tab and profile. Accept it
    // for read-only refresh instead of requiring another tab-inventory round trip.
    check(context);const entry=this.snapshots.get(snapshot)||this.pageSnapshots.get(snapshot);
    if(!entry||Date.now()-entry.created>SNAPSHOT_TTL||!this.clients.has(entry.client)||entry.sessionId!==entry.client.sessionId)throw fault('stale_browser_snapshot','Read the browser tabs again before inspecting a page.');
    const tab=entry.tabs?entry.tabs.get(tab_id):entry.tab?.id===tab_id?entry.tab:null,client=entry.client;
    if(!tab||tab.pendingUrl||!/^https?:/.test(tab.url))throw fault('invalid_page_target','Select an observed ordinary HTTP or HTTPS tab that has finished navigating.');
    // Read-only inspection is allowed even after an uncertain action.
    if(!client.pages)throw fault('page_adapter_unavailable','Reload the Mitch Browser Bridge extension to enable page controls.');
    if([...this.pending.values()].some(request=>request.client===client&&request.mutation))throw fault('browser_busy','Wait for the current browser operation to finish.');
    if(selector)validatePlan({steps:[{op:'assert',target:selector}],completion:[{target:selector}]});
    const chosenFrame=frame_id??entry.frameTarget?.frame_id??0;
    const frameTarget=chosenFrame===0?undefined:entry.frames?.find(f=>f.frame_id===chosenFrame)||(entry.frameTarget?.frame_id===chosenFrame?entry.frameTarget:undefined);
    if(chosenFrame!==0&&!frameTarget)throw fault('unobserved_frame','Read the outer page and choose an observed frame_id.');
    const epoch=client.epoch,result=await this.request(client,'page.observe',{...(frameTarget?{expectedFrame:frameTarget}:{}),expectedTab:{id:tab.id,windowId:tab.windowId,url:tab.url,pinned:tab.pinned},...(selector?{selector}:{})},context);
    check(context);
    if(epoch!==client.epoch||!this.clients.has(client))throw fault('stale_browser_session','The browser changed during inspection.');
    if(result?.status==='refused')return {status:'refused',action_attempted:false,code:result.code,message:String(result.message||'Page access is unavailable.').slice(0,500)};
    return this.pageFrame(client,tab,result,frameTarget);
  }
  async executePagePlan({snapshot,steps,completion},context={}){
    check(context);const plan=validatePlan({steps,completion}),entry=this.pageSnapshots.get(snapshot);
    if(!entry||Date.now()-entry.created>SNAPSHOT_TTL||!this.clients.has(entry.client)||entry.sessionId!==entry.client.sessionId)throw fault('stale_page_snapshot','Read this page again before planning actions.');
    const {client,tab,frame,frameTarget}=entry;this.pageReady(client,tab,context);
    if(!await approveActions(plan.steps,this.confirm,context))return {status:'refused',verified:false,action_attempted:false,stop_task:true,code:'confirmation_required',message:'The sensitive action was not approved. No input was sent.'};
    this.pageReady(client,tab,context);
    const scope=context.activityScope??this.defaultScope,binding=JSON.stringify([client.browser,client.clientId,tab.id]);
    const delivered=this.partialPlans.get(scope)?.get(binding)||[];
    const activation=step=>['click','follow_link'].includes(step.op)||(step.op==='press'&&step.key==='Enter');
    const replays=plan.steps.some(step=>delivered.some(previous=>matchControls([previous.target],step.target).length===1&&((activation(step)&&activation(previous))||(step.op===previous.op&&step.text===previous.text&&step.value===previous.value&&step.key===previous.key))));
    if(replays)return {status:'refused',verified:false,action_attempted:false,input_suppressed:true,recovery_required:true,code:'delivered_step_replay',message:'That control already received this input in the interrupted plan. Continue from the returned page controls without repeating the delivered steps.',observation:entry.observation};
    for(const [key,value] of this.pageSnapshots)if(value.client===client&&value.tab.id===tab.id)this.pageSnapshots.delete(key);
    const uncertain=(source,recovered)=>{this.markUncertain(client,[tab],context);this.uncertain.get(scope).add(`page:${client.browser}:${client.clientId}:${tab.id}`);const reason=toolDiagnostics({reason:source?.reason||source?.code}).reason;return {status:'interrupted',verified:false,action_attempted:true,outcome_unknown:true,reason:'page_outcome_unknown',...(reason?{source_reason:reason}:{}),...(recovered?{read_only_recovery:true,recovery_required:true,observation:recovered}:{}),message:recovered?'Input may have navigated the page. The attached state is a fresh read-only observation. Check whether the original task is complete; do not send or repeat input.':'The page plan was issued but its result is unknown. Inspect the page; do not repeat its actions.'};};
    let result;
    try{result=await this.request(client,'page.plan',{...(frameTarget?{expectedFrame:frameTarget}:{}),expectedTab:{id:tab.id,windowId:tab.windowId,url:tab.url,pinned:tab.pinned},snapshot:frame.snapshot,...plan},context,true,30000);}catch(error){if(error.action_attempted)return uncertain(error);throw error;}
    if(result?.status==='refused'&&result.action_attempted===false&&!result.outcome_unknown)return result;
    if(result?.outcome_unknown){let recovered;if(result.recovery_kind==='read_only_after_input'&&result.observation)try{recovered=this.pageFrame(client,tab,result.observation,frameTarget);}catch{}return uncertain(result,recovered);}
    if(!result||!['completed','interrupted'].includes(result.status)||!Number.isInteger(result.attempted)||result.attempted<0||result.attempted>plan.steps.length||!Number.isInteger(result.completed)||result.completed<0||result.completed>plan.steps.length||!Array.isArray(result.steps)||result.steps.length>plan.steps.length)return uncertain();
    let observation,proofs=[];
    try{if(result.observation){if(result.observation.document_id!==frame.document_id)throw Error('Document changed');observation=this.pageFrame(client,tab,result.observation,frameTarget);}}catch{return uncertain();}
    let validProofs=false;
    if(result.status==='completed')try{
      if(!Array.isArray(result.completion)||result.completion.length!==plan.completion.length)throw Error('Missing completion proof');
      proofs=result.completion.map((proof,index)=>{
        const expected=plan.completion[index];
        if(proof.passed!==true||proof.condition!==expected.condition||proof.value!==expected.value||JSON.stringify(proof.target)!==JSON.stringify(expected.target)||proof.observation?.document_id!==frame.document_id)throw Error('Mismatched completion proof');
        const observed=this.pageFrame(client,tab,proof.observation,frameTarget);
        if(observed.complete!==true||!testCondition(observed,expected))throw Error('Unsupported completion claim');
        return {...expected,passed:true,observation:observed};
      });validProofs=true;
    }catch{return uncertain();}
    const validSteps=result.steps.length===plan.steps.length&&result.steps.every((step,index)=>step.index===index&&step.op===plan.steps[index].op&&(['wait','assert'].includes(step.op)?step.status==='passed':step.status==='delivered'));
    const mutations=plan.steps.filter(step=>!['wait','assert'].includes(step.op)).length;
    const verified=result.status==='completed'&&result.verified===true&&result.completed===plan.steps.length&&result.attempted===mutations&&validSteps&&validProofs&&!!observation;
    if(result.status==='completed'&&!verified)return uncertain();
    let acknowledged=[];
    if(result.recovery_required)try{
      if(!observation||!Array.isArray(result.delivered_steps)||!result.delivered_steps.length||result.delivered_steps.length>plan.steps.length)throw Error('Missing acknowledged delivery');
      const indices=new Set();
      acknowledged=result.delivered_steps.map(step=>{
        const expected=plan.steps[step.index],record=result.steps[step.index];
        if(!Number.isInteger(step.index)||indices.has(step.index)||!expected||!record||['wait','assert'].includes(step.op)||step.op!==expected.op||record.index!==step.index||record.op!==step.op||record.known_delivery!==true||typeof step.target?.name!=='string'||typeof step.target?.role!=='string'||step.target.name.length>1000||step.target.role.length>100||step.target.match!=='exact'||JSON.stringify(record.resolved_target)!==JSON.stringify(step.target)||matchControls([step.target],expected.target).length!==1||['text','value','key'].some(key=>step[key]!==expected[key]))throw Error('Mismatched acknowledged delivery');
        indices.add(step.index);return {index:step.index,op:expected.op,target:{name:step.target.name,role:normalizeRole(step.target.role),match:'exact',...(step.target.ancestors?.length?{ancestors:step.target.ancestors}:{})},...(expected.text!==undefined?{text:expected.text}:{}),...(expected.value!==undefined?{value:expected.value}:{}),...(expected.key!==undefined?{key:expected.key}:{})};
      });
      const known=result.steps.filter(step=>step.known_delivery===true);
      if(known.length!==indices.size||known.some(step=>!indices.has(step.index))||result.steps.some(step=>!['wait','assert'].includes(step.op)&&step.status==='delivered'&&step.known_delivery!==true))throw Error('Incomplete delivered prefix');
      let tasks=this.partialPlans.get(scope);if(!tasks){tasks=new Map();this.partialPlans.set(scope,tasks);}tasks.set(binding,[...delivered,...acknowledged].slice(-128));
      if(this.partialPlans.size>128)this.partialPlans.delete(this.partialPlans.keys().next().value);
    }catch{return uncertain(result);}
    return {...result,verified,completion:proofs,delivered_steps:acknowledged,...(observation?{observation}:{}),...(result.recovery_required?{message:'Some steps were delivered and the next predicted control or assertion was not found. Use the fresh page controls to finish the request. Delivered steps are blocked from replay.'}:{})};
  }
  async openTab({snapshot,url},context={}){
    check(context);const entry=this.snapshots.get(snapshot);
    if(!entry||Date.now()-entry.created>SNAPSHOT_TTL||!this.clients.has(entry.client)||entry.sessionId!==entry.client.sessionId)throw fault('stale_browser_snapshot','Read this browser profile before opening a tab.');
    let destination;try{destination=new URL(url);}catch{throw fault('invalid_url','Use the explicit requested HTTP or HTTPS URL.');}
    if(typeof url!=='string'||url.length>8192||!['http:','https:'].includes(destination.protocol)||destination.username||destination.password)throw fault('invalid_url','Use the explicit requested HTTP or HTTPS URL.');
    const client=entry.client,scope=context.activityScope??this.defaultScope,blockedKey=`open:${client.browser}:${client.clientId}`;
    if(!client.pageNavigation||!client.pages||!client.pageRecovery)throw fault('page_adapter_update_required','Reload the Mitch Browser Bridge extension before opening scoped page tasks.');
    if([...this.pending.values()].some(request=>request.client===client&&request.mutation))throw fault('browser_busy','Wait for the current browser operation to finish.');
    if(this.uncertain.get(scope)?.has(blockedKey))throw fault('browser_outcome_unknown','A tab creation has an unknown outcome. Inspect existing tabs instead of creating another.');
    const windowIds=[...new Set([...entry.tabs.values()].map(tab=>tab.windowId))];
    if(!windowIds.length||windowIds.length>100)throw fault('invalid_browser_window','Read one eligible browser window before opening a tab.');
    this.invalidate(client);
    const uncertain=result=>{
      this.markUncertain(client,[],context);this.uncertain.get(scope).add(blockedKey);
      let observation;if(result?.recovery_kind==='read_only_after_input'&&result.observation&&result.tab)try{observation=this.pageFrame(client,result.tab,result.observation);}catch{}
      return {status:'interrupted',verified:false,action_attempted:true,outcome_unknown:true,reason:'browser_open_unknown',...(observation?{observation,read_only_recovery:true,recovery_required:true}:{}),message:'The new tab could not be confirmed. Inspect the existing tabs; do not open it again.'};
    };
    let result;try{result=await this.request(client,'page.open_tab',{windowIds,url:destination.href},context,true,30000);}catch(error){if(error.action_attempted)return uncertain();throw error;}
    if(result?.status==='refused'&&result.action_attempted===false&&!result.outcome_unknown)return result;
    if(result?.outcome_unknown)return uncertain(result);
    try{
      check(context);const receipt=result?.creation;
      if(!this.clients.has(client)||result?.status!=='opened'||result.verified!==true||result.action_attempted!==true||result.input_delivered!==true||!receipt||receipt.accepted!==true||receipt.requested_url!==destination.href||!integer(receipt.tab_id)||!windowIds.includes(receipt.window_id))throw Error('Missing tab creation receipt');
      const tab=inventory([result.tab])[0];if(tab.id!==receipt.tab_id||tab.windowId!==receipt.window_id||tab.pinned||tab.pendingUrl||new URL(tab.url).origin!==destination.origin||result.observation?.url!==tab.url)throw Error('Wrong created tab');
      const observation=this.pageFrame(client,tab,result.observation);
      return {status:'opened',verified:true,action_attempted:true,input_delivered:true,tab_id:tab.id,window_id:tab.windowId,url:safeURL(tab.url),creation:{accepted:true},observation};
    }catch{return uncertain(result);}
  }
  async followLink({snapshot,target,completion},context={}){
    check(context);const validated=validatePlan({steps:[{op:'assert',target}],completion}),entry=this.pageSnapshots.get(snapshot);
    if(!entry||Date.now()-entry.created>SNAPSHOT_TTL||!this.clients.has(entry.client)||entry.sessionId!==entry.client.sessionId)throw fault('stale_page_snapshot','Read this page again before following a link.');
    const {client,tab,frame}=entry;this.pageReady(client,tab,context);
    if(entry.frameTarget)throw fault('unsupported_frame_navigation','Inspect and navigate the outer page explicitly. Embedded frame link navigation is not supported.');
    if(!client.pageNavigation)throw fault('page_adapter_update_required','Reload the Mitch Browser Bridge extension and refresh this tab before using direct link navigation.');
    target=validated.steps[0].target;completion=validated.completion;
    if(!await approveActions([{op:'follow_link',target}],this.confirm,context))return {status:'refused',stop_task:true,verified:false,action_attempted:false,code:'confirmation_required'};
    this.pageReady(client,tab,context);
    const scope=context.activityScope??this.defaultScope,binding=JSON.stringify([client.browser,client.clientId,tab.id]),delivered=this.partialPlans.get(scope)?.get(binding)||[];
    if(delivered.some(previous=>(['click','follow_link'].includes(previous.op)||previous.op==='press'&&previous.key==='Enter')&&matchControls([previous.target],target).length===1))return {status:'refused',verified:false,action_attempted:false,input_suppressed:true,recovery_required:true,code:'delivered_step_replay',observation:entry.observation};
    for(const [key,value] of this.pageSnapshots)if(value.client===client&&value.tab.id===tab.id)this.pageSnapshots.delete(key);
    const uncertain=source=>{
      this.markUncertain(client,[tab],context);this.uncertain.get(scope).add(`page:${client.browser}:${client.clientId}:${tab.id}`);
      let observation;if(source?.recovery_kind==='read_only_after_input')try{observation=this.pageFrame(client,tab,source.observation);}catch{}
      return {status:'interrupted',verified:false,action_attempted:true,outcome_unknown:true,reason:'page_outcome_unknown',...(observation?{read_only_recovery:true,recovery_required:true,observation}:{}),message:'The link navigation could not be confirmed. Inspect the page without repeating it.'};
    };
    let result;try{result=await this.request(client,'page.follow_link',{expectedTab:{id:tab.id,windowId:tab.windowId,url:tab.url,pinned:tab.pinned},snapshot:frame.snapshot,target,completion},context,true,30000);}catch(error){if(error.action_attempted)return uncertain();throw error;}
    if(result?.status==='refused'&&result.action_attempted===false&&!result.outcome_unknown)return result;
    if(result?.outcome_unknown)return uncertain(result);
    try{
      check(context);const receipt=result?.navigation;
      if(!this.clients.has(client)||!receipt||receipt.accepted!==true||receipt.source_document_id!==frame.document_id||receipt.source_url!==tab.url||typeof receipt.requested_url!=='string'||typeof receipt.final_url!=='string'||receipt.requested_url.length>8192||receipt.final_url.length>8192)throw Error('Missing navigation receipt');
      for(const urlText of [receipt.requested_url,receipt.final_url]){const url=new URL(urlText);if(!['http:','https:'].includes(url.protocol)||url.origin!==new URL(tab.url).origin||url.username||url.password)throw Error('Navigation left scope');}
      if(typeof receipt.target?.name!=='string'||receipt.target.name.length>1000||receipt.target.role!=='link'||receipt.target.match!=='exact'||matchControls([receipt.target],target).length!==1)throw Error('Unmatched link');
      if(!['completed','interrupted'].includes(result.status)||result.attempted!==1||result.action_attempted!==true||result.input_delivered!==true||result.observation?.url!==receipt.final_url||receipt.requested_url===tab.url&&result.observation?.document_id===frame.document_id)throw Error('Invalid navigation result');
      const observation=this.pageFrame(client,tab,result.observation);
      if(!Array.isArray(result.steps)||result.steps.length!==1||result.steps[0].index!==0||result.steps[0].op!=='follow_link'||result.steps[0].status!=='delivered'||result.steps[0].known_delivery!==true||JSON.stringify(result.steps[0].resolved_target)!==JSON.stringify(receipt.target))throw Error('Missing delivery receipt');
      if(!Array.isArray(result.completion)||result.completion.length!==completion.length)throw Error('Missing completion proof');
      const proofs=result.completion.map((proof,index)=>{
        const expected=completion[index];
        if(proof.condition!==expected.condition||proof.value!==expected.value||JSON.stringify(proof.target)!==JSON.stringify(expected.target)||proof.observation?.document_id!==observation.document_id||proof.observation?.url!==receipt.final_url)throw Error('Mismatched completion proof');
        const observed=this.pageFrame(client,tab,proof.observation),passed=observed.complete===true&&testCondition(observed,expected);
        if(proof.passed!==passed)throw Error('Unsupported completion claim');return {...expected,passed,observation:observed};
      });
      const verified=result.status==='completed'&&result.verified===true&&result.completed===1&&proofs.every(proof=>proof.passed)&&observation.complete===true;
      if(result.status==='completed'&&!verified||result.status==='interrupted'&&(result.verified!==false||result.completed!==0||result.recovery_required!==true))throw Error('Invalid completion state');
      const acknowledged={index:0,op:'follow_link',target:{...receipt.target}};
      if(!verified){let tasks=this.partialPlans.get(scope);if(!tasks){tasks=new Map();this.partialPlans.set(scope,tasks);}tasks.set(binding,[...delivered,acknowledged].slice(-128));if(this.partialPlans.size>128)this.partialPlans.delete(this.partialPlans.keys().next().value);}
      // Raw hrefs stay inside the bridge; they may contain private query data.
      return {status:verified?'completed':'interrupted',verified,attempted:1,completed:verified?1:0,action_attempted:true,input_delivered:true,navigation:{accepted:true,source_document_id:frame.document_id,document_id:observation.document_id,url:safeURL(receipt.final_url)},steps:result.steps,delivered_steps:[acknowledged],completion:proofs,observation,...(!verified?{recovery_required:true,reason:'completion_not_met',message:'Navigation was delivered. Continue from the fresh controls without following the same link again.'}:{})};
    }catch{return uncertain(result);}
  }
  async runSiteTask({snapshot,...supplied},context={}){
    check(context);const goal=publicSites.validate(supplied),entry=this.snapshots.get(snapshot);
    if(!entry||Date.now()-entry.created>SNAPSHOT_TTL||!this.clients.has(entry.client)||entry.sessionId!==entry.client.sessionId)throw fault('stale_browser_snapshot','Read this browser profile before starting the task.');
    const client=entry.client,scope=context.activityScope??this.defaultScope,key=`site:${client.browser}:${client.clientId}`;
    if(goal.browser&&goal.browser!==client.browser)throw fault('wrong_browser','The selected browser does not match the request.');
    if(!client.publicSites)return {status:'refused',action_attempted:false,verified:false,code:'page_adapter_update_required',message:'Reload the updated Mitch Browser Bridge extension.'};
    if(this.uncertain.get(scope)?.has(key))throw fault('browser_outcome_unknown','A previous website task has an unknown outcome. Do not repeat it.');
    if([...this.pending.values()].some(p=>p.client===client&&p.mutation))throw fault('browser_busy','A browser action is still in progress.');
    const tabs=[...entry.tabs.values()],windowIds=[...new Set(tabs.map(t=>t.windowId))],matches=tabs.filter(t=>!t.pinned&&!t.pendingUrl&&publicSites.permittedURL(goal.site,t.url)),active=matches.filter(t=>t.active),selected=active.length===1?active[0]:matches.length===1?matches[0]:null;
    if(!windowIds.length)throw fault('invalid_browser_window','Open one normal browser window first.');
    const expectedTab=selected?{id:selected.id,windowId:selected.windowId,url:selected.url,pinned:false}:undefined;
    const uncertain=result=>{this.markUncertain(client,selected?[selected]:[],context);this.uncertain.get(scope).add(key);return {...result,status:'interrupted',verified:false,action_attempted:true,outcome_unknown:true};};
    this.invalidate(client);let result;
    try{result=await this.request(client,'site.task',{goal,windowIds,...(expectedTab?{expectedTab}:{})},context,true,goal.action==='play'?45000:30000);}catch(error){if(error.action_attempted)return uncertain({message:'The website task did not return a verified result. I stopped without repeating it.'});throw error;}
    if(result?.status==='refused'&&result.action_attempted===false&&!result.outcome_unknown)return result;
    if(!this.clients.has(client)||!integer(result?.tab_id)||!windowIds.includes(result?.window_id)||selected&&result.tab_id!==selected.id||!publicSites.verify(goal,result))return uncertain(result||{});
    return result;
  }
  async stop(){
    this.started=false;clearInterval(this.heartbeat);
    for(const pending of [...this.pending.values()])pending.fail(fault('browser_stopped','The browser bridge stopped.',pending.mutation&&pending.sent));
    for(const ws of this.sockets)ws.terminate();this.sockets.clear();this.clients.clear();this.snapshots.clear();this.pageSnapshots.clear();this.partialPlans.clear();this.uncertain.clear();
    this.publishStatus();
    const server=this.server;this.server=null;
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    this.wss?.close();this.wss=null;
  }
}
module.exports={BrowserBridge};
