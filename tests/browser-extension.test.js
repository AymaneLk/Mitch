const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTabOperations}=require('../browser-extension/tab-operations');
const copy=value=>structuredClone(value);
const tab=(id,overrides={})=>({id,windowId:10,url:'https://mail.google.com/mail/u/0/',title:'Inbox - Gmail',active:id===1,pinned:false,incognito:false,...overrides});
function fixture(initial=[tab(1),tab(2),tab(3,{url:'https://example.com/',title:'Keep this tab'})]){
  const state={tabs:copy(initial),storage:{},removed:[],updated:[],focused:[],queries:0,now:1000};
  const api={
    tabs:{
      query:async args=>{assert.deepEqual(args,{windowType:'normal'});state.queries++;await state.onQuery?.();return copy(state.tabs);},
      remove:async ids=>{state.removed.push(copy(ids));if(state.removeError)throw Error('Native removal failed');state.tabs=state.tabs.filter(tab=>!ids.includes(tab.id));await state.afterRemove?.();},
      update:async(id,args)=>{state.updated.push({id,...args});state.tabs=state.tabs.map(tab=>({...tab,active:tab.windowId===10?tab.id===id:tab.active}));await state.afterUpdate?.();},
    },
    windows:{update:async(id,args)=>{state.focused.push({id,...args});},get:async()=>({id:10,type:'normal',focused:state.focused.length>0})},
    storage:{session:{get:async key=>({[key]:copy(state.storage[key])}),set:async values=>{if(state.storageError)throw Error('Storage failed');Object.assign(state.storage,copy(values));await state.afterSave?.();}}},
  };
  const make=()=>createTabOperations(api,{now:()=>state.now});
  return {state,api,make,operations:make()};
}
const args=ids=>({expectedTabs:ids.map(id=>({id,windowId:10,url:'https://mail.google.com/mail/u/0/',pinned:false})),allowPinned:false});
const context=(id='request-1',extra={})=>({id,deadline:10000,...extra});
test('tab listing returns normal non-private metadata without reading page content',async()=>{
  const {operations,state}=fixture([tab(1),tab(2,{incognito:true}),tab(3,{pendingUrl:'https://example.com/'})]);
  const result=await operations.execute('tabs.list',{},context());
  assert.equal(result.status,'ok');assert.deepEqual(result.tabs.map(tab=>tab.id),[1,3]);
  assert.ok(result.tabs.every(tab=>tab.windowType==='normal'&&!tab.incognito));assert.equal(result.tabs[1].pendingUrl,'https://example.com/');assert.equal(state.removed.length,0);
});
test('two exact Gmail tabs close in one API operation and fresh inventory proves absence',async()=>{
  const {operations,state}=fixture();
  state.afterSave=()=>{assert.equal(state.removed.length,0);state.afterSave=null;};
  const result=await operations.execute('tabs.close',args([1,2]),context());
  assert.equal(result.status,'closed');assert.equal(result.verified,true);assert.deepEqual(result.closedIds,[1,2]);
  assert.deepEqual(state.removed,[[1,2]]);assert.deepEqual(result.tabs.map(tab=>tab.id),[3]);assert.equal(state.queries,2);
});
test('all targets are revalidated before any tab changes',async()=>{
  for(const changed of [{url:'https://different.example/'},{windowId:11},{pinned:true},{pendingUrl:'https://different.example/'},{incognito:true}]){
    const {operations,state}=fixture([tab(1),tab(2,changed)]);
    const result=await operations.execute('tabs.close',args([1,2]),context());
    assert.equal(result.code,'stale_target',JSON.stringify(changed));assert.equal(result.action_attempted,false);assert.equal(state.removed.length,0);
  }
});
test('cancel or expired deadline before dispatch sends no input',async()=>{
  const {operations,state}=fixture();
  assert.equal((await operations.execute('tabs.close',args([1]),context('cancelled',{isCancelled:()=>true}))).status,'cancelled');
  assert.equal((await operations.execute('tabs.close',args([1]),context('expired',{deadline:1000}))).code,'deadline_expired');
  let cancelled=false;state.afterSave=()=>{cancelled=true;};
  assert.equal((await operations.execute('tabs.close',args([1]),context('cancel-after-save',{isCancelled:()=>cancelled}))).status,'cancelled');
  assert.equal(state.removed.length,0);
});
test('cancellation during revalidation is checked immediately before mutation',async()=>{
  const {operations,state}=fixture();let cancelled=false;state.onQuery=()=>{cancelled=true;};
  const result=await operations.execute('tabs.close',args([1]),context('cancel-during-query',{isCancelled:()=>cancelled}));
  assert.equal(result.status,'cancelled');assert.equal(state.removed.length,0);
});
test('duplicate IDs never repeat completed or uncertain operations across worker restart',async()=>{
  const {operations,state,make}=fixture();
  const first=await operations.execute('tabs.close',args([1]),context());assert.equal(first.verified,true);
  state.tabs.push(tab(1));
  const duplicate=await make().execute('tabs.close',args([1]),context());
  assert.equal(duplicate.code,'duplicate_request');assert.equal(state.removed.length,1);
  state.storage.mitchBrowserOperationLedger['request-pending']={state:'pending',method:'tabs.close',at:1000};
  const pending=await make().execute('tabs.close',args([2]),context('request-pending'));
  assert.equal(pending.outcome_unknown,true);assert.equal(pending.code,'duplicate_request');assert.equal(state.removed.length,1);
});
test('API failure after issuance is uncertain and is never automatically retried',async()=>{
  const {operations,state}=fixture();state.removeError=true;
  const result=await operations.execute('tabs.close',args([1,2]),context());
  assert.equal(result.outcome_unknown,true);assert.equal(result.action_attempted,true);assert.equal(state.removed.length,1);
  await operations.execute('tabs.close',args([1,2]),context());assert.equal(state.removed.length,1);
});
test('failed post-action inspection cannot claim success',async()=>{
  const {operations,state}=fixture();state.afterRemove=()=>{state.onQuery=()=>{throw Error('Readback failed');};};
  const result=await operations.execute('tabs.close',args([1]),context());
  assert.equal(result.verified,false);assert.equal(result.outcome_unknown,true);assert.equal(state.removed.length,1);
});
test('ledger storage must succeed before any mutation',async()=>{
  const {operations,state}=fixture();state.storageError=true;
  const result=await operations.execute('tabs.close',args([1]),context());
  assert.equal(result.verified,false);assert.equal(result.action_attempted,false);assert.equal(state.removed.length,0);
});
test('a failed completion-ledger write leaves the action uncertain and still blocks replay',async()=>{
  const {operations,state,make}=fixture();state.afterRemove=()=>{state.storageError=true;};
  const result=await operations.execute('tabs.close',args([1]),context());
  assert.equal(result.code,'ledger_write_failed');assert.equal(result.outcome_unknown,true);assert.equal(result.action_attempted,true);
  assert.equal(state.storage.mitchBrowserOperationLedger['request-1'].state,'pending');
  state.storageError=false;state.tabs.push(tab(1));
  const duplicate=await make().execute('tabs.close',args([1]),context());
  assert.equal(duplicate.code,'duplicate_request');assert.equal(duplicate.outcome_unknown,true);assert.equal(state.removed.length,1);
});
test('read-only recovery inventory is available while an issued browser mutation is pending',async()=>{
  const {operations,state}=fixture();let release,entered;
  const started=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
  state.afterRemove=()=>{entered();return held;};
  const closing=operations.execute('tabs.close',args([1]),context());await started;
  const listing=await operations.execute('tabs.list',{},context('read-during-close'));
  assert.equal(listing.status,'ok');assert.deepEqual(listing.tabs.map(tab=>tab.id),[2,3]);
  release();assert.equal((await closing).status,'closed');
});
test('activation verifies the exact tab and focused window',async()=>{
  const {operations,state}=fixture();
  const result=await operations.execute('tabs.activate',args([2]),context());
  assert.equal(result.status,'activated');assert.equal(result.verified,true);assert.equal(result.activeId,2);assert.equal(result.windowFocused,true);
  assert.deepEqual(state.updated,[{id:2,active:true}]);assert.deepEqual(state.focused,[{id:10,focused:true}]);assert.equal(state.removed.length,0);
});
test('Stop after activating a tab prevents later window focus',async()=>{
  const {operations,state}=fixture();let cancelled=false;state.afterUpdate=()=>{cancelled=true;};
  const result=await operations.execute('tabs.activate',args([2]),context('activate-cancel',{isCancelled:()=>cancelled}));
  assert.equal(result.status,'cancelled');assert.equal(result.outcome_unknown,true);assert.equal(state.focused.length,0);
});
test('invalid operation, target bounds and pinned override are rejected',async()=>{
  const {operations,state}=fixture();
  const attempts=[['eval',{}],['tabs.list',{url:'*'}],['tabs.close',{...args([1]),allowPinned:true}],['tabs.close',args([1,1])],['tabs.activate',args([1,2])],['tabs.close',args(Array.from({length:21},(_,i)=>i))],['tabs.close',{...args([1]),extra:'ignored'}],['tabs.close',{...args([1]),expectedTabs:[{...args([1]).expectedTabs[0],pinned:true}]}]];
  for(let index=0;index<attempts.length;index++)assert.equal((await operations.execute(...attempts[index],context('invalid-'+index))).status,'refused');
  assert.equal(state.removed.length,0);assert.equal(state.updated.length,0);
});
test('a full at-most-once ledger fails closed rather than forgetting old request IDs',async()=>{
  const {operations,state}=fixture();state.storage.mitchBrowserOperationLedger=Object.fromEntries(Array.from({length:4096},(_,index)=>['old-'+index,{state:'complete'}]));
  const result=await operations.execute('tabs.close',args([1]),context());
  assert.equal(result.code,'ledger_full');assert.equal(state.removed.length,0);
});
test('manifest has a stable ID and page access is optional with no persistent content scripts',()=>{
  const manifest=require('../browser-extension/manifest.json'),crypto=require('node:crypto');
  const id=[...crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(value=>String.fromCharCode(97+(value>>4),97+(value&15))).join('');
  assert.equal(id,'flaibaeknfjlnkenffkpdmfilhfdiaaf');assert.deepEqual(manifest.permissions,['tabs','storage','alarms','scripting']);
  assert.deepEqual(manifest.optional_host_permissions,['http://*/*','https://*/*']);
  assert.equal(manifest.host_permissions,undefined);assert.equal(manifest.content_scripts,undefined);assert.equal(manifest.externally_connectable,undefined);
});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function workerFixture(existing){
  const fs=require('node:fs'),vm=require('node:vm'),environment=existing||fixture(),connections=[],timers=new Map();
  let counter=0;const local=environment.state.local||(environment.state.local={});
  const listeners={};
  const chrome={...environment.api,
    storage:{...environment.api.storage,local:{get:async key=>({[key]:local[key]}),set:async value=>Object.assign(local,value)}},
    runtime:{id:'flaibaeknfjlnkenffkpdmfilhfdiaaf',onMessage:{addListener:callback=>listeners.message=callback},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}}},
    alarms:{onAlarm:{addListener:callback=>listeners.alarm=callback},create:()=>{}},
  };
  class FakeSocket{
    static OPEN=1;static CONNECTING=0;
    constructor(url){assert.equal(url,'ws://127.0.0.1:22133/mitch-browser');this.readyState=0;this.messages=[];connections.push(this);}
    send(text){this.messages.push(JSON.parse(text));}
    close(){this.readyState=3;this.onclose?.();}
    open(){this.readyState=1;this.onopen();}
    receive(message){this.onmessage({data:JSON.stringify(message)});}
  }
  const context=vm.createContext({chrome,WebSocket:FakeSocket,navigator:{userAgent:'Mozilla/5.0 OPR/123.0.0.0'},crypto:require('node:crypto').webcrypto,
    setInterval:(callback,ms)=>{const id=++counter;timers.set(id,{callback,ms,interval:true});return id;},clearInterval:id=>timers.delete(id),
    setTimeout:(callback,ms)=>{const id=++counter;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id),
  });
  context.importScripts=()=>{context.MITCH_BROWSER_CONFIG={token:'test-token-'.repeat(8)};context.MitchTabOperations={createTabOperations:api=>createTabOperations(api,{now:()=>environment.state.now})};context.MitchPageOperations=require('../browser-extension/page-operations');context.MitchPublicSites=require('../public-site-task');context.MitchSiteOperations=require('../browser-extension/site-operations');};
  vm.runInContext(fs.readFileSync(require.resolve('../browser-extension/worker.js'),'utf8'),context);
  await flush();const socket=connections[0];socket.open();socket.receive({type:'ready'});
  return {...environment,socket,connections,timers,listeners,context};
}
test('worker sends authenticated hello and JS-visible heartbeat without exposing token in popup status',async()=>{
  const {socket,timers,listeners}=await workerFixture();
  const hello=socket.messages[0];assert.equal(hello.type,'hello');assert.equal(hello.browser,'opera');assert.ok(hello.token.length>=32);assert.ok(hello.clientId);assert.ok(hello.sessionId);
  [...timers.values()].find(timer=>timer.interval&&timer.ms===20000).callback();assert.deepEqual(socket.messages.at(-1),{type:'ping'});
  socket.receive({type:'ping'});assert.deepEqual(socket.messages.at(-1),{type:'pong'});
  let response;listeners.message({type:'mitch_browser_status'},{id:'flaibaeknfjlnkenffkpdmfilhfdiaaf'},value=>response=value);
  assert.equal(response.connected,true);assert.equal(JSON.stringify(response).includes(hello.token),false);
});
test('worker cancellation delivered during revalidation prevents native mutation',async()=>{
  const environment=await workerFixture();let release,entered;
  const begun=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
  environment.state.onQuery=()=>{entered();return held;};
  environment.socket.receive({type:'command',id:'worker-cancel',method:'tabs.close',args:args([1]),deadline:10000});
  await begun;environment.socket.receive({type:'cancel',id:'worker-cancel'});release();await flush();
  const reply=environment.socket.messages.find(message=>message.type==='result');assert.equal(reply.result.status,'cancelled');assert.equal(environment.state.removed.length,0);
});
test('worker disconnect loses no at-most-once protection after native action issuance',async()=>{
  const environment=await workerFixture();let release,entered;
  const begun=new Promise(resolve=>entered=resolve),held=new Promise(resolve=>release=resolve);
  environment.state.afterRemove=()=>{entered();return held;};
  const command={type:'command',id:'lost-reply',method:'tabs.close',args:args([1]),deadline:10000};
  environment.socket.receive(command);await begun;environment.socket.close();release();await flush();
  assert.equal(environment.socket.messages.some(message=>message.type==='result'),false);assert.equal(environment.state.removed.length,1);
  environment.state.afterRemove=null;environment.state.tabs.push(tab(1));
  const next=await workerFixture(environment);next.socket.receive(command);await flush();
  assert.equal(next.socket.messages.find(message=>message.type==='result').result.code,'duplicate_request');assert.equal(environment.state.removed.length,1);
  assert.equal(environment.socket.messages[0].clientId,next.socket.messages[0].clientId);assert.notEqual(environment.socket.messages[0].sessionId,next.socket.messages[0].sessionId);
});
