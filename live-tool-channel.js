'use strict';

const {randomUUID}=require('node:crypto');
const {formatToolOutput}=require('./tool-output');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Large screenshots cannot reliably fit a WebRTC data-channel message. Keep
// result delivery on one authenticated backend sideband; audio stays on WebRTC.
// https://developers.openai.com/api/docs/guides/live-delegation
// https://developers.openai.com/api/reference/resources/live/sideband-websocket
class LiveToolChannel {
  constructor(getKey,{socketFactory,onError=()=>{},timeoutMs=15000}={}) {
    this.getKey=getKey;this.socketFactory=socketFactory||((url,options)=>new(require('undici').WebSocket)(url,options));
    this.onError=onError;this.timeoutMs=timeoutMs;this.generation=0;this.sessionId=null;this.socket=null;this.connecting=null;this.queue=Promise.resolve();this.failure=null;
  }
  setSession(sessionId) {
    this.close();
    if(typeof sessionId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(sessionId))throw new Error('Voice service did not return a valid session identifier.');
    this.sessionId=sessionId;
  }
  assertCurrent(generation,signal) {
    signal?.throwIfAborted();
    if(generation!==this.generation||!this.sessionId)throw new Error('Voice task stopped or session changed.');
    if(this.failure)throw this.failure;
  }
  async connect(generation,signal) {
    this.assertCurrent(generation,signal);
    if(this.socket?.readyState===1)return this.socket;
    if(this.connecting)return this.connecting;
    const pending=(async()=>{
      const key=await this.getKey();this.assertCurrent(generation,signal);
      if(!key)throw new Error('Add your OpenAI API key in Settings first.');
      const socket=this.socketFactory(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(this.sessionId)}/attach`,{headers:{Authorization:'Bearer '+key}});
      this.socket=socket;
      socket.addEventListener('message',event=>{
        if(generation!==this.generation)return;
        let message;try{message=JSON.parse(event.data);}catch{return;}
        if(message.type==='error'){
          this.failure=new Error(message.error?.message||'Voice backend rejected a tool result.');
          this.onError(this.failure);
        }
      });
      socket.addEventListener('close',()=>{
        if(generation!==this.generation)return;
        this.failure=new Error('Voice tool connection closed. End the conversation and reconnect before continuing.');this.onError(this.failure);
      });
      socket.addEventListener('error',()=>{
        if(generation!==this.generation)return;
        this.failure=new Error('Voice tool connection failed. End the conversation and reconnect before continuing.');this.onError(this.failure);
      });
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('Voice tool connection timed out.')),this.timeoutMs);
        const abort=()=>finish(signal?.reason||new Error('Voice task stopped.'));
        const open=()=>finish();
        const error=()=>finish(new Error('Could not connect the voice tool sideband.'));
        const closed=()=>finish(new Error('Voice tool connection closed before opening.'));
        const finish=problem=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.removeEventListener('open',open);socket.removeEventListener('error',error);socket.removeEventListener('close',closed);if(problem){try{socket.close();}catch{}reject(problem);}else resolve();};
        socket.addEventListener('open',open,{once:true});socket.addEventListener('error',error,{once:true});socket.addEventListener('close',closed,{once:true});signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();else if(socket.readyState===1)open();
      });
      this.assertCurrent(generation,signal);return socket;
    })();
    this.connecting=pending;
    try{return await pending;}finally{if(this.connecting===pending)this.connecting=null;}
  }
  submit(results,{signal}={}) {
    const generation=this.generation;
    const run=this.queue.then(async()=>{
      this.assertCurrent(generation,signal);
      if(!Array.isArray(results)||!results.length||results.length>50)throw new Error('Invalid voice tool result batch.');
      const seen=new Set();
      const events=results.map(result=>{
        if(typeof result?.call_id!=='string'||!result.call_id||result.call_id.length>200||seen.has(result.call_id))throw new Error('Invalid or duplicate voice call id.');
        seen.add(result.call_id);
        return {type:'response.item.create',event_id:randomUUID(),item:{type:'function_call_output',call_id:result.call_id,output:formatToolOutput(result.output)}};
      });
      events.push({type:'response.create',event_id:randomUUID()});
      const socket=await this.connect(generation,signal);
      for(const event of events){this.assertCurrent(generation,signal);if(socket.readyState!==1)throw new Error('Voice tool connection is closed.');socket.send(JSON.stringify(event));}
      const started=Date.now();
      while(socket.bufferedAmount>0){this.assertCurrent(generation,signal);if(socket.readyState!==1)throw new Error('Voice tool delivery was interrupted; do not replay its actions.');if(Date.now()-started>this.timeoutMs)throw new Error('Voice tool result delivery timed out; do not replay its actions.');await wait(10);}
      this.assertCurrent(generation,signal);
      return {status:'submitted',count:results.length};
    });
    this.queue=run.catch(()=>{});return run;
  }
  close() {
    this.generation++;this.sessionId=null;this.failure=null;this.connecting=null;this.queue=Promise.resolve();
    const socket=this.socket;this.socket=null;try{socket?.close();}catch{}
  }
}

module.exports={LiveToolChannel};
