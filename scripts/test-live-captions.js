// Real CPU speech check using an existing public recording, never the microphone.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {RealtimeTranscription}=require('../realtime-transcription');
(async()=>{
  const wav=fs.readFileSync('test-output/asr-comparison/jfk.wav');let pcm;
  for(let offset=12;offset+8<=wav.length;){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data')pcm=wav.subarray(offset+8,offset+8+size);offset+=8+size+(size%2);}
  assert.ok(pcm);const start=performance.now();let firstTextAt=null,updates=0;
  const stream=new RealtimeTranscription(text=>{if(text&&firstTextAt===null)firstTextAt=performance.now();updates++;});
  try{
    await stream.ready;
    for(let offset=0;offset<pcm.length;offset+=4096){stream.append(pcm.subarray(offset,offset+4096));await new Promise(resolve=>setTimeout(resolve,128));}
    const committedAt=performance.now(),transcript=await stream.finish(),endedAt=performance.now();
    assert.ok(firstTextAt<committedAt);assert.match(transcript,/ask not what your country/i);
    const speech=await fetch('http://127.0.0.1:22132/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:"Got it. I'm on it.",language:'en-us'}),signal:AbortSignal.timeout(30000)});
    assert.equal(speech.ok,true);const audio=Buffer.from(await speech.arrayBuffer());assert.equal(audio.toString('ascii',0,4),'RIFF');
    const result={status:'passed',firstCaptionMs:Math.round(firstTextAt-start),finalAfterPauseMs:Math.round(endedAt-committedAt),updates,transcript,acknowledgementBytes:audio.length,scope:'Existing public JFK fixture through the installed CPU recognizer; real local acknowledgement synthesis. No microphone, GPU model, cloud requests or desktop actions.'};
    fs.writeFileSync('test-output/live-captions-speech.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{stream.cancel();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
