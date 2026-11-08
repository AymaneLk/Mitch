const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ComputerUse}=require('../computer-use');
const {validateTool}=require('../core');

const identity={pid:42,window_id:123};
const windowRow={...identity,title:'Editor',app_name:'Notepad'};
const result=data=>({structuredContent:data});
const controls=revision=>{
  const save={element_token:`s${revision}:save`,label:'Save',role:'button',enabled:true};
  const document={element_token:`s${revision}:document`,label:'Document',role:'edit',enabled:true,value:'Text'};
  const password={element_token:`s${revision}:password`,label:'Password',role:'edit',is_password:true,value:'never-return-this'};
  return revision===1?[save,document,password]:[document,save,password];
};

function fixture(options={}){
  const calls=[];let revision=0,mutations=0;
  const client={running:false,async call(name,args){
    this.running=true;calls.push({name,args});
    if(name==='start_session')return result({session:args.session||args.session_id,status:'started'});
    if(name==='list_windows')return result(options.list||{windows:[windowRow]});
    if(name==='get_window_state'){
      revision++;
      const custom=options.observe?.(revision);
      return result(custom||{window_title:'Editor',elements:controls(revision),elements_complete:true});
    }
    if(['click','set_value','press_key','scroll'].includes(name)){
      mutations++;
      const custom=options.act?.(name,args,mutations);
      return custom??result({effect:'confirmed'});
    }
    throw new Error('Unexpected provider call '+name);
  },async stop(){this.running=false;}};
  const service=new ComputerUse({client,getSettings:()=>({allowDesktop:true}),confirm:async()=>true});
  return {service,calls,inputs:()=>calls.filter(c=>['click','set_value','press_key','scroll'].includes(c.name)),read:()=>service.findWindow({query:'Editor'})};
}

const typeThenSave=[{kind:'type',control_id:'1',expected_name:'Document',text:'سلام'},{kind:'click',control_id:'0',expected_name:'Save'}];

test('findWindow combines unique discovery and inspection without guessing ambiguous or partial results',async()=>{
  const unique=fixture(),observed=await unique.read();
  assert.equal(observed.status,'inspected');assert.ok(observed.snapshot);
  assert.equal(unique.calls.filter(c=>c.name==='get_window_state').length,1);
  for(const [list,status]of [
    [{windows:[windowRow,{...windowRow,window_id:456}]},'ambiguous'],
    [{windows:[windowRow],truncated:true},'partial'],
    [{windows:[windowRow],degraded:true},'partial'],
    [{windows:[]},'not_found'],
  ]){
    const f=fixture({list});const found=await f.read();assert.equal(found.status,status);
    assert.equal(f.calls.filter(c=>c.name==='get_window_state').length,0);
  }
  await assert.rejects(unique.service.findWindow({query:' '}),/name|title/);
});

test('a sequence refreshes and rebinds original controls to current IDs and tokens between inputs',async()=>{
  const f=fixture(),initial=await f.read();
  const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
  assert.equal(outcome.status,'completed');assert.equal(outcome.verified,true);
  assert.deepEqual([outcome.completed,outcome.attempted,outcome.total],[2,2,2]);
  assert.deepEqual(f.inputs().map(c=>[c.name,c.args.element_token]),[['set_value','s1:document'],['click','s2:save']]);
  assert.equal(f.inputs()[0].args.value,'سلام');
  assert.equal(f.calls.filter(c=>c.name==='get_window_state').length,3);
  assert.notEqual(outcome.observation.snapshot,initial.snapshot);
  assert.equal(outcome.observation.controls.find(c=>c.name==='Save').control_id,'1');
  assert.ok(!JSON.stringify(outcome).includes('never-return-this'));
  assert.ok(!JSON.stringify(outcome).includes('element_token'));
  await assert.rejects(f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave}),/expired|replaced/);
  assert.equal(f.inputs().length,2,'A consumed plan must not replay completed inputs.');
});

test('every step is checked before any input, including future controls and invalid text types',async()=>{
  const f=fixture(),initial=await f.read();
  const invalidSteps=[
    {kind:'click',control_id:'99',expected_name:'Future dialog'},
    {kind:'click',control_id:'0',expected_name:'Delete'},
    {kind:'type',control_id:'0',expected_name:'Save',text:'Invalid button text'},
    {kind:'type',control_id:'1',expected_name:'Document',text:42},
    {kind:'key',control_id:'1',expected_name:'Document',key:'Return'},
    {kind:'click',control_id:'0',expected_name:'Save',script:'arbitrary'},
  ];
  for(const last of invalidSteps)await assert.rejects(f.service.sequence({snapshot:initial.snapshot,actions:[typeThenSave[0],last]}));
  assert.equal(f.inputs().length,0);
});

test('duplicate, protected, and disabled sequence targets never receive an input',async()=>{
  const variants=[
    {elements:[...controls(1),{element_token:'another',label:'Save',role:'button'}],step:typeThenSave[1]},
    {elements:controls(1),step:{kind:'type',control_id:'2',expected_name:'Password',text:'Not allowed'}},
    {elements:controls(1).map((c,i)=>i===0?{...c,enabled:false}:c),step:typeThenSave[1]},
  ];
  for(const variant of variants){
    const f=fixture({observe:()=>({window_title:'Editor',elements:variant.elements})}),initial=await f.read();
    await assert.rejects(f.service.sequence({snapshot:initial.snapshot,actions:[variant.step]}));
    assert.equal(f.inputs().length,0);
  }
});

test('an incomplete starting observation refuses the entire sequence',async()=>{
  for(const flags of [{degraded:true},{truncated:true},{elements_complete:false}]){
    const f=fixture({observe:revision=>({window_title:'Editor',elements:controls(revision),...flags})}),initial=await f.read();
    await assert.rejects(f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave}),/complete/);
    assert.equal(f.inputs().length,0);
  }
});

test('a partial observation after input stops the remaining plan and preserves its progress',async()=>{
  for(const flags of [{degraded:true},{truncated:true},{elements_complete:false}]){
    const f=fixture({observe:revision=>revision===2?{window_title:'Editor',elements:controls(revision),...flags}:undefined}),initial=await f.read();
    const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
    assert.equal(outcome.status,'interrupted');assert.equal(outcome.verified,false);
    assert.deepEqual([outcome.completed,outcome.attempted,outcome.total],[1,1,2]);assert.equal(f.inputs().length,1);
    assert.match(outcome.message,/No remaining steps|Do not replay/);
  }
});

test('changed or missing targets stop a sequence without trying the old control token',async()=>{
  const f=fixture({observe:revision=>revision===2?{window_title:'Editor',elements:[controls(revision)[0]]}:undefined}),initial=await f.read();
  const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
  assert.equal(outcome.status,'interrupted');assert.equal(outcome.completed,1);assert.equal(outcome.attempted,1);
  assert.equal(f.inputs().length,1);assert.ok(outcome.observation);
});

test('cancellation during the fresh observation prevents the next step',async()=>{
  const controller=new AbortController();
  const f=fixture({observe:revision=>{if(revision===2)controller.abort(new Error('Task stopped.'));}}),initial=await f.read();
  await assert.rejects(f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave},{signal:controller.signal}),/stopped|cancelled/);
  assert.equal(f.inputs().length,1);
});

test('findWindow cancellation after discovery prevents the inspection',async()=>{
  const f=fixture();let checks=0;
  await assert.rejects(f.service.findWindow({query:'Editor'},{assertActive:()=>{if(++checks===2)throw new Error('Task stopped.');}}),/stopped/);
  assert.equal(f.calls.filter(c=>c.name==='get_window_state').length,0);
});

test('unverified typing, provider refusal, and timeout stop rather than replaying the plan',async()=>{
  for(const failure of ['unverified','refused','timeout']){
    const f=fixture({act:()=>{
      if(failure==='timeout')throw new Error('Provider timeout');
      return result(failure==='refused'?{effect:'refused',code:'background_unavailable'}:{effect:'unverifiable'});
    }}),initial=await f.read();
    const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
    assert.equal(outcome.status,'interrupted');assert.equal(outcome.completed,failure==='unverified'?1:0);assert.equal(outcome.confirmed,0);assert.equal(outcome.attempted,1);
    assert.equal(f.inputs().length,1);assert.equal(outcome.verified,false);
    if(failure==='refused')assert.equal(outcome.results[0].outcome_unknown,false);
    if(failure==='timeout')assert.equal(outcome.results[0].outcome_unknown,true);
    await assert.rejects(f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave}),/expired|replaced/);
    assert.equal(f.inputs().length,1);
  }
});

test('known unconditional clicks can continue with complete observations without claiming verified success',async()=>{
  const f=fixture({act:()=>result({effect:'unverifiable'})}),initial=await f.read();
  const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:[typeThenSave[1],typeThenSave[1]]});
  assert.equal(outcome.status,'unverified');assert.equal(outcome.verified,false);
  assert.deepEqual([outcome.completed,outcome.attempted,outcome.total,outcome.confirmed],[2,2,2,0]);
  assert.equal(f.inputs().length,2);
  assert.deepEqual(f.inputs().map(call=>call.args.element_token),['s1:save','s2:save']);
  assert.ok(outcome.results.every(step=>step.verified===false&&step.effect==='unverifiable'));
  assert.match(outcome.message,/final observation|delivery alone/i);
});

test('unverifiable typing must read back its exact fresh field value before a later click can run',async()=>{
  const f=fixture({
    act:()=>result({effect:'unverifiable'}),
    observe:revision=>revision>1?{window_title:'Editor',elements:controls(revision).map(control=>control.label==='Document'?{...control,value:'سلام'}:control)}:undefined,
  }),initial=await f.read();
  const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
  assert.equal(outcome.status,'unverified');assert.equal(outcome.verified,false);
  assert.deepEqual([outcome.completed,outcome.attempted,outcome.confirmed],[2,2,1]);
  assert.equal(f.inputs().length,2);
  assert.equal(outcome.results[0].verified,true);assert.equal(outcome.results[0].verification,'text_readback');
  assert.equal(outcome.results[0].effect,'unverifiable','Readback must not rewrite the native provider effect.');
  assert.equal(outcome.results[1].verified,false);
});

test('unverifiable typing cannot use duplicate, protected, or differently valued fields as readback proof',async()=>{
  for(const change of ['mismatch','duplicate','protected']){
    const f=fixture({act:()=>result({effect:'unverifiable'}),observe:revision=>{
      if(revision===1)return;
      const elements=controls(revision).map(control=>control.label==='Document'?{...control,value:change==='mismatch'?'Different text':'سلام',...(change==='protected'?{is_password:true}:{})}:control);
      if(change==='duplicate')elements.push({element_token:'duplicate',label:'Document',role:'edit',value:'سلام'});
      return {window_title:'Editor',elements};
    }}),initial=await f.read();
    const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
    assert.equal(outcome.status,'interrupted');assert.equal(outcome.verified,false);assert.equal(outcome.confirmed,0);
    assert.equal(f.inputs().length,1);
  }
});

test('suspected no-op, partial, error, and escalation native click outcomes stop unconditional sequences',async()=>{
  for(const native of [
    {effect:'suspected_noop'},
    {effect:'partial'},
    {effect:'unverifiable',status:'partial'},
    {effect:'unverifiable',error:{code:'delivery_uncertain',hint:'Check the target.'}},
    {effect:'unverifiable',escalation_reason:'Background delivery is unavailable.'},
    {effect:'unverifiable',escalation_required:true},
    {status:'ok'},
    {effect:'unknown'},
  ]){
    const f=fixture({act:()=>result(native)}),initial=await f.read();
    const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:[typeThenSave[1],typeThenSave[1]]});
    assert.equal(outcome.status,'interrupted',JSON.stringify(native));assert.equal(outcome.verified,false);
    assert.equal(f.inputs().length,1);assert.equal(outcome.confirmed,0);
  }
});

test('a native outcome needing review cannot become verified merely because the requested text is present',async()=>{
  for(const native of [
    {effect:'suspected_noop'},
    {effect:'unverifiable',error:{code:'delivery_uncertain'}},
    {effect:'unverifiable',escalation_reason:'Foreground required.'},
  ]){
    const f=fixture({act:()=>result(native),observe:revision=>revision>1?{window_title:'Editor',elements:controls(revision).map(control=>control.label==='Document'?{...control,value:'سلام'}:control)}:undefined}),initial=await f.read();
    const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
    assert.equal(outcome.status,'interrupted');assert.equal(outcome.verified,false);assert.equal(outcome.confirmed,0);
    assert.equal(outcome.results[0].verified,false);assert.equal(outcome.results[0].verification,undefined);
    assert.equal(f.inputs().length,1);
  }
});

test('observation failure after a confirmed input reports partial progress rather than task completion',async()=>{
  const f=fixture({observe:revision=>{if(revision===2)throw new Error('Window closed');}}),initial=await f.read();
  const outcome=await f.service.sequence({snapshot:initial.snapshot,actions:typeThenSave});
  assert.equal(outcome.status,'interrupted');assert.equal(outcome.completed,1);assert.equal(outcome.verified,false);
  assert.equal(outcome.observation,undefined);assert.equal(f.inputs().length,1);
});

test('fast tool schemas bound sequences and disallow shortcuts, arbitrary fields, and unobserved target specifications',()=>{
  assert.doesNotThrow(()=>validateTool('computer_find_window',{query:'Editor'}));
  assert.doesNotThrow(()=>validateTool('computer_action_sequence',{snapshot:'known',actions:typeThenSave}));
  for(const query of ['', 'a'.repeat(121)])assert.throws(()=>validateTool('computer_find_window',{query}));
  for(const actions of [[],Array(21).fill(typeThenSave[1]),[{kind:'key',key:'Win+R',control_id:'0',expected_name:'Save'}],[{kind:'click',control_id:'0'}],[{kind:'click',control_id:'0',expected_name:'Save',x:10,y:10}]]){
    assert.throws(()=>validateTool('computer_action_sequence',{snapshot:'known',actions}));
  }
});
