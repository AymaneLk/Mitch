'use strict';
// A short original two-note chime, generated locally with no media download.
window.playWakeChime=async function({signal}={}) {
  const Audio=window.AudioContext||window.webkitAudioContext;
  if(!Audio)throw new Error('Audio playback is unavailable.');
  const context=new Audio();
  try{
    signal?.throwIfAborted();
    await new Promise((resolve,reject)=>{
      const finish=error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>finish(signal.reason||new Error('Wake cancelled.'));
      const timer=setTimeout(()=>finish(new Error('Could not play the ready chime. Check your audio output.')),1500);
      signal?.addEventListener('abort',abort,{once:true});context.resume().then(()=>finish(),finish);if(signal?.aborted)abort();
    });signal?.throwIfAborted();
    const start=context.currentTime;
    for(const [offset,frequency]of [[0,880],[0.095,1174.66]]){
      const tone=context.createOscillator(),gain=context.createGain();tone.type='sine';tone.frequency.value=frequency;
      gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(0.12,start+offset+0.012);gain.gain.exponentialRampToValueAtTime(0.001,start+offset+0.15);
      tone.connect(gain);gain.connect(context.destination);tone.start(start+offset);tone.stop(start+offset+0.17);
    }
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(done,285);
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason||new Error('Wake cancelled.'));};
      function done(){signal?.removeEventListener('abort',abort);resolve();}
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  }finally{await context.close().catch(()=>{});}
};
