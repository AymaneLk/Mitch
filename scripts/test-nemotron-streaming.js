// Feed a public JFK recording at real-time speed; no microphone or cloud calls.
const fs=require('node:fs');
const {WebSocket}=require('undici');
const wav=fs.readFileSync('test-output/asr-comparison/jfk.wav');
let pcm,format;
for(let offset=12;offset+8<=wav.length;){
  const name=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),data=wav.subarray(offset+8,offset+8+size);
  if(name==='fmt ')format={encoding:data.readUInt16LE(0),channels:data.readUInt16LE(2),rate:data.readUInt32LE(4),bits:data.readUInt16LE(14)};
  if(name==='data')pcm=data;
  offset+=8+size+(size%2);
}
if(!pcm||format.encoding!==1||format.channels!==1||format.rate!==16000||format.bits!==16)throw Error('Expected 16kHz mono PCM16 fixture');
(async()=>{
  const ws=new WebSocket('ws://127.0.0.1:22133/v1/audio/transcriptions/realtime');
  const events=[];let start,committedAt,firstTextAt,finished=false;
  let resolveReady,resolveDone,rejectDone;
  const ready=new Promise(resolve=>resolveReady=resolve);
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const timeout=setTimeout(()=>rejectDone(Error('Streaming test timed out')),45000);
  ws.addEventListener('error',()=>rejectDone(Error('WebSocket failed')));
  ws.addEventListener('message',event=>{
    const value=JSON.parse(event.data),now=performance.now();
    if(value.type==='session.created')ws.send(JSON.stringify({type:'session.update',session:{sample_rate:16000,language:'en',endpointing_ms:20000}}));
    if(value.type==='session.updated')resolveReady();
    if(value.type==='error')rejectDone(Error(JSON.stringify(value)));
    if(value.type?.startsWith('conversation.item.input_audio_transcription.')){
      if(firstTextAt===undefined&&(value.delta||value.transcript||value.text))firstTextAt=now;
      events.push({...value,elapsedMs:Math.round(now-start)});
    }
    if(value.type==='input_audio_buffer.committed'){finished=true;resolveDone(now);}
  });
  try{
    await Promise.race([ready,done]);start=performance.now();
    const bytesPerFrame=5120;
    for(let offset=0;offset<pcm.length;offset+=bytesPerFrame){
      if(finished)throw Error('Session ended before all audio was sent');
      ws.send(pcm.subarray(offset,offset+bytesPerFrame));
      await new Promise(resolve=>setTimeout(resolve,160));
    }
    committedAt=performance.now();ws.send(JSON.stringify({type:'input_audio_buffer.commit'}));
    const end=await done;
    const result={audioSeconds:pcm.length/32000,firstTextMs:Math.round(firstTextAt-start),finalAfterCommitMs:Math.round(end-committedAt),events};
    if(!events.some(e=>e.type.endsWith('.completed')))throw Error('No final transcript');
    fs.writeFileSync('test-output/asr-comparison/streaming.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{clearTimeout(timeout);ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
