class LiveVoice {
  constructor({status,caption,error,readySound}) {
    this.onStatus=status;this.onCaption=caption;this.onError=error;this.state='idle';
    this.pc=null;this.stream=null;this.channel=null;this.calls=new Map();this.responses=new Set();
    this.queue=Promise.resolve();this.backendQueue=Promise.resolve();this.generation=0;
    this.readySound=readySound;this.microphoneLease=null;
  }
  change(state,label) {this.state=state;this.onStatus(state,label);}
  current(generation,channel=this.channel) {return generation===this.generation&&this.state!=='idle'&&channel===this.channel;}
  send(event) {if(this.channel?.readyState==='open')this.channel.send(JSON.stringify(event));else throw new Error('Voice connection is closed.');}
  finishDesktopTask() {return Promise.resolve(window.companion.voiceTaskFinished?.(this.backendGeneration)).catch(()=>{});}
  resetBackend(active,generation=this.generation) {
    // Preserve IPC ordering across a cancelled start followed immediately by a new session.
    const reset=this.backendQueue.then(()=>{
      if(active&&generation!==this.generation)return false;
      return Promise.resolve(window.companion.voiceReset(active)).then(result=>{if(active&&generation===this.generation)this.backendGeneration=result?.generation;return true;});
    });
    this.backendQueue=reset.catch(()=>{});return reset;
  }
  async start({wakeId}={}) {
    if(this.state!=='idle')return;
    const generation=++this.generation;
    this.wakeRequested=!!wakeId;this.chimeAbort=wakeId?new AbortController():null;
    this.change('connecting','Connecting your voice…');this.calls.clear();this.responses.clear();this.currentResponseId=null;this.queue=Promise.resolve();
    try {
      const config=await window.companion.state();if(!this.current(generation))return;
      if(!config.hasKey)throw new Error('Add your API key in Settings first.');
      const lease=await window.companion.claimMicrophone?.('voice',wakeId);
      if(!this.current(generation)){if(lease)await window.companion.releaseMicrophone?.(lease);return;}
      this.microphoneLease=lease;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(!this.current(generation)){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      if(this.wakeRequested)stream.getTracks().forEach(track=>{track.enabled=false;});
      const connection=new RTCPeerConnection();this.pc=connection;stream.getTracks().forEach(t=>connection.addTrack(t,stream));
      connection.addEventListener('track',event=>{
        if(!this.current(generation)||this.pc!==connection)return;
        const audio=document.getElementById('remoteAudio');audio.srcObject=event.streams[0]||new MediaStream([event.track]);
        audio.play().catch(()=>{if(this.current(generation))this.onError('Click the conversation controls to allow audio playback.');});
      });
      connection.addEventListener('connectionstatechange',()=>{if(this.current(generation)&&this.pc===connection&&connection.connectionState==='failed'){this.onError('Voice connection failed. Check your network and try again.');this.cleanup();}});
      const channel=connection.createDataChannel('oai-events');this.channel=channel;
      channel.onmessage=event=>{
        if(!this.current(generation,channel))return;
        try{this.receive(JSON.parse(event.data),generation,channel).catch(e=>{if(this.current(generation,channel))this.onError(e.message);});}
        catch(e){if(this.current(generation,channel))this.onError(e.message);}
      };
      channel.onclose=()=>{if(this.current(generation,channel)){if(this.state!=='closing')this.onError('Voice connection closed.');this.cleanup();}};
      const offer=await connection.createOffer();if(!this.current(generation,channel)||this.pc!==connection)return;
      await connection.setLocalDescription(offer);if(!this.current(generation,channel)||this.pc!==connection)return;
      await new Promise(resolve=>{
        if(connection.iceGatheringState==='complete')return resolve();
        const done=()=>{clearTimeout(timeout);connection.removeEventListener('icegatheringstatechange',check);if(this.finishIce===done)this.finishIce=null;resolve();};
        const check=()=>{if(connection.iceGatheringState==='complete')done();};
        const timeout=setTimeout(done,10000);this.finishIce=done;
        connection.addEventListener('icegatheringstatechange',check);
      });
      if(!this.current(generation,channel)||this.pc!==connection)return;
      const answer=await window.companion.voiceOffer(connection.localDescription.sdp);
      if(!this.current(generation,channel)||this.pc!==connection)return;
      if(!answer.transport?.sdp)throw new Error('Voice service did not return a connection answer.');
      await connection.setRemoteDescription({type:'answer',sdp:answer.transport.sdp});
      if(!this.current(generation,channel)||this.pc!==connection)return;
      if(this.state==='connecting')this.startTimeout=setTimeout(()=>{if(this.current(generation,channel)&&this.state==='connecting'){this.onError('Voice did not connect within 30 seconds.');this.cleanup();}},30000);
    } catch(e) {if(this.current(generation)){this.onError(e.message);this.cleanup();}}
  }
  async receive(event,generation=this.generation,channel=this.channel) {
    if(!this.current(generation,channel)||channel?.readyState!=='open')return;
    if(event.type==='session.started') {
      if(this.state!=='connecting'||this.activatingGeneration===generation)return;
      this.activatingGeneration=generation;clearTimeout(this.startTimeout);
      try {
        await this.resetBackend(true,generation);
        if(this.current(generation,channel)&&this.state==='connecting'&&channel.readyState==='open'){
          if(this.wakeRequested&&this.readySound)await this.readySound({signal:this.chimeAbort?.signal});
          if(!this.current(generation,channel)||this.state!=='connecting')return;
          this.stream?.getTracks().forEach(track=>{track.enabled=true;});
          this.change('active','Listening. Talk naturally.');
        }
      } catch(error){if(this.current(generation,channel)){this.onError(error.message);this.cleanup();}}
      finally {if(this.activatingGeneration===generation)this.activatingGeneration=null;}
    }
    else if(event.type==='session.closed') {this.cleanup();}
    else if(event.type==='error') {this.finishDesktopTask();this.onError(event.error?.message||event.message||'Voice service error.');if(this.state==='connecting')this.cleanup();}
    else if(event.type==='session.input_transcript.delta'||event.type==='session.output_transcript.delta') {
      if(this.state==='active')this.onCaption(event.delta||'',event.type.includes('input_')?'You':'Mitch');
    }
    else if(event.type==='response.event'&&this.state==='active') {
      const nested=event.event||{};
      if(nested.type==='response.created')this.currentResponseId=nested.response?.id;
      if(nested.type==='response.output_item.done'&&nested.item?.type==='function_call') this.registerCall(nested.item,nested.response_id||this.currentResponseId);
      if(nested.type==='response.completed') {
        const response=nested.response||{};const id=response.id||nested.response_id;
        for(const item of response.output||[])if(item.type==='function_call')this.registerCall(item,id);
        if(!id||this.responses.has(id))return;
        this.responses.add(id);
        const pending=[...this.calls.values()].filter(x=>x.responseId===id&&!x.sent);
        if(pending.length){this.queue=this.queue.then(async()=>{
          const results=await Promise.all(pending.map(x=>x.promise));if(!this.current(generation,channel)||this.state!=='active')return;
          if(typeof window.companion.voiceContinue==='function'){
            // Screenshot payloads stay in the main process and travel over an
            // authenticated sideband, avoiding WebRTC message-size limits.
            await window.companion.voiceContinue(pending.map(call=>call.id),this.backendGeneration);
            if(!this.current(generation,channel)||this.state!=='active')return;
            pending.forEach(call=>{call.sent=true;});
          }else{
            pending.forEach((call,i)=>{this.send({type:'response.item.create',event_id:crypto.randomUUID(),item:{type:'function_call_output',call_id:call.id,output:JSON.stringify(results[i])}});call.sent=true;});
            this.send({type:'response.create',event_id:crypto.randomUUID()});
          }
        }).catch(async e=>{if(this.current(generation,channel)){await this.finishDesktopTask();if(this.current(generation,channel))this.onError(e.message);}});}
        else if(!(response.output||[]).some(item=>item.type==='function_call'))await this.finishDesktopTask();
      }
      if(nested.type==='response.failed'||nested.type==='response.cancelled'){await this.finishDesktopTask();if(nested.type==='response.failed')this.onError(nested.response?.error?.message||'The assistant could not complete the request.');}
    }
  }
  registerCall(item,responseId) {
    if(this.state!=='active'||this.channel?.readyState!=='open'||this.calls.has(item.call_id))return;
    const record={id:item.call_id,responseId,sent:false,promise:window.companion.voiceTool({call_id:item.call_id,name:item.name,arguments:item.arguments}).catch(e=>({status:'error',message:e.message}))};this.calls.set(item.call_id,record);
  }
  async stop() {
    if(this.state==='idle'||this.state==='closing')return;
    if(this.state==='connecting'){this.cleanup();return;}
    const generation=this.generation,channel=this.channel;
    this.change('closing','Finishing the conversation…');this.stream?.getTracks().forEach(t=>t.enabled=false);
    this.resetBackend(false,generation).catch(()=>{});
    try {this.send({type:'session.close'});this.closeTimeout=setTimeout(()=>{if(this.current(generation,channel)&&this.state==='closing'){this.onError('Connection ended before final usage was confirmed.');this.cleanup();}},15000);}catch{this.cleanup();}
  }
  cleanup() {
    this.generation++;this.chimeAbort?.abort();this.chimeAbort=null;clearTimeout(this.closeTimeout);clearTimeout(this.startTimeout);this.finishIce?.();this.finishIce=null;
    const channel=this.channel;this.channel=null;if(channel){channel.onclose=null;channel.onmessage=null;channel.close();}
    this.pc?.close();this.pc=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;
    const lease=this.microphoneLease;this.microphoneLease=null;if(lease)Promise.resolve(window.companion.releaseMicrophone?.(lease)).catch(()=>{});
    this.calls.clear();this.responses.clear();this.currentResponseId=null;
    this.resetBackend(false).catch(()=>{});this.change('idle','Ready when you are');
  }
}
window.LiveVoice=LiveVoice;
