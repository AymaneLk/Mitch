'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const sites=require('../public-site-task'),{AI}=require('../ai'),{validateTool}=require('../core'),{DesktopEvidence}=require('../desktop-evidence'),{PlanTaskGuard}=require('../plan-task-guard');
const goal={site:'youtube',action:'play',query:'NASA Artemis launch',rank:2};
function receipt(){const url='https://www.youtube.com/watch?v=second';return {status:'completed',verified:true,action_attempted:true,goal:{...goal},tab_id:1,window_id:1,selection:{query:goal.query,rank:2,title:'Second video',url,results:[{url:'https://www.youtube.com/watch?v=first'},{url}]},playbackBefore:{videoId:'second',time:1,observedAt:1000,ad:false},observation:{url,media:{videoId:'second',time:1.4,observedAt:1400,paused:false,ended:false,ad:false,readyState:4}}};}
test('whole requests bind arbitrary query, ordinal and browser without dropping extra actions',()=>{
 assert.deepEqual(sites.parse('Open YouTube, search for NASA Artemis launch, and play the second video.'),goal);
 assert.deepEqual(sites.parse('Please search YouTube for "cats & dogs" then play the 3rd result in Opera GX.'),{...goal,query:'cats & dogs',rank:3,browser:'opera'});
 assert.deepEqual(sites.parse('Open the Wikipedia article Alan Turing'),{site:'wikipedia',action:'open',query:'Alan Turing'});
 for(const text of ['Search YouTube for cats then download the video','Search YouTube for cats and then close Gmail','Open Wikipedia and find the article Ada Lovelace and summarize it','Open YouTube and search for cats, then play all videos','Search YouTube for cats\nclose Opera'])assert.equal(sites.parse(text),null,text);
});
test('site schemas restrict scope, parameters and result rank',()=>{
 validateTool('browser_site_task',{snapshot:'fresh',...goal});
 for(const value of [{...goal,rank:0},{...goal,rank:11},{...goal,query:42},{...goal,query:' x'},{...goal,query:'x\ny'},{...goal,site:'evil.invalid'},{...goal,script:'click()'},{...goal,action:'delete'},{...goal,browser:'all'}])assert.throws(()=>sites.validate(value));
 for(const url of ['http://www.youtube.com/watch?v=x','https://www.youtube.com.evil.invalid/','https://a@www.youtube.com/','https://www.youtube.com:444/'])assert.equal(sites.permittedURL('youtube',url),false);
 assert.equal(new URL(sites.searchURL({...goal,query:'a & b?#'})).searchParams.get('search_query'),'a & b?#');
});
test('natural supported wording remains whole-request bounded with parameterized queries',()=>{
 assert.deepEqual(sites.parse('Please show me YouTube search results for deep ocean exploration.'),{site:'youtube',action:'search',query:'deep ocean exploration'});
 assert.deepEqual(sites.parse('Could you take me to the Wikipedia page about Katherine Johnson?'),{site:'wikipedia',action:'open',query:'Katherine Johnson'});
 assert.deepEqual(sites.parse('On GitHub, search for repositories about local databases and open result number three.'),{site:'github',action:'open',query:'local databases',rank:3});
 for(const text of ['Please show me YouTube results for rockets and download one','Take me to the Wikipedia article about Alan Turing and summarize it','On GitHub, look for repositories about tools and take me to result number two then delete it'])assert.equal(sites.parse(text),null);
});
test('ranked playback proof rejects wrong order, wrong video, ads, paused and stationary media',()=>{
 assert.equal(sites.verify(goal,receipt()),true);
 const edits=[r=>r.selection.rank=1,r=>r.selection.results.reverse(),r=>r.observation.url='https://www.youtube.com/watch?v=other',r=>r.observation.media.videoId='other',r=>r.observation.media.paused=true,r=>r.observation.media.ad=true,r=>r.playbackBefore.ad=true,r=>r.observation.media.time=1,r=>r.observation.media.observedAt=1001,r=>r.observation.media.readyState=1,r=>r.outcome_unknown=true,r=>r.verified=false,r=>r.goal.query='other'];
 for(const edit of edits){const r=receipt();edit(r);assert.equal(sites.verify(goal,r),false);}
});
test('Wikipedia requires the requested loaded article heading and path',()=>{
 const g={site:'wikipedia',action:'open',query:'Ada Lovelace'},r={status:'completed',verified:true,goal:g,observation:{url:'https://en.wikipedia.org/wiki/Ada_Lovelace',heading:'Ada Lovelace'}};
 assert.equal(sites.verify(g,r),true);r.observation.heading='Search results';assert.equal(sites.verify(g,r),false);r.observation.heading=g.query;r.observation.url='https://en.wikipedia.org/w/index.php';assert.equal(sites.verify(g,r),false);
});
test('GitHub repository URL alone cannot prove a repository loaded',()=>{
 const g={site:'github',action:'open',query:'testing tools',rank:1},url='https://github.com/microsoft/playwright',r={status:'completed',verified:true,goal:g,selection:{query:g.query,rank:1,url,results:[{url}]},observation:{url}};
 assert.equal(sites.verify(g,r),false);r.observation.repository='microsoft/playwright';assert.equal(sites.verify(g,r),true);r.observation.repository='other/project';assert.equal(sites.verify(g,r),false);
});
test('recognized public website task completes through real AI dispatch with zero model calls',async()=>{
 const calls=[];let timing;const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>assert.fail('key'),async(name,args)=>{calls.push(name);validateTool(name,args);return name==='browser_list_tabs'?{status:'ok',complete:true,snapshot:'fresh'}:receipt();},()=>assert.fail('network'));
 ai.onTaskTiming=t=>timing=t;assert.match(await ai.chat('Open YouTube, search for NASA Artemis launch, and play the second video.'),/Playing video 2/);assert.deepEqual(calls,['browser_list_tabs','browser_site_task']);assert.equal(timing.modelRequests,0);
 const evidence=new DesktopEvidence();evidence.record('browser_site_task',receipt());assert.equal(evidence.needsObservation,false);
});
test('uncertain public action stops all further input, including other routes',async()=>{
 let n=0;const result=await sites.run({text:'Open YouTube and search for cats',dispatch:async name=>{n++;return name==='browser_list_tabs'?{status:'ok',complete:true,snapshot:'s'}:{status:'interrupted',outcome_unknown:true};}});assert.equal(result.handled,true);assert.equal(n,2);
 const guard=new PlanTaskGuard(),context={activityScope:'task'};await guard.run('browser_site_task',context,async()=>({outcome_unknown:true}));assert.equal((await guard.run('computer_input',context,()=>assert.fail('no replay'))).input_suppressed,true);
});
test('missing adapter refuses before input and allows normal planning',async()=>{
 const r=await sites.run({text:'Open YouTube and search for cats',dispatch:async name=>name==='browser_list_tabs'?{status:'ok',complete:true,snapshot:'s'}:{status:'refused',action_attempted:false}});assert.equal(r.handled,false);assert.equal(r.events.length,2);
});
