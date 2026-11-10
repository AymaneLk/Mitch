'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {NativeStateSignals}=require('../native-state-signals');
test('native events invalidate affected windows and focus changes invalidate all cached state',()=>{
  const signals=new NativeStateSignals(),a={window_id:1},b={window_id:2};assert.equal(signals.stamp(a),null);assert.equal(signals.current(a,null),false);
  signals.accept({ready:true});const sa=signals.stamp(a),sb=signals.stamp(b);signals.accept({kind:'changed',window:1});assert.equal(signals.current(a,sa),false);assert.equal(signals.current(b,sb),true);
  const fresh=signals.stamp(a);signals.accept({kind:'focus',window:99});assert.equal(signals.current(a,fresh),false);assert.equal(signals.current(b,sb),false);
  signals.stop();assert.equal(signals.ready,false);
});
test('native metadata ignores malformed events and retains no control text',()=>{
  const signals=new NativeStateSignals();signals.accept({ready:true});const before=signals.stamp({window_id:1});
  for(const event of [{kind:'changed',window:-1},{kind:'script',window:1},{kind:'changed',window:'1'}])signals.accept(event);
  assert.equal(signals.stamp({window_id:1}),before);signals.accept({kind:'changed',window:1,text:'private'});assert.equal(JSON.stringify([...signals.windows]).includes('private'),false);
});

test('an unavailable state helper falls back to fresh reads without a process restart loop',()=>{
  const {EventEmitter}=require('node:events');let time=0,starts=0,child;
  const signals=new NativeStateSignals({helper:'owned-helper.ps1',now:()=>time,spawnImpl:()=>{starts++;child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr={resume(){}};child.kill=()=>{};return child;}});
  signals.start();child.emit('error',Error('unavailable'));for(let i=0;i<20;i++)signals.start();assert.equal(starts,1);assert.equal(signals.current({window_id:1},null),false);
  time=30001;signals.start();assert.equal(starts,2);signals.stop();
});
