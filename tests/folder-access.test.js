'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {FolderAccess,folderQuery,localDirectoryPath}=require('../folder-access');
const folder='C:\\Users\\Demo\\Desktop\\Operator';
const discovery=(matches=[{path:folder,name:'Operator',open_windows:[]}],extra={})=>({status:'ok',complete:true,search_scope:'Direct known-location children.',matches,...extra});
const opened=(extra={})=>({status:'opened',verified:true,path:folder,window_id:77,foreground_verified:true,action_attempted:true,...extra});
function harness(outputs){const calls=[];let now=1000;const access=new FolderAccess({now:()=>now,helper:async(payload,context)=>{calls.push({payload,context});const next=outputs.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(payload,context):next;}});return {access,calls,advance:ms=>{now+=ms;}};}
test('exact named folder gets opaque IDs then opens the observed local path with Windows verification',async()=>{
  const h=harness([discovery(),opened()]),ctx={activityScope:Symbol('request')};
  const found=await h.access.find({query:'operator'},ctx);assert.equal(found.complete,true);assert.equal(found.matches[0].path,folder);
  assert.notEqual(found.snapshot,folder);assert.notEqual(found.matches[0].folder_id,folder);
  const result=await h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},ctx);
  assert.equal(result.verified,true);assert.equal(result.foreground_verified,true);assert.equal(result.path,folder);
  assert.deepEqual(h.calls.map(row=>row.payload),[{action:'discover',query:'operator'},{action:'open',path:folder}]);
});
test('ambiguous folder paths are kept distinct and selected only by their observed ID',async()=>{
  const second='C:\\Users\\Demo\\Documents\\Operator',h=harness([discovery([{path:folder,name:'Operator',open_windows:[12]},{path:second,name:'Operator',open_windows:[14]}]),opened({status:'focused_existing',path:second})]);
  const found=await h.access.find({query:'Operator'});assert.equal(found.matches.length,2);
  const result=await h.access.open({snapshot:found.snapshot,folder_id:found.matches[1].folder_id});assert.equal(result.path,second);assert.equal(result.status,'focused_existing');
});
test('URLs, shell namespace strings, device paths, relative paths and control characters never reach helper',async()=>{
  const h=harness([]);
  for(const query of ['https://example.test','shell:Downloads','\\\\server\\share','\\\\?\\C:\\Folder','..\\Folder','C:Folder','Folder\nRun','C:\\Folder:stream','C:\\Folder.','C:\\Folder?'])await assert.rejects(h.access.find({query}));
  assert.equal(h.calls.length,0);assert.equal(folderQuery('Project & notes'),'Project & notes');assert.equal(localDirectoryPath('C:/Users/Demo/Desktop/Operator'),folder);
});
test('expired IDs and arbitrary paths cannot be used as folder IDs',async()=>{
  const h=harness([discovery()]),found=await h.access.find({query:'Operator'});
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:folder}),error=>error.code==='folder_stale_snapshot');
  h.advance(30001);await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id}),error=>error.code==='folder_stale_snapshot');assert.equal(h.calls.length,1);
});
test('incomplete directory discovery cannot authorize an automatic open',async()=>{
  const h=harness([discovery(undefined,{complete:false,truncated:true})]),found=await h.access.find({query:'Operator'});
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id}),error=>error.code==='folder_incomplete_discovery');assert.equal(h.calls.length,1);
});
test('unknown helper delivery is not replayed after a new discovery in the same task',async()=>{
  const h=harness([discovery(),Error('Lost reply'),discovery()]),ctx={activityScope:Symbol('request')};
  let found=await h.access.find({query:'Operator'},ctx);
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},ctx),error=>error.outcome_unknown===true&&error.action_attempted===true);
  found=await h.access.find({query:'Operator'},ctx);
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},ctx),error=>error.code==='folder_outcome_unknown');assert.equal(h.calls.length,3);
});
test('verified path with unverified foreground is never reported as success',async()=>{
  const h=harness([discovery(),opened({foreground_verified:false})]),found=await h.access.find({query:'Operator'});
  const result=await h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id});assert.equal(result.verified,false);assert.equal(result.status,'unverified');
});
test('a different returned folder cannot prove the requested folder opened',async()=>{
  const h=harness([discovery(),opened({path:'C:\\Other'})]),found=await h.access.find({query:'Operator'});
  const result=await h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id});assert.equal(result.verified,false);assert.equal(result.status,'unverified');
});
test('deleted directory refusal records no delivery and never becomes success',async()=>{
  const h=harness([discovery(),{status:'refused',verified:false,action_attempted:false,code:'folder_missing'}]),found=await h.access.find({query:'Operator'});
  const result=await h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id});assert.equal(result.refused,true);assert.equal(result.action_attempted,false);assert.equal(result.code,'folder_missing');
});
test('cancellation before discovery or open performs no extra helper call',async()=>{
  const controller=new AbortController(),h=harness([discovery()]),found=await h.access.find({query:'Operator'});controller.abort(Error('Stopped'));
  await assert.rejects(h.access.find({query:'Operator'},{signal:controller.signal}),/Stopped/);
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},{signal:controller.signal}),/Stopped/);assert.equal(h.calls.length,1);
});
test('cancellation after a possible helper action becomes unknown and prevents another open',async()=>{
  const controller=new AbortController(),ctx={signal:controller.signal,activityScope:Symbol('request')},h=harness([discovery(),()=>{controller.abort();return opened();}]),found=await h.access.find({query:'Operator'},ctx);
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},ctx),error=>error.outcome_unknown===true);
});
test('inconsistent, duplicate and unrelated discovery candidates are rejected',async()=>{
  for(const data of [discovery(undefined,{truncated:true}),discovery([{path:folder,name:'Operator',open_windows:[]},{path:folder.toUpperCase(),name:'OPERATOR',open_windows:[]}]),discovery([{path:'C:\\Another',name:'Another',open_windows:[]}]),discovery([{path:folder,name:'Wrong label',open_windows:[]}])]){
    const h=harness([data]);await assert.rejects(h.access.find({query:'Operator'}),error=>error.code==='folder_invalid_result');
  }
});
test('same task cannot reopen the same successful folder using new IDs',async()=>{
  const h=harness([discovery(),opened(),discovery()]),ctx={activityScope:Symbol('request')};let found=await h.access.find({query:'Operator'},ctx);
  await h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},ctx);found=await h.access.find({query:'Operator'},ctx);
  await assert.rejects(h.access.open({snapshot:found.snapshot,folder_id:found.matches[0].folder_id},ctx),error=>error.code==='folder_replay_blocked');assert.equal(h.calls.length,3);
});
test('literal leading and internal folder-name spaces survive backend discovery',async()=>{
  const target='C:\\Users\\Demo\\Desktop\\ Leading  name',h=harness([discovery([{path:target,name:' Leading  name',open_windows:[]}])]);
  const found=await h.access.find({query:' Leading  name'});assert.equal(h.calls[0].payload.query,' Leading  name');assert.equal(found.matches[0].path,target);
});
