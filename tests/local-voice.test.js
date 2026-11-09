const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function renderer(){
  let tick,time=0,level=0,resolveTurn,stops=0,releases=0,constraints;
  const track={enabled:true,stopped:false,stop(){this.stopped=true;}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const api={claimMicrophone:async()=>1,releaseMicrophone:async()=>{releases++;},localVoiceStart:async()=>7,localVoiceStop:async()=>{stops++;},localVoiceTurn:()=>new Promise(resolve=>resolveTurn=resolve)};
  class AudioContext{async resume(){}async close(){}createMediaStreamSource(){return{connect(){},disconnect(){}};}createAnalyser(){return{fftSize:1024,getFloatTimeDomainData(samples){samples.fill(level);}};}}
  class MediaRecorder{constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}}
  const ctx={window:{companion:api},navigator:{mediaDevices:{getUserMedia:async input=>{constraints=input;return stream;}}},AudioContext,MediaRecorder,performance:{now:()=>time},Float32Array,Uint8Array,Blob,URL,setTimeout,clearTimeout,setInterval:fn=>{tick=fn;return 1;},clearInterval(){tick=null;},Audio:class{constructor(){throw Error('Stale audio played');}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('ui/local-voice.js','utf8')+';globalThis.Voice=LocalVoice;',ctx);
  const errors=[],captions=[],states=[];const voice=new ctx.Voice({status:(...x)=>states.push(x),caption:(...x)=>captions.push(x),error:e=>errors.push(e)});
  return {voice,api,track,errors,captions,states,constraints:()=>constraints,resolve:result=>resolveTurn(result),step:(t,v)=>{time=t;level=v;tick();},time:t=>{time=t;},counts:()=>({stops,releases})};
}
test('voice capture requests the selected microphone explicitly',async()=>{
  const r=renderer();r.voice.microphoneId='chosen-mic';await r.voice.start();
  assert.equal(r.constraints().audio.deviceId.exact,'chosen-mic');await r.voice.stop();
});
test('local renderer pauses capture at silence and ignores a reply after End',async()=>{
  const r=renderer();await r.voice.start();assert.equal(r.voice.state,'active');
  r.step(100,0.1);r.step(1200,0);assert.equal(r.track.enabled,true);r.step(2000,0);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(r.track.enabled,false);
  await r.voice.stop();r.resolve({transcript:'hi',answer:'hello',audio:[1,2]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.track.stopped,true);assert.equal(r.voice.state,'idle');assert.equal(r.captions.length,0);assert.equal(r.errors.length,0);assert.deepEqual(r.counts(),{stops:1,releases:1});
});
test('ending during microphone acquisition stops late tracks and releases the lease',async()=>{
  const r=renderer();let release;r.api.claimMicrophone=()=>new Promise(resolve=>release=resolve);
  const pending=r.voice.start();await r.voice.stop();release(3);await pending;
  assert.equal(r.voice.state,'idle');assert.equal(r.counts().releases,1);
});

test('voice shows live words and working acknowledgement, then ignores late progress after Stop',async()=>{
  const r=renderer();await r.voice.start();r.voice.inputId=4;
  r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Open Calcu'});
  r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Open Calculator.',final:true});
  r.voice.progress({generation:7,inputId:4,type:'working',text:"Got it. I'm on it."});
  assert.equal(r.captions[0][0],'Open Calcu');assert.equal(r.captions[1][2].replace,true);
  assert.equal(r.states.at(-1)[2],'working');assert.equal(r.captions.at(-1)[1],'Mitch');
  await r.voice.stop();const count=r.captions.length;
  r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Late'});assert.equal(r.captions.length,count);
});

test('acknowledgement playback finishes before the answer and microphone resumes',async()=>{
  const r=renderer();await r.voice.start();let finishAck;const played=[];
  r.voice.playAudio=bytes=>{played.push(bytes[0]);return bytes[0]===1?new Promise(resolve=>finishAck=resolve):Promise.resolve();};
  r.step(100,0.1);r.step(2000,0);await new Promise(resolve=>setImmediate(resolve));
  r.voice.progress({generation:7,inputId:null,type:'transcript',text:'Hello',final:true});
  r.voice.progress({generation:7,inputId:null,type:'working',text:"Got it. I'm on it."});
  r.voice.progress({generation:7,inputId:null,type:'acknowledgement',audio:[1]});
  r.resolve({transcript:'Hello',answer:'Hi',audio:[2]});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(played,[1]);assert.equal(r.track.enabled,false);
  finishAck();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(played,[1,2]);assert.equal(r.track.enabled,true);assert.equal(r.voice.phase,'listening');
  assert.equal(r.captions.filter(c=>c[1]==='You').length,1);await r.voice.stop();
});

test('stable complete navigation submits after 850 ms silence instead of 1800 ms',async()=>{
  const r=renderer();await r.voice.start();r.voice.inputId=4;
  r.step(100,0.1);r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Open Calculator.'});
  r.step(900,0);assert.equal(r.track.enabled,true);
  r.step(950,0);await new Promise(resolve=>setImmediate(resolve));assert.equal(r.track.enabled,false);assert.equal(r.voice.phase,'working');
  await r.voice.stop();r.resolve({transcript:'Open Calculator.',answer:'',audio:[]});
});

test('unfinished phrasing and dictated text keep the longer pause',async()=>{
  for(const text of ['Open Notes and create','Open Instagram and go to my','Open Calculator and calculate 1.5 times','Type hello there','Call Omar Lammari']){
    const r=renderer();await r.voice.start();r.voice.inputId=4;r.step(100,0.1);
    r.voice.progress({generation:7,inputId:4,type:'transcript',text});r.step(1000,0);
    assert.equal(r.track.enabled,true,text);assert.equal(r.voice.listening,true,text);
    r.step(1600,0);assert.equal(r.track.enabled,true,text);
    await r.voice.stop();
  }
});

test('resumed speech or a newly changing transcript prevents early submission',async()=>{
  const r=renderer();await r.voice.start();r.voice.inputId=4;r.step(100,0.1);
  r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Open Calculator.'});
  r.step(800,0.1);r.step(1000,0);assert.equal(r.track.enabled,true);
  r.time(1500);r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Open Calculator and calculate 6 times 7'});
  r.step(1700,0);assert.equal(r.track.enabled,true,'New words must settle before an early endpoint');
  r.step(2000,0);await new Promise(resolve=>setImmediate(resolve));assert.equal(r.track.enabled,false);
  await r.voice.stop();r.resolve({transcript:'',answer:'',audio:[]});
});

test('failed or unavailable streaming retains full-recording pause and bounds queued audio',async()=>{
  const r=renderer();await r.voice.start();r.voice.inputId=4;r.step(100,0.1);
  r.voice.progress({generation:7,inputId:4,type:'transcript',text:'Open Calculator.'});
  let release,delivered=0;r.api.localVoiceAudio=()=>{delivered++;return new Promise(resolve=>release=resolve);};
  r.voice.queueAudio(new Uint8Array(4096),r.voice.generation);await Promise.resolve();
  for(let i=0;i<12;i++)r.voice.queueAudio(new Uint8Array(4096),r.voice.generation);
  assert.equal(r.voice.streamFailed,true);assert.equal(r.voice.audioQueue.pending,8);
  r.step(1000,0);assert.equal(r.track.enabled,true);
  release();await r.voice.inputQueue;assert.equal(delivered,1);assert.equal(r.voice.audioQueue.pending,0);
  await r.voice.stop();
});
