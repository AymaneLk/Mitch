'use strict';
// Fixed in-memory DOM/Chrome fixtures and authenticated loopback protocol only.
// These tests never navigate a real browser, call a model, or access a site.
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{WebSocket}=require('ws');
const plan=require('../action-plan');
const {createPageAgent}=require('../browser-extension/page-agent');
const {createPageOperations}=require('../browser-extension/page-operations');
const {BrowserBridge}=require('../browser-bridge');
const source='https://fixture.test/menu?private=source-secret',destination='https://fixture.test/repositories?private=destination-secret';
const target={name:'Your repositories',role:'link',match:'exact'},completion=[{target:{name:'Repositories',role:'heading',match:'exact'},condition:'exists'}];
function dom(url,rows){
  const elements=rows.map(row=>({tagName:(row.tag||'a').toUpperCase(),isConnected:true,hidden:false,disabled:false,readOnly:false,attrs:{'aria-label':row.name,...row.attrs},textContent:row.name,innerText:row.name,labels:[],getAttribute(name){return Object.hasOwn(this.attrs,name)?this.attrs[name]:null;},closest(){return null;},matches(){return false;},getBoundingClientRect(){return {left:0,top:0,width:100,height:30};}}));
  const document={querySelectorAll:()=>elements,querySelector:()=>null,getElementById:()=>null};
  const window={location:{href:url},crypto:require('node:crypto').webcrypto,MutationObserver:class{observe(){}disconnect(){}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
  return {elements,agent:createPageAgent({window,document,plan}),window};
}
function fixture(){
  const state={tab:{id:7,windowId:2,url:source,pinned:false,incognito:false,status:'complete'},storage:{},updates:[],creates:[],messages:[],allowed:true,source:dom(source,[{name:target.name,attrs:{href:destination}}])};
  state.current=state.source;
  const api={tabs:{get:async()=>({...state.tab}),update:async(id,options)=>{state.updates.push({id,...options});if(state.updateError)throw Error('Reply lost');state.tab.url=options.url;state.current=dom(options.url,[{tag:'h1',name:state.missing?'Other page':'Repositories'}]);if(state.afterUpdate)state.afterUpdate();return {...state.tab};},sendMessage:async(id,message)=>{state.messages.push(message);if(state.oldAdapter&&message.type==='mitch_page_resolve_link')return {status:'refused',reason:'unsupported_method'};if(state.onMessage)state.onMessage(message);return state.current.agent.handle(message);}},windows:{get:async()=>({id:2,incognito:false,type:'normal'})},permissions:{contains:async()=>state.allowed},scripting:{executeScript:async()=>{}},storage:{session:{get:async key=>({[key]:structuredClone(state.storage[key])}),set:async value=>{if(state.storageError)throw Error('Storage failed');Object.assign(state.storage,structuredClone(value));if(state.afterReserve)state.afterReserve();}}}};
  api.tabs.create=async options=>{state.creates.push(options);if(state.createError)throw Error('Create reply lost');state.tab={...state.tab,id:8,url:options.url,active:true};state.current=dom(options.url,[{tag:'h1',name:'Repositories'}]);state.afterCreate?.();return {...state.tab};};
  const make=()=>createPageOperations(api,{plan}),operations=make(),context=id=>({id,deadline:Date.now()+5000,isCancelled:()=>state.cancelled});
  const observe=()=>operations.execute('page.observe',{expectedTab:{id:7,windowId:2,url:state.tab.url,pinned:false}},context('observe-'+Math.random()));
  const body=async()=>({expectedTab:{id:7,windowId:2,url:state.tab.url,pinned:false},snapshot:(await observe()).snapshot,target,completion});
  return {state,api,make,operations,context,observe,body};
}
test('direct link navigation resolves the DOM href twice, issues once, and proves the new document',async()=>{
  const f=fixture(),args=await f.body(),before=f.state.source.agent;
  const result=await f.operations.execute('page.follow_link',args,f.context('navigate'));
  assert.equal(result.status,'completed');assert.equal(result.verified,true);assert.equal(result.navigation.accepted,true);assert.notEqual(result.navigation.source_document_id,result.observation.document_id);
  assert.deepEqual(f.state.updates,[{id:7,url:destination}]);assert.equal(f.state.messages.filter(m=>m.type==='mitch_page_resolve_link').length,2);assert.equal(f.state.messages.some(m=>m.type==='mitch_page_plan'),false);
  assert.equal(result.delivered_steps[0].op,'follow_link');assert.equal(result.completion[0].passed,true);assert.equal(result.observation.url,destination);
  assert.equal((await f.make().execute('page.follow_link',args,f.context('navigate'))).code,'duplicate_request');assert.equal(f.state.updates.length,1);before.disconnect();
});
test('unsupported links, ambiguous matches, stale snapshots, and invalid instructions send zero navigations',async t=>{
  for(const mode of ['external','javascript','download','newtab','ambiguous','stale','old-agent','missing','malformed'])await t.test(mode,async()=>{
    const f=fixture();if(mode==='external')f.state.source.elements[0].attrs.href='https://other.test/';if(mode==='javascript')f.state.source.elements[0].attrs.href='javascript:alert(1)';if(mode==='download')f.state.source.elements[0].attrs.download='';if(mode==='newtab')f.state.source.elements[0].attrs.target='_blank';if(mode==='ambiguous')f.state.source.elements.push({...f.state.source.elements[0]});if(mode==='old-agent')f.state.oldAdapter=true;if(mode==='missing')f.state.source.elements.length=0;
    const args=await f.body();if(mode==='stale')args.snapshot='not-observed';if(mode==='malformed')args.url='https://invented.test/';
    const result=await f.operations.execute('page.follow_link',args,f.context(mode));assert.equal(result.status,'refused');assert.equal(result.action_attempted,false);assert.equal(f.state.updates.length,0);
  });
});
test('a changed href after durable reservation and cancellation prevent navigation',async()=>{
  for(const mode of ['href','cancel','permission','storage']){
    const f=fixture(),args=await f.body();if(mode==='storage')f.state.storageError=true;
    else f.state.afterReserve=()=>{if(mode==='href')f.state.source.elements[0].attrs.href='https://fixture.test/changed';if(mode==='cancel')f.state.cancelled=true;if(mode==='permission')f.state.allowed=false;};
    const result=await f.operations.execute('page.follow_link',args,f.context(mode));assert.equal(result.action_attempted,false,mode);assert.equal(f.state.updates.length,0,mode);
  }
});
test('link resolution uses the browser resolved anchor URL, including a document base',async()=>{
  const f=fixture();f.state.source.elements[0].attrs.href='repositories';f.state.source.elements[0].href='https://fixture.test/base/repositories';const args=await f.body();
  const result=await f.operations.execute('page.follow_link',args,f.context('base'));assert.equal(result.verified,true);assert.equal(f.state.updates[0].url,'https://fixture.test/base/repositories');
});
test('lost update acknowledgement remains uncertain and cannot repeat after worker restart',async()=>{
  const f=fixture(),args=await f.body();f.state.updateError=true;
  const result=await f.operations.execute('page.follow_link',args,f.context('lost'));
  assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.equal(f.state.updates.length,1);
  assert.equal((await f.make().execute('page.follow_link',args,f.context('lost'))).outcome_unknown,true);assert.equal(f.state.updates.length,1);
});
test('acknowledged navigation with unmet predicates returns a known delivered prefix',async()=>{
  const f=fixture(),args=await f.body();f.state.missing=true;
  const result=await f.operations.execute('page.follow_link',args,f.context('partial'));
  assert.equal(result.status,'interrupted');assert.equal(result.verified,false);assert.equal(result.outcome_unknown,undefined);assert.equal(result.recovery_required,true);assert.equal(result.navigation.accepted,true);assert.equal(result.steps[0].known_delivery,true);assert.equal(result.delivered_steps[0].target.name,target.name);assert.equal(f.state.updates.length,1);
});
test('cross-origin redirects and revoked page permission never become successful navigation proofs',async()=>{
  for(const mode of ['origin','permission']){const f=fixture(),args=await f.body();f.state.afterUpdate=()=>{if(mode==='origin')f.state.tab.url='https://other.test/';else f.state.allowed=false;};const result=await f.operations.execute('page.follow_link',args,f.context(mode));assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.equal(f.state.updates.length,1);}
});
async function connected(t,{navigation=true,alter}={}){
  const f=fixture(),token='z'.repeat(64),extensionId='c'.repeat(32),bridge=new BrowserBridge({token,extensionId,port:0,timeoutMs:500});await bridge.start();t.after(()=>bridge.stop());
  const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}/mitch-browser`,{origin:`chrome-extension://${extensionId}`});ws.on('error',()=>{});await once(ws,'open');
  ws.on('message',async bytes=>{const message=JSON.parse(bytes.toString());if(message.type!=='command')return;let result;if(message.method==='tabs.list')result={status:'ok',tabs:[{...f.state.tab,title:'Fixture',active:true,windowType:'normal'}]};else result=await f.operations.execute(message.method,message.args,{id:message.id,deadline:message.deadline});if(alter&&message.method==='page.follow_link')result=alter(result);ws.send(JSON.stringify({type:'result',id:message.id,result}));});
  const ready=once(ws,'message');ws.send(JSON.stringify({type:'hello',token,clientId:'fixture',sessionId:'session',browser:'opera',capabilities:['pages','page-recovery-v1',...(navigation?['page-navigation-v1']:[])]}));await ready;
  const current=async()=>{const tabs=await bridge.list({browser:'opera'});return bridge.observePage({snapshot:tabs.snapshot,tab_id:7});};
  return {...f,bridge,current};
}
test('bridge verifies actual worker navigation end to end and strips private href queries',async t=>{
  const f=await connected(t),page=await f.current();assert.equal(f.bridge.status().navigationCapable,1);
  const result=await f.bridge.followLink({snapshot:page.snapshot,target,completion});assert.equal(result.verified,true);assert.equal(result.status,'completed');assert.equal(result.observation.url,'https://fixture.test/repositories');assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(result.delivered_steps[0].op,'follow_link');assert.equal(f.state.updates.length,1);
});
test('old extension capability refuses before dispatching link resolution or navigation',async t=>{
  const f=await connected(t,{navigation:false}),page=await f.current();await assert.rejects(f.bridge.followLink({snapshot:page.snapshot,target,completion}),e=>e.code==='page_adapter_update_required');assert.equal(f.state.updates.length,0);assert.equal(f.state.messages.some(m=>m.type==='mitch_page_resolve_link'),false);
});
test('forged destination proofs become uncertain and cannot be replayed through a fresh snapshot',async t=>{
  for(const mode of ['source','target','origin','predicate','proof-document','accepted'])await t.test(mode,async t=>{
    const f=await connected(t,{alter:r=>{if(mode==='source')r.navigation.source_document_id='forged';if(mode==='target')r.navigation.target.name='Another link';if(mode==='origin')r.navigation.final_url='https://other.test/';if(mode==='predicate')r.completion[0].observation.controls=[];if(mode==='proof-document')r.completion[0].observation.document_id='foreign';if(mode==='accepted')r.navigation.accepted=false;return r;}}),context={activityScope:Symbol(mode)},page=await f.current();
    const result=await f.bridge.followLink({snapshot:page.snapshot,target,completion},context);assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);
    const fresh=await f.current();await assert.rejects(f.bridge.followLink({snapshot:fresh.snapshot,target,completion},context),e=>e.code==='browser_outcome_unknown');assert.equal(f.state.updates.length,1);
  });
});
test('known partial navigation blocks equivalent click and link replay but permits reads',async t=>{
  const f=await connected(t),context={activityScope:Symbol('partial')},page=await f.current();f.state.missing=true;
  const result=await f.bridge.followLink({snapshot:page.snapshot,target,completion},context);assert.equal(result.recovery_required,true);assert.equal(result.outcome_unknown,undefined);assert.equal(result.delivered_steps[0].op,'follow_link');
  for(const method of ['link','click']){const fresh=await f.current(),args={snapshot:fresh.snapshot,...(method==='link'?{target,completion}:{steps:[{op:'click',target}],completion})};const repeat=await (method==='link'?f.bridge.followLink(args,context):f.bridge.executePagePlan(args,context));assert.equal(repeat.code,'delivered_step_replay');assert.equal(repeat.action_attempted,false);}
  assert.equal(f.state.updates.length,1);
});
test('explicit tab opening uses one observed normal window and verifies new tab DOM',async()=>{
  const f=fixture(),args={windowIds:[2],url:destination};
  const result=await f.operations.execute('page.open_tab',args,f.context('open'));
  assert.equal(result.status,'opened');assert.equal(result.verified,true);assert.equal(result.creation.accepted,true);assert.equal(result.creation.tab_id,8);assert.equal(result.observation.url,destination);assert.deepEqual(f.state.creates,[{windowId:2,url:destination,active:true}]);
  assert.equal((await f.make().execute('page.open_tab',args,f.context('open'))).code,'duplicate_request');assert.equal(f.state.creates.length,1);
});
test('a created tab may wait on its initial blank document but never injects into it',async()=>{
  const f=fixture();let loaded;f.state.afterCreate=()=>{f.state.tab.url='about:blank';f.state.tab.pendingUrl=destination;f.state.tab.status='loading';loaded=setTimeout(()=>{f.state.tab.url=destination;delete f.state.tab.pendingUrl;f.state.tab.status='complete';},10);};
  f.api.scripting.executeScript=async()=>{assert.equal(f.state.tab.url,destination);assert.equal(f.state.tab.status,'complete');};
  const result=await f.operations.execute('page.open_tab',{windowIds:[2],url:destination},f.context('blank'));clearTimeout(loaded);assert.equal(result.verified,true);assert.equal(result.observation.url,destination);assert.equal(f.state.creates.length,1);
});

test('created tabs wait for an initially empty URL even before Chromium exposes pendingUrl',async()=>{
  for(const initial of ['',undefined,'about:blank']){
    const f=fixture();let loaded,injected=0;f.state.afterCreate=()=>{f.state.tab.url=initial;delete f.state.tab.pendingUrl;f.state.tab.status='complete';loaded=setTimeout(()=>{f.state.tab.url=destination;f.state.tab.status='complete';},10);};
    f.api.scripting.executeScript=async()=>{injected++;assert.equal(f.state.tab.url,destination);};
    const result=await f.operations.execute('page.open_tab',{windowIds:[2],url:destination},f.context('empty-'+String(initial)));clearTimeout(loaded);assert.equal(result.status,'opened');assert.equal(result.verified,true);assert.equal(injected,1);assert.equal(f.state.creates.length,1);
  }
});

test('initial blank tab with a foreign pending URL cannot be injected or recreated',async()=>{
  const f=fixture();let injected=0;f.state.afterCreate=()=>{f.state.tab.url='';f.state.tab.pendingUrl='https://other.test/';f.state.tab.status='loading';};f.api.scripting.executeScript=async()=>{injected++;};
  const args={windowIds:[2],url:destination},result=await f.operations.execute('page.open_tab',args,f.context('foreign-blank'));assert.equal(result.outcome_unknown,true);assert.equal(result.reason,'page_scope_changed');assert.equal(injected,0);assert.equal((await f.make().execute('page.open_tab',args,f.context('foreign-blank'))).code,'duplicate_request');assert.equal(f.state.creates.length,1);
});
test('invalid URL, permission, ambiguous or stale windows, cancellation and ledger errors prevent tab creation',async t=>{
  for(const mode of ['url','credentials','permission','ambiguous','stale','private','cancel','storage'])await t.test(mode,async()=>{
    const f=fixture(),args={windowIds:[2],url:destination};if(mode==='url')args.url='javascript:alert(1)';if(mode==='credentials')args.url='https://user:secret@fixture.test/';if(mode==='permission')f.state.allowed=false;if(mode==='ambiguous'){args.windowIds=[2,3];f.api.windows.get=async id=>({id,type:'normal',incognito:false});}if(mode==='stale')f.api.windows.get=async()=>({id:3,type:'normal',incognito:false});if(mode==='private')f.api.windows.get=async()=>({id:2,type:'normal',incognito:true});if(mode==='cancel')f.state.cancelled=true;if(mode==='storage')f.state.storageError=true;
    const result=await f.operations.execute('page.open_tab',args,f.context(mode));assert.equal(result.status,'refused');assert.equal(result.action_attempted,false);assert.equal(f.state.creates.length,0);
  });
});
test('lost creation reply and cross-origin new-tab redirects remain unknown and cannot replay',async()=>{
  for(const mode of ['lost','origin']){const f=fixture(),args={windowIds:[2],url:destination};if(mode==='lost')f.state.createError=true;else f.state.afterCreate=()=>{f.state.tab.url='https://other.test/';};const result=await f.operations.execute('page.open_tab',args,f.context(mode));assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.equal((await f.make().execute('page.open_tab',args,f.context(mode))).outcome_unknown,true);assert.equal(f.state.creates.length,1);}
});
test('bridge opens in the profile bound to its inventory and sanitizes tab receipt',async t=>{
  const f=await connected(t),tabs=await f.bridge.list({browser:'opera'}),result=await f.bridge.openTab({snapshot:tabs.snapshot,url:destination});
  assert.equal(result.status,'opened');assert.equal(result.verified,true);assert.equal(result.tab_id,8);assert.equal(result.window_id,2);assert.equal(result.observation.window_id,2);assert.equal(result.observation.browser,'opera');assert.equal(result.observation.tab_id,8);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(f.state.creates.length,1);
});
test('unknown tab creation blocks another open in the same task even after fresh inventory',async t=>{
  const f=await connected(t),context={activityScope:Symbol('open-unknown')};f.state.createError=true;const tabs=await f.bridge.list({browser:'opera'}),result=await f.bridge.openTab({snapshot:tabs.snapshot,url:destination},context);assert.equal(result.outcome_unknown,true);
  const fresh=await f.bridge.list({browser:'opera'});await assert.rejects(f.bridge.openTab({snapshot:fresh.snapshot,url:destination},context),error=>error.code==='browser_outcome_unknown');assert.equal(f.state.creates.length,1);
});
