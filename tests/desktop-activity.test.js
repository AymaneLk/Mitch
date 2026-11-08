const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DesktopActivity} = require('../desktop-activity');

function deferred() { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('indicator precedes input and stays visible across a task tool gap',async()=>{
  const events=[];
  const activity=new DesktopActivity({show:()=>events.push('show'),hide:()=>events.push('hide')});
  const scope=activity.beginScope();
  assert.equal(activity.active,false);
  assert.equal(await activity.run(scope,async()=>{events.push('input');return 42;}),42);
  assert.deepEqual(events,['show','input']);assert.equal(activity.active,true);
  await activity.run(scope,async()=>events.push('next'));
  activity.endScope(scope);
  assert.deepEqual(events,['show','input','next','hide']);assert.equal(activity.active,false);
});

test('ephemeral operation hides on success and preserves its original error',async()=>{
  const events=[];const activity=new DesktopActivity({show:()=>events.push('show'),hide:()=>{events.push('hide');throw Error('cleanup failed');}});
  assert.equal(await activity.run(null,async()=>12),12);
  const original=new Error('input failed');
  await assert.rejects(activity.run(undefined,async()=>{throw original;}),error=>error===original);
  assert.equal(activity.active,false);assert.deepEqual(events,['show','hide','show','hide']);
});

test('overlapping task scopes share the indicator and cannot hide each other',async()=>{
  const events=[],ready=deferred();const activity=new DesktopActivity({show:()=>{events.push('show');return ready.promise;},hide:()=>events.push('hide')});
  const a=activity.beginScope(),b=activity.beginScope();
  const first=activity.run(a,async()=>events.push('a')),second=activity.run(b,async()=>events.push('b'));
  await turn();assert.deepEqual(events,['show']);ready.resolve();await Promise.all([first,second]);
  activity.endScope(a);assert.equal(activity.active,true);assert.equal(events.includes('hide'),false);
  activity.endScope(b);assert.equal(events.at(-1),'hide');assert.equal(activity.active,false);
});

test('Stop before show starts prevents both the indicator callback and input',async()=>{
  let shows=0,inputs=0,hides=0;const activity=new DesktopActivity({show:()=>shows++,hide:()=>hides++});
  const scope=activity.beginScope(),pending=activity.run(scope,async()=>inputs++);
  activity.stop();await assert.rejects(pending,/stopped/);
  assert.equal(shows,0);assert.equal(inputs,0);assert.equal(hides,1);
});

test('Stop while indicator loads prevents input and leaves the overlay hidden',async()=>{
  const ready=deferred();let visible=false,inputs=0;
  const activity=new DesktopActivity({show:async()=>{await ready.promise;visible=true;},hide:()=>{visible=false;}});
  const pending=activity.run(activity.beginScope(),async()=>inputs++);
  await turn();activity.stop();assert.equal(visible,false);
  ready.resolve();await assert.rejects(pending,/stopped/);
  assert.equal(inputs,0);assert.equal(visible,false);
});

test('a stale show completion never hides the indicator owned by a replacement task',async()=>{
  const firstReady=deferred(),secondReady=deferred();let visible=false,calls=0;
  const activity=new DesktopActivity({show:async()=>{await (++calls===1?firstReady:secondReady).promise;visible=true;},hide:()=>{visible=false;}});
  const old=activity.run(activity.beginScope(),async()=>assert.fail('old input'));
  await turn();activity.stop();
  const freshScope=activity.beginScope(),fresh=activity.run(freshScope,async()=>17);
  await turn();secondReady.resolve();assert.equal(await fresh,17);assert.equal(visible,true);
  firstReady.resolve();await assert.rejects(old,/stopped/);assert.equal(visible,true);
  activity.endScope(freshScope);assert.equal(visible,false);
});

test('ending a scope while show loads cancels that scope without affecting another',async()=>{
  const ready=deferred();let input=0,hides=0;const activity=new DesktopActivity({show:()=>ready.promise,hide:()=>hides++});
  const a=activity.beginScope(),b=activity.beginScope();
  const first=activity.run(a,async()=>assert.fail('ended input')),second=activity.run(b,async()=>input++);
  await turn();activity.endScope(a);ready.resolve();await assert.rejects(first,/expired/);await second;
  assert.equal(input,1);assert.equal(hides,0);activity.endScope(b);assert.equal(hides,1);
});

test('indicator failure prevents input and can be retried by a still-live task',async()=>{
  let show=0,input=0;const activity=new DesktopActivity({show:()=>{if(++show===1)throw Error('overlay unavailable');},hide:()=>{}});
  const scope=activity.beginScope();await assert.rejects(activity.run(scope,async()=>input++),/overlay unavailable/);
  assert.equal(input,0);await activity.run(scope,async()=>input++);assert.equal(input,1);activity.endScope(scope);
});

test('a false readiness result also fails closed',async()=>{
  const activity=new DesktopActivity({show:()=>false,hide:()=>{}});let input=0;
  await assert.rejects(activity.run(null,async()=>input++),/could not be shown/);assert.equal(input,0);assert.equal(activity.active,false);
});

test('unknown, ended and stopped scopes reject without showing or acting',async()=>{
  let calls=0;const activity=new DesktopActivity({show:()=>calls++,hide:()=>{}});
  await assert.rejects(activity.run(Symbol(),async()=>calls++),/expired/);
  const ended=activity.beginScope();activity.endScope(ended);await assert.rejects(activity.run(ended,async()=>calls++),/expired/);
  const stopped=activity.beginScope();activity.stop();await assert.rejects(activity.run(stopped,async()=>calls++),/stopped/);
  assert.equal(calls,0);activity.endScope(stopped);
});

test('Stop during an operation rejects its late success without masking its failure',async()=>{
  const done=deferred();const activity=new DesktopActivity({show:()=>{},hide:()=>{}});
  const pending=activity.run(activity.beginScope(),()=>done.promise);
  await turn();activity.stop();done.resolve('late success');await assert.rejects(pending,/stopped/);
  const failure=deferred(),original=Error('operation failed');
  const second=activity.run(activity.beginScope(),()=>failure.promise);
  await turn();activity.stop();failure.reject(original);await assert.rejects(second,error=>error===original);
});

test('a late voice final ends admission but keeps the indicator until input settles',async()=>{
  const done=deferred();let visible=false;
  const activity=new DesktopActivity({show:()=>{visible=true;},hide:()=>{visible=false;}});
  const scope=activity.beginScope(),pending=activity.run(scope,()=>done.promise);
  await turn();activity.endScope(scope);
  assert.equal(visible,true);assert.equal(activity.active,true);
  await assert.rejects(activity.run(scope,()=>assert.fail('new input after task end')),/expired/);
  done.resolve('actual result');assert.equal(await pending,'actual result');
  assert.equal(visible,false);assert.equal(activity.active,false);
});

test('an ended task draining cannot hide an overlapping replacement task',async()=>{
  const done=deferred();let visible=false,hides=0;
  const activity=new DesktopActivity({show:()=>{visible=true;},hide:()=>{visible=false;hides++;}});
  const oldScope=activity.beginScope(),old=activity.run(oldScope,()=>done.promise);
  await turn();activity.endScope(oldScope);
  const fresh=activity.beginScope();await activity.run(fresh,async()=>42);
  done.resolve('old result');await old;
  assert.equal(visible,true);assert.equal(hides,0);
  activity.endScope(fresh);assert.equal(visible,false);assert.equal(hides,1);
});

test('Stop immediately hides even when a gracefully ended task is draining',async()=>{
  const done=deferred();let visible=false;
  const activity=new DesktopActivity({show:()=>{visible=true;},hide:()=>{visible=false;}});
  const scope=activity.beginScope(),pending=activity.run(scope,()=>done.promise);
  await turn();activity.endScope(scope);assert.equal(visible,true);
  activity.stop();assert.equal(visible,false);done.resolve('late');await assert.rejects(pending,/stopped/);
});
