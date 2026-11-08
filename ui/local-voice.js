// Local half-duplex conversation. Microphone capture pauses during processing/playback.
class LocalVoice {
  constructor({status,caption,error,level=()=>{},microphone=()=>{}}){this.onStatus=status;this.onCaption=caption;this.onError=error;this.onLevel=level;this.onMicrophone=microphone;this.state='idle';this.generation=0;this.microphoneId='';}
  change(state,label){this.state=state;this.onStatus(state,label);}
  caption(text,speaker){if(this.state==='active')this.onCaption(text,speaker);}
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
      this.context=new AudioContext();await this.context.resume();
      if(generation!==this.generation){this.context?.close().catch(()=>{});return;}
      this.source=this.context.createMediaStreamSource(stream);this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;this.source.connect(this.analyser);
      this.listen(generation);
    }catch(error){if(generation===this.generation){this.onError(error.message);this.cleanup();}}
  }
  listen(generation){
    if(generation!==this.generation)return;
    this.stream.getAudioTracks().forEach(t=>t.enabled=true);this.listening=true;this.change('active','Listening locally… pause when finished');
    const chunks=[],recorder=new MediaRecorder(this.stream);this.recorder=recorder;
    let voiced=false,lastVoice=performance.now(),started=lastVoice;
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{clearInterval(this.timer);if(generation===this.generation&&voiced)this.respond(chunks,recorder.mimeType,generation);else if(generation===this.generation)this.listen(generation);};
    recorder.onerror=()=>{this.onError('Microphone recording failed.');this.cleanup();};recorder.start(250);
    const samples=new Float32Array(this.analyser.fftSize);
    this.timer=setInterval(()=>{
      this.analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length),now=performance.now();
      this.onLevel(Math.max(0,Math.min(1,(20*Math.log10(Math.max(rms,0.000001))+60)/60)));
      if(rms>0.018){voiced=true;lastVoice=now;}
      if((voiced&&now-lastVoice>1800)||now-started>120000){clearInterval(this.timer);if(recorder.state!=='inactive')recorder.stop();}
    },100);
  }
  async respond(chunks,mime,generation){
    this.listening=false;this.onLevel(0);this.stream.getAudioTracks().forEach(t=>t.enabled=false);this.change('active','Thinking locally…');
    try{
      const bytes=Array.from(new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer()));
      if(generation!==this.generation)return;
      const result=await window.companion.localVoiceTurn(bytes,this.session);if(generation!==this.generation)return;
      if(result.transcript)this.caption(result.transcript,'You');if(result.answer)this.caption(result.answer,'Mitch');
      if(result.audio.length){
        this.change('active','Speaking locally…');this.url=URL.createObjectURL(new Blob([new Uint8Array(result.audio)],{type:'audio/wav'}));this.audio=new Audio(this.url);
        await new Promise((resolve,reject)=>{this.finishPlayback=resolve;this.audio.onended=resolve;this.audio.onerror=()=>reject(new Error('Local audio playback failed.'));this.audio.play().catch(reject);});
        this.finishPlayback=null;URL.revokeObjectURL(this.url);this.url=null;
      }
      if(generation===this.generation)this.listen(generation);
    }catch(error){if(generation===this.generation){this.onError(error.message);this.cleanup();}}
  }
  async stop(){this.cleanup();}
  cleanup(){
    this.listening=false;this.onLevel(0);
    this.generation++;clearInterval(this.timer);if(this.recorder){this.recorder.onstop=null;if(this.recorder.state!=='inactive')this.recorder.stop();}this.recorder=null;
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.source?.disconnect();this.context?.close().catch(()=>{});this.context=null;
    this.audio?.pause();this.finishPlayback?.();this.finishPlayback=null;if(this.url)URL.revokeObjectURL(this.url);this.url=null;
    window.companion.localVoiceStop().catch(()=>{});if(this.lease)window.companion.releaseMicrophone(this.lease).catch(()=>{});this.lease=null;this.change('idle','Ready when you are');
  }
}
