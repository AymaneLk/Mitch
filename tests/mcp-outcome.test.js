'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {confirmedNotApplied,recoverDevice}=require('../mcp-errors');
test('provider receipts distinguish rejected, accepted and lost writes',async t=>{
 const {trackedFetch,runWithOutcome}=await import('../mcp-provider-outcome.mjs');
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 for(const [status,outcome] of [[404,'not_applied'],[403,'not_applied'],[500,'unknown'],[200,'partial']]){
  global.fetch=async()=>new Response('',{status});
  const r=await runWithOutcome(async()=>{await trackedFetch('https://example.invalid',{method:'PUT'});throw Error('operation failed');});
  assert.equal(r.structuredContent.mitchExecution.outcome,outcome);assert.equal(confirmedNotApplied('spotify',r),outcome==='not_applied');assert.equal(confirmedNotApplied('filesystem',r),false);
 }
 global.fetch=async()=>{throw Error('connection lost');};
 const lost=await runWithOutcome(async()=>{await trackedFetch('https://example.invalid',{method:'POST'});});assert.equal(lost.structuredContent.mitchExecution.outcome,'unknown');
 const preflight=await runWithOutcome(async()=>{throw Error('search failed before playback');});assert.equal(preflight.structuredContent.mitchExecution.outcome,'not_applied');
});
test('provider receipt state is isolated across concurrent requests',async t=>{
 const {trackedFetch,runWithOutcome}=await import('../mcp-provider-outcome.mjs');const original=global.fetch;t.after(()=>{global.fetch=original;});
 global.fetch=async()=>{await new Promise(r=>setImmediate(r));return new Response('',{status:200});};
 const [written,read]=await Promise.all([runWithOutcome(async()=>{await trackedFetch('https://example.invalid',{method:'POST'});throw Error('later failed');}),runWithOutcome(async()=>{throw Error('read failed');})]);
 assert.equal(written.structuredContent.mitchExecution.outcome,'partial');assert.equal(read.structuredContent.mitchExecution.outcome,'not_applied');
});
test('device recovery launches only an exact discovered app once, then uses read-only availability',async()=>{
 const calls=[];let checks=0;
 const r=await recoverDevice({call:async name=>{calls.push(name);checks++;return {content:[{type:'text',text:checks===1?'No devices found.':'Available devices:\n1. Desktop'}]};}},
 {dispatchChild:async(name,args)=>{require('../core').validateTool(name,args);calls.push(name);if(name==='list_apps')return {apps:[{name:'Spotify',app_id:'observed-id'}]};assert.equal(args.app_id,'observed-id');return {status:'opened'};}},{timeoutMs:100,pollMs:1});
 assert.equal(r.ready,true);assert.deepEqual(calls,['list_apps','open_app','devices','devices']);
});
test('cancelling device recovery never launches or retries playback',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(recoverDevice({call:()=>assert.fail()},{signal:c.signal,dispatchChild:()=>assert.fail()}));
});

test('playback acknowledgement requires the requested track and device, allowing relinking',async()=>{
 const {confirmPlayback}=await import('../mcp-provider-playback.mjs');
 const states=[null,{is_playing:true,item:{uri:'spotify:track:wrong'},device:{id:'target'}},{is_playing:true,item:{uri:'spotify:track:regional',linked_from:{uri:'spotify:track:requested'}},device:{id:'target'}}];let reads=0;
 const result=await confirmPlayback(async()=>states[reads++],{uri:'spotify:track:requested',deviceId:'target',delays:[0,0,0]});
 assert.equal(result.item.uri,'spotify:track:regional');assert.equal(reads,3);
 for(const state of [null,{is_playing:false,item:{uri:'spotify:track:requested'}},{is_playing:true,item:{uri:'spotify:track:requested'},device:{id:'other'}}]){
  await assert.rejects(confirmPlayback(async()=>state,{uri:'spotify:track:requested',deviceId:'target',delays:[0]}),e=>e.mitchReason==='playback_unconfirmed');
 }
});

test('context playback requires matching context; an accepted but unconfirmed play is never a rejected write',async t=>{
 const {confirmPlayback}=await import('../mcp-provider-playback.mjs'),{trackedFetch,runWithOutcome}=await import('../mcp-provider-outcome.mjs');
 const context={is_playing:true,context:{uri:'spotify:album:requested'}};
 assert.equal(await confirmPlayback(async()=>context,{uri:'spotify:album:requested',delays:[0]}),context);
 const original=global.fetch;t.after(()=>{global.fetch=original;});global.fetch=async()=>new Response(null,{status:204});
 const receipt=await runWithOutcome(async()=>{await trackedFetch('https://example.invalid',{method:'PUT'});await confirmPlayback(async()=>null,{uri:'spotify:track:requested',delays:[0,0]});});
 assert.equal(receipt.isError,true);assert.equal(receipt.structuredContent.mitchExecution.outcome,'partial');assert.equal(confirmedNotApplied('spotify',receipt),false);assert.equal(receipt.structuredContent.mitchExecution.reason,'playback_unconfirmed');
});

test('track playback uses its observed album and exact URI before any write, without a redundant lookup',async()=>{
 const {preparePlayback}=await import('../mcp-provider-playback.mjs');
 const uri='spotify:track:'+'a'.repeat(22),album='spotify:album:'+'b'.repeat(22);
 assert.deepEqual(await preparePlayback(uri,album,()=>assert.fail('Search already supplied the album')),{body:{context_uri:album,offset:{uri},position_ms:0},albumContext:true});
 const direct=await preparePlayback(uri,null,async id=>{assert.equal(id,'a'.repeat(22));return {album:{uri:album}};});assert.equal(direct.body.offset.uri,uri);
 assert.deepEqual(await preparePlayback(album,null,()=>assert.fail()),{body:{context_uri:album},albumContext:false});
 await assert.rejects(preparePlayback(uri,null,async()=>({})),/No playback request was sent/);
 await assert.rejects(preparePlayback('spotify:track:../../invalid',null,()=>assert.fail()),/valid Spotify/);
});
