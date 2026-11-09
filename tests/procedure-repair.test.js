'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {repairVerifiedProcedure,ProcedureMemory}=require('../procedure-memory');
const {fixture}=require('../scripts/benchmark-workflow-model');
const clone=value=>JSON.parse(JSON.stringify(value));
const search={name:'Search',role:'textbox'},typed={target:search,condition:'value',value:'Alpha'};
const resultExists={target:{name:'Alpha',role:'button'},condition:'exists'};
function staleProgram(){return {version:1,steps:[{op:'bind',target:{kind:'native',app:'Customer workspace'}},{op:'act',steps:[{op:'fill',target:search,text:'Alpha'},{op:'assert',target:search,condition:'value',value:'Alpha'}],completion:[typed]},{op:'act',steps:[{op:'click',target:{name:'Search',role:'button'}}],completion:[typed]}],completion:[typed]};}
async function example(program=staleProgram()){
  const desktop=fixture('search_only'),prepared=await desktop.prepare(desktop.prompt,{readOnly:true});
  const output=await desktop.dispatch('computer_run_workflow',program,{activityScope:Symbol('repair-test')});
  assert.equal(output.status,'interrupted');assert.equal(output.reason,'completion_unmet');assert.equal(desktop.readback().verified,true);
  return {program,output,desktop,prepared};
}
const lastAction=output=>output.events.filter(event=>event.name==='computer_execute_plan').at(-1);
function replaceFinalView(output,controls){output.observation.controls=clone(controls);lastAction(output).output.observation.controls=clone(controls);}

test('review-approved repair learns disappearing Search field from acknowledged real local executor evidence',async()=>{
  const {program,output,desktop,prepared}=await example(),before=clone(program);
  assert.equal(repairVerifiedProcedure(program,output),null);assert.equal(repairVerifiedProcedure(program,output,{approved:'true'}),null);
  const repaired=repairVerifiedProcedure(program,output,{approved:true});assert.ok(repaired);
  assert.deepEqual(repaired.completion,[{target:{name:'Alpha',role:'button',match:'exact'},condition:'exists'}]);
  assert.deepEqual(repaired.steps.at(-1).completion,repaired.completion);assert.deepEqual(repaired.steps.slice(0,-1),program.steps.slice(0,-1));assert.deepEqual(program,before);
  const memory=new ProcedureMemory();assert.equal(memory.remember(desktop.prompt,prepared,repaired,{approved:true}),true);
  desktop.reset();const current=await desktop.prepare(desktop.prompt,{readOnly:true}),cached=memory.get(desktop.prompt,current);assert.ok(cached);
  const replay=await desktop.dispatch('computer_run_workflow',cached.program,{activityScope:Symbol('repaired-replay'),workflowBindings:cached.bindings,workflowReplay:cached});
  assert.equal(replay.status,'completed');assert.equal(replay.verified,true);assert.equal(replay.replay_context_verified,true);assert.equal(desktop.readback().verified,true);
});

test('completion repair refuses earlier failures, unacknowledged deliveries and uncertain or scoped evidence',async()=>{
  const {program,output}=await example();
  const changes=[
    o=>o.outcome_unknown=true,o=>o.evidence_truncated=true,o=>o.event_placeholders=1,o=>o.reason='condition_unmet',o=>o.steps[1].status='interrupted',
    o=>o.events.find(event=>event.name==='computer_execute_plan').output.verified=false,
    o=>{const receipt=lastAction(o).output.steps[0];receipt.verified=false;delete receipt.known_delivery;},
    o=>lastAction(o).output.steps[0].status='pending',o=>lastAction(o).output.completed=0,o=>lastAction(o).output.steps=[],
    o=>lastAction(o).args.steps[0].target.name='A different action',o=>lastAction(o).output.reason='outcome_unknown',
    o=>o.observation.window.window_id++,o=>o.observation.snapshot_superseded=true,o=>o.observation.selector={name:'Alpha'},
    o=>o.observation.complete=false,o=>o.observation.controls[0].protected=true,o=>o.observation.controls[0].visible=false,
    o=>replaceFinalView(o,[]),o=>replaceFinalView(o,[o.observation.controls[0],clone(o.observation.controls[0])]),
    o=>replaceFinalView(o,Array.from({length:9},(_,index)=>({name:'Control '+index,role:'button',enabled:true}))),
    o=>replaceFinalView(o,Array.from({length:3},(_,index)=>({name:'Field '+index,role:'textbox',value:'',checked:false,selected:false}))),
  ];
  for(const change of changes){const altered=clone(output);change(altered);assert.equal(repairVerifiedProcedure(program,altered,{approved:true}),null,change.toString());}
  const earlier=clone(program);earlier.steps.push({op:'assert',condition:resultExists});assert.equal(repairVerifiedProcedure(earlier,output,{approved:true}),null);
  const conditional=clone(program);conditional.steps[2]={op:'if',condition:resultExists,then:[conditional.steps[2]],else:[]};assert.equal(repairVerifiedProcedure(conditional,output,{approved:true}),null);
});

test('explicit delivery acknowledgement is sufficient only after all phase actions completed',async()=>{
  const {program,output}=await example(),receipt=lastAction(output).output.steps[0];receipt.verified=false;receipt.known_delivery=true;
  assert.ok(repairVerifiedProcedure(program,output,{approved:true}));receipt.status='interrupted';assert.equal(repairVerifiedProcedure(program,output,{approved:true}),null);
});

test('repair handles stale global assertion after a fully verified final action phase',async()=>{
  const program=staleProgram();program.steps.at(-1).completion=[resultExists];const {output}=await example(program);
  assert.equal(lastAction(output).output.status,'completed');assert.ok(repairVerifiedProcedure(program,output,{approved:true}));
});

test('repair retains entire small view and exact value/checked/selected predicates without storing IDs',async()=>{
  const {program,output}=await example();
  replaceFinalView(output,[{id:'opaque-result',name:'Alpha',role:'button',enabled:true},{id:'opaque-field',name:'Filter',role:'textbox',enabled:true,value:'Exact Value',checked:false,selected:true}]);
  const repaired=repairVerifiedProcedure(program,output,{approved:true});assert.ok(repaired);assert.equal(repaired.completion.length,5);assert.equal(repaired.steps.at(-1).completion.length,4);
  assert.deepEqual(repaired.completion.map(check=>[check.target.name,check.condition,check.value]),[['Alpha','exists',undefined],['Filter','exists',undefined],['Filter','value','Exact Value'],['Filter','checked','false'],['Filter','selected','true']]);
  assert.equal(JSON.stringify(repaired).includes('opaque-'),false);
});
