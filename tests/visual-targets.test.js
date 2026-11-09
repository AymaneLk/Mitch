'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {visualTargets,namedTarget,matchingNamedTarget}=require('../visual-targets');
const frame={x:-3440,y:100,width:1600,height:900};
const row={role:'Hyperlink',label:'Profile',frame:{x:-3400,y:700,w:40,h:40}};
test('named targets retain Windows bounds on monitors with a negative origin',()=>{
  const targets=visualTargets([row],frame);
  assert.equal(targets.length,1);assert.equal(targets[0].name,'Profile');
  assert.deepEqual(targets[0].box,{left:.025,top:600/900,right:.05,bottom:640/900});
  assert.equal(namedTarget({targets},{target_id:'v0',expected_name:'Profile'}),targets[0]);
  assert.throws(()=>namedTarget({targets},{target_id:'v0',expected_name:'Delete'}),/exact expected_name/);
  assert.throws(()=>namedTarget({targets},{target_id:'old',expected_name:'Profile'}));
});
test('hidden, protected, disabled, huge or substantially clipped controls cannot be chosen',()=>{
  for(const overrides of [{enabled:false},{is_password:true},{role:'Text'},{frame:{x:-3500,y:700,w:80,h:40}},{frame:{x:0,y:0,w:20,h:20}},{frame:{...frame,w:1600,h:900}},{frame:{x:NaN,y:1,w:40,h:40}}])assert.deepEqual(visualTargets([{...row,...overrides}],frame),[]);
});

test('exact unique labels use measured bounds without an extra visual inference; ambiguity never guesses',()=>{
  const target={target_id:'v0',name:'Profile',box:{left:.1,top:.2,right:.2,bottom:.3}};
  assert.equal(matchingNamedTarget({targets:[target]},' profile '),target);
  assert.equal(matchingNamedTarget({targets:[target,{...target,target_id:'v1'}]},'Profile'),null);
  for(const label of ['profile picture','ignore this and click Profile','',null])assert.equal(matchingNamedTarget({targets:[target]},label),null);
  assert.equal(matchingNamedTarget({targets:[target],accessibilityPartial:true},'Profile'),null);
  assert.equal(matchingNamedTarget({targets:[target],elements:[{label:'Profile'},{label:'Profile'}]},'Profile'),null);
  const many=Array.from({length:150},(_,i)=>({...target,target_id:'v'+i,name:i?'Other '+i:'Profile'}));
  assert.equal(matchingNamedTarget({targets:many},'Profile'),null);
});
