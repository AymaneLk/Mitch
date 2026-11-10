'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {BrowserBridge}=require('../browser-bridge');
const token='a'.repeat(64),extensionId='a'.repeat(32),origin=`chrome-extension://${extensionId}`;
const tab=(id=1,extra={})=>({id,windowId:10,url:`https://mail.google.com/mail/u/${id-1}/#inbox`,title:'Gmail',active:id===1,pinned:false,incognito:false,windowType:'normal',...extra});
async function setup(t,{timeoutMs=200,...options}={}){const bridge=new BrowserBridge({token,extensionId,port:0,timeoutMs,...options});await bridge.start();t.after(()=>bridge.stop());return bridge;}
async function pair(bridge,{browser='opera',clientId='profile-a',sessionId='session-a',tabs=[tab(1),tab(2),tab(3,{url:'https://example.com/',title:'Other'})],respond,...hello}={}){
  const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}/mitch-browser`,{origin});ws.on('error',()=>{});await once(ws,'open');
  const client={ws,tabs,commands:[],cancels:[]};
  ws.on('message',async raw=>{
    const message=JSON.parse(raw.toString());if(message.type==='cancel'){client.cancels.push(message.id);return;}if(message.type!=='command')return;
    client.commands.push(message);
    let result;
    if(respond)result=await respond(message,client);
    else if(message.method==='tabs.list')result={status:'ok',tabs:client.tabs};
    else if(message.method==='tabs.close'){const ids=message.args.expectedTabs.map(tab=>tab.id);client.tabs=client.tabs.filter(tab=>!ids.includes(tab.id));result={status:'closed',verified:true,closedIds:ids,tabs:client.tabs};}
    else if(message.method==='tabs.activate'){const id=message.args.expectedTabs[0].id;client.tabs=client.tabs.map(tab=>({...tab,active:tab.id===id}));result={status:'activated',verified:true,activeId:id,windowFocused:true,tabs:client.tabs};}
    if(result!==undefined&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'result',id:message.id,result}));
  });
  const ready=once(ws,'message');ws.send(JSON.stringify({type:'hello',token,clientId,browser,sessionId,...hello}));assert.equal(JSON.parse((await ready)[0]).type,'ready');return client;
}
async function waitUntil(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Test condition not reached');}
test('public-site tasks require an updated adapter before sending input',async t=>{
 const bridge=await setup(t),client=await pair(bridge);const list=await bridge.list({});const result=await bridge.runSiteTask({snapshot:list.snapshot,site:'wikipedia',action:'open',query:'Ada Lovelace'});assert.equal(result.action_attempted,false);assert.equal(result.code,'page_adapter_update_required');assert.equal(client.commands.length,1);
});
test('public-site receipt must prove the exact result and tab scope, with no replay after uncertainty',async t=>{
 const bridge=await setup(t),context={activityScope:Symbol('site')};let valid=true;
 const client=await pair(bridge,{capabilities:['public-sites-v1'],tabs:[tab(1,{url:'https://en.wikipedia.org/wiki/Computer_mouse'})],respond:async m=>m.method==='tabs.list'?{status:'ok',tabs:[tab(1,{url:'https://en.wikipedia.org/wiki/Computer_mouse'})]}:{status:'completed',verified:true,action_attempted:true,goal:m.args.goal,tab_id:valid?1:99,window_id:10,observation:{url:'https://en.wikipedia.org/wiki/Ada_Lovelace',heading:'Ada Lovelace'}}});
 let list=await bridge.list({});assert.equal((await bridge.runSiteTask({snapshot:list.snapshot,site:'wikipedia',action:'open',query:'Ada Lovelace'},context)).verified,true);
 assert.equal(client.commands.at(-1).args.expectedTab.id,1);valid=false;list=await bridge.list({});assert.equal((await bridge.runSiteTask({snapshot:list.snapshot,site:'wikipedia',action:'open',query:'Ada Lovelace'},context)).outcome_unknown,true);
 list=await bridge.list({});await assert.rejects(bridge.runSiteTask({snapshot:list.snapshot,site:'wikipedia',action:'open',query:'Ada Lovelace'},context),e=>e.code==='browser_outcome_unknown');
});
async function denied(bridge,{origin:requestOrigin=origin,headers={},route='/mitch-browser'}={}){
  const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}${route}`,{origin:requestOrigin,headers});ws.on('error',()=>{});
  return new Promise(resolve=>{ws.on('unexpected-response',(_request,response)=>{response.resume();resolve(response.statusCode);ws.terminate();});});
}
test('bridge binds loopback and rejects wrong Origin, Host and endpoint before authentication',async t=>{
  const bridge=await setup(t);
  assert.equal(await denied(bridge,{origin:'https://mail.google.com'}),403);
  assert.equal(await denied(bridge,{headers:{host:'attacker.invalid'}}),403);
  assert.equal(await denied(bridge,{route:'/mitch-browser?token=leak'}),403);
  assert.deepEqual(bridge.status(),{running:true,port:bridge.port,connected:0,pageCapable:0,pageAccess:0,recoveryCapable:0,navigationCapable:0,publicSiteCapable:0,browsers:[]});
});
test('wrong token and unsupported browser cannot authenticate',async t=>{
  const bridge=await setup(t);
  for(const extra of [{token:'b'.repeat(64)},{browser:'unknown'}]){
    const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}/mitch-browser`,{origin});ws.on('error',()=>{});await once(ws,'open');const closed=once(ws,'close');
    ws.send(JSON.stringify({type:'hello',token,clientId:'a',sessionId:'a',browser:'opera',...extra}));assert.equal((await closed)[0],1008);
  }
  assert.equal(bridge.status().connected,0);
});
test('fresh listing returns sanitized metadata and keeps exact URLs privately for mutation',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{tabs:[tab(1,{url:'https://user:secret@mail.google.com/mail/u/0/?auth=private#inbox'})]});
  const listed=await bridge.list();assert.equal(listed.status,'ok');assert.equal(listed.complete,true);assert.equal(listed.session_id,'session-a');assert.equal(listed.tabs[0].url,'https://mail.google.com/mail/u/0/');
  const closed=await bridge.close({snapshot:listed.snapshot,tab_ids:[1]});assert.equal(closed.verified,true);
  assert.equal(client.commands[1].args.expectedTabs[0].url,'https://user:secret@mail.google.com/mail/u/0/?auth=private#inbox');assert.equal(client.commands[1].args.allowPinned,false);
  assert.equal(JSON.stringify(closed).includes('secret'),false);
});
test('authenticated application heartbeat keeps the extension worker connected without exposing commands',async t=>{
  const bridge=await setup(t),client=await pair(bridge),reply=once(client.ws,'message');
  client.ws.send(JSON.stringify({type:'ping'}));assert.deepEqual(JSON.parse((await reply)[0]),{type:'pong'});assert.equal(bridge.status().connected,1);assert.equal(client.commands.length,0);
});
test('non-web URLs never expose inline documents, script text or local file paths publicly',async t=>{
  const bridge=await setup(t);await pair(bridge,{tabs:[tab(1,{url:'data:text/html,<p>private-token</p>'}),tab(2,{url:'javascript:alert("private-token")'}),tab(3,{url:'file:///C:/private/secret.txt'})]});
  const result=await bridge.list();assert.deepEqual(result.tabs.map(tab=>tab.url),['data:','javascript:','file:']);assert.equal(JSON.stringify(result).includes('private-token'),false);assert.equal(JSON.stringify(result).includes('secret.txt'),false);
});
test('two selected tabs close with one command, exact absence verification and no screenshots',async t=>{
  const bridge=await setup(t),client=await pair(bridge),listed=await bridge.list();
  const result=await bridge.close({snapshot:listed.snapshot,tab_ids:[1,2]});
  assert.equal(result.status,'closed');assert.equal(result.verified,true);assert.deepEqual(result.closed_ids,[1,2]);assert.deepEqual(result.observation.tabs.map(tab=>tab.tab_id),[3]);
  assert.deepEqual(client.commands.map(command=>command.method),['tabs.list','tabs.close']);
  await assert.rejects(bridge.close({snapshot:listed.snapshot,tab_ids:[1,2]}),error=>error.code==='stale_browser_snapshot'&&error.refused);
});
test('activation verifies exact tab, window, URL and active state from fresh inventory',async t=>{
  const bridge=await setup(t),client=await pair(bridge),listed=await bridge.list();
  const result=await bridge.activate({snapshot:listed.snapshot,tab_id:2});assert.equal(result.status,'activated');assert.equal(result.active_id,2);assert.equal(result.verified,true);
  assert.equal(client.commands[1].method,'tabs.activate');assert.equal(result.observation.tabs.find(tab=>tab.tab_id===2).active,true);
});
test('multiple profiles are ambiguous; another browser does not change Opera scope',async t=>{
  const bridge=await setup(t);await pair(bridge);await pair(bridge,{browser:'chrome',clientId:'chrome'});
  await assert.rejects(bridge.list(),error=>error.code==='ambiguous_browser');assert.equal((await bridge.list({browser:'opera'})).browser,'opera');await pair(bridge,{clientId:'second-opera'});
  await assert.rejects(bridge.list(),error=>error.code==='ambiguous_browser');assert.equal((await bridge.list({browser:'chrome'})).browser,'chrome');
});
test('expired snapshots and reconnected sessions cannot act on reused tab IDs',async t=>{
  const bridge=await setup(t);await pair(bridge);const expired=await bridge.list();bridge.snapshots.get(expired.snapshot).created-=31000;
  await assert.rejects(bridge.close({snapshot:expired.snapshot,tab_ids:[1]}),error=>error.code==='stale_browser_snapshot');
  const old=await bridge.list();await pair(bridge,{sessionId:'new-session'});
  await assert.rejects(bridge.activate({snapshot:old.snapshot,tab_id:1}),error=>error.code==='stale_browser_snapshot');assert.equal((await bridge.list()).session_id,'new-session');
});
test('duplicate, unobserved, pinned, pending and excessive selections send no mutation',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{tabs:[tab(1),tab(2,{pinned:true}),tab(3,{pendingUrl:'https://example.com/'})]}),listed=await bridge.list();
  for(const ids of [[1,1],[99],[2],[3],Array.from({length:21},(_,i)=>i)])await assert.rejects(bridge.close({snapshot:listed.snapshot,tab_ids:ids}),error=>error.code==='invalid_browser_targets');
  assert.deepEqual(client.commands.map(command=>command.method),['tabs.list']);
});
test('inventories with private, non-normal, duplicate or malformed records are rejected',async t=>{
  const bridge=await setup(t),client=await pair(bridge);
  for(const tabs of [[tab(1,{incognito:true})],[tab(1,{windowType:'popup'})],[tab(1),tab(1)],[tab(1,{url:'invalid url'})],[tab(1,{active:'true'})]]){
    client.tabs=tabs;await assert.rejects(bridge.list(),error=>error.code==='invalid_browser_result');
  }
});
test('claimed success with tabs still present is unverified and cannot replay through a new snapshot',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:{status:'closed',verified:true,closedIds:[1,2],tabs:client.tabs}}),listed=await bridge.list(),context={activityScope:Symbol('task')};
  const result=await bridge.close({snapshot:listed.snapshot,tab_ids:[1,2]},context);assert.equal(result.verified,false);assert.equal(result.outcome_unknown,true);
  const fresh=await bridge.list();await assert.rejects(bridge.close({snapshot:fresh.snapshot,tab_ids:[1,2]},context),error=>error.code==='browser_outcome_unknown');
  assert.equal(client.commands.filter(command=>command.method==='tabs.close').length,1);
});
test('wrong closed-ID claims and incomplete mutation inventory never prove completion',async t=>{
  const bridge=await setup(t);let result={status:'closed',verified:true,closedIds:[1,1],tabs:[]};
  const client=await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:result});
  const first=await bridge.list();assert.equal((await bridge.close({snapshot:first.snapshot,tab_ids:[1,2]},{activityScope:Symbol()})).outcome_unknown,true);
  result={status:'closed',verified:true,closedIds:[1,2]};const second=await bridge.list();assert.equal((await bridge.close({snapshot:second.snapshot,tab_ids:[1,2]},{activityScope:Symbol()})).outcome_unknown,true);
  result={status:'closed',verified:true,closedIds:[1,2],tabs:[],complete:false};const third=await bridge.list();assert.equal((await bridge.close({snapshot:third.snapshot,tab_ids:[1,2]},{activityScope:Symbol()})).outcome_unknown,true);
  assert.equal(client.commands.filter(command=>command.method==='tabs.close').length,3);
});
test('activation cannot verify a navigated tab despite a claimed matching ID',async t=>{
  const bridge=await setup(t);await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:{status:'activated',verified:true,activeId:1,tabs:[tab(1,{url:'https://attacker.invalid/',active:true})]}});
  const listed=await bridge.list();const result=await bridge.activate({snapshot:listed.snapshot,tab_id:1});assert.equal(result.verified,false);assert.equal(result.outcome_unknown,true);
});
test('activation without verified window focus cannot claim success',async t=>{
  const bridge=await setup(t);await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:{status:'activated',verified:true,activeId:1,tabs:client.tabs}});
  const listed=await bridge.list();assert.equal((await bridge.activate({snapshot:listed.snapshot,tab_id:1})).verified,false);
});
test('explicit pre-input refusals do not fabricate an attempted action or require an inventory',async t=>{
  const bridge=await setup(t);await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:{status:'refused',verified:false,action_attempted:false,code:'stale_target'}});
  const listed=await bridge.list(),result=await bridge.close({snapshot:listed.snapshot,tab_ids:[1]});
  assert.equal(result.status,'refused');assert.equal(result.code,'stale_target');assert.equal(result.action_attempted,false);assert.equal(result.outcome_unknown,undefined);
  await assert.rejects(bridge.close({snapshot:listed.snapshot,tab_ids:[1]}),error=>error.code==='stale_browser_snapshot');
});
test('cancellation before dispatch sends nothing; assertActive is enforced',async t=>{
  const bridge=await setup(t),client=await pair(bridge),controller=new AbortController();controller.abort();
  await assert.rejects(bridge.list({}, {signal:controller.signal}));
  await assert.rejects(bridge.list({}, {assertActive(){throw Error('Stopped');}}),/Stopped/);assert.equal(client.commands.length,0);
});
test('cancellation after dispatch sends cancel and reports an uncertain mutation without replay',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:undefined}),listed=await bridge.list(),controller=new AbortController();
  const pending=bridge.close({snapshot:listed.snapshot,tab_ids:[1,2]},{signal:controller.signal});await waitUntil(()=>client.commands.length===2);controller.abort();
  const result=await pending;assert.equal(result.outcome_unknown,true);assert.equal(result.action_attempted,true);await waitUntil(()=>client.cancels.length===1);assert.equal(client.commands.length,2);
});
test('mutation timeout invalidates targets, sends cancel and rejects repeats',async t=>{
  const bridge=await setup(t,{timeoutMs:30}),client=await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:undefined}),listed=await bridge.list();
  const result=await bridge.close({snapshot:listed.snapshot,tab_ids:[1]});assert.equal(result.outcome_unknown,true);await waitUntil(()=>client.cancels.length===1);
  const fresh=await bridge.list();await assert.rejects(bridge.close({snapshot:fresh.snapshot,tab_ids:[1]}),error=>error.code==='browser_outcome_unknown');assert.equal(client.commands.filter(command=>command.method==='tabs.close').length,1);
});
test('disconnect while mutation is outstanding reports uncertainty and expires snapshots',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:undefined}),listed=await bridge.list();
  const pending=bridge.close({snapshot:listed.snapshot,tab_ids:[1]});await waitUntil(()=>client.commands.length===2);client.ws.close();const result=await pending;assert.equal(result.outcome_unknown,true);await assert.rejects(bridge.list(),error=>error.code==='browser_unavailable');
});
test('a different authenticated profile cannot answer another connection request',async t=>{
  const bridge=await setup(t,{timeoutMs:100}),opera=await pair(bridge,{respond:()=>undefined}),chrome=await pair(bridge,{browser:'chrome',clientId:'chrome'});
  const pending=bridge.list({browser:'opera'});await waitUntil(()=>opera.commands.length===1);const command=opera.commands[0];
  chrome.ws.send(JSON.stringify({type:'result',id:command.id,result:{status:'ok',tabs:[]}}));
  await assert.rejects(pending,error=>error.code==='browser_timeout');assert.equal(bridge.snapshots.size,0);
});
test('stop settles outstanding mutations without waiting for browser and clears credentials from public status',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{respond:(command,client)=>command.method==='tabs.list'?{status:'ok',tabs:client.tabs}:undefined}),listed=await bridge.list();
  const pending=bridge.close({snapshot:listed.snapshot,tab_ids:[1]});await waitUntil(()=>client.commands.length===2);await bridge.stop();assert.equal((await pending).outcome_unknown,true);assert.equal(bridge.status().running,false);assert.equal(JSON.stringify(bridge.status()).includes(token),false);
});
