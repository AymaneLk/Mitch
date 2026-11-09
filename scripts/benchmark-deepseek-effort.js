'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {AI}=require('../ai');
const {chatPayload}=require('../local-ai');
const {deepseekPayload,deepseekURL,deepseekHeaders}=require('../deepseek-ai');
const {desktopTools}=require('../desktop-speed');
const MODEL='deepseek-flash',EFFORTS=['high','low'],REQUEST_LIMIT=26;
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length?(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2):null;};
const rounded=value=>value===null?null:Math.round(value*100)/100;
const readTools=new Set(['computer_list_windows','computer_find_window','computer_inspect_window','computer_focus_window','computer_observe','inspect_app','look_at_screen','list_apps']);

function evaluate(task,message){
  const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
  const content=typeof message.content==='string'?message.content.trim():'';
  if(task.expected.kind==='clarification'){
    const clarifies=!calls.length&&/\b(?:which|clarify|specify|tell me)\b/i.test(content)&&
      (/\?/.test(content)||/\b(?:please|need|could|would)\b/i.test(content))&&!/\b(?:opened|selected|clicked)\b/i.test(content);
    if(clarifies)return {exact_first_choice_correct:true,classification:'correct_clarification'};
  }
  if(calls.length===1&&task.expected.kind==='tool'){
    const call=calls[0];let args;
    try{args=JSON.parse(call.function?.arguments);}catch{}
    if(call.function?.name===task.expected.name&&args&&typeof args==='object'&&!Array.isArray(args)&&
      JSON.stringify(Object.keys(args).sort())===JSON.stringify(Object.keys(task.expected.args).sort())&&
      Object.entries(task.expected.args).every(([key,value])=>args[key]===value)){
      return {exact_first_choice_correct:true,classification:'correct_direct_action'};
    }
  }
  if(calls.length&&calls.every(call=>readTools.has(call.function?.name)))return {exact_first_choice_correct:false,classification:'extra_observation'};
  if(!calls.length)return {exact_first_choice_correct:false,classification:'other_text_response'};
  const names=calls.map(call=>call.function?.name);
  if(names.some(name=>['click_app_control','type_in_app'].includes(name)))return {exact_first_choice_correct:false,classification:'wrong_tool_namespace'};
  return {exact_first_choice_correct:false,classification:'unexpected_action'};
}

function summarize(rows){
  return Object.fromEntries(EFFORTS.map(effort=>{
    const attempts=rows.filter(row=>row.effort===effort&&!row.warmup),responses=attempts.filter(row=>row.status==='ok'),times=responses.map(row=>row.duration_ms);
    const count=classification=>responses.filter(row=>row.classification===classification).length;
    return [effort,{
      attempts:attempts.length,responses:responses.length,errors:attempts.length-responses.length,
      exact_first_choice_correct:responses.filter(row=>row.exact_first_choice_correct).length,
      extra_observations:count('extra_observation'),wrong_tool_namespace:count('wrong_tool_namespace'),unexpected_actions:count('unexpected_action'),other_text_responses:count('other_text_response'),
      median_ms:rounded(median(times)),min_ms:times.length?Math.min(...times):null,max_ms:times.length?Math.max(...times):null,mean_ms:times.length?rounded(times.reduce((sum,value)=>sum+value,0)/times.length):null,
      prompt_tokens:responses.reduce((sum,row)=>sum+(row.usage?.prompt_tokens||0),0),cached_prompt_tokens:responses.reduce((sum,row)=>sum+(row.usage?.cached_prompt_tokens||0),0),completion_tokens:responses.reduce((sum,row)=>sum+(row.usage?.completion_tokens||0),0),reasoning_tokens:responses.reduce((sum,row)=>sum+(row.usage?.reasoning_tokens||0),0),
    }];
  }));
}

async function buildTasks({nativeOnlySimple=false}={}){
  if(typeof nativeOnlySimple!=='boolean')throw Error('Invalid benchmark variant.');
  const settings={chatProvider:'deepseek',deepseekChatModel:MODEL,allowScreen:false,allowDesktop:true};
  const window={pid:9101,window_id:9102,title:'Synthetic messaging app'};
  const frame=(snapshot,ambiguous=false)=>({status:'inspected',snapshot,window,degraded:false,truncated:false,controls:[
    {control_id:'0',name:'Messages',type:'Link',enabled:true,editable:false},
    {control_id:'1',name:'Search conversations',type:'Edit',enabled:true,editable:true},
    {control_id:'2',name:ambiguous?'Alex':'Test contact',type:'Button',enabled:true,editable:false},
    {control_id:'3',name:ambiguous?'Alex':'Other contact',type:'Button',enabled:true,editable:false},
  ]});
  const fixtures=[
    {id:'simple_click',label:'Select a unique observed conversation',category:'simple',prompt:'Open the existing conversation named Test contact in the messaging app. Do not send anything or start a call.',prior:{name:'computer_inspect_window',args:{pid:9101,window_id:9102},output:frame('effort-inbox')},expected:{kind:'tool',name:'computer_action',args:{snapshot:'effort-inbox',kind:'click',control_id:'2',expected_name:'Test contact'}}},
    {id:'text_field_focus',label:'Focus a unique observed editable field',category:'simple',prompt:'Put keyboard focus in the Search conversations text field. Do not type, send a message or press Enter.',prior:{name:'computer_inspect_window',args:{pid:9101,window_id:9102},output:frame('effort-focus')},expected:{kind:'tool',name:'computer_action',args:{snapshot:'effort-focus',kind:'click',control_id:'1',expected_name:'Search conversations'}}},
    {id:'ambiguous_contact',label:'Ask which of two identically named contacts',category:'ambiguous',prompt:'Open the existing conversation named Alex. Do not send anything or start a call.',prior:{name:'computer_inspect_window',args:{pid:9101,window_id:9102},output:frame('effort-ambiguous',true)},expected:{kind:'clarification'}},
    {id:'recovery',label:'Continue after uncertain Messages navigation without replay',category:'recovery',prompt:'Go to Messages and open the existing conversation named Test contact. Do not send anything or start a call.',prior:{name:'computer_action',args:{snapshot:'effort-home',kind:'click',control_id:'0',expected_name:'Messages'},output:{status:'error',code:'tool_invocation_failed',outcome_unknown:true,action_attempted:true,recovery_required:true,recovery:{observed:true,state_changed:true},observation:frame('effort-recovery'),message:'Messages navigation was attempted once. Fresh inspection shows the inbox and Test contact. Do not click Messages again; continue with the next distinct observed control.'}},expected:{kind:'tool',name:'computer_action',args:{snapshot:'effort-recovery',kind:'click',control_id:'2',expected_name:'Test contact'}}},
  ];
  const tasks=nativeOnlySimple?fixtures.filter(task=>task.category==='simple'):fixtures;
  for(const task of tasks){
    let body;
    const ai=new AI(()=>settings,async()=>{throw Error('No credentials needed to build fixtures');},()=>{throw Error('No desktop dispatcher in this benchmark');});
    ai.request=async(_endpoint,input)=>{body=structuredClone(input);return {output:[{type:'message',content:[{type:'output_text',text:'Fixture captured.'}]}]};};
    await ai.chat(task.prompt);
    if(!body)throw Error('The benchmark did not capture production instructions.');
    const callId='effort-'+task.id;
    body.input.push({type:'function_call',call_id:callId,name:task.prior.name,arguments:JSON.stringify(task.prior.args),_localReasoning:''},{type:'function_call_output',call_id:callId,output:JSON.stringify(task.prior.output)});
    if(nativeOnlySimple)body.tools=desktopTools(body.tools,[task.prior]);
    // Build once from Mitch's real provider path. Both variants share every
    // prompt/tool/limit parameter; only reasoning_effort changes at send time.
    body.localThinking=true;body.localReasoningEffort='high';
    task.payload=deepseekPayload(chatPayload(body,settings),body,settings);
    task.payload.thinking={type:'enabled'};task.payload.reasoning_effort='high';task.payload.stream=false;task.payload.max_tokens=8192;
    const {reasoning_effort,...common}=task.payload;
    task.payload_sha256=crypto.createHash('sha256').update(JSON.stringify(common)).digest('hex');
  }
  return tasks;
}

async function runBenchmark({key,directory,fetcher=fetch,repeats=3,nativeOnlySimple=false,onProgress=()=>{}}){
  if(repeats!==3)throw Error('The effort benchmark is bounded to three repeats.');
  const tasks=await buildTasks({nativeOnlySimple}),headers=deepseekHeaders(key),requestLimit=nativeOnlySimple?14:REQUEST_LIMIT;
  const report={status:'running',started_at:new Date().toISOString(),method:{model:MODEL,efforts:EFFORTS,thinking:'enabled',stream:false,max_tokens:8192,repeats,request_limit:requestLimit,availability_checks:1,nativeOnlySimple,order:'Sequential effort pairs; order alternates per task and repetition',warmup:'One excluded request for each effort',timing:'Request start through complete parsed response, including network and thinking',realDesktopActions:false,screenshots:false,context:nativeOnlySimple?'Actual Mitch instructions with production desktopTools pruning after complete native observations; two simple synthetic UI choices':'Actual Mitch instructions and full tool definitions with synthetic recorded observations',accuracy_scope:'Exact first-choice matches only. Extra observation requests are reported separately and are not necessarily incorrect. No overall desktop task success or general accuracy is measured. Ambiguous clarification scoring is a conservative text heuristic.'},tasks:tasks.map(({id,label,category,expected,payload_sha256})=>({id,label,category,expected,payload_sha256})),rows:[]};
  fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,nativeOnlySimple?'deepseek-effort-native-benchmark.json':'deepseek-effort-benchmark.json');
  const redact=value=>String(value).replaceAll(key,'[REDACTED]').slice(0,250);
  const save=()=>{
    report.summary=summarize(report.rows);
    report.by_task=Object.fromEntries(tasks.map(task=>[task.id,summarize(report.rows.filter(row=>row.task===task.id))]));
    report.by_category=Object.fromEntries(['simple','ambiguous','recovery'].map(category=>[category,summarize(report.rows.filter(row=>tasks.find(task=>task.id===row.task)?.category===category))]));
    fs.writeFileSync(file,JSON.stringify(report,null,2));
  };
  async function request(task,effort,repeat,warmup=false){
    if(report.rows.length>=requestLimit)throw Error('Benchmark request limit reached.');
    const row={model:MODEL,effort,task:task.id,repeat,warmup,started_at:new Date().toISOString(),payload_sha256:task.payload_sha256},started=performance.now();
    try{
      const response=await fetcher(deepseekURL(),{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(90000),body:JSON.stringify({...task.payload,reasoning_effort:effort})});
      row.http_status=response.status;
      if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json(),choice=data.choices?.[0];row.duration_ms=Math.round(performance.now()-started);
      if(!choice?.message)throw Error('No response message');
      row.finish_reason=choice.finish_reason;row.served_model=String(data.model||'').slice(0,100);
      row.usage={prompt_tokens:data.usage?.prompt_tokens||0,cached_prompt_tokens:data.usage?.prompt_tokens_details?.cached_tokens||0,completion_tokens:data.usage?.completion_tokens||0,reasoning_tokens:data.usage?.completion_tokens_details?.reasoning_tokens||0,total_tokens:data.usage?.total_tokens||0};
      if(choice.finish_reason==='length')throw Error('Response token limit reached');
      if(!['stop','tool_calls'].includes(choice.finish_reason))throw Error('Unexpected finish reason');
      row.status='ok';if(!warmup)Object.assign(row,evaluate(task,choice.message));
      // Never persist reasoning_content or the raw provider response.
      row.output=choice.message.tool_calls?.length?choice.message.tool_calls.map(call=>({name:String(call.function?.name||'').slice(0,100),arguments:String(call.function?.arguments||'').slice(0,1200)})):String(choice.message.content||'').slice(0,600);
    }catch(error){row.status='error';row.duration_ms=Math.round(performance.now()-started);row.error=error.name==='TimeoutError'?'Request timed out':redact(error.message);}
    report.rows.push(row);save();onProgress({completed:report.rows.length,total:requestLimit,effort,task:row.task,duration_ms:row.duration_ms,status:row.status,classification:row.classification});
    if([401,402,429].includes(row.http_status))throw Error('Benchmark stopped after HTTP '+row.http_status);
  }
  save();
  try{
    const available=await fetcher(deepseekURL('models'),{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!available.ok)throw Error('Model availability check failed: HTTP '+available.status);
    if(!(await available.json()).data?.some(model=>model.id===MODEL))throw Error('DeepSeek Flash is unavailable for this connection.');
    for(const effort of EFFORTS)await request({...tasks[0],id:'warmup'},effort,-1,true);
    for(let repeat=0;repeat<repeats;repeat++)for(let index=0;index<tasks.length;index++){
      const order=(repeat+index)%2?[...EFFORTS].reverse():EFFORTS;
      for(const effort of order)await request(tasks[index],effort,repeat);
    }
    report.status=report.rows.some(row=>row.status==='error')?'completed_with_errors':'completed';
  }catch(error){report.status='failed';report.error=redact(error.message);}
  report.finished_at=new Date().toISOString();save();
  return report;
}
module.exports={buildTasks,evaluate,summarize,runBenchmark,median};
