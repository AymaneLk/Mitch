const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ComputerUse}=require('../computer-use');

function fixture(rows) {
  const calls=[];
  let revision=0;
  const client={async call(name,args){
    calls.push({name,args});
    if(name==='start_session')return {structuredContent:{active:true}};
    if(name==='list_windows')return {structuredContent:{windows:[{pid:42,window_id:123,title:'Calculatrice'}]}};
    if(name==='get_window_state')return {structuredContent:{window_title:'Calculatrice',elements:rows.map((row,index)=>({...row,element_token:`r${++revision}:${index}`}))}};
    if(name==='set_value'||name==='click')return {structuredContent:{effect:'confirmed'}};
    throw new Error('Unexpected provider call '+name);
  },async stop(){}};
  const service=new ComputerUse({client,getSettings:()=>({allowDesktop:true}),confirm:async()=>true});
  return {service,calls,read:()=>service.findWindow({query:'Calculatrice'}),inputs:()=>calls.filter(call=>['set_value','click','press_key','type_text'].includes(call.name))};
}

test('observations distinguish a Calculator display and buttons from real writable fields',async()=>{
  const f=fixture([
    {role:'Text',label:'L’affichage est 6.5'},
    {role:'Button',label:'Six'},
    {role:'Button',label:'Plus'},
    {role:'Edit',label:'Test input'},
    {role:'Document',label:'Read-only document',read_only:true},
    {role:'Edit',label:'Disabled input',enabled:false},
    {role:'Edit',label:'Protected input',is_password:true,value:'must-not-leak'},
  ]);
  const observed=await f.read();
  assert.deepEqual(observed.controls.map(control=>control.editable),[false,false,false,true,false,false,false]);
  assert.ok(!JSON.stringify(observed).includes('must-not-leak'));
  assert.equal(observed.controls[0].name,'L’affichage est 6.5');
});

test('typing into a Calculator display gives button guidance without delivering any input',async()=>{
  const f=fixture([{role:'Text',label:'L’affichage est 6.5'},{role:'Button',label:'Six'}]);
  const observed=await f.read();
  const action={kind:'type',control_id:'0',expected_name:'L’affichage est 6.5',text:'67'};
  await assert.rejects(f.service.action({...action,snapshot:observed.snapshot}),/read-only.*Calculator.*buttons/);
  await assert.rejects(f.service.sequence({snapshot:observed.snapshot,actions:[{kind:'click',control_id:'1',expected_name:'Six'},action]}),/read-only.*Calculator.*buttons/);
  assert.deepEqual(f.inputs(),[],'Invalid later typing must reject the entire sequence before its first click.');
});

test('explicit negative editability flags override text roles and contradictory positive flags',async()=>{
  const negatives=[...['read_only','readOnly','is_read_only','isReadOnly'].map(key=>({[key]:true})),...['editable','is_editable','isEditable','writable','is_writable','isWritable'].map(key=>({[key]:false}))];
  for(const flags of negatives){
    const f=fixture([{role:'Document',label:'Document',editable:true,writable:true,...flags}]);
    const observed=await f.read();
    assert.equal(observed.controls[0].editable,false,JSON.stringify(flags));
    await assert.rejects(f.service.action({snapshot:observed.snapshot,kind:'type',control_id:'0',expected_name:'Document',text:'Blocked'}),/read-only|editable/);
    assert.deepEqual(f.inputs(),[],JSON.stringify(flags));
  }
});

test('writable fields keep exact-label checks and still use set_value without keyboard fallback',async()=>{
  const f=fixture([{role:'Edit',label:'Message'}]);
  const observed=await f.read();
  assert.equal(observed.controls[0].editable,true);
  await assert.rejects(f.service.action({snapshot:observed.snapshot,kind:'type',control_id:'0',expected_name:'Wrong',text:'سلام'}),/label/);
  assert.equal(f.inputs().length,0);
  const typed=await f.service.action({snapshot:observed.snapshot,kind:'type',control_id:'0',expected_name:'Message',text:'سلام'});
  assert.equal(typed.verified,true);
  assert.deepEqual(f.inputs().map(call=>call.name),['set_value']);
  assert.equal(f.inputs()[0].args.value,'سلام');
});

test('explicit positive capability flags are exposed but cannot override disabled or protected controls',async()=>{
  const f=fixture([
    {role:'Custom',label:'Custom input',isEditable:true},
    {role:'Edit',label:'Disabled input',isWritable:true,enabled:false},
    {role:'Edit',label:'Protected input',writable:true,is_password:true},
  ]);
  const observed=await f.read();
  assert.deepEqual(observed.controls.map(control=>control.editable),[true,false,false]);
  for(const index of [1,2])await assert.rejects(f.service.action({snapshot:observed.snapshot,kind:'type',control_id:String(index),expected_name:observed.controls[index].name,text:'Blocked'}),/unavailable|protected/);
  assert.deepEqual(f.inputs(),[]);
});
