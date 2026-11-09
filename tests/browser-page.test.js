'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPageOperations}=require('../browser-extension/page-operations');
const {createPageAgent}=require('../browser-extension/page-agent');
const plan=require('../action-plan');
const target=(role,name)=>({role,name,match:'exact'});
const expected={id:7,windowId:2,url:'http://fixture.test:4321/form',pinned:false};
const body={expectedTab:expected,snapshot:'doc:1',steps:[{op:'click',target:target('button','Save')}],completion:[{target:target('button','Saved'),condition:'exists'}]};
function operationsFixture(){
  const state={tab:{...expected,status:'complete'},allowed:true,storage:{},calls:[],reply:{status:'completed',verified:true},cancelled:false};
  const api={tabs:{get:async()=>{state.onGet?.();return {...state.tab};},sendMessage:async(id,message,options)=>{state.calls.push({kind:'send',id,message,options});return state.onSend?state.onSend(message):state.reply;}},windows:{get:async()=>({id:2,type:'normal',incognito:false})},permissions:{contains:async request=>{state.permission=request;return state.allowed;}},scripting:{executeScript:async request=>{state.calls.push({kind:'inject',request});state.afterInject?.();}},storage:{session:{get:async key=>({[key]:state.storage[key]?structuredClone(state.storage[key]):undefined}),set:async data=>{if(state.storageError)throw Error('storage unavailable');Object.assign(state.storage,structuredClone(data));}}}};
  const make=()=>createPageOperations(api),context=id=>({id,deadline:Date.now()+1000,isCancelled:()=>state.cancelled});
  return {state,api,make,operations:make(),context};
}
test('page observation checks exact host permission and injects only fixed isolated top-frame files',async()=>{
  const {operations,state,context}=operationsFixture();state.reply={status:'observed',snapshot:'doc:1',controls:[],complete:true};
  assert.equal((await operations.execute('page.observe',{expectedTab:expected},context('read'))).status,'observed');
  assert.deepEqual(state.permission,{origins:['http://fixture.test/*']});
  assert.deepEqual(state.calls[0].request,{target:{tabId:7,frameIds:[0]},world:'ISOLATED',files:['action-plan.js','page-agent.js']});
  assert.deepEqual(state.calls[1].options,{frameId:0});assert.equal(state.calls[1].message.type,'mitch_page_observe');
});
test('permission, navigation, private tabs and unsupported URLs stop before injection or input',async()=>{
  for(const mode of ['permission','navigating','private','url','window','pinned']){
    const {operations,state,context}=operationsFixture();let args=body;
    if(mode==='permission')state.allowed=false;if(mode==='navigating')state.tab.pendingUrl=expected.url;if(mode==='private')state.tab.incognito=true;
    if(mode==='url')args={...body,expectedTab:{...expected,url:'chrome://settings/'}};if(mode==='window')state.tab.windowId=5;if(mode==='pinned')state.tab.pinned=true;
    const result=await operations.execute('page.plan',args,context(mode));assert.equal(result.status,'refused',mode);assert.equal(state.calls.length,0,mode);
  }
});
test('tab identity is revalidated after injection, with no plan sent when it changed',async()=>{
  const {operations,state,context}=operationsFixture();state.afterInject=()=>{state.tab.url='https://other.test/';};
  assert.equal((await operations.execute('page.plan',body,context('race'))).code,'stale_target');assert.equal(state.calls.filter(c=>c.kind==='send').length,0);
});
test('durable at-most-once page ledger prevents replay even after worker restart',async()=>{
  const {operations,state,context,make}=operationsFixture();assert.equal((await operations.execute('page.plan',body,context('once'))).verified,true);
  const duplicate=await make().execute('page.plan',body,context('once'));assert.equal(duplicate.code,'duplicate_request');assert.equal(state.calls.filter(c=>c.kind==='send').length,1);
});
test('uncertain page delivery is not replayed and ledger failure prevents first delivery',async()=>{
  const {operations,state,context,make}=operationsFixture();state.onSend=()=>{throw Error('Frame navigated');};
  const result=await operations.execute('page.plan',body,context('lost'));assert.equal(result.outcome_unknown,true);
  assert.equal((await make().execute('page.plan',body,context('lost'))).outcome_unknown,true);assert.equal(state.calls.filter(c=>c.kind==='send'&&c.message.type==='mitch_page_plan').length,1);
  state.storageError=true;const failed=await operations.execute('page.plan',body,context('storage'));assert.equal(failed.action_attempted,false);assert.equal(state.calls.filter(c=>c.kind==='send'&&c.message.type==='mitch_page_plan').length,1);
});

test('lost page-plan reply after same-origin navigation recovers only a fresh read without replaying input',async()=>{
  const f=operationsFixture(),destination='http://fixture.test:4321/repositories';
  f.state.onSend=message=>{
    if(message.type==='mitch_page_plan'){f.state.tab.url=destination;throw Error('Old document reply port closed');}
    if(message.type==='mitch_page_cancel')return {status:'cancelled'};
    assert.equal(message.type,'mitch_page_observe');assert.equal(message.expectedUrl,destination);
    return {status:'observed',snapshot:'new-doc:1',document_id:'new-doc',url:destination,complete:true,controls:[{id:'e1',role:'heading',name:'Repositories'}]};
  };
  const result=await f.operations.execute('page.plan',body,f.context('navigation'));
  assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.equal(result.recovery_required,true);assert.equal(result.recovery_kind,'read_only_after_input');assert.equal(result.observation.document_id,'new-doc');
  assert.deepEqual(f.state.calls.filter(c=>c.kind==='send').map(c=>c.message.type),['mitch_page_plan','mitch_page_cancel','mitch_page_observe']);
  assert.equal(f.state.calls.filter(c=>c.kind==='inject').length,2);
  assert.equal((await f.make().execute('page.plan',body,f.context('navigation'))).outcome_unknown,true);assert.equal(f.state.calls.filter(c=>c.kind==='send'&&c.message.type==='mitch_page_plan').length,1);
});

test('an explicitly uncertain page reply receives read-only evidence while preserving its unknown outcome',async()=>{
  const f=operationsFixture();f.state.onSend=message=>message.type==='mitch_page_plan'?{status:'interrupted',verified:false,outcome_unknown:true,reason:'observation_failed'}:message.type==='mitch_page_cancel'?{status:'cancelled'}:{status:'observed',snapshot:'same-doc:2',document_id:'same-doc',url:expected.url,complete:true,controls:[]};
  const result=await f.operations.execute('page.plan',body,f.context('explicit-unknown'));
  assert.equal(result.outcome_unknown,true);assert.equal(result.reason,'observation_failed');assert.equal(result.recovery_kind,'read_only_after_input');assert.equal(result.observation.snapshot,'same-doc:2');
  assert.equal(f.state.calls.filter(c=>c.kind==='send'&&c.message.type==='mitch_page_plan').length,1);
});

test('read-only recovery refuses changed tab scope, revoked permission, and cancellation',async()=>{
  for(const mode of ['origin','pending-origin','window','private','permission','cancel']){
    const f=operationsFixture();f.state.onSend=message=>{
      assert.equal(message.type,'mitch_page_plan','No recovery message may be sent to an ineligible tab');
      if(mode==='origin')f.state.tab.url='https://other.test/repositories';
      if(mode==='pending-origin')f.state.tab.pendingUrl='https://other.test/repositories';
      if(mode==='window')f.state.tab.windowId=3;
      if(mode==='private')f.state.tab.incognito=true;
      if(mode==='permission')f.state.allowed=false;
      if(mode==='cancel')f.state.cancelled=true;
      throw Error('Reply lost');
    };
    const result=await f.operations.execute('page.plan',body,f.context('scope-'+mode));
    assert.equal(result.outcome_unknown,true,mode);assert.equal(result.observation,undefined,mode);assert.equal(result.recovery_kind,undefined,mode);assert.equal(f.state.calls.filter(c=>c.kind==='inject').length,1,mode);
    assert.equal(result.recovery_error,mode==='permission'?'page_permission_required':mode==='cancel'?'cancelled':'recovery_scope_changed',mode);
  }
});

test('read-only recovery waits for same-origin loading but never exceeds the remaining request deadline',async()=>{
  const f=operationsFixture();let finishLoading;
  f.state.onSend=message=>{
    if(message.type==='mitch_page_plan'){f.state.tab.status='loading';finishLoading=setTimeout(()=>{f.state.tab.status='complete';},10);throw Error('Document replaced');}
    if(message.type==='mitch_page_cancel')return {status:'cancelled'};
    assert.equal(f.state.tab.status,'complete');return {status:'observed',snapshot:'loaded:1',document_id:'loaded',url:expected.url,complete:true,controls:[]};
  };
  const result=await f.operations.execute('page.plan',body,f.context('loading'));clearTimeout(finishLoading);
  assert.equal(result.recovery_kind,'read_only_after_input');assert.equal(result.outcome_unknown,true);assert.equal(f.state.calls.filter(c=>c.kind==='send'&&c.message.type==='mitch_page_plan').length,1);
  const g=operationsFixture();g.state.onSend=message=>{if(message.type==='mitch_page_plan'){g.state.tab.status='loading';throw Error('Document replaced');}assert.equal(message.type,'mitch_page_cancel');return {status:'cancelled'};};
  const expired=await g.operations.execute('page.plan',body,{...g.context('never-ready'),deadline:Date.now()+25});
  assert.equal(expired.outcome_unknown,true);assert.equal(expired.observation,undefined);assert.ok(['deadline_exceeded','recovery_timeout'].includes(expired.recovery_error));assert.equal(g.state.calls.filter(c=>c.kind==='inject').length,1);
});
test('cancellation before issuance prevents input; in-flight cancel is delivered to the exact top frame',async()=>{
  const {operations,state,context}=operationsFixture();state.afterInject=()=>{state.cancelled=true;};
  assert.equal((await operations.execute('page.plan',body,context('stopped'))).status,'cancelled');assert.equal(state.calls.filter(c=>c.kind==='send').length,0);
  state.cancelled=false;state.afterInject=null;let release,entered;const begun=new Promise(resolve=>entered=resolve);
  state.onSend=message=>{if(message.type==='mitch_page_plan'){entered();return new Promise(resolve=>release=resolve);}return {status:'cancelled'};};
  const pending=operations.execute('page.plan',body,context('running'));await begun;await operations.cancel('running');release({status:'interrupted',verified:false,reason:'cancelled'});await pending;
  assert.equal(state.calls.at(-1).message.type,'mitch_page_cancel');assert.deepEqual(state.calls.at(-1).options,{frameId:0});
});

function domFixture(){
  let observer;const state={elements:[],clicks:[],occluded:false};
  class Element {
    constructor(tag,name,attrs={}){this.tagName=tag.toUpperCase();this.attrs={'aria-label':name,...attrs};this.id=attrs.id||'';this.type=attrs.type||(tag==='input'?'text':'');this.isConnected=true;this.hidden=false;this.disabled=false;this.readOnly=false;this.isContentEditable=false;this.textContent=name;this.innerText=name;this.labels=[];this._value='';this.rect={left:10,top:10,width:100,height:30};}
    getAttribute(name){return Object.hasOwn(this.attrs,name)?this.attrs[name]:null;}
    closest(){return this.hidden?this:null;}
    matches(){return this.disabled;}
    getBoundingClientRect(){return this.rect;}
    contains(other){return other===this;}
    scrollIntoView(){}
    focus(){document.activeElement=this;}
    dispatchEvent(event){this.events??=[];this.events.push(event.type);observer?.();return true;}
    click(){state.clicks.push(this.attrs['aria-label']);this.onClick?.();observer?.();}
  }
  class Input extends Element{get value(){return this._value;}set value(value){this._value=value;}}
  const document={activeElement:null,querySelectorAll:()=>state.elements,querySelector:()=>null,getElementById:id=>state.elements.find(item=>item.id===id),elementFromPoint:()=>state.occluded?{}:state.hit||state.elements[0]};
  const window={location:{href:expected.url},innerWidth:1000,innerHeight:800,crypto:require('node:crypto').webcrypto,MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),Event:class{constructor(type){this.type=type;}},HTMLInputElement:Input,HTMLTextAreaElement:Input};
  const add=(tag,name,attrs)=>{const element=new (['input','textarea'].includes(tag)?Input:Element)(tag,name,attrs);state.elements.push(element);return element;};
  const agent=createPageAgent({window,document,plan}),message=(type,fields={})=>({type,id:'dom-'+Math.random(),deadline:Date.now()+1000,expectedUrl:window.location.href,...fields});
  const observe=()=>agent.handle(message('mitch_page_observe'));
  const execute=async(steps,completion)=>{const frame=await observe();return agent.handle(message('mitch_page_plan',{snapshot:frame.snapshot,steps,completion}));};
  return {state,window,document,add,agent,message,observe,execute};
}
test('DOM observation exposes names/roles, omits protected values and hides invisible controls',async()=>{
  const {add,observe}=domFixture();add('input','Search').value='ordinary';add('input','Password',{type:'password'}).value='NEVER-EXPOSE';add('button','Hidden').hidden=true;
  const frame=await observe();assert.equal(frame.complete,true);assert.deepEqual(frame.controls.map(control=>control.name),['Search','Password']);
  assert.equal(frame.controls[0].role,'textbox');assert.equal(frame.controls[1].protected,true);assert.equal('value' in frame.controls[1],false);assert.equal(JSON.stringify(frame).includes('NEVER-EXPOSE'),false);
});
test('associated labels protect secrets even when the input has an opaque id',async()=>{
  const {add,observe}=domFixture();const input=add('input','', {id:'opaque123'});input.labels=[{textContent:'API key'}];input.value='NEVER-EXPOSE';
  const frame=await observe();assert.equal(frame.controls[0].name,'API key');assert.equal(frame.controls[0].protected,true);assert.equal(JSON.stringify(frame).includes('NEVER-EXPOSE'),false);
});
test('DOM plan fills with native setter and verifies the resulting live value',async()=>{
  const {add,execute}=domFixture();const input=add('input','Search');
  const result=await execute([{op:'fill',target:target('textbox','Search'),text:'Alpha'}],[{target:target('textbox','Search'),condition:'value',value:'Alpha'}]);
  assert.equal(result.verified,true,JSON.stringify(result));assert.equal(input.value,'Alpha');assert.deepEqual(input.events,['input','change']);
});
test('DOM dynamic controls resolve after earlier steps, with unique completion readback',async()=>{
  const {add,state,execute}=domFixture();const open=add('button','Open');
  open.onClick=()=>{open.isConnected=false;state.elements=[];const save=add('button','Save');state.hit=save;save.onClick=()=>{save.isConnected=false;state.elements=[];state.hit=add('button','Saved');};};
  const result=await execute([{op:'click',target:target('button','Open')},{op:'click',target:target('button','Save')}],[{target:target('button','Saved'),condition:'exists'}]);
  assert.equal(result.verified,true,JSON.stringify(result));assert.deepEqual(state.clicks,['Open','Save']);
});
test('focus-triggered rerenders and newly readonly fields stop before the native setter',async()=>{
  const f=domFixture();const input=f.add('input','Search');input.focus=()=>{f.document.activeElement=input;input.isConnected=false;};
  let result=await f.execute([{op:'fill',target:target('textbox','Search'),text:'unsafe'}],[{target:target('textbox','Search'),condition:'value',value:'unsafe'}]);assert.equal(result.verified,false);assert.equal(input.value,'');
  const g=domFixture();const readonly=g.add('input','Search');readonly.focus=()=>{g.document.activeElement=readonly;readonly.readOnly=true;};
  result=await g.execute([{op:'fill',target:target('textbox','Search'),text:'unsafe'}],[{target:target('textbox','Search'),condition:'value',value:'unsafe'}]);assert.equal(result.reason,'stale_control');assert.equal(readonly.value,'');assert.notEqual(result.outcome_unknown,true);
});
test('duplicate controls, occlusion, and stale elements refuse instead of guessing clicks',async()=>{
  const f=domFixture();f.add('button','Save');f.add('button','Save');let result=await f.execute([{op:'click',target:target('button','Save')}],[{target:target('button','Saved'),condition:'exists'}]);assert.equal(result.reason,'ambiguous_target');assert.equal(f.state.clicks.length,0);
  const g=domFixture();g.add('button','Save');g.state.occluded=true;result=await g.execute([{op:'click',target:target('button','Save')}],[{target:target('button','Saved'),condition:'exists'}]);assert.equal(result.reason,'occluded_control');assert.equal(g.state.clicks.length,0);assert.notEqual(result.outcome_unknown,true);
  const h=domFixture();const element=h.add('button','Save'),frame=await h.observe();element.attrs['aria-label']='Delete';await assert.rejects(h.agent.adapter.act({op:'click'},frame.controls[0],{}),error=>error.code==='stale_control');assert.equal(h.state.clicks.length,0);
});

test('acknowledged menu opening returns the full fresh menu when a later guessed target is missing',async()=>{
  const f=domFixture(),profile=f.add('button','Open user navigation menu');
  profile.onClick=()=>{f.state.hit=f.add('a','Repositories',{role:'menuitem'});};
  const result=await f.execute([
    {op:'click',target:target('button','Open user navigation menu')},
    {op:'click',target:target('link','Your repositories'),timeout_ms:10},
  ],[{target:target('heading','My repositories'),condition:'exists'}]);
  assert.equal(result.status,'interrupted');assert.equal(result.reason,'condition_unmet');assert.notEqual(result.outcome_unknown,true);assert.equal(result.recovery_required,true);
  assert.deepEqual(f.state.clicks,['Open user navigation menu']);
  assert.deepEqual(result.observation.controls.map(control=>[control.role,control.name]),[['button','Open user navigation menu'],['menuitem','Repositories']]);
  assert.equal(result.observation.complete,true);
  assert.deepEqual(result.delivered_steps,[{index:0,op:'click',target:target('button','Open user navigation menu')}]);
});

test('an exception after DOM dispatch remains unknown and is never represented as a pre-input refusal',async()=>{
  const f=domFixture(),button=f.add('button','Submit');button.onClick=()=>{throw Error('Event processing failed after dispatch');};
  const result=await f.execute([{op:'click',target:target('button','Submit')}],[{target:target('heading','Sent'),condition:'exists'}]);
  assert.equal(result.status,'interrupted');assert.equal(result.outcome_unknown,true);assert.deepEqual(f.state.clicks,['Submit']);
});

test('full final overview may be partial while selector-scoped completion proof remains complete',async()=>{
  const f=domFixture();for(let i=0;i<305;i++)f.add('button','Button '+i);
  const result=await f.execute([{op:'assert',target:target('button','Button 304'),condition:'exists'}],[{target:target('button','Button 304'),condition:'exists'}]);
  assert.equal(result.verified,true);assert.equal(result.observation.complete,false);assert.equal(result.observation.controls.length,300);
  assert.equal(result.completion[0].passed,true);assert.equal(result.completion[0].observation.complete,true);assert.deepEqual(result.completion[0].observation.controls.map(control=>control.name),['Button 304']);
});
test('synthetic keys with no dependable native default are refused, not falsely reported completed',async()=>{
  const {add,execute,state}=domFixture();add('input','Search');const result=await execute([{op:'press',target:target('textbox','Search'),key:'Enter'}],[{target:target('textbox','Search'),condition:'exists'}]);assert.equal(result.verified,false);assert.equal(result.reason,'action_interrupted');assert.equal(state.clicks.length,0);
});
test('stale page snapshot and changed origin stop without actions',async()=>{
  const {agent,add,message,state,window}=domFixture();add('button','Save');
  const result=await agent.handle(message('mitch_page_plan',{snapshot:'not-this-document',steps:body.steps,completion:body.completion}));assert.equal(result.reason,'stale_snapshot');assert.equal(state.clicks.length,0);
  window.location.href='https://other.test';const observation=await agent.handle(message('mitch_page_observe'));assert.equal(observation.reason,'navigation_changed');
});
test('large DOM snapshots report incompleteness while a specific selector remains bounded and complete',async()=>{
  const {add,observe,agent,message}=domFixture();for(let i=0;i<305;i++)add('button','Button '+i);assert.equal((await observe()).complete,false);
  const frame=await agent.handle(message('mitch_page_observe',{selector:target('button','Button 304')}));assert.equal(frame.complete,true);assert.equal(frame.controls.length,1);
});
