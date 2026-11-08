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
