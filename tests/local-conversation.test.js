const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalConversation}=require('../local-conversation');
const {AI}=require('../ai');
const settings=()=>({localOnly:true,chatProvider:'local',transcriptionProvider:'local',localSpeechUrl:'http://127.0.0.1:22132',localVoiceLanguage:'fr-fr'});
test('local edition refuses cloud API before reading credentials or sending a request',async()=>{
  const ai=new AI(settings,()=>{throw Error('Key accessed');},()=>{},()=>{throw Error('Network accessed');});
  await assert.rejects(ai.request('live/sessions',{}),/Cloud AI is disabled/);
});
test('local conversation transcribes, reasons and returns local speech',async()=>{
  const calls=[];const ai={cancel(){},async chat(text){assert.equal(text,'Hello');return 'Hi';}};
  const voice=new LocalConversation(ai,settings,async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');if(url.endsWith('/speech'))assert.equal(JSON.parse(options.body).language,'en-us');return url.endsWith('/transcribe')?{ok:true,json:async()=>({text:'Hello'})}:{ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer};});
  const id=voice.start();assert.deepEqual(await voice.turn(Buffer.from('audio'),id),{transcript:'Hello',answer:'Hi',audio:[1,2]});
  assert.ok(calls.every(url=>url.startsWith('http://127.0.0.1:22132/')));
  voice.stop();await assert.rejects(voice.turn(Buffer.from('audio'),id),/ended/);
});
test('ending during transcription prevents model actions and audio',async()=>{
  let release;const ai={cancel(){},chat(){throw Error('Should not act');}};
  const voice=new LocalConversation(ai,settings,()=>new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({text:'Do something'})});}));
  const pending=voice.turn(Buffer.from('audio'),voice.start());voice.stop();release();await assert.rejects(pending);
  assert.equal(voice.busy,false);
});

test('live captions and acknowledgement arrive before reasoning completes; final transcript is used once',async()=>{
  const events=[],chats=[],requests=[];let releaseAnswer,onText;
  const stream={ready:Promise.resolve(),append(){},cancel(){},async finish(){return 'Open Calculator.';}};
  const ai={cancel(){},chat(text){chats.push(text);return new Promise(resolve=>releaseAnswer=resolve);}};
  const voice=new LocalConversation(ai,settings,async(url)=>{requests.push(url);return {ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer};},{notify:e=>events.push(e),createTranscription:callback=>{onText=callback;return stream;}});
  const generation=voice.start(),input=await voice.beginInput(generation,16000);
  onText('Open Calcu');assert.equal(events[0].text,'Open Calcu');assert.equal(chats.length,0);
  const pending=voice.turn(Buffer.from('fallback audio'),generation,null,input);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(chats,['Open Calculator.']);assert.ok(events.some(e=>e.type==='working'));assert.ok(events.some(e=>e.type==='acknowledgement'&&e.audio.length===2));
  releaseAnswer('Calculator is open.');assert.equal((await pending).answer,'Calculator is open.');
  assert.equal(requests.some(url=>url.endsWith('/transcribe')),false);voice.stop();
});

test('a broken live stream falls back to the complete recording without acting on partial words',async()=>{
  const chats=[];
  const voice=new LocalConversation({cancel(){},async chat(text){chats.push(text);return 'OK';}},settings,async url=>url.endsWith('/transcribe')?{ok:true,json:async()=>({text:'The complete instruction'})}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(0)},{createTranscription:()=>({ready:Promise.resolve(),cancel(){},finish:async()=>{throw Error('disconnected');}})});
  const generation=voice.start(),input=await voice.beginInput(generation,16000);
  await voice.turn(Buffer.from('complete recording'),generation,null,input);assert.deepEqual(chats,['The complete instruction']);voice.stop();
});

test('stable partial requests revise at most twice without running actions; Stop aborts preparation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const prepared=[];let onText,chats=0;
  const voice=new LocalConversation({cancel(){},chat(){chats++;throw Error('Partial words must not act');}},settings,async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}),{
    prepare:(text,context)=>prepared.push({text,...context}),createTranscription:callback=>{onText=callback;return {ready:Promise.resolve(),cancel(){},finish:async()=>''};},
  });
  const generation=voice.start(),inputId=await voice.beginInput(generation,16000);
  onText('Open Cal');t.mock.timers.tick(300);onText('Open Calculator');t.mock.timers.tick(300);await Promise.resolve();assert.equal(prepared.length,0);
  t.mock.timers.tick(100);await Promise.resolve();assert.equal(prepared.length,1);assert.equal(prepared[0].text,'Open Calculator');assert.equal(prepared[0].inputId,inputId);assert.equal(chats,0);
  onText('Open Calculator and calculate 6 times 7');assert.equal(prepared[0].signal.aborted,true);t.mock.timers.tick(1000);await Promise.resolve();assert.equal(prepared.length,2);assert.ok(prepared[1].revision>prepared[0].revision);assert.equal(prepared[1].readOnly,true);assert.equal(prepared[1].final,false);
  onText('Open Calculator and calculate 8 times 7');assert.equal(prepared[1].signal.aborted,true);t.mock.timers.tick(1000);await Promise.resolve();assert.equal(prepared.length,2);assert.equal(chats,0);
  voice.stop();onText('Open Notes');t.mock.timers.tick(1000);await Promise.resolve();assert.equal(prepared.length,2);
});

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function preparationFixture(t,{prepare,chat,finish,now}={}){
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[],preparations=[],callbacks=[];
  const ai={cancel(){},async chat(text,image,scope,options){calls.push({text,options});return chat?chat(text,options):'Done';}};
  const voice=new LocalConversation(ai,settings,async url=>url.endsWith('/transcribe')?{ok:true,json:async()=>({text:'Open Calculator'})}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(0)},{
    ...(now?{now}:{}),
    prepare:(text,context)=>{preparations.push({text,context});return prepare?prepare(text,context):{context:'owned fixture'};},
    createTranscription:callback=>{callbacks.push(callback);return {ready:Promise.resolve(),append(){},cancel(){},finish:async()=>finish?finish():'Open Calculator'};},
  });
  return {voice,calls,preparations,callbacks,async start(){const generation=voice.start(),inputId=await voice.beginInput(generation,16000);return {generation,inputId};},async partial(text){callbacks.at(-1)(text);t.mock.timers.tick(400);await settle();}};
}

test('exact final words adopt an in-flight read-only preparation without aborting it at finish',async t=>{
  let resolvePreparation,used;
  const f=preparationFixture(t,{prepare:()=>new Promise(resolve=>resolvePreparation=resolve),chat:async(_text,options)=>{used=options.prepared;const value=await used.promise;assert.deepEqual(value,{context:'fresh fixture',draft:'bounded plan'});return 'Done';}});
  const {generation,inputId}=await f.start();await f.partial('Open Calculator');assert.equal(f.calls.length,0);
  const pending=f.voice.turn(Buffer.from('audio'),generation,null,inputId);await settle();
  assert.ok(used);assert.equal(used.signal.aborted,false);assert.equal(used.inputId,inputId);assert.equal(used.generation,generation);assert.equal(used.normalizedText,'Open Calculator');assert.equal(f.calls.length,1);
  resolvePreparation({context:'fresh fixture',draft:'bounded plan'});assert.equal((await pending).answer,'Done');assert.equal(used.signal.aborted,true);f.voice.stop();
});

test('changed final instruction never adopts the previously prepared plan',async t=>{
  const f=preparationFixture(t,{finish:()=>"Open Calculator and don't calculate anything"});
  const {generation,inputId}=await f.start();await f.partial('Open Calculator');
  await f.voice.turn(Buffer.from('audio'),generation,null,inputId);
  assert.equal(f.calls[0].options.prepared,undefined);assert.equal(f.preparations[0].context.signal.aborted,true);f.voice.stop();
});

test('prepared matching preserves case, punctuation and whitespace that may be typed data',async t=>{
  let finalText;
  const f=preparationFixture(t,{finish:()=>finalText});const generation=f.voice.start();
  for(finalText of ['Open Notepad and type "hello"','Open Notepad and type "Hello "','Open Notepad and type "Hello".']){
    const inputId=await f.voice.beginInput(generation,16000);await f.partial('Open Notepad and type "Hello"');
    await f.voice.turn(Buffer.from('audio'),generation,null,inputId);assert.equal(f.calls.at(-1).options.prepared,undefined);
  }
  f.voice.stop();
});

test('expired preparation is discarded even when its read already completed',async t=>{
  let now=1000;
  const f=preparationFixture(t,{now:()=>now});const {generation,inputId}=await f.start();await f.partial('Open Calculator');now=4001;
  await f.voice.turn(Buffer.from('audio'),generation,null,inputId);assert.equal(f.calls[0].options.prepared,undefined);assert.equal(f.preparations[0].context.signal.aborted,true);f.voice.stop();
});

test('Stop aborts adopted preparation and releases a hook that ignores cancellation',async t=>{
  let used;
  const f=preparationFixture(t,{prepare:()=>new Promise(()=>{}),chat:async(_text,options)=>{used=options.prepared;assert.equal(await used.promise,null);return 'Late';}});
  const {generation,inputId}=await f.start();await f.partial('Open Calculator');
  const pending=f.voice.turn(Buffer.from('audio'),generation,null,inputId);await settle();assert.equal(used.signal.aborted,false);
  f.voice.stop();await assert.rejects(pending,/abort|ended/i);assert.equal(used.signal.aborted,true);assert.equal(f.voice.busy,false);
});

test('a cancelled old revision resolving late cannot replace a newer prepared context',async t=>{
  let resolveOld;
  const f=preparationFixture(t,{finish:()=> 'Open Notepad',prepare:text=>text==='Open Calculator'?new Promise(resolve=>resolveOld=resolve):{context:'new'},chat:async(_text,options)=>{assert.deepEqual(await options.prepared.promise,{context:'new'});return 'Done';}});
  const {generation,inputId}=await f.start();await f.partial('Open Calculator');await f.partial('Open Notepad');resolveOld({context:'old'});await settle();
  await f.voice.turn(Buffer.from('audio'),generation,null,inputId);assert.equal(f.preparations[0].context.signal.aborted,true);assert.equal(f.calls.length,1);f.voice.stop();
});

test('a preparation deadline releases adopted waits without authorizing partial input',async t=>{
  const f=preparationFixture(t,{prepare:()=>new Promise(()=>{}),chat:async(_text,options)=>{assert.equal(await options.prepared.promise,null);return 'Fresh fallback';}});
  const {generation,inputId}=await f.start();await f.partial('Open Calculator');assert.equal(f.calls.length,0);
  const pending=f.voice.turn(Buffer.from('audio'),generation,null,inputId);await settle();t.mock.timers.tick(3000);assert.equal((await pending).answer,'Fresh fallback');f.voice.stop();
});

test('replacing the recording aborts old preparation and ignores its late callback and result',async t=>{
  let resolveOld;
  const f=preparationFixture(t,{prepare:()=>new Promise(resolve=>resolveOld=resolve)});
  const {generation}=await f.start();await f.partial('Open Calculator');const oldCallback=f.callbacks[0];
  const inputId=await f.voice.beginInput(generation,16000);assert.equal(f.preparations[0].context.signal.aborted,true);oldCallback('Open Calculator');resolveOld({context:'old'});await settle();
  await f.voice.turn(Buffer.from('audio'),generation,null,inputId);assert.equal(f.calls[0].options.prepared,undefined);assert.equal(f.preparations.length,1);f.voice.stop();
});

test('finishing or replacing an input cancels its pending preparation timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let onText;const prepared=[];
  const voice=new LocalConversation({cancel(){},chat(){throw Error('Empty input must not act');}},settings,async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}),{
    prepare:text=>prepared.push(text),createTranscription:callback=>{onText=callback;return {ready:Promise.resolve(),cancel(){},finish:async()=>''};},
  });
  const generation=voice.start();await voice.beginInput(generation,16000);onText('Open Instagram');
  const inputId=await voice.beginInput(generation,16000);t.mock.timers.tick(500);await Promise.resolve();assert.deepEqual(prepared,[]);
  onText('Find Calculator');await voice.turn(Buffer.from('fallback'),generation,null,inputId);t.mock.timers.tick(500);await Promise.resolve();assert.deepEqual(prepared,[]);voice.stop();
});
