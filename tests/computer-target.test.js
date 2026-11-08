const {test} = require('node:test');
const assert = require('node:assert/strict');
const {captureTarget, resolveTarget} = require('../computer-target');

function snapshot(elements, window = {pid: 42, window_id: 123, title: 'Editor'}) {
  return {window, elements, controls: elements.map((row, index) => ({control_id: String(index), name: row.label || '', type: row.role, enabled: row.enabled !== false, protected: !!row.is_password, value: row.value}))};
}
const flat = () => snapshot([{role:'button',label:'Save',element_token:'s1:0'},{role:'edit',label:'Document',value:'Old text',element_token:'s1:1'}]);
const hierarchical = () => snapshot([
  {element_index:40,parent_index:null,depth:0,role:'window',label:'Editor'},
  {element_index:12,parent_index:40,depth:1,role:'group',label:'Document actions'},
  {element_index:99,parent_index:12,depth:2,role:'button',label:'Save',element_token:'s1:99'},
]);

test('flat observations rebind unique exact controls after reindexing and token renewal',()=>{
  const initial=flat(), descriptor=captureTarget(initial,'0');
  const current=snapshot([{role:'edit',label:'Document',value:'Changed'}, {role:'button',label:'Save',element_token:'s2:900'}]);
  assert.equal(resolveTarget(current,descriptor),current.controls[1]);
  assert.equal(descriptor.ancestors,null);
});

test('native parent indices resolve by element_index rather than array position',()=>{
  const initial=hierarchical(), descriptor=captureTarget(initial,'2');
  const current=snapshot([
    {element_index:7,parent_index:80,depth:2,role:'button',label:'Save',element_token:'s2:7'},
    {element_index:90,parent_index:null,depth:0,role:'window',label:'Editor'},
    {element_index:80,parent_index:90,depth:1,role:'group',label:'Document actions'},
  ]);
  assert.deepEqual(descriptor.ancestors,{depth:2,chain:[{role:'group',label:'Document actions',depth:1},{role:'window',label:'Editor',depth:0}],boundaryDepth:0});
  assert.equal(resolveTarget(current,descriptor),current.controls[0]);
});

test('a control moving into a different ancestor context stops rebinding',()=>{
  const initial=hierarchical(), descriptor=captureTarget(initial,'2');
  for(const change of [{label:'Other document'},{role:'dialog'}]){
    const current=hierarchical();Object.assign(current.elements[1],change);
    assert.throws(()=>resolveTarget(current,descriptor),/context changed/);
  }
});

test('window process, handle and title changes are rejected independently',()=>{
  const descriptor=captureTarget(flat(),'0');
  for(const change of [{pid:43},{window_id:124},{title:'Another editor'}]){
    const current=flat();Object.assign(current.window,change);
    assert.throws(()=>resolveTarget(current,descriptor),/window identity or title/);
  }
});

test('initial or later duplicate names and roles are ambiguous even if one is disabled',()=>{
  const descriptor=captureTarget(flat(),'0');
  const duplicate=snapshot([{role:'button',label:'Save'},{role:'button',label:'Save',enabled:false}]);
  assert.throws(()=>captureTarget(duplicate,'0'),/ambiguous/);
  assert.throws(()=>resolveTarget(duplicate,descriptor),/ambiguous/);
  const changed=flat();changed.controls[0].name='save';
  assert.throws(()=>resolveTarget(changed,descriptor),/missing or ambiguous/);
});

test('protected, disabled or missing controls never rebind',()=>{
  const descriptor=captureTarget(flat(),'0');
  for(const change of [{protected:true},{enabled:false}]){
    const current=flat();Object.assign(current.controls[0],change);
    assert.throws(()=>resolveTarget(current,descriptor),/protected or unavailable/);
  }
  assert.throws(()=>resolveTarget(snapshot([]),descriptor),/missing/);
});

test('partial observations cannot establish or rebind a unique target',()=>{
  const descriptor=captureTarget(flat(),'0');
  for(const field of ['truncated','degraded']){
    const current=flat();current[field]=true;
    assert.throws(()=>captureTarget(current,'0'),/incomplete/);
    assert.throws(()=>resolveTarget(current,descriptor),/incomplete/);
  }
});

test('missing parents, cycles, duplicate native ids and depth mismatches are refused',()=>{
  for(const mutate of [
    state=>{state.elements[2].parent_index=500;},
    state=>{state.elements[1].parent_index=99;delete state.elements[1].depth;delete state.elements[2].depth;},
    state=>{state.elements[1].element_index=40;},
    state=>{state.elements[1].depth=4;},
  ]){
    const current=hierarchical();mutate(current);
    assert.throws(()=>captureTarget(current,'2'),/ancestor/);
  }
});

test('hierarchy disappearing or appearing cannot be treated as the same context',()=>{
  const initial=hierarchical(), descriptor=captureTarget(initial,'2');
  assert.throws(()=>resolveTarget(flat(),descriptor),/context changed/);
  assert.throws(()=>resolveTarget(hierarchical(),captureTarget(flat(),'0')),/context changed/);
});

test('inconsistent public control mapping is refused instead of indexing the wrong raw element',()=>{
  const initial=flat();initial.controls[0].control_id='7';
  assert.throws(()=>captureTarget(initial,'7'),/mapping is inconsistent/);
});

test('native Windows implicit window roots and omitted intermediate UIA nodes remain anchored',()=>{
  const initial=snapshot([
    {element_index:0,depth:1,role:'Edit',label:'Test input'},
    {element_index:3,depth:1,role:'TitleBar',label:'Editor'},
    {element_index:4,parent_index:3,depth:3,role:'MenuItem',label:'System'},
  ]);
  const direct=captureTarget(initial,'0'), nested=captureTarget(initial,'2');
  const current=structuredClone(initial);
  assert.equal(resolveTarget(current,direct).control_id,'0');
  assert.equal(resolveTarget(current,nested).control_id,'2');
  current.elements[2].depth=2;
  assert.throws(()=>resolveTarget(current,nested),/context changed/);
});

test('Calculator buttons with omitted deep parents survive display changes and reindexing',()=>{
  const window={pid:42,window_id:123,title:'Calculatrice'};
  const initial=snapshot([
    {element_index:0,depth:1,role:'Window',label:'Calculatrice'},
    {element_index:8,depth:4,role:'Text',label:'L’affichage est 6.5'},
    {element_index:31,depth:5,role:'Button',label:'Six',element_token:'s1:31'},
    {element_index:32,depth:5,role:'Button',label:'Sept',element_token:'s1:32'},
  ],window);
  const six=captureTarget(initial,'2');
  assert.deepEqual(six.ancestors,{depth:5,chain:[],boundaryDepth:5});
  const current=snapshot([
    {element_index:0,depth:1,role:'Window',label:'Calculatrice'},
    {element_index:9,depth:4,role:'Text',label:'L’affichage est 42'},
    {element_index:32,parent_index:null,depth:5,role:'Button',label:'Sept',element_token:'s2:32'},
    {element_index:33,parent_index:null,depth:5,role:'Button',label:'Six',element_token:'s2:33'},
  ],window);
  assert.equal(resolveTarget(current,six),current.controls[3]);
  for(const mutate of [
    state=>{state.elements[3].depth=4;},
    state=>{state.elements[3].parent_index=0;},
    state=>{state.window.title='Other calculator';},
    state=>{state.window.window_id=124;},
  ]){
    const changed=structuredClone(current);mutate(changed);
    assert.throws(()=>resolveTarget(changed,six),/context changed|window identity/);
  }
  const dangling=structuredClone(current);dangling.elements[3].parent_index=999;
  assert.throws(()=>captureTarget(dangling,'3'),/ancestor is missing/);
});

test('a retained ancestor disappearing cannot turn into an equivalent omitted-parent boundary',()=>{
  const initial=hierarchical(),descriptor=captureTarget(initial,'2');
  const current=hierarchical();delete current.elements[2].parent_index;
  assert.doesNotThrow(()=>captureTarget(current,'2'));
  assert.throws(()=>resolveTarget(current,descriptor),/context changed/);
});
