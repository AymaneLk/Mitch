'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseFolderWorkflow,runFolderWorkflow,verifyFolderCompletion}=require('../folder-workflows');
const folderPath=String.raw`C:\Users\aymane\Desktop\Operator`;
const discovery=(matches=[{folder_id:'directory-1',path:folderPath,name:'Operator'}],rest={})=>({status:'ok',complete:true,snapshot:'folders-snapshot',matches,...rest});
const opened=rest=>({status:'opened',verified:true,path:folderPath,foreground_verified:true,...rest});
function fixture({found=discovery(),result=opened()}={}){
  const calls=[];return {calls,dispatch:async(name,args,context)=>{calls.push({name,args,context});if(name==='folders_find')return found;if(name==='folders_open')return result;assert.fail('No app, model or Cua tool is permitted in this workflow: '+name);}};
}
test('explicit folder requests preserve names and local paths, not app routing',()=>{
  for(const text of ['open operator folder','Open the Operator folder.','please open folder Operator','Could you open the directory Operator?']){
    const parsed=parseFolderWorkflow(text);assert.equal(parsed.kind,'open_folder');assert.equal(parsed.query,/operator folder/.test(text)?'operator':'Operator');
  }
  for(const [text,query]of [['open the "Operator  Work" folder','Operator  Work'],['open folder “Project & notes”','Project & notes'],['open folder ".codex"','.codex'],['open the " Leading name" folder',' Leading name'],[String.raw`open folder "C:\Users\aymane\Desktop\Operator"`,folderPath],[String.raw`open C:\Users\aymane\Desktop\Operator`,folderPath],[String.raw`open "C:\Project and Notes"`,String.raw`C:\Project and Notes`]])assert.deepEqual(parseFolderWorkflow(text),{kind:'open_folder',query},text);
});
test('parser never silently drops compound tasks, shell syntax, URLs, or relative paths',()=>{
  for(const text of ['open Operator','open Notepad app','open operator folder and delete its contents','open folder Operator then click Delete','open the Operator folder and copy something','open folder Operator; Remove-Item x','open folder Operator && whoami','open folder https://example.com','open file://C:/Operator','open folder ..\\Operator','open folder C:Operator','open folder \\server\\share','open folder \\\\?\\C:\\Operator','open folder "Operator" and run it','open the file report.pdf','open folder report.pdf','open folder script.ps1','open folder "Operator\nOther"','open folder “Operator"','open folder ""'])assert.equal(parseFolderWorkflow(text),null,text);
  for(const text of [String.raw`open C:\Operator\..\Other`,String.raw`open C:\Operator\file:stream`,String.raw`open C:\Operator\.`])assert.equal(parseFolderWorkflow(text),null,text);
});
test('one exact folder opens through two authoritative calls and verifies path plus foreground',async()=>{
  const f=fixture(),result=await runFolderWorkflow({text:'open operator folder',dispatch:f.dispatch});
  assert.equal(result.handled,true);assert.equal(result.answer,`Opened ${folderPath}.`);assert.deepEqual(f.calls.map(({name,args})=>({name,args})),[{name:'folders_find',args:{query:'operator'}},{name:'folders_open',args:{snapshot:'folders-snapshot',folder_id:'directory-1'}}]);
  assert.equal(verifyFolderCompletion('open operator folder',result.events).decision,'complete');
});
test('already-open hidden folder may be focused only when exact path and foreground are confirmed',async()=>{
  const f=fixture({result:opened({status:'focused_existing',path:'c:/USERS/AYMANE/Desktop/Operator/'})}),result=await runFolderWorkflow({text:'open Operator folder',dispatch:f.dispatch});
  assert.match(result.answer,/^Opened /);assert.equal(f.calls.length,2);
});
test('different matching paths require clarification with no open or model fallback',async()=>{
  const f=fixture({found:discovery([{folder_id:'one',path:folderPath},{folder_id:'two',path:String.raw`D:\Projects\Operator`}])}),result=await runFolderWorkflow({text:'open operator folder',dispatch:f.dispatch});
  assert.equal(result.handled,true);assert.match(result.answer,/Which full path/);assert.ok(result.answer.includes(folderPath));assert.ok(result.answer.includes(String.raw`D:\Projects\Operator`));assert.equal(f.calls.length,1);
});
test('not found refers only to searched locations and stops before any input',async()=>{
  const f=fixture({found:discovery([])}),result=await runFolderWorkflow({text:'open operator folder',dispatch:f.dispatch});
  assert.equal(result.handled,true);assert.match(result.answer,/in the searched locations/);assert.equal(f.calls.length,1);assert.doesNotMatch(result.answer,/does not exist|anywhere/);
});
test('incomplete, duplicate, mismatching, or unsafe discovery cannot choose a folder',async()=>{
  const bad=[discovery(undefined,{complete:false}),discovery(undefined,{truncated:true}),discovery(undefined,{degraded:true}),discovery(undefined,{snapshot:''}),discovery(undefined,{outcome_unknown:true}),discovery([{folder_id:'same',path:folderPath},{folder_id:'same',path:String.raw`D:\Operator`}]),discovery([{folder_id:'one',path:folderPath},{folder_id:'two',path:folderPath.toLowerCase()}]),discovery([{folder_id:'one',path:String.raw`C:\Operator Backups`}]),discovery([{folder_id:'one',path:'https://example.com/Operator'}]),discovery([{folder_id:'one',path:String.raw`\\server\share\Operator`}])];
  for(const found of bad){const f=fixture({found}),result=await runFolderWorkflow({text:'open Operator folder',dispatch:f.dispatch});assert.equal(result.handled,true);assert.match(result.answer,/could not safely identify/);assert.equal(f.calls.length,1);}
  const f=fixture({found:discovery()}),result=await runFolderWorkflow({text:String.raw`open folder C:\Somewhere\Operator`,dispatch:f.dispatch});assert.equal(f.calls.length,1);assert.match(result.answer,/could not safely identify/);
});
test('unverified or uncertain open is never called successful and never retried',async()=>{
  for(const result of [opened({verified:false}),opened({foreground_verified:false}),opened({path:String.raw`D:\Operator`}),opened({outcome_unknown:true}),opened({status:'error'}),opened({folder_id:'different'}),opened({status:'launch_requested'}),opened({requires_review:true})]){
    const f=fixture({result}),value=await runFolderWorkflow({text:'open Operator folder',dispatch:f.dispatch});assert.equal(value.handled,true);assert.doesNotMatch(value.answer,/^Opened /);assert.match(value.answer,/did not repeat/);assert.equal(f.calls.length,2);assert.equal(verifyFolderCompletion('open Operator folder',value.events),null);
  }
});
test('exceptions cannot fall through to visual clicking or repeat an open',async()=>{
  const calls=[];const result=await runFolderWorkflow({text:'open Operator folder',dispatch:async name=>{calls.push(name);if(name==='folders_find')return discovery();throw Error('Shell reply lost');}});
  assert.equal(result.handled,true);assert.match(result.answer,/did not repeat/);assert.equal(result.events.at(-1).output.outcome_unknown,true);assert.deepEqual(calls,['folders_find','folders_open']);
  const unavailable=await runFolderWorkflow({text:'open Operator folder',dispatch:async()=>{throw Error('Discovery unavailable');}});assert.equal(unavailable.handled,true);assert.equal(unavailable.events.length,1);
});
test('cancellation before and after discovery prevents the open',async()=>{
  let calls=0;const controller=new AbortController();controller.abort(Error('Stopped'));
  await assert.rejects(runFolderWorkflow({text:'open Operator folder',context:{signal:controller.signal},dispatch:async()=>{calls++;}}),/Stopped/);assert.equal(calls,0);
  const next=new AbortController();await assert.rejects(runFolderWorkflow({text:'open Operator folder',context:{signal:next.signal},dispatch:async()=>{calls++;next.abort(Error('Stopped after read'));return discovery();}}),/Stopped after read/);assert.equal(calls,1);
});
test('completion requires the exact discovery/open pair and snapshot without later mutations',async()=>{
  const f=fixture(),result=await runFolderWorkflow({text:'open Operator folder',dispatch:f.dispatch}),events=result.events;
  for(const changed of [[...events,{name:'computer_input',args:{},output:{}}],[events[0],{...events[1],args:{...events[1].args,snapshot:'another'}}],[{...events[0],args:{query:'Other'}},events[1]],[events[0],{...events[1],args:{...events[1].args,folder_id:'other'}}]])assert.equal(verifyFolderCompletion('open Operator folder',changed),null);
});
