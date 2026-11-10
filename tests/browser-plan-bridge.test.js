'use strict';
// Host protocol tests use only authenticated fake workers on a temporary
// loopback port. No extension, real browser, page or model is involved.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const {BrowserBridge}=require('../browser-bridge');
const {validatePlan}=require('../action-plan');
const token='p'.repeat(64),extensionId='b'.repeat(32),origin=`chrome-extension://${extensionId}`;
const exact=(name)=>({role:'button',name,match:'exact'});
const plan=validatePlan({steps:[{op:'click',target:exact('Save')}],completion:[{target:exact('Saved Alpha'),condition:'exists'}]});
const tab=()=>({id:7,windowId:4,url:'https://records.example.test/editor?private=test-secret#record',title:'Owned record',active:true,pinned:false,incognito:false,windowType:'normal'});
let sequence=0;
const frame=(name='Save',extra={})=>({status:'observed',snapshot:`worker-page-${++sequence}`,document_id:'document-a',url:tab().url,origin:'https://records.example.test',complete:true,revision:sequence,controls:[{id:`control-${sequence}`,role:'button',name,enabled:true,editable:false,protected:false}],...extra});
const success=(extra={})=>{
  const observation=frame('Saved Alpha');
  return {status:'completed',verified:true,completed:1,attempted:1,steps:[{index:0,op:'click',target:exact('Save'),status:'delivered',verified:false}],observation,completion:[{...plan.completion[0],passed:true,observation:structuredClone(observation)}],stats:{actions:1,observations:2},...extra};
};
async function setup(t){const bridge=new BrowserBridge({token,extensionId,port:0,timeoutMs:300});await bridge.start();t.after(()=>bridge.stop());return bridge;}
async function pair(bridge,{capabilities=['pages','page-recovery-v1'],sessionId='worker-a',clientId='owned-profile',handler}={}){
  const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}/mitch-browser`,{origin});ws.on('error',()=>{});await once(ws,'open');
  const client={ws,commands:[],cancels:[],handler};
  ws.on('message',async raw=>{
    const message=JSON.parse(raw.toString());if(message.type==='cancel'){client.cancels.push(message.id);return;}if(message.type!=='command')return;
    client.commands.push(message);let result;
    if(client.handler)result=await client.handler(message,client);
    else result=message.method==='tabs.list'?{status:'ok',tabs:[tab()]}:message.method==='page.observe'?frame():success();
    if(result!==undefined&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'result',id:message.id,result}));
  });
  const ready=once(ws,'message');ws.send(JSON.stringify({type:'hello',token,clientId,sessionId,browser:'opera',capabilities}));assert.equal(JSON.parse((await ready)[0]).type,'ready');return client;
}
const current=async(bridge,context={})=>{const tabs=await bridge.list({browser:'opera'},context);return bridge.observePage({snapshot:tabs.snapshot,tab_id:7},context);};
const planCalls=client=>client.commands.filter(command=>command.method==='page.plan');
test('a fresh page receipt refreshes the same tab without an extra inventory request',async t=>{
 const bridge=await setup(t),client=await pair(bridge),page=await current(bridge);const next=await bridge.observePage({snapshot:page.snapshot,tab_id:7});assert.equal(next.source,'browser_dom');assert.notEqual(next.snapshot,page.snapshot);assert.deepEqual(client.commands.map(c=>c.method),['tabs.list','page.observe','page.observe']);assert.equal(client.commands.at(-1).args.expectedTab.url,tab().url);
 await assert.rejects(bridge.observePage({snapshot:page.snapshot,tab_id:8}),e=>e.code==='invalid_page_target');bridge.pageSnapshots.get(page.snapshot).created-=31000;await assert.rejects(bridge.observePage({snapshot:page.snapshot,tab_id:7}),e=>e.code==='stale_browser_snapshot');assert.equal(client.commands.length,3);
});
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.fail('Expected protocol event did not arrive.');}

test('an old worker cannot read or act on pages before it declares page support',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{capabilities:[]}),tabs=await bridge.list();
  await assert.rejects(bridge.observePage({snapshot:tabs.snapshot,tab_id:7}),error=>error.code==='page_adapter_unavailable'&&error.refused===true);
  assert.deepEqual(client.commands.map(command=>command.method),['tabs.list']);assert.equal(bridge.pageSnapshots.size,0);
});

test('a missing site permission is returned as a pre-input refusal without a page snapshot',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:{status:'refused',action_attempted:false,verified:false,code:'page_permission_required',message:'Enable this test host first.'}});
  const result=await current(bridge);assert.equal(result.status,'refused');assert.equal(result.action_attempted,false);assert.equal(result.code,'page_permission_required');assert.equal(result.snapshot,undefined);assert.equal(bridge.pageSnapshots.size,0);assert.equal(planCalls(client).length,0);
});

test('observed page identity stays private while a valid completed plan carries bounded verified evidence',async t=>{
  const bridge=await setup(t),client=await pair(bridge),page=await current(bridge);
  assert.equal(page.url,'https://records.example.test/editor');assert.equal(page.source,'browser_dom');assert.equal(page.untrusted_page_data,true);assert.notEqual(page.snapshot,client.commands[1].args.snapshot);
  const originalWorkerToken=bridge.pageSnapshots.get(page.snapshot).frame.snapshot;
  const result=await bridge.executePagePlan({snapshot:page.snapshot,...plan},{activityScope:Symbol('valid')});
  assert.equal(result.status,'completed');assert.equal(result.verified,true);assert.equal(result.observation.complete,true);
  assert.deepEqual(planCalls(client)[0].args,{expectedTab:{id:7,windowId:4,url:tab().url,pinned:false},snapshot:originalWorkerToken,...plan});
  assert.equal(JSON.stringify(result).includes('test-secret'),false,'Raw URLs in assertion proofs must not leak into model output.');
  assert.equal(result.completion.length,1);assert.equal(result.completion[0].passed,true);
});

test('expired, consumed and superseded-session page snapshots cannot dispatch input',async t=>{
  const bridge=await setup(t),client=await pair(bridge);let page=await current(bridge);bridge.pageSnapshots.get(page.snapshot).created-=31000;
  await assert.rejects(bridge.executePagePlan({snapshot:page.snapshot,...plan}),error=>error.code==='stale_page_snapshot');assert.equal(planCalls(client).length,0);
  page=await current(bridge);await bridge.executePagePlan({snapshot:page.snapshot,...plan});
  await assert.rejects(bridge.executePagePlan({snapshot:page.snapshot,...plan}),error=>error.code==='stale_page_snapshot');assert.equal(planCalls(client).length,1);
  const old=await current(bridge),replacement=await pair(bridge,{sessionId:'worker-b'});
  await assert.rejects(bridge.executePagePlan({snapshot:old.snapshot,...plan}),error=>error.code==='stale_page_snapshot');assert.equal(planCalls(replacement).length,0);
});

test('permission revoked before plan dispatch consumes the snapshot but does not invent uncertain input',async t=>{
  let refuse=true;
  const bridge=await setup(t),client=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?frame():refuse?{status:'refused',action_attempted:false,verified:false,code:'page_permission_required'}:success()}),context={activityScope:Symbol('revoked')};
  let page=await current(bridge),result=await bridge.executePagePlan({snapshot:page.snapshot,...plan},context);
  assert.equal(result.status,'refused');assert.equal(result.action_attempted,false);assert.equal(result.outcome_unknown,undefined);
  await assert.rejects(bridge.executePagePlan({snapshot:page.snapshot,...plan},context),error=>error.code==='stale_page_snapshot');
  refuse=false;page=await current(bridge);result=await bridge.executePagePlan({snapshot:page.snapshot,...plan},context);assert.equal(result.verified,true);assert.equal(planCalls(client).length,2);
});

test('malformed completion claims become uncertain and cannot replay through a fresh page snapshot',async t=>{
  const cases=[
    ['unverified completion',()=>success({verified:false})],
    ['missing assertion proof',()=>{const result=success();delete result.completion[0].observation;return result;}],
    ['unrelated assertion target',()=>{const result=success();result.completion[0].target=exact('An unrelated outcome');return result;}],
    ['false assertion against current proof',()=>{const result=success();result.completion[0].observation.controls=[];return result;}],
    ['incomplete assertion proof',()=>{const result=success();result.completion[0].observation.complete=false;return result;}],
    ['foreign assertion document',()=>{const result=success();result.completion[0].observation.document_id='document-from-another-page';return result;}],
    ['foreign assertion origin',()=>{const result=success();result.completion[0].observation.url='https://other.example.test/';return result;}],
    ['missing steps',()=>success({steps:[]})],
    ['impossible input count',()=>success({attempted:0})],
    ['replaced final document',()=>success({observation:frame('Saved Alpha',{document_id:'new-document'})})],
    ['foreign final origin',()=>success({observation:frame('Saved Alpha',{url:'https://other.example.test/'})})],
  ];
  for(const [label,make] of cases)await t.test(label,async t=>{
    const bridge=await setup(t),client=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?frame():make()}),context={activityScope:Symbol(label)};
    const page=await current(bridge),result=await bridge.executePagePlan({snapshot:page.snapshot,...plan},context);assert.equal(result.verified,false);assert.equal(result.outcome_unknown,true,label);
    const fresh=await current(bridge,context);assert.equal(fresh.complete,true,'Read-only recovery must remain available.');
    await assert.rejects(bridge.executePagePlan({snapshot:fresh.snapshot,...plan},context),error=>error.code==='browser_outcome_unknown');assert.equal(planCalls(client).length,1);
  });
});

test('a partial overview does not invalidate complete scoped completion proofs',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?frame():success({observation:frame('Saved Alpha',{complete:false})})});
  const page=await current(bridge),result=await bridge.executePagePlan({snapshot:page.snapshot,...plan});
  assert.equal(result.status,'completed');assert.equal(result.verified,true);assert.equal(result.outcome_unknown,undefined);
  assert.equal(result.observation.complete,false);assert.equal(result.completion[0].observation.complete,true);assert.equal(planCalls(client).length,1);
});

const profileTarget={role:'button',name:'Open user navigation menu',match:'exact'};
const repositoriesTarget={role:'link',name:'Your repositories',match:'exact'};
const menuPlan=validatePlan({steps:[{op:'click',target:{role:'button',name:'user navigation',match:'contains'}},{op:'click',target:{role:'link',name:'My repositories',match:'exact'}}],completion:[{target:repositoriesTarget,condition:'exists'}]});
const repositoryPlan=validatePlan({steps:[{op:'click',target:repositoriesTarget}],completion:[{target:{role:'heading',name:'Repositories'},condition:'exists'}]});
const profileReplay=validatePlan({steps:[{op:'click',target:profileTarget}],completion:[{target:profileTarget,condition:'exists'}]});
const profilePress=validatePlan({steps:[{op:'press',target:profileTarget,key:'Enter'}],completion:[{target:profileTarget,condition:'exists'}]});
const menuFrame=(extra={})=>frame('Open user navigation menu',{controls:[{id:'profile-control',name:profileTarget.name,role:'button',enabled:true},{id:'repositories-control',name:repositoriesTarget.name,role:'link',enabled:true}],...extra});
const interruptedMenu=()=>({
  status:'interrupted',verified:false,recovery_required:true,reason:'condition_unmet',completed:1,attempted:1,
  steps:[{index:0,op:'click',target:menuPlan.steps[0].target,status:'delivered',delivery:'issued',verified:false,known_delivery:true,resolved_target:profileTarget},{index:1,op:'click',target:menuPlan.steps[1].target,status:'interrupted'}],
  delivered_steps:[{index:0,op:'click',target:profileTarget}],observation:menuFrame(),completion:[],stats:{actions:1,observations:3},
});
const completedPlan=(requested,observed)=>({
  status:'completed',verified:true,completed:requested.steps.length,attempted:requested.steps.filter(step=>!['wait','assert'].includes(step.op)).length,
  steps:requested.steps.map((step,index)=>({index,op:step.op,target:step.target,status:['wait','assert'].includes(step.op)?'passed':'delivered',verified:true,...(!['wait','assert'].includes(step.op)?{known_delivery:true,resolved_target:step.target}:{})})),
  delivered_steps:requested.steps.flatMap((step,index)=>['wait','assert'].includes(step.op)?[]:[{index,op:step.op,target:step.target,...(step.key?{key:step.key}:{})}]),
  observation:observed,completion:requested.completion.map(assertion=>({...assertion,passed:true,observation:structuredClone(observed)})),stats:{actions:1,observations:2},
});

test('a partial acknowledged menu plan blocks its delivered prefix but allows a distinct current menu item',async t=>{
  let opened=false;
  const handler=command=>{
    if(command.method==='tabs.list')return {status:'ok',tabs:[tab()]};
    if(command.method==='page.observe')return opened?menuFrame():frame(profileTarget.name);
    if(command.args.steps.length===2){opened=true;return interruptedMenu();}
    return completedPlan(validatePlan({steps:command.args.steps,completion:command.args.completion}),frame('Repositories',{controls:[{id:'repos-heading',name:'Repositories',role:'heading',enabled:true}]}));
  };
  const bridge=await setup(t),client=await pair(bridge,{handler}),context={activityScope:Symbol('menu-task')};
  let page=await current(bridge),result=await bridge.executePagePlan({snapshot:page.snapshot,...menuPlan},context);
  assert.equal(result.recovery_required,true);assert.equal(result.outcome_unknown,undefined);assert.equal(result.verified,false);
  assert.equal(result.delivered_steps[0].target.name,profileTarget.name);assert.ok(result.observation.controls.some(control=>control.name===repositoriesTarget.name));
  for(const repeated of [profileReplay,profilePress]){
    page=await current(bridge,context);const rejected=await bridge.executePagePlan({snapshot:page.snapshot,...repeated},context);
    assert.equal(rejected.status,'refused');assert.equal(rejected.code,'delivered_step_replay');assert.equal(rejected.input_suppressed,true);assert.equal(rejected.recovery_required,true);assert.equal(rejected.stop_task,undefined);
    assert.ok(rejected.observation.controls.some(control=>control.name===repositoriesTarget.name));assert.equal(planCalls(client).length,1,'Replaying a click or equivalent Enter must send zero additional page plans.');
  }
  page=await current(bridge,context);result=await bridge.executePagePlan({snapshot:page.snapshot,...repositoryPlan},context);
  assert.equal(result.verified,true);assert.equal(result.status,'completed');assert.equal(planCalls(client).length,2);
});

test('partial-plan delivery reservations survive worker reconnection for the task but not a new user task',async t=>{
  const handler=command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?menuFrame():command.args.steps.length===2?interruptedMenu():completedPlan(validatePlan({steps:command.args.steps,completion:command.args.completion}),menuFrame());
  const bridge=await setup(t),first=await pair(bridge,{handler}),context={activityScope:Symbol('same-menu-task')};
  let page=await current(bridge);await bridge.executePagePlan({snapshot:page.snapshot,...menuPlan},context);assert.equal(planCalls(first).length,1);
  const replacement=await pair(bridge,{sessionId:'menu-worker-restarted',handler});page=await current(bridge,context);
  const refused=await bridge.executePagePlan({snapshot:page.snapshot,...profileReplay},context);assert.equal(refused.code,'delivered_step_replay');assert.equal(planCalls(replacement).length,0);
  page=await current(bridge);const result=await bridge.executePagePlan({snapshot:page.snapshot,...profileReplay},{activityScope:Symbol('new-user-task')});assert.equal(result.verified,true);assert.equal(planCalls(replacement).length,1);
});

test('malformed partial delivery evidence cannot enable resumable input',async t=>{
  const cases=[
    ['missing reservation',result=>{result.delivered_steps=[];}],
    ['wrong index',result=>{result.delivered_steps[0].index=1;}],
    ['wrong operation',result=>{result.delivered_steps[0].op='fill';result.delivered_steps[0].text='Unexpected';}],
    ['wrong resolved role',result=>{result.delivered_steps[0].target={...profileTarget,role:'link'};}],
    ['unmatched resolved name',result=>{result.delivered_steps[0].target={...profileTarget,name:'An unrelated menu'};}],
    ['unacknowledged step',result=>{result.steps[0].known_delivery=false;}],
    ['mismatched step target',result=>{result.steps[0].resolved_target={...profileTarget,name:'An unrelated menu'};}],
    ['duplicate reservation index',result=>{result.delivered_steps.push(structuredClone(result.delivered_steps[0]));}],
    ['omitted later acknowledged delivery',result=>{result.completed=2;result.attempted=2;result.steps[1]={...result.steps[1],status:'delivered',delivery:'issued',known_delivery:true,resolved_target:menuPlan.steps[1].target};}],
    ['no fresh overview',result=>{delete result.observation;}],
  ];
  for(const [label,mutate]of cases)await t.test(label,async t=>{
    const bridge=await setup(t),client=await pair(bridge,{handler:command=>{
      if(command.method==='tabs.list')return {status:'ok',tabs:[tab()]};if(command.method==='page.observe')return menuFrame();const result=interruptedMenu();mutate(result);return result;
    }}),context={activityScope:Symbol(label)},page=await current(bridge);
    const result=await bridge.executePagePlan({snapshot:page.snapshot,...menuPlan},context);assert.equal(result.outcome_unknown,true,label);assert.equal(result.verified,false);assert.equal(result.recovery_required,undefined);
    const fresh=await current(bridge,context);await assert.rejects(bridge.executePagePlan({snapshot:fresh.snapshot,...repositoryPlan},context),error=>error.code==='browser_outcome_unknown');assert.equal(planCalls(client).length,1);
  });
});

test('read-only recovery after a lost navigation acknowledgment exposes current state without authorizing more input',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?menuFrame():{
    status:'interrupted',verified:false,outcome_unknown:true,action_attempted:true,recovery_kind:'read_only_after_input',reason:'navigation_changed',
    observation:frame('Repositories',{document_id:'replacement-document',url:'https://records.example.test/repositories?private=another-secret',controls:[{id:'repos',name:'Repositories',role:'heading',enabled:true}]}),
  }}),context={activityScope:Symbol('lost-navigation')},page=await current(bridge);
  const result=await bridge.executePagePlan({snapshot:page.snapshot,...repositoryPlan},context);
  assert.equal(result.outcome_unknown,true);assert.equal(result.read_only_recovery,true);assert.equal(result.verified,false);assert.equal(result.observation.document_id,'replacement-document');assert.equal(result.observation.url,'https://records.example.test/repositories');assert.equal(JSON.stringify(result).includes('another-secret'),false);
  const fresh=await current(bridge,context);await assert.rejects(bridge.executePagePlan({snapshot:fresh.snapshot,...profileReplay},context),error=>error.code==='browser_outcome_unknown');assert.equal(planCalls(client).length,1);
});

test('a foreign-origin read-only recovery frame is discarded while input remains blocked',async t=>{
  const bridge=await setup(t);await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?frame():{status:'interrupted',verified:false,outcome_unknown:true,recovery_kind:'read_only_after_input',observation:frame('Other page',{url:'https://foreign.example.test/'})}});
  const page=await current(bridge),result=await bridge.executePagePlan({snapshot:page.snapshot,...plan},{activityScope:Symbol('foreign-recovery')});
  assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.equal(result.read_only_recovery,undefined);assert.equal(result.observation,undefined);
});

test('reported unknown input remains blocked in the same task after the worker reconnects',async t=>{
  const bridge=await setup(t),first=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?frame():{status:'interrupted',verified:false,outcome_unknown:true}}),context={activityScope:Symbol('same-task')};
  const before=await current(bridge),result=await bridge.executePagePlan({snapshot:before.snapshot,...plan},context);assert.equal(result.outcome_unknown,true);assert.equal(planCalls(first).length,1);
  const replacement=await pair(bridge,{sessionId:'worker-restarted'}),fresh=await current(bridge,context);
  await assert.rejects(bridge.executePagePlan({snapshot:fresh.snapshot,...plan},context),error=>error.code==='browser_outcome_unknown');assert.equal(planCalls(replacement).length,0);
  // A separate user task is a fresh authorization scope, not a retry by this one.
  assert.equal((await bridge.executePagePlan({snapshot:fresh.snapshot,...plan},{activityScope:Symbol('new-task')})).verified,true);
});

test('cancellation after issuance sends cancel and blocks another plan in that task',async t=>{
  const bridge=await setup(t),client=await pair(bridge,{handler:command=>command.method==='tabs.list'?{status:'ok',tabs:[tab()]}:command.method==='page.observe'?frame():undefined}),page=await current(bridge),controller=new AbortController(),scope=Symbol('cancelled-task');
  const pending=bridge.executePagePlan({snapshot:page.snapshot,...plan},{activityScope:scope,signal:controller.signal});await waitFor(()=>planCalls(client).length===1);controller.abort();
  const result=await pending;assert.equal(result.outcome_unknown,true);assert.equal(result.action_attempted,true);await waitFor(()=>client.cancels.length===1);
  const fresh=await current(bridge);await assert.rejects(bridge.executePagePlan({snapshot:fresh.snapshot,...plan},{activityScope:scope}),error=>error.code==='browser_outcome_unknown');assert.equal(planCalls(client).length,1);
});

test('frame observations retain the outer tab identity, redact private URLs and reject unseen frame IDs',async t=>{
 const bridge=await setup(t),child={frame_id:3,browser_document_id:'child-browser-doc',url:'https://embedded.example.test/editor?private=secret',title:'Embedded editor'};
 const client=await pair(bridge,{handler:m=>m.method==='tabs.list'?{status:'ok',tabs:[tab()]}:m.args.expectedFrame?{...frame(),url:child.url,document_id:'child-doc',snapshot:'child-snapshot'}:{...frame(),has_iframes:true,frames:[child]}});
 const outer=await current(bridge);assert.equal(outer.frames[0].frame_id,3);assert.ok(!JSON.stringify(outer).includes('secret'));
 await assert.rejects(bridge.observePage({snapshot:outer.snapshot,tab_id:7,frame_id:99}),e=>e.code==='unobserved_frame');
 const inside=await bridge.observePage({snapshot:outer.snapshot,tab_id:7,frame_id:3});assert.equal(inside.frame_id,3);assert.equal(inside.url,outer.url);assert.equal(inside.frame_url,'https://embedded.example.test/editor');
 assert.equal(client.commands.at(-1).args.expectedFrame.browser_document_id,'child-browser-doc');
 await assert.rejects(bridge.followLink({snapshot:inside.snapshot,target:{name:'Continue'},completion:[{target:{name:'Done'},condition:'exists'}]}),e=>e.code==='unsupported_frame_navigation');
});

test('sensitive page actions cannot dispatch without host confirmation',async t=>{
 const bridge=await setup(t),client=await pair(bridge),page=await current(bridge);
 const result=await bridge.executePagePlan({snapshot:page.snapshot,steps:[{op:'click',target:{name:'Delete record'}}],completion:[{target:{name:'Deleted'},condition:'exists'}]});
 assert.equal(result.code,'confirmation_required');assert.equal(result.action_attempted,false);assert.equal(planCalls(client).length,0);
});
