'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {start,waitFor,delay,independent,consent,ROOT,OUT}=require('./real-browser-lab');
const {connect,app}=require('./chatgpt-benchmark-host');
const phase=process.argv.includes('--baseline')?'baseline':'optimized',source=phase==='baseline'?path.join(ROOT,'outputs/real-web-baseline-v24'):ROOT;
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||phase;if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid report label');
const suite=[
 {id:'youtube-second',site:'youtube',query:'NASA Artemis launch',rank:2,text:'Open YouTube, search for NASA Artemis launch, and play the second video.'},
 {id:'youtube-first',site:'youtube',query:'Blender beginner tutorial',rank:1,text:'Open YouTube, search for Blender beginner tutorial, and play the first video.'},
 {id:'youtube-third',site:'youtube',query:'piano tutorial beginner',rank:3,text:'Open YouTube, search for piano tutorial beginner, and play the third video.'},
 {id:'youtube-search',site:'youtube',query:'James Webb telescope',text:'Open YouTube and search for James Webb telescope.'},
 {id:'wikipedia-ada',site:'wikipedia',query:'Ada Lovelace',text:'Open Wikipedia and find the article Ada Lovelace.'},
 {id:'wikipedia-mouse',site:'wikipedia',query:'Computer mouse',text:'Open Wikipedia and find the article Computer mouse.'},
 {id:'github-playwright',site:'github',query:'microsoft playwright',rank:1,text:'Open GitHub, search repositories for microsoft playwright, and open the first repository.'},
 {id:'github-ufo',site:'github',query:'microsoft UFO',rank:1,text:'Open GitHub, search repositories for microsoft UFO, and open the first repository.'}
];
if(process.argv.includes('--extended'))suite.splice(0,suite.length,
 {id:'youtube-nature-second',site:'youtube',query:'wildlife documentary',rank:2,text:'Search YouTube for wildlife documentary then play the second video.'},
 {id:'youtube-space-third',site:'youtube',query:'International Space Station tour',rank:3,text:'Open YouTube and search for International Space Station tour and play the third video.'},
 {id:'youtube-origami-first',site:'youtube',query:'origami paper crane tutorial',rank:1,text:'Search YouTube for origami paper crane tutorial and play the first video.'},
 {id:'youtube-search-new',site:'youtube',query:'Roman aqueduct engineering',text:'Search YouTube for Roman aqueduct engineering.'},
 {id:'wikipedia-grace',site:'wikipedia',query:'Grace Hopper',text:'Open the Wikipedia article Grace Hopper.'},
 {id:'wikipedia-alan',site:'wikipedia',query:'Alan Turing',text:'Open the Wikipedia article Alan Turing.'},
 {id:'github-second',site:'github',query:'electron desktop',rank:2,text:'Search GitHub repositories for electron desktop and open the second repository.'},
 {id:'github-third',site:'github',query:'browser automation',rank:3,text:'Search GitHub repositories for browser automation and open the third repository.'}
);
if(process.argv.includes('--model-wording'))suite.splice(0,suite.length,
 {id:'model-youtube',site:'youtube',query:'Mars rover',text:'Please bring up YouTube results for Mars rover.'},
 {id:'model-wikipedia',site:'wikipedia',query:'Margaret Hamilton (software engineer)',text:'Could you take me to the Wikipedia page about Margaret Hamilton (software engineer)?'},
 {id:'model-github',site:'github',query:'speech recognition',rank:2,text:'On GitHub, look for repositories about speech recognition and take me to result number two.'}
);
const report={status:'running',phase,sourceVersion:require(path.join(source,'package.json')).version,at:new Date().toISOString(),method:'Real public YouTube, Wikipedia and GitHub pages in a separate logged-out Opera profile. Real account-selected GPT, production AI/dispatcher/workflow/Browser Bridge. Same browser-only scope in both versions; the optimized build additionally exposes its typed site adapter. No screenshots/native fallback. Full typed-request to reply/result timing; speech and Opera startup excluded. No existing user tabs/account actions. CDP only resets owned test tabs, handles cookie setup, records independent results and captures evidence. Eight tasks, six model requests/task and 48 total maximum; 90 seconds/task.',rows:[],modelRequests:0};
const reportPath=path.join(OUT,'real-web-'+label+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
let lab,host,active,ai;
async function states(){const out=[];for(const t of await lab.targets()){if(!/^https:\/\/(?:www\.youtube\.com|en\.wikipedia\.org|github\.com)\//.test(t.url))continue;try{out.push({targetId:t.targetId,...await lab.evaluate(t.targetId,independent)});}catch{}}return out;}
async function captureExpected(row){for(const page of lab.audit||[]){if(page.query===row.task.query&&page.links?.length>=row.task.rank)row.expected={...page.links[row.task.rank-1],rank:row.task.rank};}const s=await states();for(const page of s){if(row.task.site==='youtube'&&page.query===row.task.query&&page.videos.length>=row.task.rank)row.expected={...page.videos[row.task.rank-1],rank:row.task.rank};if(row.task.site==='github'&&new URL(page.url).pathname==='/search'&&new URL(page.url).searchParams.get('q')===row.task.query){const result=await lab.evaluate(page.targetId,`[...document.querySelectorAll('div.search-title a')].filter(e=>e.getClientRects().length&&/^https:\/\/github.com\/[^/]+\/[^/]+\/?$/.test(e.href)).map(e=>({title:e.textContent,href:e.href})).slice(0,10)`);if(result.length>=row.task.rank)row.expected={...result[row.task.rank-1],rank:row.task.rank};}}return s;}
async function runTask(task){
 await lab.reset('about:blank');
 const row={task,status:'running',modelRequests:0,modelMs:[],tools:[],verified:false,expected:null};report.rows.push(row);active=row;save();
 const {AI}=require(path.join(source,'ai')),{createDispatcher}=require(path.join(source,'core')),{prepareTaskContext}=require(path.join(source,'task-program-host')),{runGuardedTaskProgram}=require(path.join(source,'task-program-runner'));
 const b=lab.bridge,settings={...host.settings,chatProvider:'chatgpt',chatModel:host.auth.model(),allowDesktop:true,allowScreen:false,workflowEngine:true,reuseWorkflows:false,speculativePlanning:false,localGrounding:false};
 let dispatch;const handlers={browser_list_tabs:(a,c)=>b.list(a,c),browser_read_page:(a,c)=>b.observePage(a,c),browser_execute_plan:(a,c)=>b.executePagePlan(a,c),browser_follow_link:(a,c)=>b.followLink(a,c),browser_open_tab:(a,c)=>b.openTab(a,c),browser_close_tabs:(a,c)=>b.close(a,c),browser_activate_tab:(a,c)=>b.activate(a,c),computer_list_windows:async()=>({status:'ok',windows:[],degraded:false,truncated:false}),computer_run_workflow:(a,c)=>runGuardedTaskProgram({program:a,bindings:c.workflowBindings||{},dispatch:c.dispatchChild,context:c,replay:c.workflowReplay})};
 if(phase==='optimized'&&typeof b.runSiteTask==='function')handlers.browser_site_task=(a,c)=>b.runSiteTask(a,c);
 for(const [name,handler] of Object.entries(handlers))handlers[name]=async(a,c)=>{const start=performance.now();let result;try{return result=await handler(a,c);}finally{row.tools.push({name,ms:Math.round(performance.now()-start),args:a,status:result?.status,reason:result?.reason||result?.code,verified:result?.verified,outcome_unknown:result?.outcome_unknown,complete:result?.complete??result?.observation?.complete,controlCount:result?.controls?.length??result?.observation?.controls?.length,bytes:result?Buffer.byteLength(JSON.stringify(result)):0,siteTiming:result?.timing,sourceError:result?.sourceError,...(result?.message?{message:result.message.slice(0,300)}:{})});save();}};
 dispatch=createDispatcher(handlers);ai=new AI(()=>settings,()=>{throw Error('No key access');},dispatch,fetch,{request:(body,options)=>{
  if(row.modelRequests>=6||report.modelRequests>=48)throw Error('Bounded model request limit');row.modelRequests++;report.modelRequests++;const start=performance.now();return host.provider.request({...body,...(body.tools?{tools:body.tools.filter(t=>Object.hasOwn(handlers,t.name))}:{})},options).finally(()=>{row.modelMs.push(Math.round(performance.now()-start));save();});
 }});
 ai.prepareContext=(text,context)=>prepareTaskContext({text,dispatch:dispatch.readOnly,context});ai.onTaskTiming=t=>row.timing=t;
 const started=performance.now(),timer=setTimeout(()=>ai.controller?.abort(),90000);let pollBusy=false;
 const polling=setInterval(()=>{if(!pollBusy){pollBusy=true;captureExpected(row).catch(()=>{}).finally(()=>pollBusy=false);}},200);
 try{row.reply=await ai.chat(task.text,undefined,Symbol(task.id));row.replyMs=Math.round(performance.now()-started);row.status='returned';}
 catch(error){row.status='failed';row.error=error.code||error.message;}finally{clearTimeout(timer);clearInterval(polling);}
 let actual=await captureExpected(row),match;
 if(task.site==='youtube'){
  if(task.rank){const expectedId=row.expected?new URL(row.expected.href).searchParams.get('v'):null;match=actual.find(p=>new URL(p.url).pathname==='/watch'&&new URL(p.url).searchParams.get('v')===expectedId);if(match?.media&&!match.media.paused&&!match.media.ad){const before=match.media.currentTime;await delay(600);actual=await states();match=actual.find(p=>p.targetId===match.targetId);row.verified=!!match?.media&&!match.media.paused&&!match.media.ad&&match.media.currentTime>before+.15;}else row.verified=false;
  }else{match=actual.find(p=>p.query===task.query&&p.videos.length>0);row.verified=!!match;}
 }else if(task.site==='wikipedia'){match=actual.find(p=>new URL(p.url).hostname==='en.wikipedia.org'&&p.heading?.toLowerCase()===task.query.toLowerCase());row.verified=!!match;}
 else{match=actual.find(p=>row.expected&&p.url.replace(/[?#].*$/,'').replace(/\/$/,'')===row.expected.href.replace(/[?#].*$/,'').replace(/\/$/,''));row.verified=!!match;}
 row.totalMs=Math.round(performance.now()-started);row.actual=actual;row.confirmed=row.verified&&row.status==='returned'&&!/^I stopped|^An action was sent|^I couldn't|^I could not/.test(row.reply||'');
 const last=match||actual.at(-1);if(last)try{await lab.screenshot(last.targetId,path.join(OUT,`real-web-${label}-${task.id}.png`));row.screenshot=`real-web-${label}-${task.id}.png`;}catch{}
 row.independentRankSnapshots=lab.audit.filter(p=>p.query===task.query).slice(-4);
 console.log(JSON.stringify({phase,task:task.id,ms:row.totalMs,requests:row.modelRequests,verified:row.verified,confirmed:row.confirmed,error:row.error}));active=null;save();
}
connect().then(async value=>{host=value;report.model=host.auth.model();lab=await start({source});report.browser=lab.version;save();
 // Cookie setup is recorded separately and excluded for both versions.
 const setup=await lab.reset('https://www.youtube.com/');await waitFor(()=>lab.evaluate(setup,'location.hostname!==""&&document.readyState!=="loading"'),25000,'YouTube setup');await delay(1500);report.cookieSetup=await consent(lab,setup);await delay(800);
 for(const task of suite){await runTask(task);if(report.rows.at(-1).error?.includes('usage_limit'))break;}
 report.status='completed';
}).catch(error=>{report.status='failed';report.error=error.code||error.message;console.error(error.stack);}).finally(async()=>{await lab?.close();host?.close();save();console.log(JSON.stringify({status:report.status,phase,requests:report.modelRequests,verified:report.rows.filter(r=>r.verified).length,confirmed:report.rows.filter(r=>r.confirmed).length,tasks:report.rows.length,error:report.error}));app.exit(report.status==='completed'?0:1);});
