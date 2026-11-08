'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AI}=require('../ai');
class Socket extends EventTarget {
  constructor(autoOpen=true){super();this.readyState=0;this.bufferedAmount=0;this.sent=[];if(autoOpen)queueMicrotask(()=>this.open());}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  send(text){this.sent.push(JSON.parse(text));}
  close(){if(this.readyState===3)return;this.readyState=3;this.dispatchEvent(new Event('close'));}
}
const makeAI=getKey=>new AI(()=>({chatModel:'gpt-6-luna',voiceModel:'gpt-live-1'}),getKey||(async()=>'test-key'),async()=>{},async()=>{throw new Error('No HTTP request expected.');});

test('voice preparation skips missing sessions without credentials, network or model output',async()=>{
  const ai=makeAI(async()=>{throw new Error('No key retrieval expected.');});
  assert.deepEqual(await ai.prepareVoice(),{status:'skipped'});
  assert.equal(ai.liveToolChannel.socket,null);
});

test('voice preparation shares one handshake and first tool continuation reuses it',async()=>{
  const ai=makeAI();let socket,connections=0;
  ai.liveToolChannel.socketFactory=()=>{connections++;return socket=new Socket();};
  ai.liveToolChannel.setSession('active-session');
  assert.deepEqual(await Promise.all([ai.prepareVoice(),ai.prepareVoice()]),[{status:'ready'},{status:'ready'}]);
  assert.equal(connections,1);assert.equal(socket.sent.length,0,'Preparation must not generate a response.');
  await ai.continueVoice([{call_id:'first',output:{status:'ok'}}]);
  assert.equal(connections,1);assert.deepEqual(socket.sent.map(item=>item.type),['response.item.create','response.create']);
  ai.closeVoice();
});

test('stopping while preparation awaits credentials cannot open or restore an old session',async()=>{
  let resolveKey,entered;const started=new Promise(resolve=>{entered=resolve;});
  const ai=makeAI(()=>{entered();return new Promise(resolve=>{resolveKey=resolve;});});let connections=0;
  ai.liveToolChannel.socketFactory=()=>{connections++;return new Socket();};
  ai.liveToolChannel.setSession('old');const preparing=ai.prepareVoice();await started;
  ai.closeVoice();ai.liveToolChannel.setSession('replacement');resolveKey('test-key');
  await assert.rejects(preparing,/stopped or session changed/);assert.equal(connections,0);assert.equal(ai.liveToolChannel.sessionId,'replacement');
  ai.closeVoice();
});

test('an aborted preparation cannot send output and obsolete socket close cannot fail a replacement',async()=>{
  const ai=makeAI();const failures=[];ai.onVoiceError=error=>failures.push(error.message);
  let socket,entered;const started=new Promise(resolve=>{entered=resolve;});
  ai.liveToolChannel.socketFactory=()=>{socket=new Socket(false);entered();return socket;};
  ai.liveToolChannel.setSession('old');const controller=new AbortController();
  const preparing=ai.prepareVoice({signal:controller.signal});await started;
  ai.closeVoice();ai.liveToolChannel.setSession('replacement');controller.abort(new Error('Stopped'));
  await assert.rejects(preparing,/closed before opening|Stopped/);assert.equal(socket.sent.length,0);assert.deepEqual(failures,[]);assert.equal(ai.liveToolChannel.sessionId,'replacement');
  ai.closeVoice();
});
