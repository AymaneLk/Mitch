'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {LocalGrounder}=require('../local-grounding');
const {AI}=require('../ai');
const image='data:image/png;base64,AA==';
test('local proposer sends no credentials and accepts only bounded coordinate proposals',async()=>{
  let request;
  const grounder=new LocalGrounder({fetcher:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({found:true,point:{x:.2,y:.7},confidence:1,box:{left:0,top:0,right:1,bottom:1}})};}});
  assert.deepEqual(await grounder.propose(image,'Profile'),{point:{x:.2,y:.7},source:'goclick',grounding_only:true});
  assert.equal(request.url,'http://127.0.0.1:22135/locate');assert.equal(request.headers.Authorization,undefined);assert.equal(request.headers['X-Mitch-Grounding'],'1');assert.equal(request.redirect,'error');
  assert.deepEqual(JSON.parse(request.body),{image,label:'Profile'});
  for(const result of [{found:false,point:{x:.2,y:.3}},{found:true,point:{x:2,y:0}},{found:true,point:{x:0,y:'0'}},{found:true,box:{left:0,top:0,right:1,bottom:1}}]){
    grounder.fetch=async()=>({ok:true,json:async()=>result});assert.equal(await grounder.propose(image,'Profile'),null);
  }
});
test('offline or timed-out runtime enters bounded cooldown without replaying requests',async()=>{
  let now=0,calls=0;
  const grounder=new LocalGrounder({now:()=>now,fetcher:async()=>{calls++;throw Error('offline');}});
  assert.equal(await grounder.propose(image,'Profile'),null);assert.equal(await grounder.propose(image,'Profile'),null);assert.equal(calls,1);
  now=30001;assert.equal(await grounder.propose(image,'Profile'),null);assert.equal(calls,2);
});
test('cancelled local response is never treated as an offline fallback',async()=>{
  const controller=new AbortController();
  const grounder=new LocalGrounder({fetcher:async()=>{controller.abort(Error('Stopped'));return {ok:true,json:async()=>({found:true,point:{x:.2,y:.3}})};}});
  await assert.rejects(grounder.propose(image,'Profile',controller.signal),/Stopped/);
});
test('invalid input never reaches local service',async()=>{
  const grounder=new LocalGrounder({fetcher:()=>assert.fail('No request')});
  await assert.rejects(grounder.propose('https://example.test/image.png','Profile'),/image/);
  await assert.rejects(grounder.propose(image,''),/label/);
});
test('AI keeps local attempts separate from paid model requests and honors screen revocation',async()=>{
  const settings={allowScreen:true,localGrounding:true};
  const ai=new AI(()=>settings,()=>assert.fail('No key'),()=>assert.fail('No desktop input'),()=>assert.fail('No API'));
  ai.taskTiming={modelRequests:0,modelMs:0,steps:[]};
  ai.localGrounder.propose=async()=>({point:{x:.2,y:.3}});
  assert.ok(await ai.proposeTarget(image,'Profile'));assert.equal(ai.taskTiming.modelRequests,0);assert.equal(ai.taskTiming.localGroundingAttempts,1);assert.equal(ai.taskTiming.steps[0].kind,'local_grounding');
  settings.localGrounding=false;assert.equal(await ai.proposeTarget(image,'Profile'),null);
  settings.allowScreen=false;await assert.rejects(ai.proposeTarget(image,'Profile'),/screen sharing/);
  await assert.rejects(ai.locate(image,'Profile'),/screen sharing/);
  settings.allowScreen=true;settings.localGrounding=true;
  ai.localGrounder.propose=async()=>{settings.allowScreen=false;return{point:{x:.2,y:.3}};};
  await assert.rejects(ai.proposeTarget(image,'Profile'),/disabled/);
});
