// A synthetic voice turn through the same controller used by Electron.
const fs=require('node:fs');
const {AI}=require('../ai');
const {LocalConversation}=require('../local-conversation');
const settings=()=>({localOnly:true,chatProvider:'local',transcriptionProvider:'local',localChatModel:'mitch-local',localChatUrl:'http://127.0.0.1:22130/v1',localSpeechUrl:'http://127.0.0.1:22132',allowScreen:false,allowDesktop:false});
(async()=>{
  const ai=new AI(settings,()=>{throw Error('Cloud key access forbidden');},async()=>({status:'error',message:'Synthetic benchmark: actions disabled'}));
  const voice=new LocalConversation(ai,settings);
  const fixture=await fetch('http://127.0.0.1:22132/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Hello Mitch. What is two plus two? Answer in one short sentence.',language:'en-us'})});
  if(!fixture.ok)throw Error('Fixture generation failed');
  const bytes=Buffer.from(await fixture.arrayBuffer());
  const start=Date.now(),result=await voice.turn(bytes,voice.start());
  if(!result.transcript||!result.answer||result.audio.length<44)throw Error('Incomplete voice turn');
  if(!/four|\b4\b/i.test(result.answer))throw Error('Unexpected answer to synthetic arithmetic question');
  fs.writeFileSync('test-output/local-conversation.wav',Buffer.from(result.audio));
  const summary={elapsedMs:Date.now()-start,transcript:result.transcript,answer:result.answer,audioBytes:result.audio.length};
  fs.writeFileSync('test-output/local-conversation.json',JSON.stringify(summary,null,2));console.log(summary);voice.stop();
})().catch(error=>{console.error(error);process.exitCode=1;});
