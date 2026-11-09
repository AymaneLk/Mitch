// Send short PCM16 frames to the main process. Output stays silent; there is no
// microphone monitoring and no network access in this worklet.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(){super();this.frame=new Int16Array(2048);this.offset=0;}
  process(inputs){
    const samples=inputs[0]?.[0];
    if(samples)for(const sample of samples){
      const value=Math.max(-1,Math.min(1,sample));
      this.frame[this.offset++]=Math.round(value*(value<0?32768:32767));
      if(this.offset===this.frame.length){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(2048);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('mitch-voice-capture',VoiceCapture);
