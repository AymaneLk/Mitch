'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ProcedureMemory,scopeSignature}=require('../procedure-memory');
const {validateTaskProgram}=require('../task-program');
const clone=value=>JSON.parse(JSON.stringify(value));
const target={kind:'browser',hostname:'example.test',browser:'opera'};
const search={name:'Search',role:'textbox',match:'exact'};
const expected=value=>({target:search,condition:'value',value});
function program(value='Alpha'){
  return {version:1,steps:[{op:'bind',target},{op:'act',steps:[{op:'fill',target:search,text:value},{op:'click',target:{name:'Search',role:'button',match:'exact'}}],completion:[expected(value)]}],completion:[expected(value)]};
}
function context(){return {preparedAt:1000,scopes:[{target,observation:{source:'browser_dom',snapshot:'opaque-old-snapshot',document_id:'opaque-old-document',tab_id:10,session_id:'old-session',browser:'opera',url:'https://example.test/',complete:true,controls:[{id:'old1',name:'Search',role:'textbox',enabled:true,editable:true,value:''},{id:'old2',name:'Search',role:'button',enabled:true}]}}]};}
const approved={approved:true};

test('only independently approved programs are remembered and results are cloned',()=>{
  let changes=0;const memory=new ProcedureMemory({onChange:()=>changes++}),original=program(),prepared=context();
  assert.equal(memory.remember('Search for Alpha',prepared,original),false);assert.equal(memory.remember('Search for Alpha',prepared,original,{approved:'true'}),false);
  assert.equal(memory.remember('Search for Alpha',prepared,original,approved),true);assert.equal(changes,1);
  original.steps[1].steps[0].text='Tampered';
  const hit=memory.get('Search for Alpha',prepared);assert.equal(hit.program.steps[1].steps[0].text,'Alpha');assert.deepEqual(hit.bindings,{});
  assert.deepEqual(hit.scopeSignatures,[{target,signature:scopeSignature(target,prepared.scopes[0].observation)}]);
  hit.program.steps[1].steps[0].text='Different';assert.equal(memory.get('Search for Alpha',prepared).program.steps[1].steps[0].text,'Alpha');
  assert.equal(memory.get('Search for Beta',prepared),null);assert.equal(memory.get('search for Alpha',prepared),null);
});

test('planner shorthand is normalized before storage and on import',()=>{
  const memory=new ProcedureMemory(),short=program();delete short.completion;
  assert.equal(memory.remember('Search for "Alpha"',context(),short,approved),true);const stored=memory.export();assert.ok(Array.isArray(stored[0].program.completion));assert.deepEqual(stored[0].program.completion,stored[0].program.steps.at(-1).completion);
  const hit=memory.get('Search for "Beta"',context());assert.deepEqual(hit.program.completion[0].value,{ref:'mitchParam0'});assert.doesNotThrow(()=>validateTaskProgram(hit.program,hit.bindings));
  delete stored[0].program.completion;const imported=new ProcedureMemory();assert.equal(imported.import(stored),1);assert.deepEqual(imported.export()[0].program.completion,imported.export()[0].program.steps.at(-1).completion);assert.ok(imported.get('Search for "Beta"',context()));
  stored[0].program.steps.push({op:'bind',target});assert.equal(imported.import(stored),0);
});

test('quoted arguments generalize only whole symbolic field values with fresh bindings',()=>{
  const memory=new ProcedureMemory(),prepared=context();
  assert.equal(memory.remember('Search for "Alpha"',prepared,program(),approved),true);
  const result=memory.get('Search for "Beta"',prepared);
  assert.deepEqual(result.bindings,{mitchParam0:'Beta'});assert.deepEqual(result.program.steps[1].steps[0].text,{ref:'mitchParam0'});assert.deepEqual(result.program.completion[0].value,{ref:'mitchParam0'});
  assert.doesNotThrow(()=>validateTaskProgram(result.program,result.bindings));assert.throws(()=>validateTaskProgram(result.program,{}));
  assert.ok(!JSON.stringify(memory.export()).includes('Alpha'),'The quoted sample argument is not persisted.');
  assert.equal(memory.get('Search in "Beta"',prepared),null);assert.equal(memory.get('Search for ""',prepared),null);
});

test('quoted whitespace and punctuation remain exact parameter data',()=>{
  const memory=new ProcedureMemory();memory.remember('Search for "Alpha"',context(),program(),approved);
  assert.equal(memory.get('Search for "hello  world!"',context()).bindings.mitchParam0,'hello  world!');
  assert.equal(memory.get('Search  for "Alpha"',context()),null);assert.equal(memory.get('Search for "Alpha".',context()),null);
});

test('quoted scope names and partial literal occurrences never become parameters',()=>{
  const memory=new ProcedureMemory(),prepared=context();
  const nativeTarget={kind:'native',app:'Notepad'},nativeProgram={version:1,steps:[{op:'bind',target:nativeTarget}],completion:[{target:{name:'Editor',role:'textbox'},condition:'exists'}]};
  const nativeContext={scopes:[{target:nativeTarget,observation:{complete:true,window:{title:'Untitled - Notepad'},controls:[{name:'Editor',role:'textbox',value:''}]}}]};
  assert.equal(memory.remember('Open "Notepad"',nativeContext,nativeProgram,approved),true);assert.equal(memory.export()[0].matcher.kind,'exact');assert.equal(memory.get('Open "Calculator"',nativeContext),null);
  const partial=program();partial.completion=[{target:{name:'Results for Alpha',role:'heading'},condition:'exists'}];
  assert.equal(memory.remember('Search for "Alpha"',prepared,partial,approved),true);assert.equal(memory.export().at(-1).matcher.kind,'exact');assert.equal(memory.get('Search for "Beta"',prepared),null);
});

test('quoted arguments that coincide with fixed controls or boolean assertions stay exact-only',()=>{
  for(const value of ['Search','true','false']){
    const memory=new ProcedureMemory();assert.equal(memory.remember('Search for "'+value+'"',context(),program(value),approved),true);assert.equal(memory.export()[0].matcher.kind,'exact');assert.equal(memory.get('Search for "Different"',context()),null);
  }
  const memory=new ProcedureMemory(),mixed=program();mixed.completion=[{target:{name:'Results for alpha',role:'heading'},condition:'exists'}];
  assert.equal(memory.remember('Search for "Alpha"',context(),mixed,approved),true);assert.equal(memory.export()[0].matcher.kind,'exact');
});

test('fresh IDs and focus changes are accepted but changed UI values, roles, state and URLs invalidate reuse',()=>{
  const memory=new ProcedureMemory(),prepared=context();memory.remember('Search for Alpha',prepared,program(),approved);
  const renewed=clone(prepared),frame=renewed.scopes[0].observation;
  frame.snapshot='new';frame.document_id='new';frame.tab_id=42;frame.session_id='new';frame.controls[0].id='fresh';frame.controls[0].focused=true;
  assert.ok(memory.get('Search for Alpha',renewed));
  const mutations=[f=>f.controls[0].value='Already changed',f=>f.controls[0].name='Other',f=>f.controls[1].role='link',f=>f.controls[1].enabled=false,f=>f.controls[0].selected=true,f=>f.url='https://example.test/other',f=>f.browser='chrome'];
  for(const mutate of mutations){const changed=clone(prepared);mutate(changed.scopes[0].observation);assert.equal(memory.get('Search for Alpha',changed),null);}
});
test('unrelated layout changes reuse a procedure but ambiguous targets and new dialogs do not',()=>{
  const memory=new ProcedureMemory(),prepared=context();memory.remember('Search for Alpha',prepared,program(),approved);
  const changed=clone(prepared);changed.scopes[0].observation.controls.reverse();changed.scopes[0].observation.controls.push({name:'News updated',role:'heading'});
  assert.ok(memory.get('Search for Alpha',changed));
  changed.scopes[0].observation.controls.push({name:'Search',role:'button'});assert.equal(memory.get('Search for Alpha',changed),null);
  const modal=clone(prepared);modal.scopes[0].observation.controls.push({name:'Confirm',role:'dialog'});assert.equal(memory.get('Search for Alpha',modal),null);
});

test('incomplete, protected, ambiguous and empty observations cannot establish replay state',()=>{
  const memory=new ProcedureMemory(),prepared=context();memory.remember('Search for Alpha',prepared,program(),approved);
  for(const mutate of [f=>f.complete=false,f=>f.degraded=true,f=>f.truncated=true,f=>f.context_truncated=true,f=>f.controls=[],f=>f.controls[0].protected=true,f=>f.controls[0].role='PasswordText',f=>f.controls[0].value={unexpected:true}]){
    const changed=clone(prepared);mutate(changed.scopes[0].observation);assert.equal(memory.remember('Search for Alpha',changed,program(),approved),false);assert.equal(memory.get('Search for Alpha',changed),null);
  }
  const duplicate=clone(prepared);duplicate.scopes.push(clone(duplicate.scopes[0]));assert.equal(memory.get('Search for Alpha',duplicate),null);
});

test('sensitive requests, mutating labels and potential submissions are not replayable',()=>{
  for(const request of ['Send a message','Call Omar','Delete the file','Pay the bill','Publish this','Install software','Change my password','Save the document','Search for "secret"']){
    const memory=new ProcedureMemory();assert.equal(memory.remember(request,context(),program(),approved),false);
  }
  for(const name of ['Send','Call','Delete','Purchase','Submit','Save','Unknown irreversible action']){
    const unsafe=program();unsafe.steps[1].steps[1].target.name=name;assert.equal(new ProcedureMemory().remember('Search for Alpha',context(),unsafe,approved),false);
  }
  const enters=program();enters.steps[1].steps[1]={op:'press',target:search,key:'Enter'};assert.equal(new ProcedureMemory().remember('Search for Alpha',context(),enters,approved),false);
  const opening=program();opening.steps[0].target={...target,open_if_missing:true,url:'https://example.test/'};assert.equal(new ProcedureMemory().remember('Search for Alpha',context(),opening,approved),false);
});

test('requests needing fresh factual readback cannot become generic completion replays',()=>{
  const memory=new ProcedureMemory();
  for(const request of ['Find Alpha and tell me its price','Find "Alpha" and summarize it','Find Alpha and give me the result','Find Alpha and read the details','Compare Alpha and Beta','Find Alpha: what is its status?']){
    assert.equal(memory.remember(request,context(),program(),approved),false);
    assert.equal(memory.get(request,context()),null);
  }
  assert.equal(memory.remember('Find "Alpha" in Example',context(),program(),approved),true);
  assert.ok(memory.get('Find "Beta" in Example',context()));
});

test('cache has a strict size limit and expires without extending lifetime on a hit',()=>{
  let now=1000;const memory=new ProcedureMemory({now:()=>now});
  for(let index=0;index<33;index++)assert.equal(memory.remember('Search item '+index,context(),program(),approved),true);
  assert.equal(memory.size,32);assert.equal(memory.get('Search item 0',context()),null);assert.ok(memory.get('Search item 32',context()));
  now+=30*24*60*60*1000;assert.equal(memory.get('Search item 32',context()),null);assert.equal(memory.size,0);
});

test('persistence callback receives isolated JSON rows and cannot break memory operations',()=>{
  const snapshots=[],memory=new ProcedureMemory({onChange:rows=>{snapshots.push(rows);rows[0]?.program.steps.splice(0);throw Error('disk unavailable');}});
  assert.equal(memory.remember('Search for Alpha',context(),program(),approved),true);
  assert.equal(snapshots.length,1);assert.ok(memory.get('Search for Alpha',context()));
  memory.clear();assert.deepEqual(snapshots[1],[]);assert.equal(memory.size,0);
});

test('import validates cloned schema, missing bindings, dates and rejects cached opaque state',()=>{
  let now=1000;const memory=new ProcedureMemory({now:()=>now});memory.remember('Search for "Alpha"',context(),program(),approved);
  const rows=memory.export(),copy=new ProcedureMemory({now:()=>now});assert.equal(copy.import(rows),1);assert.ok(copy.get('Search for "Beta"',context()));
  rows[0].program.steps[1].steps[0].text='Tampered';assert.deepEqual(copy.get('Search for "Beta"',context()).program.steps[1].steps[0].text,{ref:'mitchParam0'});
  const corruptions=[row=>row.createdAt=2000,row=>row.snapshot='old',row=>row.program.snapshot='old',row=>row.program.steps[1].steps[0].text={ref:'missing'},row=>row.program.steps[1].steps[1].target.name='Delete',row=>row.signature='not a digest',row=>{row.program=program('Literal');},row=>row.program.steps.splice(1,0,{op:'read',target:search,attribute:'value',as:'mitchParam0'})];
  for(const corrupt of corruptions){const row=memory.export()[0];corrupt(row);assert.equal(new ProcedureMemory({now:()=>now}).import([row]),0);}
  const json=JSON.stringify(memory.export());for(const marker of ['opaque-old-snapshot','opaque-old-document','old-session','old1','old2'])assert.equal(json.includes(marker),false);
  assert.equal(new ProcedureMemory().import(Array.from({length:33},()=>memory.export()[0])),0);
  assert.equal(copy.import({invalid:true}),0);assert.equal(copy.size,0);
});

test('multi-scope procedures are not replayed without checking every initial scope before input',()=>{
  const memory=new ProcedureMemory(),second={kind:'browser',hostname:'other.test',browser:'opera'},prepared=context(),multi=program();
  prepared.scopes.push({target:second,observation:{...clone(prepared.scopes[0].observation),url:'https://other.test/'}});
  multi.steps.push({op:'bind',target:second});
  assert.equal(memory.remember('Search for Alpha',prepared,multi,approved),true);assert.equal(memory.get('Search for Alpha',prepared),null);
});
