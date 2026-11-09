const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({main,pet,localConversation,directory,version})=>{
  const run=code=>main.webContents.executeJavaScript(code),read=code=>pet.webContents.executeJavaScript(code);
  const until=async(code,predicate)=>{for(let i=0;i<120;i++){const value=await read(code);if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('Popup did not update: '+code);};
  const capture=async phase=>{
    const errors=[];
    // DOM assertions can finish before Chromium has submitted a composited
    // frame for this transparent, non-focusable window. Request a real repaint
    // and wait for two animation frames instead of relying on a fixed sleep.
    for(let attempt=0;attempt<2;attempt++){
      try{
        assert.equal(pet.isDestroyed(),false,'Popup window was destroyed.');
        if(pet.isMinimized())pet.restore();pet.showInactive();
        pet.webContents.invalidate();
        await read(`new Promise((resolve,reject)=>{
          const timeout=setTimeout(()=>reject(Error('Popup compositor did not reach two animation frames')),2000);
          document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timeout);resolve();})),reject);
        })`);
        const {width,height}=pet.getContentBounds();assert.ok(width>0&&height>0,'Popup content bounds must be positive.');
        const image=await pet.webContents.capturePage({x:0,y:0,width,height},{stayHidden:false,stayAwake:true});
        assert.equal(image.isEmpty(),false,'Popup capture was empty.');
        const size=image.getSize();assert.ok(size.width>0&&size.height>0,'Popup capture dimensions must be positive.');
        fs.writeFileSync(path.join(directory,`voice-popup-${phase}.png`),image.toPNG());return;
      }catch(error){
        errors.push(error.message);
        if(attempt===0)await new Promise(resolve=>setTimeout(resolve,150));
      }
    }
    const diagnostic={status:'failed',version,phase:'capture-'+phase,errors,windowDestroyed:pet.isDestroyed()};
    if(!pet.isDestroyed())Object.assign(diagnostic,{visible:pet.isVisible(),minimized:pet.isMinimized(),bounds:pet.getContentBounds(),rendererCrashed:pet.webContents.isCrashed()});
    fs.writeFileSync(path.join(directory,'voice-popup-integration.json'),JSON.stringify(diagnostic,null,2));
    throw Error(`Voice popup ${phase} capture failed after repaint: ${errors.join('; ')}. Window state: ${JSON.stringify(diagnostic)}`);
  };
  const original={fetch:localConversation.fetch,chat:localConversation.ai.chat,create:localConversation.createTranscription};
  // Valid silent WAV: exercise the actual audio player without recording anyone.
  const wav=Buffer.alloc(44+6400);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(6400,40);
  let onText,releaseAnswer,modelCalls=0;
  localConversation.fetch=async url=>{assert.ok(url.endsWith('/speech'));return {ok:true,arrayBuffer:async()=>wav};};
  localConversation.ai.chat=async text=>{modelCalls++;assert.equal(text,'Open Calculator.');return new Promise(resolve=>releaseAnswer=resolve);};
  localConversation.createTranscription=callback=>{onText=callback;return {ready:Promise.resolve(),cancel(){},append(){},finish:async()=> 'Open Calculator.'};};
  try{
    await run('document.fonts.ready');main.hide();
    const worklet=await run(`(async()=>{
      const context=new AudioContext({sampleRate:16000});await context.resume();await context.audioWorklet.addModule('voice-capture.js');
      const capture=new AudioWorkletNode(context,'mitch-voice-capture'),source=context.createOscillator();source.connect(capture);capture.connect(context.destination);
      try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No microphone PCM frame')),3000);capture.port.onmessage=event=>{clearTimeout(timer);const samples=new Int16Array(event.data);resolve({bytes:event.data.byteLength,nonzero:samples.some(x=>x!==0),sampleRate:context.sampleRate});};source.start();});}
      finally{source.stop();source.disconnect();capture.disconnect();await context.close();}
    })()`);
    assert.equal(worklet.bytes,4096);assert.equal(worklet.nonzero,true);assert.equal(worklet.sampleRate,16000);
    await run(`(async()=>{
      live.session=await api.localVoiceStart();live.inputId=await api.localVoiceInput(live.session,16000);live.hasInputCaption=false;live.heardFinal=false;
      live.inputQueue=Promise.resolve();live.streamFailed=false;live.change('active','Listening…','listening');
      window.popupTrack={enabled:true,stop(){}};live.stream={getTracks:()=>[window.popupTrack],getAudioTracks:()=>[window.popupTrack]};
      window.originalListen=live.listen;live.listen=async function(){this.stream.getTracks()[0].enabled=true;this.listening=true;this.change('active','Listening…','listening');};
    })()`);
    onText('Open Calcu');await until("document.querySelector('.words')?.textContent",value=>value==='Open Calcu');assert.equal(modelCalls,0);
    await run("window.popupTurn=live.respond([new Blob(['fallback'])],'audio/webm',live.generation);void 0");
    await until("document.querySelector('.caption:last-child .words')?.textContent",value=>value==="Got it. I'm on it.");
    assert.equal(await read("document.getElementById('status').textContent"),'Working…');
    assert.equal(await read("getComputedStyle(document.getElementById('pet')).backgroundColor"),'rgb(165, 35, 48)');
    assert.equal(await read("getComputedStyle(document.querySelector('.live-label')).display"),'none');
    assert.deepEqual(await read("[...document.querySelectorAll('.words')].map(p=>p.textContent)"),['Open Calculator.',"Got it. I'm on it."]);
    assert.equal(await run('window.popupTrack.enabled'),false);assert.equal(modelCalls,1);
    await capture('working');
    releaseAnswer('Calculator is open.');await run('window.popupTurn');
    await until("document.getElementById('status').textContent",value=>value==='Listening');
    assert.equal(await read("getComputedStyle(document.getElementById('pet')).backgroundColor"),'rgb(28, 33, 27)');
    assert.deepEqual(await read("[...document.querySelectorAll('.words')].map(p=>p.textContent)"),['Open Calculator.','Calculator is open.']);
    assert.equal(await run('window.popupTrack.enabled'),true);
    await capture('listening');
    await run('live.cleanup();live.listen=window.originalListen;void 0');
    onText('Late words');await until("document.querySelectorAll('.words').length",value=>value===0);
    fs.writeFileSync(path.join(directory,'voice-popup-integration.json'),JSON.stringify({status:'passed',version,checks:['AudioWorklet loads and emits PCM16 in Electron','partial captions appear before model request','final transcript replaces partial text','whole popup red while working','Listening and LIVE hidden during work','acknowledgement caption and actual WAV playback','microphone muted through acknowledgement and final answer','final answer replaces acknowledgement without removing user words','listening restores original popup color','Stop ignores stale words'],scope:'Synthetic recognizer and model through real IPC/renderers/audio player; no microphone recording, cloud API or desktop actions.'},null,2));
  }finally{localConversation.stop();localConversation.fetch=original.fetch;localConversation.ai.chat=original.chat;localConversation.createTranscription=original.create;}
};
