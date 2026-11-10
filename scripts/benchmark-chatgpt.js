'use strict';
const {performance}=require('node:perf_hooks');
const fs=require('node:fs'),path=require('node:path');
const {AI}=require('../ai');
const {createDispatcher}=require('../core');
function percentile(values,p){if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),value=p===.5&&v.length%2===0?(v[v.length/2-1]+v[v.length/2])/2:v[Math.min(v.length-1,Math.ceil(v.length*p)-1)];return Math.round(value*100)/100;}
function summarize(rows){
  const result={};for(const transport of ['http','websocket']){
    const selected=rows.filter(r=>r.transport===transport&&!r.warmup),calls=selected.flatMap(r=>r.calls),successful=calls.filter(c=>c.success);
    result[transport]={tasks:selected.length,verifiedTasks:selected.filter(r=>r.verified).length,taskSuccessRate:selected.length?selected.filter(r=>r.verified).length/selected.length:null,medianTaskMs:percentile(selected.filter(r=>r.verified).map(r=>r.ms),.5),p95TaskMs:percentile(selected.filter(r=>r.verified).map(r=>r.ms),.95),modelCalls:calls.length,medianModelMs:percentile(successful.map(c=>c.ms),.5),p95ModelMs:percentile(successful.map(c=>c.ms),.95),medianFirstTextMs:percentile(successful.map(c=>c.firstTextMs).filter(Number.isFinite),.5),errorRecoverySuccessRate:null};
  }return result;
}
async function runBenchmark({auth,provider,directory,repeats=3}){
  if(!Number.isInteger(repeats)||repeats<1||repeats>5)throw Error('Use between one and five measured repeats.');
  const before=auth.publicState(),rows=[],report={status:'running',version:require('../package.json').version,at:new Date().toISOString(),model:auth.model(),scope:'Real OAuth inference; an owned in-memory note fixture uses Mitch schema validation. Two-call tool continuation plus final-answer checks. Excludes Windows UI, microphone, ASR, TTS and app launch. Not arbitrary desktop task accuracy. No recovery is induced; that metric remains null. P95 from this small sample is descriptive only.',repeats,rows};
  let current,totalCalls=0;const oldMetrics=provider.onMetrics,originalRequest=provider.request.bind(provider);
  provider.onMetrics=metric=>{oldMetrics(metric);current?.calls.push(metric);};
  provider.request=async(...args)=>{if(++totalCalls>32)throw Error('Bounded benchmark request limit reached.');return originalRequest(...args);};
  const save=()=>{report.summary=summarize(rows);fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'chatgpt-transport-benchmark.json'),JSON.stringify(report,null,2));};
  save();
  try{
    for(let trial=0;trial<=repeats;trial++)for(const transport of (trial%2?['websocket','http']:['http','websocket'])){
      if(fs.existsSync(path.join(directory,'chatgpt-benchmark.stop')))throw Error('Benchmark stopped.');
      provider.close();await auth.select({mode:before.mode,transport});
      current={transport,trial,warmup:trial===0,calls:[],verified:false};rows.push(current);const started=performance.now();let notes=[];
      const dispatch=createDispatcher({create_note:async args=>{notes.push(args);return {status:'saved',id:'owned-fixture-note'};}});
      const ai=new AI(()=>({chatProvider:'chatgpt',localOnly:true,allowDesktop:false,allowScreen:false}),async()=>'',dispatch,fetch,provider);
      const timer=setTimeout(()=>ai.cancel(),90000);
      try{
        const reply=await ai.chat('Save one note titled Transport check with the exact text alpha '+trial+'. Then reply with exactly: Saved.');
        current.verified=notes.length===1&&notes[0].title==='Transport check'&&notes[0].text==='alpha '+trial&&reply.trim()==='Saved.';current.status='completed';
      }catch{current.status='failed';}
      finally{clearTimeout(timer);ai.cancel();ai.closeVoice();current.ms=Math.round(performance.now()-started);save();}
      // Admission/usage/auth failures must not loop through accounts or billing.
      if(current.calls.some(c=>['subscription_sharing_usage_limit_exceeded','subscription_sharing_user_not_eligible','session_expired','plan_permission_required'].includes(c.code)))throw Error('Benchmark stopped by ChatGPT account limits.');
    }
    report.status=rows.every(r=>r.verified)?'completed':'completed_with_errors';
  }finally{provider.request=originalRequest;provider.onMetrics=oldMetrics;provider.close();await auth.select({mode:before.mode,transport:before.transport});if(report.status==='running')report.status='stopped';save();}
  return report;
}
module.exports={runBenchmark,summarize,percentile};
