// Local half-duplex conversation. Microphone capture pauses during processing/playback.
// A short pause only ends a recognizable, stable navigation/calculation request.
// Dictated text, sensitive actions and incomplete phrasing retain the longer pause.
function voiceEndpointDelay(text,stableMs,streamHealthy){
  if(!streamHealthy||stableMs<450)return 1800;
  const words=String(text||'').trim().toLowerCase().replace(/[.!?,;:]+$/,'').trim();
  if(!words||/\b(?:and|then|or|but|because|if|to|for|with|in|on|at|of|the|a|an|my|your|his|her|their|this|that|open|create|write|type|find|search|show|calculate|multiply|divide|plus|minus|times|equals|saying|called|named)$/.test(words)||/[+\-*/×÷=]$/.test(words))return 1800;
  if(/\b(?:write|type|dictate|send|call|dial|delete|remove|upload|publish|post|buy|pay|order|share|save|replace)\b/.test(words)||/["“][^"”]*$/.test(words))return 1800;
  const request=words.replace(/^(?:(?:hey|hi) mitch[, ]+)?(?:(?:can|could|would) you |please )?/,'').replace(/ please$/,'');
  if(/^(?:open|launch|start|show|focus|switch to) (?:the )?(?:calculator|calculatrice|notepad|instagram|spotify|chrome|google chrome|edge|microsoft edge|browser|notes|settings|file explorer)(?: app| application)?$/.test(request))return 850;
  if(/^(?:open|show|go to|navigate to) (?:the |my )?(?:messages|inbox|profile|home|settings)(?: page| tab)?$/.test(request))return 850;
  const mathPrefix=/^(?:(?:open|launch) (?:the )?calculator(?: app)? and )?(?:calculate|compute|what is|what's|do(?: this calculation)?)\s+/;
  const expression=request.replace(mathPrefix,'').replace(/multiplied by|times|\bx\b|×/g,'*').replace(/divided by|÷/g,'/').replace(/plus/g,'+').replace(/minus/g,'-');
  if(mathPrefix.test(request)&&/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*[+*/-]\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+))+$/.test(expression))return 850;
  // A complete navigation clause can take a little longer than a single command.
  if(/^(?:open|show|go to|navigate to)\b/.test(request)&&/\b(?:messages|inbox|profile|home|settings)(?: page| tab)?$/.test(request)&&request.split(/\s+/).length<=24)return 1000;
  return 1800;
}
class LocalVoice {
  constructor({status,caption,error,level=()=>{},microphone=()=>{}}){
    this.onStatus=status;this.onCaption=caption;this.onError=error;this.onLevel=level;this.onMicrophone=microphone;this.state='idle';this.generation=0;this.microphoneId='';
    window.companion.on?.('localVoiceProgress',event=>this.progress(event));
  }
  change(state,label,phase='listening'){this.state=state;this.phase=state==='active'?phase:null;this.onStatus(state,label,this.phase);}
  caption(text,speaker,options){if(this.state==='active')this.onCaption(text,speaker,options);}
  progress(event){
    if(this.state!=='active'||event.generation!==this.session||event.inputId!==this.inputId)return;
    if(event.type==='transcript'){
      if(event.text!==this.inputText){this.inputText=event.text;this.inputTextAt=performance.now();}
      this.caption(event.text,'You',{replace:true,newTurn:!this.hasInputCaption});this.hasInputCaption=true;
      if(event.final)this.heardFinal=true;
    }else if(event.type==='working'){
      this.change('active','Working…','working');
    }
  }
  async start({wakeId}={}){
    if(this.state!=='idle')return;
    const generation=++this.generation;this.change('connecting','Starting local voice…');
    try{
      const lease=await window.companion.claimMicrophone('voice',wakeId);
      if(generation!==this.generation){await window.companion.releaseMicrophone(lease);return;}this.lease=lease;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(this.microphoneId?{deviceId:{exact:this.microphoneId}}:{})},video:false});
      if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
      this.onMicrophone(stream.getAudioTracks()[0]?.label||'System default microphone');
      this.session=await window.companion.localVoiceStart();
      if(generation!==this.generation)return;
      this.context=new AudioContext({sampleRate:16000});await this.context.resume();
      if(generation!==this.generation){this.context?.close().catch(()=>{});return;}
      this.source=this.context.createMediaStreamSource(stream);this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;this.source.connect(this.analyser);
      try{
        await this.context.audioWorklet.addModule('voice-capture.js');if(generation!==this.generation)return;
        this.capture=new AudioWorkletNode(this.context,'mitch-voice-capture');this.source.connect(this.capture);this.capture.connect(this.context.destination);
        this.capture.port.onmessage=event=>this.queueAudio(new Uint8Array(event.data),generation);
      }catch{this.capture=null;} // Full-recording transcription remains available.
      await this.listen(generation);
    }catch(error){if(generation===this.generation){this.onError(error.message);this.cleanup();}}
  }
  queueAudio(bytes,generation){
    if(generation!==this.generation||!this.listening||this.inputId==null||this.streamFailed)return;
    const queue=this.audioQueue,id=this.inputId,session=this.session;
    // Bound retained PCM even if the main process is busy. A dropped frame
    // invalidates streaming; the complete MediaRecorder recording is the fallback.
    if(!queue||queue.pending>=8||!bytes.length||bytes.length>65536){this.streamFailed=true;return;}
    queue.pending++;
    const current=()=>generation===this.generation&&this.audioQueue===queue&&this.inputId===id;
    this.inputQueue=this.inputQueue.then(async()=>{
      if(!current()||this.streamFailed)return;
      let timeout;
      try{await Promise.race([window.companion.localVoiceAudio(bytes,session,id),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Live audio fell behind.')),1500);})]);}
      finally{clearTimeout(timeout);}
    }).catch(()=>{if(current())this.streamFailed=true;}).finally(()=>{queue.pending--;});
  }
  async listen(generation){
    if(generation!==this.generation)return;
    this.hasInputCaption=false;this.heardFinal=false;this.ackPlayback=null;this.inputQueue=Promise.resolve();this.audioQueue={pending:0};this.streamFailed=false;this.inputId=null;this.inputText='';this.inputTextAt=performance.now();
    if(this.capture){this.inputId=await window.companion.localVoiceInput(this.session,this.context.sampleRate);if(generation!==this.generation)return;}
    this.stream.getAudioTracks().forEach(t=>t.enabled=true);this.listening=true;this.change('active','Listening locally… pause when finished');
    const chunks=[],recorder=new MediaRecorder(this.stream);this.recorder=recorder;
    let voiced=false,lastVoice=performance.now(),started=lastVoice;
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{clearInterval(this.timer);if(generation!==this.generation)return;this.listening=false;if(voiced)this.respond(chunks,recorder.mimeType,generation);else this.listen(generation).catch(error=>{if(generation===this.generation){this.onError(error.message);this.cleanup();}});};
    recorder.onerror=()=>{this.onError('Microphone recording failed.');this.cleanup();};recorder.start(250);
    const samples=new Float32Array(this.analyser.fftSize);
    this.timer=setInterval(()=>{
      this.analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length),now=performance.now();
      this.onLevel(Math.max(0,Math.min(1,(20*Math.log10(Math.max(rms,0.000001))+60)/60)));
      if(rms>0.018){voiced=true;lastVoice=now;}
      const pause=voiceEndpointDelay(this.inputText,now-this.inputTextAt,this.inputId!=null&&!this.streamFailed);
      if((voiced&&now-lastVoice>=pause)||now-started>120000){clearInterval(this.timer);if(recorder.state!=='inactive')recorder.stop();}
    },100);
  }
  async respond(chunks,mime,generation){
    this.listening=false;this.onLevel(0);this.stream.getAudioTracks().forEach(t=>t.enabled=false);this.change('active','Working…','working');
    try{
      const bytes=Array.from(new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer()));
      if(generation!==this.generation)return;
      await this.inputQueue;if(generation!==this.generation)return;
      const result=await window.companion.localVoiceTurn(bytes,this.session,this.inputId,this.streamFailed);if(generation!==this.generation)return;
      if(result.transcript&&!this.heardFinal)this.caption(result.transcript,'You',{replace:true});if(result.answer)this.caption(result.answer,'Mitch',{replace:true});
      if(result.audio.length){
        this.change('active','Speaking…','speaking');await this.playAudio(result.audio,generation);
      }
      if(generation===this.generation)await this.listen(generation);
    }catch(error){if(generation===this.generation){this.onError(error.message);this.cleanup();}}
  }
  async playAudio(bytes,generation){
    if(!bytes?.length||generation!==this.generation)return;
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'audio/wav'}));const audio=new Audio(url);this.url=url;this.audio=audio;
    try{await new Promise((resolve,reject)=>{this.finishPlayback=resolve;audio.onended=resolve;audio.onerror=()=>reject(new Error('Local audio playback failed.'));audio.play().catch(reject);});}
    finally{audio.onended=null;audio.onerror=null;URL.revokeObjectURL(url);if(this.audio===audio){this.audio=null;this.url=null;this.finishPlayback=null;}}
  }
  async stop(){this.cleanup();}
  cleanup(){
    this.listening=false;this.onLevel(0);
    this.generation++;clearInterval(this.timer);if(this.recorder){this.recorder.onstop=null;if(this.recorder.state!=='inactive')this.recorder.stop();}this.recorder=null;
    if(this.capture){this.capture.port.onmessage=null;this.capture.disconnect();this.capture=null;}
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.source?.disconnect();this.context?.close().catch(()=>{});this.context=null;
    this.audio?.pause();this.finishPlayback?.();this.finishPlayback=null;if(this.url)URL.revokeObjectURL(this.url);this.url=null;
    window.companion.localVoiceStop().catch(()=>{});if(this.lease)window.companion.releaseMicrophone(this.lease).catch(()=>{});this.lease=null;this.change('idle','Ready when you are');
  }
}
