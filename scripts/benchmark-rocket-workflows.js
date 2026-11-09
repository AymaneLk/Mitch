'use strict';
const fs=require('node:fs'),path=require('node:path');
const {AI:CurrentAI}=require('../ai');
const {AI:BaselineAI}=require('../outputs/rocket-baseline/ai');

const tasks=[
  {id:'open_calculator',prompt:'Open Calculator.',app:'Calculator'},
  {id:'calculate',prompt:'Open calculator and calculate 1.5 x 188 and give me the result',app:'Calculator'},
  {id:'notepad_text',prompt:'Open Notepad and type "Rocket test"',app:'Notepad'},
];
const catalog=[{name:'Calculator',app_id:'Microsoft.WindowsCalculator_benchmark!App'},{name:'Notepad',app_id:'C:\\Windows\\System32\\notepad.exe'}];
const buttons=['Clear','Zero','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Decimal separator','Plus','Minus','Multiply by','Divide by','Equals'];
const median=values=>{const ordered=[...values].sort((a,b)=>a-b),middle=Math.floor(ordered.length/2);return ordered.length?(ordered.length%2?ordered[middle]:(ordered[middle-1]+ordered[middle])/2):null;};

// A stateful synthetic desktop, not a canned success response. Every native or
// legacy action must use the current observed namespace and exact control name.
function fixture(task){
  let open=false,focus=false,frame=0,latest=null,text='',display='0',left=null,operator=null,freshNumber=false;
  const calls=[];
  const window={pid:7101,window_id:7102,title:task.app==='Notepad'?'Untitled - Notepad':'Calculator',app:task.app==='Notepad'?'notepad.exe':'CalculatorApp.exe',minimized:false,on_screen:true};
  const control=(name,index,type='Button',rest={})=>({control_id:String(index),name,type,enabled:true,protected:false,editable:false,...rest});
  const controls=()=>task.app==='Notepad'?[control('Text Editor',0,'Document',{editable:true,value:text})]:[...buttons.map((name,index)=>control(name,index)),control('Display is '+display,99,'Text')];
  function observation(legacy=false){
    const snapshot=(legacy?'legacy':'native')+'-'+(++frame);
    latest={snapshot,legacy};
    return {status:'inspected',snapshot,window:{...window},focus_verified:focus,focused:focus,degraded:false,truncated:false,controls:controls().map(item=>legacy?{...item,id:'legacy-'+item.control_id}:item)};
  }
  const requireOpen=()=>{if(!open)throw Error('App is not open.');};
  function validateSnapshot(args,legacy){
    requireOpen();if(!latest||args.snapshot!==latest.snapshot||legacy!==latest.legacy)throw Error('Stale snapshot or mixed tool namespace. Inspect the intended app again.');
  }
  function input(args,legacy=false){
    validateSnapshot(args,legacy);
    const id=legacy?String(args.control_id).replace(/^legacy-/,''):args.control_id;
    const target=controls().find(item=>item.control_id===id);
    if(!target||args.expected_name!==undefined&&args.expected_name!==target.name)throw Error('Control does not match this observation.');
    if(args.kind==='type'){
      if(!target.editable||typeof args.text!=='string')throw Error('This field is not editable.');text=args.text;
      return {status:'verified',verified:true,verification:'text_readback',effect:'confirmed',observation:observation(legacy)};
    }
    if(args.kind!=='click'||task.app!=='Calculator'||target.type!=='Button')throw Error('Unsupported observed input for this fixture.');
    const name=target.name,digit=buttons.slice(1,11).indexOf(name);
    if(name==='Clear'){display='0';left=null;operator=null;freshNumber=false;}
    else if(digit>=0){display=freshNumber||display==='0'?String(digit):display+digit;freshNumber=false;}
    else if(name==='Decimal separator'){if(freshNumber){display='0';freshNumber=false;}if(!display.includes('.'))display+='.';}
    else if(['Plus','Minus','Multiply by','Divide by'].includes(name)){left=Number(display);operator=name;freshNumber=true;}
    else if(name==='Equals'){
      if(left===null||!operator)throw Error('Calculator has no pending binary operation.');
      const right=Number(display),value=operator==='Plus'?left+right:operator==='Minus'?left-right:operator==='Multiply by'?left*right:left/right;
      if(!Number.isFinite(value))throw Error('Invalid arithmetic.');display=String(Number(value.toPrecision(15)));left=null;operator=null;freshNumber=true;
    }
    return {status:'unverified',verified:false,effect:'unverifiable',observation:observation(legacy)};
  }
  async function dispatch(name,args){
    const entry={name,args};calls.push(entry);let output;
    try{
      if(name==='list_apps')output={status:'ok',apps:catalog.filter(app=>(app.name+' '+app.app_id).toLowerCase().includes(String(args.query||'').toLowerCase()))};
      else if(name==='open_app'){
        const app=catalog.find(item=>item.app_id===args.app_id);
        if(!app||app.name!==task.app)throw Error('Only the requested fixture app may be opened.');
        const existing=open;open=true;focus=true;output={status:existing?'focused_existing':'opened',app:app.name,observation:observation()};
      }else if(name==='computer_list_windows')output={status:'ok',windows:open&&(!args.query||(window.title+' '+window.app).toLowerCase().includes(args.query.toLowerCase()))?[{...window}]:[],degraded:false,truncated:false};
      else if(name==='computer_find_window'){
        output=open&&(window.title+' '+window.app).toLowerCase().includes(String(args.query).toLowerCase())?observation():{status:'not_found',windows:[],degraded:false,truncated:false};
      }else if(['computer_focus_window','computer_inspect_window','computer_restore_window'].includes(name)){
        requireOpen();if(args.pid!==window.pid||args.window_id!==window.window_id)throw Error('Unknown window identity.');
        if(name!=='computer_inspect_window')focus=true;output=observation();
      }else if(name==='inspect_app'){
        if(!args.query)output={status:'windows',windows:open?[{...window}]:[]};
        else {requireOpen();if(!(window.title+' '+window.app).toLowerCase().includes(args.query.toLowerCase()))throw Error('No matching window.');output=observation(true);}
      }else if(name==='computer_action')output=input(args);
      else if(name==='type_in_app')output=input({...args,kind:'type'},true);
      else if(name==='click_app_control')output=input({...args,kind:'click'},true);
      else if(name==='computer_action_sequence'){
        validateSnapshot(args,false);
        if(!Array.isArray(args.actions)||!args.actions.length||args.actions.length>20)throw Error('Invalid action sequence.');
        const plan=args.actions.map(step=>{
          const target=controls().find(item=>item.control_id===step.control_id&&item.name===step.expected_name);
          if(!target||!['click','type'].includes(step.kind))throw Error('Sequence contains an unobserved target.');return {...step};
        });
        const results=[];let last;
        for(const step of plan){last=input({...step,snapshot:latest.snapshot});results.push({status:last.status,verified:last.verified,effect:last.effect});}
        output={status:results.every(item=>item.verified)?'completed':'unverified',completed:results.length,attempted:results.length,total:results.length,verified:results.every(item=>item.verified),results,observation:last.observation};
      }else throw Error('This no-image synthetic fixture does not implement '+name+'. Use its observed accessibility controls.');
    }catch(error){output={status:'error',refused:true,message:error.message};}
    entry.status=output.status;return output;
  }
  function evaluate(answer){
    const words=String(answer||'');
    const refused=/couldn['’]?t|could not|cannot|can['’]?t|unable|failed|not (?:open|verified)|unverified|please check/i.test(words);
    const stateCorrect=open&&focus&&(task.id==='calculate'?display==='282':task.id==='notepad_text'?text==='Rocket test':true);
    const answerCorrect=!refused&&(task.id==='calculate'?/\b282\b/.test(words):task.id==='notepad_text'?/text|typ(?:ed|ing)|writ(?:ten|e)|wrote|notepad|done/i.test(words):/calculator/i.test(words)&&/open|ready|launched/i.test(words));
    return {stateCorrect,answerCorrect,success:stateCorrect&&answerCorrect,finalState:{open,focused:focus,app:task.app,...(task.app==='Calculator'?{display}:{text})}};
  }
  return {dispatch,calls,evaluate};
}
function summarize(rows){
  return Object.fromEntries(['baseline','rocket'].map(version=>{
    const attempts=rows.filter(row=>row.version===version),completed=attempts.filter(row=>row.status==='ok'),successes=completed.filter(row=>row.success);
    return [version,{attempts:attempts.length,completed:completed.length,successes:successes.length,median_ms:median(completed.map(row=>row.duration_ms)),successful_median_ms:median(successes.map(row=>row.duration_ms)),model_calls:attempts.reduce((n,row)=>n+row.modelCalls,0),tool_calls:attempts.reduce((n,row)=>n+row.toolCalls,0)}];
  }));
}
async function runBenchmark({key,directory,fetcher=fetch,onProgress=()=>{}}){
  if(typeof key!=='string'||!key)throw Error('DeepSeek key required for the bounded baseline comparison.');
  const report={status:'running',started_at:new Date().toISOString(),method:{baseline:'exact saved v15 AI loop',current:'current rocket AI loop',model:'deepseek-flash',repeats:2,order:'paired sequential runs; order alternates by task and repeat',scope:'Real model API requests over synthetic desktop tools with stateful Calculator and Notepad fixtures. No real desktop execution, microphone, screenshots or local GPU model. These timings exclude app launch, native input and accessibility latency.',requestsPerRunLimit:8,totalRequestLimit:48,rows:12,privateReasoningStored:false},rows:[]};
  let totalRequests=0,fatal=null;
  const scrub=error=>String(error?.message||error).replaceAll(key,'[REDACTED]').slice(0,250);
  fs.mkdirSync(directory,{recursive:true});const filename=path.join(directory,'rocket-workflows-benchmark.json');
  const save=()=>{report.totalModelRequests=totalRequests;report.summary=summarize(report.rows);report.by_task=Object.fromEntries(tasks.map(task=>[task.id,summarize(report.rows.filter(row=>row.task===task.id))]));fs.writeFileSync(filename,JSON.stringify(report,null,2));};
  save();
  for(let repeat=0;repeat<2&&!fatal;repeat++)for(let index=0;index<tasks.length&&!fatal;index++){
    const task=tasks[index],order=(repeat+index)%2?['rocket','baseline']:['baseline','rocket'];
    for(const version of order){
      if(fatal)break;
      const desktop=fixture(task),row={version,task:task.id,repeat,prompt:task.prompt,modelCalls:0,toolCalls:0,usage:{prompt_tokens:0,completion_tokens:0},efforts:[],started_at:new Date().toISOString()},AI=version==='baseline'?BaselineAI:CurrentAI;
      const settings={chatProvider:'deepseek',deepseekChatModel:'deepseek-flash',chatModel:'gpt-6-luna',allowDesktop:true,allowScreen:false,localOnly:true};
      const boundedFetch=async(url,options)=>{
        if(url!=='https://api.deepseek.com/chat/completions'||options.method!=='POST')throw Error('Benchmark permits only DeepSeek inference.');
        if(row.modelCalls>=8)throw Error('Per-run model request limit reached.');
        if(totalRequests>=48){fatal='Global model request limit reached.';throw Error(fatal);}
        row.modelCalls++;totalRequests++;
        const body=JSON.parse(options.body);row.efforts.push(body.thinking?.type==='disabled'?'off':body.reasoning_effort||'default');
        const response=await fetcher(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(45000)])});
        const data=await response.json();
        row.usage.prompt_tokens+=data.usage?.prompt_tokens||0;row.usage.completion_tokens+=data.usage?.completion_tokens||0;
        if([401,402,429].includes(response.status))fatal='Benchmark stopped after HTTP '+response.status;
        // The AI still receives all reasoning needed for valid tool continuations;
        // none of that private provider content is written into the report.
        return {ok:response.ok,status:response.status,json:async()=>data};
      };
      const ai=new AI(()=>settings,async()=>{throw Error('OpenAI credentials are not used.');},desktop.dispatch,boundedFetch,async()=>key);
      const started=performance.now();
      try{row.answer=String(await ai.chat(task.prompt,undefined,'synthetic-benchmark')).slice(0,1000);row.status='ok';Object.assign(row,desktop.evaluate(row.answer));}
      catch(error){row.status='error';row.error=scrub(error);Object.assign(row,desktop.evaluate(''));}
      finally{row.duration_ms=Math.round((performance.now()-started)*100)/100;row.toolCalls=desktop.calls.length;row.tools=desktop.calls;ai.cancel();ai.closeVoice();report.rows.push(row);save();onProgress({completed:report.rows.length,total:12,version,task:task.id,duration_ms:row.duration_ms,success:row.success,modelCalls:row.modelCalls,status:row.status});}
    }
  }
  report.status=fatal?'stopped':report.rows.some(row=>row.status==='error')?'completed_with_errors':'completed';if(fatal)report.error=fatal;report.finished_at=new Date().toISOString();save();
  return report;
}
module.exports={runBenchmark,fixture,summarize,tasks};
