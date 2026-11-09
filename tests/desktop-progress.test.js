const {test}=require('node:test'),assert=require('node:assert/strict');
const {DesktopProgress}=require('../desktop-progress');
const {AI}=require('../ai');
const frame=(value,id='a')=>({snapshot:id,window:{pid:1,window_id:2,title:'Calculator'},controls:[{control_id:id,name:'Display',type:'Text',value}]});
test('three inputs with unchanged controls stop despite renewed snapshot/control IDs',()=>{
  const p=new DesktopProgress();p.record('computer_inspect_window',{},frame('1'));
  for(let i=0;i<2;i++)assert.equal(p.record('computer_action',{kind:'click'},{status:'unverified',observation:frame('1',String(i))}),undefined);
  assert.match(p.record('computer_action',{kind:'click'},{status:'unverified',observation:frame('1','last')}),/no observable change/);
});
test('repeated digits are valid when the actual display changes',()=>{
  const p=new DesktopProgress();p.record('computer_inspect_window',{},frame('0'));
  for(const value of ['1','18','188','282'])assert.equal(p.record('computer_action',{kind:'click'},{status:'unverified',observation:frame(value)}),undefined);
});
test('reading an unchanged screen does not reset failed-input protection',()=>{
  const p=new DesktopProgress();p.record('computer_inspect_window',{},frame('0'));
  for(let i=0;i<2;i++){assert.equal(p.record('computer_input',{}, {status:'error',message:'No accessible target'}),undefined);p.record('computer_inspect_window',{},frame('0',String(i)));}
  assert.match(p.record('computer_input',{}, {status:'error',message:'No accessible target'}),/three unsuccessful/);
});

test('visual clicks with no meaningful image change stop even when accessibility is absent',()=>{
  const p=new DesktopProgress(),output={status:'unverified',snapshot:'fresh',visual_change:{meaningful:false,changed_fraction:.001}};
  for(let i=0;i<2;i++){
    assert.equal(p.record('computer_input',{kind:'click'},output),undefined);
    p.record('computer_observe',{}, {status:'observed',snapshot:String(i),targets:[]});
  }
  assert.match(p.record('computer_input',{kind:'click'},output),/no observable change/);
});
test('a meaningful visual change resets no-progress counting without claiming success',()=>{
  const p=new DesktopProgress();
  for(const meaningful of [false,false,true,false,false])assert.equal(p.record('computer_input',{kind:'click'},{status:'unverified',visual_change:{meaningful}}),undefined);
});
test('real progress after an uncertain operation permits continuing',()=>{
  const p=new DesktopProgress();p.record('computer_inspect_window',{},frame('0'));
  p.record('computer_action',{}, {status:'error'});p.record('computer_action',{}, {status:'error'});
  p.record('computer_inspect_window',{},frame('1'));
  assert.equal(p.record('computer_action',{}, {status:'error'}),undefined);
});

test('fresh changed recovery state breaks a failure streak even when the action acknowledgement failed',()=>{
  const p=new DesktopProgress();
  p.record('computer_action',{}, {status:'error'});p.record('computer_action',{}, {status:'error'});
  assert.equal(p.record('computer_action',{}, {status:'error',outcome_unknown:true,recovery:{state_changed:true},observation:frame('Messages')}),undefined);
  assert.equal(p.record('computer_action',{}, {status:'error'}),undefined);
});
test('tool loop stops repeated desktop errors before another model call or action',async()=>{
  let requests=0,actions=0;const ai=new AI(()=>({}),async()=>'',async()=>{actions++;return {status:'error',message:'Input refused'};});
  ai.request=async()=>({output:[{type:'function_call',call_id:String(++requests),name:'computer_input',arguments:'{"snapshot":"fixture","kind":"click","x":0.2,"y":0.5}'}]});
  const answer=await ai.chat('Use Calculator');assert.match(answer,/three unsuccessful/);assert.equal(requests,3);assert.equal(actions,3);
});
