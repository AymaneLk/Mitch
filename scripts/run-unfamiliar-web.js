'use strict';
const fs=require('node:fs'),path=require('node:path'),{connect,app}=require('./chatgpt-benchmark-host'),{start,waitFor,ROOT,OUT}=require('./real-browser-lab'),{startFixtures}=require('./engine-fixtures'),{Resources}=require('./benchmark-resources');
const source=process.env.MITCH_BENCHMARK_SOURCE||ROOT,label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'optimized';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid benchmark label');
const api={AI:require(path.join(source,'ai')).AI,dispatch:require(path.join(source,'core')).createDispatcher,prepare:require(path.join(source,'task-program-host')).prepareTaskContext,run:require(path.join(source,'task-program-runner')).runGuardedTaskProgram,Guard:require(path.join(source,'plan-task-guard')).PlanTaskGuard};
const report={status:'running',version:require(path.join(source,'package.json')).version,label,method:'Cold general structured browser tasks on previously unhandled layouts. Real selected model and production extension in an owned Opera profile. No site adapters, cache, screenshots or speculative planning. Eight requests/task, forty total, 75-second timeout. Typed request to final reply; setup/speech excluded. CDP is setup and independent readback only.',rows:[],requests:0};
const out=path.join(OUT,'unfamiliar-web-'+label+'.json'),save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)),resources=new Resources();let host,lab,fixtures;
const tasks=[
 {id:'repeated',text:'Edit the record Iris using its Edit button, set Title to "Iris revised", and click Save changes. Leave Harbor and Wren unchanged. Verify Save status says "Saved Iris revised".'},
 {id:'large',text:'Set Public label to "Large interface test", click Apply changes and verify Save status says "Saved Large interface test". Do not click any Browse category buttons.'},
 {id:'shadow',text:'In Embedded settings, set Public label to "Shadow interface test", click Apply changes and verify Save status says "Saved Shadow interface test".'},
 {id:'iframe',text:'In the Embedded editor frame, set Reference to "Embedded interface test" and click Apply changes. Verify the outer page Save status says "Saved Embedded interface test".'},
 {id:'popup',text:'Open Edit settings, set Public label to "Adaptive interface test", click Apply changes and verify Save status says "Saved Adaptive interface test".'}
];
connect().then(async h=>{
 host=h;report.model=host.auth.model();await resources.start();fixtures=await startFixtures();lab=await start({source});report.browserVersion=lab.version;
 for(const task of tasks){
  if(process.env.MITCH_BENCH_TASKS&&!process.env.MITCH_BENCH_TASKS.split(',').includes(task.id))continue;
  const id=await lab.reset(fixtures.base+'/'+task.id);await waitFor(()=>lab.evaluate(id,'document.readyState==="complete"&&!!window.fixture'),15000,'Owned fixture ready');
  report.webMCP=await lab.evaluate(id,'({available:typeof navigator.modelContext!=="undefined",testing:typeof navigator.modelContextTesting!=="undefined"})');
  const row={task:task.id,requests:0,model:[],tools:[],verified:false,screenshots:0},guard=new api.Guard(),scope=Symbol(task.id);report.rows.push(row);
  const handlers={browser_list_tabs:(a,c)=>lab.bridge.list(a,c),browser_read_page:(a,c)=>lab.bridge.observePage(a,c),browser_execute_plan:(a,c)=>lab.bridge.executePagePlan(a,c),browser_follow_link:(a,c)=>lab.bridge.followLink(a,c),computer_list_windows:async()=>({status:'ok',windows:[],degraded:false,truncated:false}),computer_run_workflow:(a,c)=>api.run({program:a,dispatch:c.dispatchChild,context:c})};
  for(const [name,handler]of Object.entries(handlers))handlers[name]=async(a,c)=>{const at=performance.now();let result;try{return result=await guard.run(name,c,()=>handler(a,c));}finally{row.tools.push({name,args:a,result,ms:Math.round(performance.now()-at)});save();}};
  const dispatch=api.dispatch(handlers),settings={...host.settings,chatProvider:'chatgpt',chatModel:host.auth.model(),allowDesktop:true,allowScreen:false,workflowEngine:true,reuseWorkflows:false,speculativePlanning:false,parallelGoalVerification:true,localGrounding:false};
  const ai=new api.AI(()=>settings,()=>{throw Error('No API key access');},dispatch,fetch,{request:async(body,options)=>{if(row.requests>=8||report.requests>=40)throw Error('Benchmark request cap');row.requests++;report.requests++;const entry={kind:body.response_format?.json_schema?.name||'planner',inputBytes:JSON.stringify(body).length};row.model.push(entry);const at=performance.now();try{return await host.provider.request({...body,...(body.tools?{tools:body.tools.filter(t=>Object.hasOwn(handlers,t.name))}:{})},options);}finally{entry.ms=Math.round(performance.now()-at);save();}}});
  ai.prepareContext=(text,context)=>api.prepare({text,dispatch:dispatch.readOnly,context});ai.onTaskTiming=t=>row.timing=t;
  row.text='In 127.0.0.1, '+task.text;const resourceStart=resources.begin(),at=performance.now(),timer=setTimeout(()=>ai.controller?.abort(),75000);
  try{row.reply=await ai.chat(row.text,undefined,scope);row.status='returned';}catch(e){row.status='failed';row.error=e.code||e.message;}finally{clearTimeout(timer);row.totalMs=Math.round(performance.now()-at);row.resources=await resources.end(resourceStart);}
  row.actual=await lab.evaluate(id,'JSON.parse(JSON.stringify(window.fixture))');const a=row.actual;
  row.verified=task.id==='repeated'?a.saved?.record==='Iris'&&a.records.Iris==='Iris revised'&&a.records.Harbor==='Harbor'&&a.records.Wren==='Wren'&&JSON.stringify(a.actions)==='["edit:Iris","save:Iris"]':a.saved===({large:'Large interface test',shadow:'Shadow interface test',iframe:'Embedded interface test',popup:'Adaptive interface test'})[task.id]&&JSON.stringify(a.actions)===JSON.stringify(task.id==='popup'?['open','continue','apply']:task.id==='iframe'?['frame-saved']:['apply']);
  row.confirmed=row.verified&&row.status==='returned'&&!/^(I stopped|An action was sent|I couldn't|I could not)/.test(row.reply||'');save();console.log(JSON.stringify({task:task.id,ms:row.totalMs,requests:row.requests,verified:row.verified,confirmed:row.confirmed,error:row.error}));
 }
 report.status='completed';
}).catch(e=>{report.status='failed';report.error=e.code||e.message;console.error(e.stack);}).finally(async()=>{await lab?.close();await fixtures?.close();await resources.stop();host?.close();save();app.exit(report.status==='completed'?0:1);});
