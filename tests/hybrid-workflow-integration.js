'use strict';
// Explicit smoke-test hook: real Cua window focus is confined to disposable
// Electron windows owned by this process. No screenshots, user apps or APIs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AI}=require('../ai');
const {validateTool}=require('../core');
const rounded=value=>Math.round(value*100)/100;
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const identity=value=>value&&`${value.pid}:${value.window_id}`;
const title='Mitch Hybrid Focus Fixture';
const coverTitle='Mitch Hybrid Cover Fixture';

module.exports=async function({BrowserWindow,computer,dispatch,desktopActivity,directory,version}){
  const report={status:'running',version,at:new Date().toISOString(),scope:'Real AI local router and native Windows focus/restore against process-owned disposable Electron fixtures only. Three trials per mode. No cloud API, microphone, screenshots, user apps or general-task accuracy measurement.',rows:[],checks:[],actualModelRequests:0};
  const file=path.join(directory,'hybrid-workflow-integration.json'),windows=[],known=new Map(),calls=[],raw=[];
  const original=computer.client.call.bind(computer.client);
  let scope,ai,abortAfterList=false,modelRequests=0;
  const save=()=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2));};
  const context=()=>({activityScope:scope,assertActive:()=>desktopActivity.assertScope(scope)});
  const checkOwned=value=>assert.ok(known.has(identity(value)),'Native operations must target an exact process-owned fixture HWND.');
  const create=async name=>{
    const window=new BrowserWindow({title:name,width:480,height:320,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    windows.push(window);window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"><title>'+name+'</title></head><body><h1>'+name+'</h1><p>This window belongs to a Mitch integration test.</p><button>Owned fixture control</button></body></html>'));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    const handle=window.getNativeWindowHandle(),window_id=handle.length>=8?Number(handle.readBigUInt64LE(0)):handle.readUInt32LE(0);
    assert.ok(Number.isSafeInteger(window_id)&&window_id>0);
    const owner={pid:process.pid,window_id,title:name};known.set(identity(owner),{window,owner});
    window.show();return window;
  };
  const wrappedDispatch=async(name,args,toolContext)=>{
    validateTool(name,args);assert.ok(['computer_list_windows','computer_focus_window'].includes(name),'The focus-only fixture must not invoke another tool: '+name);
    const entry={name},started=performance.now();calls.push(entry);
    try{
      if(name==='computer_list_windows'){
        assert.equal(args.query,'');
        const listed=await dispatch(name,args,toolContext);
        assert.equal(listed.status,'ok');assert.equal(listed.degraded,false);assert.equal(listed.truncated,false);
        // Test discovery is deliberately scoped; no user titles reach the AI
        // fixture history or report. The production query is still real.
        const ownedRows=listed.windows.filter(row=>known.has(identity(row))&&row.pid===process.pid&&[title,coverTitle].includes(row.title));
        for(const row of ownedRows)assert.equal(known.get(identity(row)).owner.title,row.title);
        entry.windowCount=ownedRows.length;
        if(abortAfterList)ai.cancel();
        return {...listed,windows:ownedRows};
      }
      checkOwned(args);assert.equal(known.get(identity(args)).owner.title,title);
      const output=await dispatch(name,args,toolContext);
      entry.focusVerified=output?.focus_verified===true;entry.status=output?.status;
      return output;
    }finally{entry.ms=rounded(performance.now()-started);}
  };
  const run=async(mode,trial)=>{
    scope=desktopActivity.beginScope();
    const offset={raw:raw.length,calls:calls.length},started=performance.now();
    try{
      const answer=await ai.chat('switch to '+title,undefined,scope);
      assert.equal(answer,title+' is in front.');assert.equal(ai.lastTaskTiming.modelRequests,0);assert.equal(ai.lastTaskTiming.route,'local');
      const row={mode,trial,totalMs:rounded(performance.now()-started),answer,modelRequests:ai.lastTaskTiming.modelRequests,timing:ai.lastTaskTiming,tools:calls.slice(offset.calls),nativeCalls:raw.slice(offset.raw)};
      assert.deepEqual(row.tools.map(item=>item.name),['computer_list_windows','computer_focus_window']);
      assert.equal(row.nativeCalls.filter(item=>item.name==='bring_to_front').length,1);
      report.rows.push(row);save();return row;
    }finally{desktopActivity.endScope(scope);scope=null;}
  };
  try{
    const target=await create(title),cover=await create(coverTitle);
    ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),()=>{throw Error('Credentials forbidden in hybrid fixture');},wrappedDispatch,()=>{throw Error('Network forbidden in hybrid fixture');});
    ai.request=async()=>{modelRequests++;throw Error('Model fallback forbidden in hybrid fixture');};
    ai.reviewDesktop=async()=>{throw Error('Model review forbidden for an exactly verified focus request');};
    computer.client.call=async(name,args)=>{
      if(['get_window_state','bring_to_front'].includes(name))checkOwned(args);
      assert.ok(['start_session','list_windows','get_window_state','bring_to_front'].includes(name),'Unexpected native input: '+name);
      const started=performance.now();try{return await original(name,args);}finally{raw.push({name,ms:rounded(performance.now()-started)});}
    };
    for(let trial=1;trial<=3;trial++){
      // Alternate the modes; setup is deliberately outside measured task time.
      for(const mode of trial%2?['focus','restore-focus']:['restore-focus','focus']){
        target.restore();target.show();cover.show();cover.focus();
        if(mode==='restore-focus')target.minimize();
        await delay(60);
        if(mode==='restore-focus')assert.equal(target.isMinimized(),true);
        const row=await run(mode,trial);
        assert.equal(target.isMinimized(),false,'The target must no longer be minimized.');
        assert.equal(target.isFocused(),true,'Electron independently confirms the owned target has focus.');
        row.independentFixtureFocus=true;save();
      }
    }
    // Two owned windows with the same exact title must not be guessed between.
    const duplicate=await create(title),beforeAmbiguous=raw.length;
    scope=desktopActivity.beginScope();
    let answer;
    try{answer=await ai.chat('focus '+title,undefined,scope);}finally{desktopActivity.endScope(scope);scope=null;}
    assert.match(answer,/More than one/);assert.equal(raw.slice(beforeAmbiguous).some(item=>item.name==='bring_to_front'),false);assert.equal(ai.lastTaskTiming.modelRequests,0);
    report.checks.push({name:'ambiguous duplicate fixture titles',passed:true,focusCalls:0,modelRequests:0});
    for(const [key,item]of known)if(item.window===duplicate)known.delete(key);
    duplicate.destroy();
    // Stop after real discovery and before the first focus dispatch.
    abortAfterList=true;const beforeCancel=raw.length;scope=desktopActivity.beginScope();
    try{await assert.rejects(ai.chat('focus '+title,undefined,scope),/stopped|abort/i);}finally{desktopActivity.endScope(scope);scope=null;abortAfterList=false;}
    assert.equal(raw.slice(beforeCancel).some(item=>item.name==='bring_to_front'),false);assert.equal(ai.lastTaskTiming.modelRequests,0);
    report.checks.push({name:'cancellation after real window discovery',passed:true,focusCalls:0,modelRequests:0});
    assert.equal(modelRequests,0);
    report.summary={trialsPerMode:3,focusMedianMs:median(report.rows.filter(row=>row.mode==='focus').map(row=>row.totalMs)),restoreFocusMedianMs:median(report.rows.filter(row=>row.mode==='restore-focus').map(row=>row.totalMs)),actualModelRequests:0,successfulTrials:report.rows.length,physicalClicks:0,scope:'Real local task latency on owned fixtures, excluding fixture preparation and speech. No comparison with a measured cloud-planned baseline; no arbitrary-task accuracy claim.'};
    report.status='passed';
  }catch(error){report.status='failed';report.error=error.message;throw error;}
  finally{
    ai?.cancel();computer.client.call=original;if(scope)desktopActivity.endScope(scope);
    for(const window of windows)if(!window.isDestroyed())window.destroy();save();
  }
};
