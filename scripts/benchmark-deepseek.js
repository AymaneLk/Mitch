'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {AI}=require('../ai');
const {chatPayload}=require('../local-ai');
const {deepseekPayload,deepseekURL,deepseekHeaders}=require('../deepseek-ai');
const MODELS=['deepseek-flash','deepseek-v4-pro'];
const median=values=>{const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length?(a.length%2?a[m]:(a[m-1]+a[m])/2):null;};
const rounded=value=>value===null?null:Math.round(value*100)/100;
function summarize(rows){
  return Object.fromEntries(MODELS.map(model=>{
    const attempts=rows.filter(r=>r.model===model&&!r.warmup),ok=attempts.filter(r=>r.status==='ok'),times=ok.map(r=>r.duration_ms);
    return [model,{attempts:attempts.length,responses:ok.length,correct:ok.filter(r=>r.correct).length,median_ms:rounded(median(times)),min_ms:times.length?Math.min(...times):null,max_ms:times.length?Math.max(...times):null,mean_ms:times.length?rounded(times.reduce((a,b)=>a+b,0)/times.length):null,completion_tokens:ok.reduce((n,r)=>n+(r.usage?.completion_tokens||0),0),reasoning_tokens:ok.reduce((n,r)=>n+(r.usage?.completion_tokens_details?.reasoning_tokens||0),0)}];
  }));
}
function valid(task,message){
  if(task.id==='arithmetic')return /^282\.?$/.test(String(message.content||'').trim())&&!(message.tool_calls?.length);
  if(message.tool_calls?.length!==1)return false;
  const call=message.tool_calls[0];let args;try{args=JSON.parse(call.function.arguments);}catch{return false;}
  if(task.id==='open_app')return call.function.name==='open_app'&&args.app_id===task.appId;
  return call.function.name==='computer_action'&&args.snapshot===task.snapshot&&args.kind==='click'&&args.control_id==='2'&&args.expected_name==='Test contact';
}
async function buildTasks(){
  const settings={chatProvider:'deepseek',deepseekChatModel:MODELS[0],allowScreen:false};
  const appId='Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
  const frame=snapshot=>({status:'inspected',snapshot,window:{pid:9001,window_id:9002,title:'Synthetic messaging app'},degraded:false,truncated:false,controls:[{control_id:'0',name:'Messages',type:'Link',enabled:true},{control_id:'1',name:'Search conversations',type:'Edit',enabled:true,editable:true},{control_id:'2',name:'Test contact',type:'Button',enabled:true},{control_id:'3',name:'Other contact',type:'Button',enabled:true}]});
  const tasks=[
    {id:'arithmetic',label:'Short arithmetic answer',prompt:'What is 1.5 multiplied by 188? Reply with only the number. Do not open an app or use tools.'},
    {id:'open_app',label:'Choose an app to open',appId,prompt:'Open Calculator.',prior:{name:'list_apps',args:{query:'Calculator'},output:{status:'ok',apps:[{name:'Calculator',app_id:appId}]}}},
    {id:'inbox_selection',label:'Choose a conversation',snapshot:'bench-inbox',prompt:'Open the existing conversation named Test contact in the messaging app. Do not send anything or start a call.',prior:{name:'computer_inspect_window',args:{pid:9001,window_id:9002},output:frame('bench-inbox')}},
    {id:'recovery',label:'Continue after uncertain navigation',snapshot:'bench-recovery',prompt:'Go to Messages and open the existing conversation named Test contact. Do not send anything or start a call.',prior:{name:'computer_action',args:{snapshot:'bench-home',kind:'click',control_id:'0',expected_name:'Messages'},output:{status:'error',code:'tool_invocation_failed',outcome_unknown:true,action_attempted:true,recovery_required:true,recovery:{observed:true,state_changed:true},observation:frame('bench-recovery'),message:'Messages navigation was attempted once. Fresh inspection shows the inbox and Test contact. Do not click Messages again; continue with the next distinct observed control.'}}}
  ];
  for(const task of tasks){
    let body;
    const ai=new AI(()=>settings,async()=>{throw new Error('No credentials needed to build fixtures');},()=>{throw new Error('No desktop dispatcher in benchmark');});
    ai.request=async(_endpoint,input)=>{body=structuredClone(input);return {output:[{type:'message',content:[{type:'output_text',text:'Fixture captured.'}]}]};};
    await ai.chat(task.prompt);
    if(task.prior){
      const callId='bench-'+task.id;
      body.input.push({type:'function_call',call_id:callId,name:task.prior.name,arguments:JSON.stringify(task.prior.args),_localReasoning:''},{type:'function_call_output',call_id:callId,output:JSON.stringify(task.prior.output)});
    }
    task.payload=deepseekPayload(chatPayload(body,settings),body,settings);
    const {model,...common}=task.payload;
    task.payload_sha256=crypto.createHash('sha256').update(JSON.stringify(common)).digest('hex');
  }
  return tasks;
}
async function runBenchmark({key,directory,fetcher=fetch,repeats=3,onProgress=()=>{}}){
  if(repeats!==3)throw new Error('This benchmark is bounded to three repeats.');
  const tasks=await buildTasks(),report={status:'running',started_at:new Date().toISOString(),method:{models:MODELS,thinking:'enabled',reasoning_effort:'high',stream:false,max_tokens:8192,repeats,order:'sequential paired runs; model order alternates per task and repetition',timing:'request start through complete parsed response, including network and thinking',warmup:'one excluded inference per model',realDesktopActions:false,screenshots:false,context:'actual Mitch instructions and full tool definitions; synthetic recorded observations',request_limit:26},tasks:tasks.map(({id,label,payload_sha256})=>({id,label,payload_sha256})),rows:[]};
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'deepseek-flash-pro-benchmark.json');
  const save=()=>{report.summary=summarize(report.rows);report.by_task=Object.fromEntries(tasks.map(t=>[t.id,summarize(report.rows.filter(r=>r.task===t.id))]));fs.writeFileSync(file,JSON.stringify(report,null,2));};
  save();
  const headers=deepseekHeaders(key);
  const available=await fetcher(deepseekURL('models'),{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!available.ok)throw new Error('Model availability check failed: HTTP '+available.status);
  const models=(await available.json()).data?.map(m=>m.id)||[];
  for(const model of MODELS)if(!models.includes(model))throw new Error(model+' is not available for this connection.');
  async function request(task,model,repeat,warmup=false){
    if(report.rows.length>=26)throw new Error('Benchmark request limit reached.');
    const started=performance.now(),row={model,task:task.id,repeat,warmup,started_at:new Date().toISOString(),payload_sha256:task.payload_sha256};
    try{
      const response=await fetcher(deepseekURL(),{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(90000),body:JSON.stringify({...task.payload,model})});
      const data=await response.json();row.duration_ms=Math.round(performance.now()-started);row.http_status=response.status;
      if(!response.ok)throw new Error('HTTP '+response.status);
      const choice=data.choices?.[0];if(!choice?.message)throw new Error('No response message');
      row.finish_reason=choice.finish_reason;row.served_model=data.model;row.usage=data.usage;
      if(choice.finish_reason==='length')throw new Error('Response token limit reached');
      row.status='ok';row.correct=warmup?true:valid(task,choice.message);
      row.output=choice.message.tool_calls?.length?choice.message.tool_calls.map(c=>({name:c.function.name,arguments:c.function.arguments})):String(choice.message.content||'').slice(0,600);
    }catch(error){row.status='error';row.duration_ms=Math.round(performance.now()-started);row.error=error.name==='TimeoutError'?'Request timed out':String(error.message).replaceAll(key,'[REDACTED]').slice(0,200);}
    report.rows.push(row);save();onProgress({completed:report.rows.length,total:26,model,task:row.task,duration_ms:row.duration_ms,status:row.status,correct:row.correct});
    if(row.http_status===401||row.http_status===402||row.http_status===429)throw new Error('Benchmark stopped after HTTP '+row.http_status);
  }
  try{
    for(const model of MODELS)await request({...tasks[0],id:'warmup'},model,-1,true);
    for(let repeat=0;repeat<repeats;repeat++)for(let index=0;index<tasks.length;index++){
      const order=(repeat+index)%2?[...MODELS].reverse():MODELS;
      for(const model of order)await request(tasks[index],model,repeat);
    }
    report.status=report.rows.some(r=>r.status==='error')?'completed_with_errors':'completed';
  }catch(error){report.status='failed';report.error=String(error.message).replaceAll(key,'[REDACTED]').slice(0,200);}
  report.finished_at=new Date().toISOString();save();
  const fields=['model','task','repeat','warmup','duration_ms','status','correct','finish_reason'];
  const csv=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  fs.writeFileSync(path.join(directory,'deepseek-flash-pro-benchmark.csv'),[fields.join(','),...report.rows.map(r=>fields.map(k=>csv(r[k])).join(','))].join('\n'));
  return report;
}
module.exports={buildTasks,runBenchmark,summarize,median};
