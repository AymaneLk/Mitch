const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {WakeListener,WakeService}=require('../wake-listener');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fakeProcess(){
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.exitCode=null;
  child.kill=()=>{setImmediate(()=>{if(child.exitCode!==null)return;child.exitCode=0;child.emit('close',0);});};child.stdin.end=()=>{};
  child.event=data=>child.stdout.emit('data',Buffer.from(JSON.stringify(data)+'\n'));return child;
}
test('local helper is hidden, emits no transcript and wakes once only after a qualified result',async()=>{
  let child,options,args;const wakes=[],states=[];const listener=new WakeListener({helper:'C:/Mitch/wake-word.ps1',spawnImpl:(_file,a,o)=>{args=a;options=o;return child=fakeProcess();},onWake:()=>wakes.push(true),onState:s=>states.push(s)});
  listener.start();assert.equal(options.windowsHide,true);assert.ok(args.includes('C:/Mitch/wake-word.ps1'));
  child.event({event:'ready',culture:'en-US'});assert.equal(listener.state.status,'listening');child.event({event:'wake',confidence:0.1});assert.equal(wakes.length,0);
  child.event({event:'wake',confidence:0.9,text:'never forward ambient text'});child.event({event:'wake',confidence:0.9});assert.equal(wakes.length,1);assert.ok(!JSON.stringify(states).includes('ambient'));
  await listener.stop();child.event({event:'wake',confidence:0.99});assert.equal(wakes.length,1);
});
test('stop releases the process and late helper messages cannot reactivate listening',async()=>{
  let child;const listener=new WakeListener({helper:'wake.ps1',spawnImpl:()=>child=fakeProcess()});listener.start();await listener.stop();child.event({event:'ready'});
  assert.equal(listener.state.status,'off');assert.equal(listener.child,null);
});
function service(){
  const listener={state:{status:'off'},starts:0,stops:0,start(){this.starts++;this.state={status:'listening'};this.onState();},async stop(){this.stops++;this.state={status:'off'};this.onState();}};
  const wakes=[];const wake=new WakeService({listener,onWake:event=>wakes.push(event),cooldownMs:1});return {wake,listener,wakes};
}
test('wake starts only when enabled and configured, and detection supplies a one-use activation',async t=>{
  const {wake,listener,wakes}=service();t.after(()=>wake.close());await wake.configure({enabled:true,available:false});assert.equal(wake.status().status,'setup');assert.equal(listener.starts,0);
  await wake.configure({enabled:true,available:true});assert.equal(wake.status().status,'listening');listener.onWake();listener.onWake();assert.equal(wakes.length,1);assert.equal(wake.status().status,'waking');
  const lease=await wake.claim('voice',wakes[0].id);assert.equal(wake.status().status,'busy');assert.equal(listener.state.status,'off');await assert.rejects(wake.claim('voice',wakes[0].id),/ended/);
  wake.release(lease);await new Promise(r=>setTimeout(r,5));await wake.queue;assert.equal(wake.status().status,'listening');
});
test('overlapping microphone claims prevent early rearming and releases are idempotent',async t=>{
  const {wake,listener}=service();t.after(()=>wake.close());await wake.configure({enabled:true,available:true});const a=await wake.claim('voice'),b=await wake.claim('dictation');
  wake.release(a);wake.release(a);await new Promise(r=>setTimeout(r,5));await wake.queue;assert.equal(wake.status().status,'busy');assert.equal(listener.state.status,'off');
  wake.release(b);await new Promise(r=>setTimeout(r,5));await wake.queue;assert.equal(wake.status().status,'listening');
});
test('Stop invalidates wake events and pending claims; no automatic rearm until explicit resume',async t=>{
  const {wake,listener,wakes}=service();t.after(()=>wake.close());await wake.configure({enabled:true,available:true});listener.onWake();const old=wakes[0].id;
  await wake.pause();await assert.rejects(wake.claim('voice',old),/ended/);listener.onWake();assert.equal(wakes.length,1);assert.equal(wake.status().status,'paused');
  const manual=await wake.claim('voice');wake.release(manual);await new Promise(r=>setTimeout(r,5));await wake.queue;assert.equal(wake.status().status,'paused');
  await wake.resume();assert.equal(wake.status().status,'listening');
});
test('late claim completion after Stop cannot acquire a microphone',async t=>{
  const {wake,listener}=service();t.after(()=>wake.close());await wake.configure({enabled:true,available:true});let finish;listener.stop=()=>new Promise(resolve=>{finish=resolve;});
  const claim=wake.claim('voice');await tick();const paused=wake.pause();finish();await assert.rejects(claim,/cancelled/);await tick();finish();await paused;
  listener.stop=async()=>{};assert.equal(wake.claims.size,0);assert.equal(wake.status().status,'paused');
});
