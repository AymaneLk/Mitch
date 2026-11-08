const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PetPresentation}=require('../pet-presentation');
test('pet shows connection immediately, keeps live captions, and clears them after ending',()=>{
  const pet=new PetPresentation();pet.setWake('listening');assert.equal(pet.snapshot().label,'Say “Hi Mitch”');
  pet.update({type:'status',state:'connecting'});assert.equal(pet.snapshot().label,'Connecting…');
  assert.equal(pet.update({type:'caption',speaker:'You',delta:'too early'}),false);
  pet.update({type:'status',state:'active'});
  for(const delta of ['Hello',' Mitch'])pet.update({type:'caption',speaker:'You',delta});
  pet.update({type:'caption',speaker:'Mitch',delta:'Hi!'});
  assert.deepEqual(pet.snapshot().turns,[{speaker:'You',text:'Hello Mitch'},{speaker:'Mitch',text:'Hi!'}]);
  pet.update({type:'status',state:'closing'});assert.equal(pet.snapshot().turns.length,2);
  assert.equal(pet.update({type:'caption',speaker:'Mitch',delta:'late'}),false);
  pet.update({type:'status',state:'idle'});assert.equal(pet.snapshot().turns.length,0);assert.equal(pet.snapshot().width,180);
  assert.equal(pet.update({type:'caption',speaker:'Mitch',delta:'after Stop'}),false);
});
test('transcripts stay bounded and the latest two speaker turns remain in order',()=>{
  const pet=new PetPresentation();pet.update({type:'status',state:'active'});
  pet.update({type:'caption',speaker:'You',delta:'First'});pet.update({type:'caption',speaker:'Mitch',delta:'Reply'});
  for(let i=0;i<100;i++)pet.update({type:'caption',speaker:'You',delta:'مرحبا '.repeat(100)});
  const snapshot=pet.snapshot();assert.equal(snapshot.turns.length,2);assert.equal(snapshot.turns[0].text,'Reply');assert.equal(snapshot.turns[1].text.length,1200);
  snapshot.turns[0].text='changed';assert.equal(pet.snapshot().turns[0].text,'Reply');
  assert.throws(()=>pet.update({type:'caption',speaker:'unknown',delta:'text'}));assert.throws(()=>pet.update({type:'caption',speaker:'You',delta:'x'.repeat(8193)}));
});
test('wake changes cannot replace conversation status and giant size survives expansion',()=>{
  const pet=new PetPresentation();pet.setSize('giant');assert.equal(pet.snapshot().width,360);
  pet.update({type:'status',state:'active'});pet.setWake('busy');assert.equal(pet.snapshot().label,'Listening');assert.equal(pet.snapshot().width,440);
  pet.update({type:'status',state:'idle'});assert.equal(pet.snapshot().width,360);assert.equal(pet.snapshot().label,'Microphone in use');
  pet.setWake('paused');assert.equal(pet.snapshot().label,'Paused');
});
