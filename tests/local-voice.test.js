const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function renderer(){
  let tick,time=0,level=0,resolveTurn,stops=0,releases=0,constraints;
  const track={enabled:true,stopped:false,stop(){this.stopped=true;}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const api={claimMicrophone:async()=>1,releaseMicrophone:async()=>{releases++;},localVoiceStart:async()=>7,localVoiceStop:async()=>{stops++;},localVoiceTurn:()=>new Promise(resolve=>resolveTurn=resolve)};
  class AudioContext{async resume(){}async close(){}createMediaStreamSource(){return{connect(){},disconnect(){}};}createAnalyser(){return{fftSize:1024,getFloatTimeDomainData(samples){samples.fill(level);}};}}
  class MediaRecorder{constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}}
  const ctx={window:{companion:api},navigator:{mediaDevices:{getUserMedia:async input=>{constraints=input;return stream;}}},AudioContext,MediaRecorder,performance:{now:()=>time},Float32Array,Uint8Array,Blob,URL,setInterval:fn=>{tick=fn;return 1;},clearInterval(){tick=null;},Audio:class{constructor(){throw Error('Stale audio played');}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('ui/local-voice.js','utf8')+';globalThis.Voice=LocalVoice;',ctx);
  const errors=[],captions=[];const voice=new ctx.Voice({status(){},caption:(...x)=>captions.push(x),error:e=>errors.push(e)});
  return {voice,api,track,errors,captions,constraints:()=>constraints,resolve:result=>resolveTurn(result),step:(t,v)=>{time=t;level=v;tick();},counts:()=>({stops,releases})};
}
test('voice capture requests the selected microphone explicitly',async()=>{
  const r=renderer();r.voice.microphoneId='chosen-mic';await r.voice.start();
  assert.equal(r.constraints().audio.deviceId.exact,'chosen-mic');await r.voice.stop();
});
test('local renderer pauses capture at silence and ignores a reply after End',async()=>{
  const r=renderer();r.voice.autoSend=true;await r.voice.start();assert.equal(r.voice.state,'active');
  r.step(100,0.1);r.step(1200,0);assert.equal(r.track.enabled,true);r.step(2000,0);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(r.track.enabled,false);
  await r.voice.stop();r.resolve({transcript:'hi',answer:'hello',audio:[1,2]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.track.stopped,true);assert.equal(r.voice.state,'idle');assert.equal(r.captions.length,0);assert.equal(r.errors.length,0);assert.deepEqual(r.counts(),{stops:1,releases:1});
});
test('manual turn preserves pauses and allows quiet recordings below the energy threshold',async()=>{
  const r=renderer();r.voice.autoSend=false;await r.voice.start();
  r.step(100,0.005);r.step(5000,0);assert.equal(r.track.enabled,true);
  r.voice.sendTurn();await new Promise(resolve=>setImmediate(resolve));assert.equal(r.track.enabled,false);
  await r.voice.stop();r.resolve({transcript:'quiet words',answer:'reply',audio:[]});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(r.errors.length,0);
});
test('ending during microphone acquisition stops late tracks and releases the lease',async()=>{
  const r=renderer();let release;r.api.claimMicrophone=()=>new Promise(resolve=>release=resolve);
  const pending=r.voice.start();await r.voice.stop();release(3);await pending;
  assert.equal(r.voice.state,'idle');assert.equal(r.counts().releases,1);
});
