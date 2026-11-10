'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const sites=require('../public-site-task'),{createSiteOperations}=require('../browser-extension/site-operations');
function fixture({beforeRead,permission=true,wrongRank=false,cancelAfterCreate=false}={}){
 const goal={site:'youtube',action:'play',query:'telescope',rank:2},selected='https://www.youtube.com/watch?v=second';let tab={id:5,windowId:2,url:'about:blank'},stored={},cancelled=false,time=0,reads=0;const inputs=[];
 const chrome={permissions:{contains:async()=>permission},storage:{session:{get:async()=>stored,set:async v=>{stored=v;}}},windows:{get:async id=>({id,type:'normal',focused:true,incognito:false}),update:async()=>{inputs.push('focus');}},tabs:{get:async()=>({...tab}),create:async p=>{inputs.push('create');tab={...tab,...p};if(cancelAfterCreate)cancelled=true;return {...tab};},update:async(id,p)=>{inputs.push('navigate');tab={...tab,...p};return {...tab};},sendMessage:async(id,m)=>{
   if(m.type==='mitch_site_open'){inputs.push('click');tab.url=selected;return {status:'issued'};}
   if(m.type==='mitch_site_play'){inputs.push('play');return {status:'observed'};}
   reads++;beforeRead?.({tab,reads});const watching=tab.url===selected;time+=.2;return {status:'observed',url:tab.url,documentId:'doc',ready:'interactive',query:watching?null:goal.query,results:[{url:'https://www.youtube.com/watch?v=first',title:'first'},{url:wrongRank&&reads>1?'https://www.youtube.com/watch?v=changed':selected,title:'second'}],media:watching?{videoId:'second',visible:true,paused:false,ended:false,ad:false,readyState:4,time,observedAt:1000+time*1000}:null};
 }},scripting:{executeScript:async()=>{}}};
 const operations=createSiteOperations(chrome,{sites});const args={goal,windowIds:[2]},context={id:'request-1',deadline:Date.now()+3000,isCancelled:()=>cancelled};return {operations,args,context,inputs,tab:()=>tab};
}
test('site operation executes search and ranked SPA navigation with advancing playback proof',async()=>{
 const f=fixture(),r=await f.operations.execute('site.task',f.args,f.context);assert.equal(r.status,'completed');assert.equal(sites.verify(f.args.goal,r),true);assert.deepEqual(f.inputs,['create','focus','click']);assert.ok(r.timing.verifiedMs>=0);
 const duplicate=await f.operations.execute('site.task',f.args,f.context);assert.equal(duplicate.reason,'duplicate_request');assert.equal(duplicate.action_attempted,false);assert.equal(f.inputs.length,3);
});
test('permission denial sends no browser input',async()=>{
 const f=fixture({permission:false}),r=await f.operations.execute('site.task',f.args,f.context);assert.equal(r.reason,'page_permission_required');assert.equal(r.action_attempted,false);assert.deepEqual(f.inputs,[]);
});
test('Stop during creation prevents focus and navigation afterward',async()=>{
 const f=fixture({cancelAfterCreate:true}),r=await f.operations.execute('site.task',f.args,f.context);assert.equal(r.reason,'cancelled');assert.equal(r.outcome_unknown,true);assert.deepEqual(f.inputs,['create']);
});
test('result reordering refuses to click any candidate',async()=>{
 const f=fixture({wrongRank:true}),r=await f.operations.execute('site.task',f.args,f.context);assert.equal(r.reason,'result_order_changed');assert.equal(r.outcome_unknown,true);assert.deepEqual(f.inputs,['create','focus']);
});
test('tab navigation outside the requested site stops the operation',async()=>{
 const f=fixture({beforeRead:({tab})=>tab.url='https://example.com/'}),r=await f.operations.execute('site.task',f.args,f.context);assert.equal(r.reason,'site_scope_changed');assert.equal(r.outcome_unknown,true);assert.deepEqual(f.inputs,['create','focus']);
});
test('expired command and stale preselected tab never send input',async()=>{
 const f=fixture();f.context.deadline=Date.now()-1;const r=await f.operations.execute('site.task',f.args,f.context);assert.equal(r.reason,'site_task_timeout');assert.deepEqual(f.inputs,[]);
 const g=fixture();g.args.expectedTab={id:5,windowId:2,url:'https://www.youtube.com/'};assert.equal((await g.operations.execute('site.task',g.args,g.context)).reason,'stale_target');assert.deepEqual(g.inputs,[]);
});
