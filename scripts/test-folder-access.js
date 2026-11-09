'use strict';
// Owned directory/Explorer fixture. --operator additionally reproduces the
// user's exact requested Desktop\Operator folder and deliberately leaves it
// open. No file content is read, no Cua input or model request is allowed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {FolderAccess}=require('../folder-access');
const {AI}=require('../ai');
const {validateTool}=require('../core');
const ROOT=path.resolve(__dirname,'..');
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function jsonProcess(args,payload,{signal,timeout=15000}={}){
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();const child=spawn(powershell,['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass',...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='',settled=false;
    const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill();done(signal.reason||Error('Stopped'));};
    const timer=setTimeout(()=>{child.kill();done(Error('Owned folder test helper timed out'));},timeout);
    signal?.addEventListener('abort',abort,{once:true});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',part=>{out+=part;if(out.length>1000000){child.kill();done(Error('Oversized folder reply'));}});child.stderr.on('data',part=>{err+=part;});child.on('error',error=>done(error));child.on('close',code=>{let value;try{value=JSON.parse(out.trim());}catch{return done(Error('Folder helper did not return JSON; code '+code+' '+err.slice(0,200)));}done(null,value);});child.stdin.end(JSON.stringify(payload));
  });
}
const closeOwnedScript=String.raw`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$root=[IO.Path]::GetFullPath([string]$r.root);$folder=[IO.Path]::GetFullPath([string]$r.path);if(![string]::Equals([IO.Path]::GetDirectoryName($folder),$root,[StringComparison]::OrdinalIgnoreCase)-or[IO.Path]::GetFileName($folder)-notmatch'^folder-fixture-[a-f0-9-]+$'){throw 'Not an owned fixture'};$shell=New-Object -ComObject Shell.Application;$closed=0;$rows=@();$complete=$true;$windows=$shell.Windows();if($null-eq$windows){$complete=$false};foreach($w in $windows){try{$application=[IO.Path]::GetFileName([string]$w.FullName);if(!$application){throw 'Unknown application'};if($application-ine'explorer.exe'){continue};$id=[long]$w.HWND;if($id-le0){throw 'Unknown HWND'};$actual=$null;$self=$w.Document.Folder.Self;if($null-eq$self){throw 'Unknown folder'};if($self.IsFileSystem-and$self.IsFolder){$actual=[IO.Path]::GetFullPath([string]$self.Path)};$rows+=@{id=$id;path=$actual;window=$w}}catch{$complete=$false}};if($complete){foreach($row in $rows){if($r.window_id-and$row.id-ne[long]$r.window_id){continue};if(![string]::Equals($row.path,$folder,[StringComparison]::OrdinalIgnoreCase)){continue};if(@($rows|Where-Object{$_.id-eq$row.id-and![string]::Equals($_.path,$folder,[StringComparison]::OrdinalIgnoreCase)}).Count){continue};$row.window.Quit();$closed++}};@{closed=$closed;inventory_complete=$complete}|ConvertTo-Json -Compress`;
const closeOwnedFixture=payload=>jsonProcess(['-EncodedCommand',Buffer.from(closeOwnedScript,'utf16le').toString('base64')],payload);
async function run({dispatch,context={},beginScope=()=>Symbol('folder-test'),endScope=()=>{},directory=path.join(ROOT,'test-output'),operator=false,helperFile=path.join(ROOT,'folder-helper.ps1'),helperPath,AIClass=AI,FolderAccessClass=FolderAccess}={}){
  helperFile=helperPath||helperFile;
  directory=path.resolve(directory);fs.mkdirSync(directory,{recursive:true});const fixturePath=path.join(directory,'folder-fixture-'+randomUUID()),file=path.join(directory,'folder-access-integration.json');fs.mkdirSync(fixturePath);
  const report={status:'running',version:require('../package.json').version,at:new Date().toISOString(),scope:'Actual Windows Shell folder discovery/open/focus with exact path and foreground verification. A disposable owned folder plus optional user-authorized Desktop Operator reproduction; no model, Cua, screenshots, typing or file contents.',rows:[],modelRequests:0,cuaCalls:0};let fixtureWindow;
  const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));
  const folders=new FolderAccessClass({helper:async(payload,ctx)=>{
    const output=await jsonProcess(['-File',helperFile],payload,ctx);
    // The backend intentionally removes unverified HWNDs from tool results.
    // Preserve this fixture's raw helper evidence for cleanup before assertions.
    if(payload.action==='open'&&payload.path===fixturePath){report.fixtureHelperReply=output;if(Number.isSafeInteger(output.window_id)&&output.window_id>0)fixtureWindow=output.window_id;}
    return output;
  }});
  const invoke=dispatch||((name,args,ctx)=>name==='folders_find'?folders.find(args,ctx):folders.open(args,ctx));
  const calls=[];
  const ai=new AIClass(()=>({chatProvider:'deepseek',chatModel:'test',allowDesktop:true,allowScreen:false,workflowEngine:true,fastWorkflowPlanning:true}),()=>{throw Error('No API key is needed');},async(name,args,ctx)=>{
    assert.ok(['folders_find','folders_open'].includes(name),'No non-folder desktop tool may execute: '+name);validateTool(name,args);
    const started=performance.now();let output;try{output=await invoke(name,args,{...context,...ctx});return output;}catch(error){output={status:'error',code:error.code,message:error.message};throw error;}finally{calls.push({name,args,output,ms:Math.round((performance.now()-started)*100)/100});}
  },()=>{throw Error('No network request is permitted');});
  ai.request=async()=>{report.modelRequests++;throw Error('Folder tasks must not call a model');};
  async function request(text,label,expectedPath,expectedStatus){
    const offset=calls.length,scope=beginScope(),started=performance.now();let answer;
    try{answer=await ai.chat(text,undefined,scope);}finally{endScope(scope);}
    const events=calls.slice(offset),opened=events.find(event=>event.name==='folders_open')?.output;
    if(opened?.path===fixturePath&&Number.isSafeInteger(opened.window_id)&&opened.window_id>0)fixtureWindow=opened.window_id;
    const row={label,ms:Math.round((performance.now()-started)*100)/100,route:ai.lastTaskTiming.route,modelRequests:ai.lastTaskTiming.modelRequests,toolCalls:events.map(event=>event.name),answer,events,...(opened?{status:opened.status,verified:opened.verified,path:opened.path,foreground_verified:opened.foreground_verified,window_id:opened.window_id}:{})};report.rows.push(row);save();
    assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(ai.lastTaskTiming.route,'folder');
    if(expectedPath){assert.equal(opened?.verified,true,JSON.stringify(row));assert.equal(opened?.foreground_verified,true);assert.equal(path.resolve(opened.path).toLowerCase(),path.resolve(expectedPath).toLowerCase());assert.equal(opened.status,expectedStatus);assert.deepEqual(row.toolCalls,['folders_find','folders_open']);assert.match(answer,/^Opened /);}
    else{assert.deepEqual(row.toolCalls,['folders_find']);assert.match(answer,/could not find/);}
    return row;
  }
  try{
    const first=await request(`open folder "${fixturePath}"`,'owned new folder',fixturePath,'opened');fixtureWindow=first.window_id;
    const second=await request(`open folder "${fixturePath}"`,'owned already-open folder',fixturePath,'focused_existing');assert.equal(second.window_id,fixtureWindow,'Existing exact folder window must be reused');
    await request(`open folder "${path.join(directory,'nonexistent-'+randomUUID())}"`,'missing directory stops without input');
    if(operator){
      const expected=String.raw`C:\Users\aymane\Desktop\Operator`,offset=calls.length,scope=beginScope(),started=performance.now();let answer;
      try{answer=await ai.chat('open Operator folder',undefined,scope);}finally{endScope(scope);}
      const events=calls.slice(offset),output=events.find(event=>event.name==='folders_open')?.output;
      report.rows.push({label:'user Operator folder',ms:Math.round((performance.now()-started)*100)/100,route:ai.lastTaskTiming.route,modelRequests:ai.lastTaskTiming.modelRequests,toolCalls:events.map(event=>event.name),answer,...output});save();
      assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(output?.verified,true);assert.equal(output.foreground_verified,true);assert.equal(output.path.toLowerCase(),expected.toLowerCase());assert.deepEqual(events.map(event=>event.name),['folders_find','folders_open']);
    }
    report.status='passed';report.summary={trials:report.rows.length,verifiedOpens:report.rows.filter(row=>row.verified).length,modelRequests:report.modelRequests,cuaCalls:0};return report;
  }catch(error){report.status='failed';report.error=error.message;throw error;}
  finally{
    ai.cancel();ai.closeVoice();
    // Even a failed first open may have created an Explorer window. If its
    // HWND was unavailable, find only this exact UUID fixture path; conflicting
    // tabs or incomplete inventory prevent closure of any user window.
    try{report.fixtureCleanup=await closeOwnedFixture({root:directory,path:fixturePath,window_id:fixtureWindow});}catch{report.fixtureCleanup={closed:0,error:'Owned fixture cleanup was not confirmed'};}
    // Only this exact empty owned directory may be removed. No recursive
    // deletion: unexpected files are left intact for inspection.
    if(path.dirname(fixturePath)===directory&&/^folder-fixture-[a-f0-9-]+$/.test(path.basename(fixturePath)))try{fs.rmdirSync(fixturePath);report.fixtureDirectoryRemoved=true;}catch{report.fixtureDirectoryRemoved=false;}
    report.finishedAt=new Date().toISOString();save();
  }
}
if(require.main===module)run({operator:process.argv.includes('--operator'),helperFile:process.argv.includes('--helper')?path.resolve(process.argv[process.argv.indexOf('--helper')+1]):undefined}).then(report=>console.log(JSON.stringify({status:report.status,rows:report.rows.map(row=>({label:row.label,ms:row.ms,status:row.status,verified:row.verified,route:row.route,modelRequests:row.modelRequests})),summary:report.summary,fixtureCleanup:report.fixtureCleanup}))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run,jsonProcess,closeOwnedFixture};
