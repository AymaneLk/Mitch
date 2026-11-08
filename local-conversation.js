'use strict';
const {localURL,localTranscribe}=require('./local-ai');
class LocalConversation {
  constructor(ai,getSettings,fetcher=fetch){this.ai=ai;this.getSettings=getSettings;this.fetch=fetcher;this.generation=0;this.active=false;this.busy=false;}
  start(){this.stop();this.active=true;return this.generation;}
  stop(){this.active=false;this.generation++;this.controller?.abort();this.ai.cancel();}
  async turn(bytes,generation,scope){
    if(!this.active||generation!==this.generation)throw new Error('Local voice session ended.');
    if(this.busy)throw new Error('Wait for the current voice reply.');
    if(!bytes.length||bytes.length>24*1024*1024)throw new Error('Invalid recording size.');
    this.busy=true;this.controller=new AbortController();
    const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(180000)]);
    const check=()=>{signal.throwIfAborted();if(!this.active||generation!==this.generation)throw new Error('Local voice session ended.');};
    try{
      const settings=this.getSettings();
      if(settings.chatProvider!=='local'||settings.transcriptionProvider!=='local')throw new Error('Local voice requires local chat and dictation.');
      const transcript=await localTranscribe(this.fetch,settings,bytes,signal);check();
      if(!transcript.trim())return {transcript:'',answer:'',audio:[]};
      const answer=await this.ai.chat(transcript,undefined,scope,{spoken:true});check();
      const response=await this.fetch(localURL(settings.localSpeechUrl,'speech'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:answer.slice(0,2000),language:settings.localVoiceLanguage||'en-us'}),redirect:'error',signal});
      if(!response.ok)throw new Error('Local speech generation failed.');
      const audio=Array.from(new Uint8Array(await response.arrayBuffer()));check();
      return {transcript,answer,audio};
    }finally{this.busy=false;}
  }
}
module.exports={LocalConversation};
