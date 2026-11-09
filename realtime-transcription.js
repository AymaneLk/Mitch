'use strict';
const {WebSocket}=require('undici');

// The installed CPU recognizer, accessed only from the main process. A socket is
// owned by one utterance; partial words are display-only, never model input.
class RealtimeTranscription {
  constructor(onText,{Socket=WebSocket,sampleRate=16000}={}){
    this.text='';this.finalText=null;this.bytes=0;this.closed=false;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.done=new Promise((resolve,reject)=>{this.resolveDone=resolve;this.rejectDone=reject;});
    this.ready.catch(()=>{});this.done.catch(()=>{});
    this.socket=new Socket('ws://127.0.0.1:22131/v1/audio/transcriptions/realtime');
    this.timer=setTimeout(()=>this.fail(new Error('Live captions did not connect.')),4000);
    this.socket.addEventListener('error',()=>this.fail(new Error('Live captions disconnected.')));
    this.socket.addEventListener('close',()=>{if(!this.closed)this.fail(new Error('Live captions disconnected.'));});
    this.socket.addEventListener('message',event=>{
      if(this.closed)return;
      try{
        const data=JSON.parse(event.data);
        if(data.type==='session.created')this.socket.send(JSON.stringify({type:'session.update',session:{sample_rate:sampleRate,language:'en',endpointing_ms:20000}}));
        else if(data.type==='session.updated'){clearTimeout(this.timer);this.resolveReady();}
        else if(data.type==='error')this.fail(new Error('Live transcription failed.'));
        else if(data.type==='conversation.item.input_audio_transcription.delta'&&typeof data.delta==='string'){
          this.text=(this.text+data.delta).slice(0,24000);if(data.delta)onText(this.text);
        }else if(data.type==='conversation.item.input_audio_transcription.completed'&&typeof data.transcript==='string'){
          this.finalText=data.transcript.slice(0,24000);onText(this.finalText);
        }else if(data.type==='input_audio_buffer.committed'){
          // Do not act on a partial transcript if the final event is missing.
          if(!this.committing||this.finalText===null)throw new Error('Live transcription ended without a final transcript.');
          this.closed=true;clearTimeout(this.timer);this.resolveDone(this.finalText);this.socket.close();
        }
      }catch(error){this.fail(error);}
    });
  }
  append(bytes){
    if(this.closed||this.committing)throw new Error('Live transcription ended.');
    if(!bytes.length||bytes.length>65536||bytes.length%2)throw new Error('Invalid microphone frame.');
    this.bytes+=bytes.length;
    if(this.bytes>24*1024*1024||this.socket.bufferedAmount>1024*1024){this.fail(new Error('Live transcription fell behind.'));throw new Error('Live transcription fell behind.');}
    this.socket.send(bytes);
  }
  finish(){
    if(!this.closed&&!this.committing){
      this.committing=true;clearTimeout(this.timer);
      this.timer=setTimeout(()=>this.fail(new Error('Live transcription timed out.')),4000);
      try{this.socket.send(JSON.stringify({type:'input_audio_buffer.commit'}));}catch(error){this.fail(error);}
    }
    return this.done;
  }
  fail(error){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.rejectReady(error);this.rejectDone(error);this.socket.close();}
  cancel(){this.fail(new Error('Live transcription cancelled.'));}
}
module.exports={RealtimeTranscription};
