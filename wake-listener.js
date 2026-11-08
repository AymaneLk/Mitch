'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const {randomUUID}=require('node:crypto');

class WakeListener {
  constructor({helper,spawnImpl=spawn,onState=()=>{},onWake=()=>{}}) {
    this.helper=helper;this.spawnImpl=spawnImpl;this.onState=onState;this.onWake=onWake;this.generation=0;this.child=null;this.state={status:'off'};
  }
  update(status,extra={}) {this.state={status,...extra};this.onState(this.state);}
  start() {
    if(this.child)return;
    const generation=++this.generation;this.update('starting');
    const child=this.spawnImpl(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.helper],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child=child;let buffer='',woke=false,failed=false;
    const current=()=>generation===this.generation&&this.child===child;
    const fail=message=>{if(!current()||failed)return;failed=true;this.update('error',{message:String(message).slice(0,400)});child.kill();};
    const startup=setTimeout(()=>fail('Wake listener could not start. Check Windows microphone access and try again.'),15000);
    child.stdout.on('data',bytes=>{
      if(!current())return;buffer+=bytes.toString('utf8');if(buffer.length>16000)return fail('Invalid wake listener response.');
      let newline;while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(!line)continue;
        let event;try{event=JSON.parse(line);}catch{return fail('Invalid wake listener response.');}
        if(event.event==='ready'){clearTimeout(startup);this.update('listening',{culture:event.culture});}
        else if(event.event==='error')fail(event.message||'Windows speech recognition is unavailable.');
        else if(event.event==='wake'&&!woke&&!failed&&Number.isFinite(event.confidence)&&event.confidence>=0.72){woke=true;clearTimeout(startup);this.update('waking');this.onWake();}
      }
    });
    // The native helper sends public error JSON; never forward arbitrary stderr.
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.once('error',()=>fail('Could not start the local Windows wake listener.'));
    child.once('close',()=>{clearTimeout(startup);if(!current())return;this.child=null;if(!woke&&!failed)this.update('error',{message:'Wake listener stopped. Check the microphone and try again.'});});
  }
  async stop() {
    this.generation++;const child=this.child;this.child=null;
    this.update('off');if(!child)return;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Microphone listener did not stop. Try again.')),3000);
      child.once('close',()=>{clearTimeout(timer);resolve();});
      if(child.exitCode!==null&&child.exitCode!==undefined){clearTimeout(timer);resolve();return;}
      try{child.stdin.end();child.kill();}catch(error){clearTimeout(timer);reject(error);}
    });
  }
}

class WakeService {
  constructor({listener,onState=()=>{},onWake=()=>{},cooldownMs=1200}) {
    this.listener=listener;this.onState=onState;this.onWake=onWake;this.cooldownMs=cooldownMs;
    this.enabled=false;this.available=false;this.paused=false;this.closed=false;this.claims=new Set();this.queue=Promise.resolve();this.pending=null;
    listener.onState=()=>this.notify();listener.onWake=()=>this.detected();
  }
  status() {
    const status=this.closed||!this.enabled?'off':this.paused?'paused':!this.available?'setup':this.claims.size?'busy':this.pending?'waking':this.listener.state.status;
    return {enabled:this.enabled,status,...(status==='error'?{message:this.listener.state.message}:{}),...(this.listener.state.culture?{culture:this.listener.state.culture}:{})};
  }
  notify(){this.onState(this.status());}
  cancelPending(){clearTimeout(this.pendingTimer);this.pending=null;}
  configure({enabled,available}) {
    this.enabled=!!enabled;this.available=!!available;if(!this.enabled||!this.available)this.cancelPending();
    return this.reconcile();
  }
  reconcile() {
    const run=this.queue.then(async()=>{
      if(this.closed||!this.enabled||!this.available||this.paused||this.claims.size||this.pending)await this.listener.stop();
      else this.listener.start();this.notify();
    });this.queue=run.catch(()=>{});return run;
  }
  detected() {
    if(this.closed||!this.enabled||!this.available||this.paused||this.claims.size||this.pending)return;
    const id=randomUUID();this.pending=id;this.notify();
    this.pendingTimer=setTimeout(()=>{if(this.pending===id){this.pending=null;this.reconcile().catch(()=>{});}},45000);
    this.onWake({id});
  }
  async claim(kind,wakeId) {
    if(!['voice','dictation'].includes(kind)||this.closed)throw new Error('Invalid microphone request.');
    if(wakeId&&(kind!=='voice'||wakeId!==this.pending||this.paused||!this.enabled||!this.available))throw new Error('Wake request ended. Call Mitch again.');
    this.cancelPending();
    const id=randomUUID();this.claims.add(id);
    try{await this.reconcile();if(!this.claims.has(id)||this.closed)throw new Error('Microphone request cancelled.');return id;}
    catch(error){this.claims.delete(id);throw error;}
  }
  release(id) {
    if(typeof id!=='string'||!this.claims.delete(id))return;
    clearTimeout(this.cooldown);
    this.notify();this.cooldown=setTimeout(()=>this.reconcile().catch(()=>{}),this.cooldownMs);
  }
  async pause(){this.paused=true;this.cancelPending();this.claims.clear();clearTimeout(this.cooldown);await this.reconcile();}
  async resume(){this.paused=false;await this.listener.stop();return this.reconcile();}
  async close(){this.closed=true;this.cancelPending();this.claims.clear();clearTimeout(this.cooldown);await this.reconcile();}
}
module.exports={WakeListener,WakeService};
