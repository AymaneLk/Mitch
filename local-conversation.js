'use strict';
const {localURL,localTranscribe}=require('./local-ai');
const {RealtimeTranscription}=require('./realtime-transcription');
const ACKNOWLEDGEMENT="Got it. I'm on it.";
const PREPARE_DEBOUNCE_MS=400,PREPARE_TTL_MS=3000,MAX_PREPARATIONS=2;
// Preserve case, quoted contents and internal whitespace: they can be actual
// input data. Only boundary whitespace is irrelevant to request identity.
const preparedText=text=>typeof text==='string'?text.trim():'';
class LocalConversation {
  constructor(ai,getSettings,fetcher=fetch,{notify=()=>{},prepare,now=Date.now,createTranscription=(onText,options)=>new RealtimeTranscription(onText,options)}={}){this.ai=ai;this.getSettings=getSettings;this.fetch=fetcher;this.notify=notify;this.prepare=prepare;this.now=now;this.createTranscription=createTranscription;this.generation=0;this.active=false;this.busy=false;this.inputSequence=0;}
  start(){this.stop();this.active=true;return this.generation;}
  stop(){this.active=false;this.generation++;this.controller?.abort();this.cancelInput();this.warmController?.abort();this.ai.cancel();}
  cancelInput(input=this.input,{keepPreparation=false}={}){
    if(!input)return;clearTimeout(input.prepareTimer);if(!keepPreparation)input.preparation?.controller.abort();input.stream.cancel();if(this.input===input)this.input=null;
  }
  prepareInput(input,text,generation){
    if(typeof this.prepare!=='function'||typeof text!=='string'||input.finishing||input.text===preparedText(text))return;
    input.text=preparedText(text);input.revision++;clearTimeout(input.prepareTimer);
    // A changed noun, negation or typed value invalidates the old plan at once,
    // even when the new wording is not a supported preparation intent.
    input.preparation?.controller.abort();input.preparation=null;
    if(input.preparationCount>=MAX_PREPARATIONS)return;
    if(!/^(?:(?:hey|hi) mitch[, ]+)?(?:(?:can|could|would) you |please )?(?:open|launch|start|show|find|search|focus|switch to|go to)\s+\S{3}/i.test(text.trim()))return;
    const revision=input.revision,normalizedText=input.text;
    input.prepareTimer=setTimeout(()=>{
      if(!this.active||this.generation!==generation||this.input!==input||input.finishing||input.revision!==revision)return;
      const controller=new AbortController(),signal=controller.signal,startedAt=this.now();
      const preparation={text,normalizedText,generation,inputId:input.id,revision,startedAt,expiresAt:startedAt+PREPARE_TTL_MS,controller,signal,adopted:false};
      input.preparation=preparation;input.preparationCount++;
      const deadline=setTimeout(()=>controller.abort(),PREPARE_TTL_MS);
      signal.addEventListener('abort',()=>clearTimeout(deadline),{once:true});
      let abort;
      const cancelled=new Promise(resolve=>{abort=()=>resolve(null);signal.addEventListener('abort',abort,{once:true});});
      // This hook may read context and draft a bounded plan. It has no input
      // authority; dispatch is possible only after turn() commits final words.
      const pending=Promise.resolve().then(()=>{signal.throwIfAborted();return this.prepare(text,{signal,generation,inputId:input.id,revision,final:false,readOnly:true});}).then(value=>{
        if(signal.aborted||!this.active||this.generation!==generation||input.revision!==revision||input.preparation!==preparation||(this.input!==input&&!preparation.adopted))return null;
        return value??null;
      }).catch(()=>null);
      preparation.promise=Promise.race([pending,cancelled]).finally(()=>{signal.removeEventListener('abort',abort);});
    },PREPARE_DEBOUNCE_MS);
  }
  adoptPreparation(input,text,generation,signal){
    const preparation=input?.preparation,age=preparation&&this.now()-preparation.startedAt;
    if(!preparation||preparation.signal.aborted||preparation.generation!==generation||preparation.inputId!==input.id||preparation.revision!==input.revision||preparation.normalizedText!==preparedText(text)||!Number.isFinite(age)||age<0||age>PREPARE_TTL_MS)return null;
    preparation.adopted=true;
    const abort=()=>preparation.controller.abort();signal.addEventListener('abort',abort,{once:true});
    return {value:{text:preparation.text,normalizedText:preparation.normalizedText,generation,inputId:input.id,revision:preparation.revision,startedAt:preparation.startedAt,expiresAt:preparation.expiresAt,signal:preparation.signal,promise:preparation.promise},release:()=>{signal.removeEventListener('abort',abort);abort();}};
  }
  check(generation){if(!this.active||generation!==this.generation)throw new Error('Local voice session ended.');}
  async speech(text,signal){
    const settings=this.getSettings();
    const response=await this.fetch(localURL(settings.localSpeechUrl,'speech'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,2000),language:'en-us'}),redirect:'error',signal});
    if(!response.ok)throw new Error('Local speech generation failed.');
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }
  warmAcknowledgement(){
    const key=this.getSettings().localSpeechUrl;
    if(this.ackAudio?.key===key)return Promise.resolve(this.ackAudio.audio);
    if(this.ackPending&&!this.warmController.signal.aborted)return this.ackPending;
    this.warmController=new AbortController();
    const pending=this.speech(ACKNOWLEDGEMENT,AbortSignal.any([this.warmController.signal,AbortSignal.timeout(10000)]))
      .then(audio=>{this.ackAudio={key,audio};return audio;}).catch(()=>[]);
    this.ackPending=pending;pending.finally(()=>{if(this.ackPending===pending)this.ackPending=null;});
    return this.ackPending;
  }
  async beginInput(generation,sampleRate){
    this.check(generation);if(this.busy)throw new Error('Wait for the current voice reply.');
    if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>96000)throw new Error('Invalid microphone sample rate.');
    this.cancelInput();
    this.warmAcknowledgement();
    // Custom speech adapters keep the existing full-recording path.
    if(this.getSettings().localSpeechUrl!=='http://127.0.0.1:22132')return null;
    const id=++this.inputSequence;
    const stream=this.createTranscription(text=>{
      if(this.active&&generation===this.generation&&this.input?.id===id){this.notify({type:'transcript',text,generation,inputId:id});this.prepareInput(this.input,text,generation);}
    },{sampleRate});
    this.input={id,stream,revision:0,preparationCount:0,preparation:null};
    try{await stream.ready;this.check(generation);if(this.input?.id!==id)throw new Error('Voice input replaced.');return id;}
    catch{if(this.input?.id===id)this.cancelInput();else stream.cancel();this.check(generation);return null;}
  }
  appendInput(bytes,generation,id){
    this.check(generation);if(this.input?.id!==id)throw new Error('Voice input replaced.');
    this.input.stream.append(bytes);
  }
  async turn(bytes,generation,scope,inputId,streamFailed=false){
    if(!this.active||generation!==this.generation)throw new Error('Local voice session ended.');
    if(this.busy)throw new Error('Wait for the current voice reply.');
    if(!bytes.length||bytes.length>24*1024*1024)throw new Error('Invalid recording size.');
    this.busy=true;this.controller=new AbortController();
    const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(180000)]);
    const check=()=>{signal.throwIfAborted();if(!this.active||generation!==this.generation)throw new Error('Local voice session ended.');};
    const input=this.input?.id===inputId?this.input:null;
    if(this.input&&!input)this.cancelInput();
    let adopted;
    try{
      const settings=this.getSettings();
      if(!['local','deepseek'].includes(settings.chatProvider)||settings.transcriptionProvider!=='local')throw new Error('Voice requires Local or DeepSeek chat and local dictation.');
      let transcript;
      if(input){input.finishing=true;clearTimeout(input.prepareTimer);}
      if(streamFailed)input?.stream.cancel();
      if(input){try{transcript=await input.stream.finish();}catch{check();}}
      if(transcript===undefined)transcript=await localTranscribe(this.fetch,settings,bytes,signal);check();
      if(!transcript.trim())return {transcript:'',answer:'',audio:[]};
      adopted=this.adoptPreparation(input,transcript,generation,signal);
      this.cancelInput(input,{keepPreparation:!!adopted});
      this.notify({type:'transcript',text:transcript,generation,inputId,final:true});
      this.notify({type:'working',text:ACKNOWLEDGEMENT,generation,inputId});
      // Synthesis is cached during listening. Reasoning begins immediately while
      // the acknowledgement plays; it does not claim the task has succeeded.
      const acknowledgement=this.warmAcknowledgement().then(audio=>{if(!signal.aborted&&this.active&&generation===this.generation)this.notify({type:'acknowledgement',audio,generation,inputId});});
      const answer=await this.ai.chat(transcript,undefined,scope,{spoken:true,...(adopted?{prepared:adopted.value}:{})});check();
      await acknowledgement;check();
      const audio=await this.speech(answer,signal);check();
      return {transcript,answer,audio};
    }finally{adopted?.release();this.cancelInput(input);this.controller.abort();this.busy=false;}
  }
}
module.exports={LocalConversation};
