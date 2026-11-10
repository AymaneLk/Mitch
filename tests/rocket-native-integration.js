'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AI}=require('../ai');
const identity=window=>window&&`${window.pid}:${window.window_id}`;

module.exports=async function({BrowserWindow,computer,dispatch,desktopActivity,directory,version}){
  const report={status:'running',version,at:new Date().toISOString(),scope:'Owned HTML Calculator/Notepad fixtures with real native Cua inputs, production local workflow and recovery. Empty Chromium editor readback must fall back safely; a seeded fixture exercises explicitly authorized replacement and exact native readback. No model API requests, microphone, user apps or saved documents.',checks:[]};
  const fixtures=[],knownWindows=new Map(),catalog=[{name:'Calculator',app_id:'rocket-fixture-calculator'},{name:'Notepad',app_id:'rocket-fixture-notepad'}];
  const native=computer.client.call.bind(computer.client);let clicks=0,writes=0,modelRequests=0;
  const calls=[];let activeScope;
  const save=()=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'rocket-native-integration.json'),JSON.stringify(report,null,2));};
  const checkFixture=window=>{assert.ok(knownWindows.has(identity(window)),'The test must never target another application.');};
  const wrappedDispatch=async(name,args,context)=>{
    const started=performance.now(),entry={name,args};calls.push(entry);
    try{
      if(name==='list_apps'){
        const query=String(args.query||'').toLowerCase();
        return entry.output={status:'ok',apps:catalog.filter(app=>app.name.toLowerCase()===query)};
      }
      if(name==='open_app'){
        const app=catalog.find(item=>item.app_id===args.app_id);assert.ok(app,'Unknown fixture app');
        const fixture=fixtures.find(item=>item.name===app.name);assert.ok(fixture&&!fixture.window.isDestroyed());
        const listed=await dispatch('computer_list_windows',{query:app.name},context);
        assert.equal(listed.degraded,false);assert.equal(listed.truncated,false);
        const matches=listed.windows.filter(window=>window.pid===process.pid&&window.title===app.name);
        assert.equal(matches.length,1,'Expected one owned fixture window');
        const window=matches[0];knownWindows.set(identity(window),fixture);fixture.identity=window;
        const observation=await computer.focus(window,context);assert.equal(observation.focus_verified,true);
        return entry.output={status:'focused_existing',app:app.name,observation};
      }
      assert.ok(['computer_action','computer_action_sequence'].includes(name),'Unexpected tool: '+name);
      const snapshot=computer.snapshots.get(args.snapshot);assert.ok(snapshot,'Input must use a fresh fixture snapshot');checkFixture(snapshot.window);
      return entry.output=await dispatch(name,args,context);
    }finally{entry.durationMs=Math.round(performance.now()-started);}
  };
  const ai=new AI(()=>({chatProvider:'chatgpt',allowDesktop:true,allowScreen:false}),async()=>{throw Error('Credential access forbidden in native fixture');},wrappedDispatch,async()=>{throw Error('Network forbidden in native fixture');},async()=>{throw Error('Credential access forbidden in native fixture');});
  ai.request=async()=>{modelRequests++;throw Error('Model fallback reached; network is disabled for this fixture.');};
  const run=async(text,{fallback=false}={})=>{
    const before={clicks,writes,modelRequests,toolCalls:calls.length},started=performance.now();
    activeScope=desktopActivity.beginScope();let answer,error;
    try{if(fallback)await assert.rejects(ai.chat(text,undefined,activeScope),/Model fallback reached/);else answer=await ai.chat(text,undefined,activeScope);}
    catch(caught){error=caught.message;throw caught;}
    finally{
      desktopActivity.endScope(activeScope);activeScope=null;
      report.checks.push({request:text,answer,error,fallbackExpected:fallback,durationMs:Math.round(performance.now()-started),physicalClicks:clicks-before.clicks,textReplacements:writes-before.writes,modelFallbackRequests:modelRequests-before.modelRequests,toolCalls:calls.length-before.toolCalls,timing:ai.lastTaskTiming,events:calls.slice(before.toolCalls)});save();
    }
    return report.checks.at(-1);
  };
  try{
    for(const name of ['Calculator','Notepad']){
      const window=new BrowserWindow({title:name,width:620,height:650,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      fixtures.push({name,window});window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',event=>event.preventDefault());
      await window.loadFile(path.join(__dirname,'rocket-native-fixture.html'),{query:{mode:name.toLowerCase()}});
      window.show();window.focus();await window.webContents.executeJavaScript('document.fonts.ready');
    }
    computer.client.call=async(name,args)=>{
      if(name==='bring_to_front')checkFixture(args);
      if(['click','set_value','press_key','scroll','double_click','right_click','type_text','drag'].includes(name)){
        checkFixture(args.target||args);
        assert.ok(['click','set_value'].includes(name),'The fixture requires only observed button/text controls.');
        if(name==='click')clicks++;else writes++;
      }
      return native(name,args);
    };
    const calculator=fixtures.find(item=>item.name==='Calculator'),notepad=fixtures.find(item=>item.name==='Notepad');
    const calc=await run('open calculator and do this calculation 1.5 x 188 and give me the result');
    assert.equal(calc.modelFallbackRequests,0);assert.equal(calc.timing.route,'local');assert.match(calc.answer,/282/);assert.equal(calc.physicalClicks,9);
    assert.deepEqual(await calculator.window.webContents.executeJavaScript('window.fixtureState.keys'),['clear','1','.','5','*','1','8','8','=']);
    assert.equal(await calculator.window.webContents.executeJavaScript('window.fixtureState.display'),'282');
    const readScope=desktopActivity.beginScope();
    try{
      const fresh=await dispatch('computer_inspect_window',{pid:calculator.identity.pid,window_id:calculator.identity.window_id},{activityScope:readScope});
      assert.ok(fresh.controls.some(control=>control.name==='Display is 282'));calc.independentReadback='Display is 282';
    }finally{desktopActivity.endScope(readScope);}
    fs.writeFileSync(path.join(directory,'rocket-native-calculator.png'),(await calculator.window.webContents.capturePage()).toPNG());
    const phrase='Rocket fixture text — سلام';
    const empty=await run('open notepad and write "'+phrase+'"',{fallback:true});
    assert.equal(empty.modelFallbackRequests,1);assert.equal(empty.physicalClicks,0);assert.equal(empty.textReplacements,0);
    const unreadable=empty.events.find(event=>event.name==='open_app').output.observation.controls.find(control=>control.name==='Text editor');
    assert.equal(unreadable?.editable,true);assert.equal(unreadable.value,undefined);
    assert.equal(await notepad.window.webContents.executeJavaScript("document.getElementById('editor').value"),'');
    empty.verifiedLimitation='Native Cua omits the empty Chromium textarea value; the local workflow refuses replacement without readable existing text.';
    // Reinitialize only our owned fixture with a known nonempty value. The
    // tested replacement itself must still go through the real native input.
    await notepad.window.loadFile(path.join(__dirname,'rocket-native-fixture.html'),{query:{mode:'notepad',seeded:'1'}});
    await notepad.window.webContents.executeJavaScript('document.fonts.ready');
    assert.equal(await notepad.window.webContents.executeJavaScript("document.getElementById('editor').value"),'Owned fixture seed text');
    const typed=await run('open notepad and replace the text with "'+phrase+'"');
    assert.equal(typed.modelFallbackRequests,0);assert.equal(typed.timing.route,'local');assert.equal(typed.textReplacements,1);assert.equal(typed.physicalClicks,0);
    assert.equal(await notepad.window.webContents.executeJavaScript("document.getElementById('editor').value"),phrase);
    const protectedText=await run('open notepad and write "Do not replace the existing text"',{fallback:true});
    assert.equal(protectedText.modelFallbackRequests,1);assert.equal(protectedText.textReplacements,0);assert.equal(protectedText.physicalClicks,0);
    assert.equal(await notepad.window.webContents.executeJavaScript("document.getElementById('editor').value"),phrase);
    const opened=await run('open Calculator');assert.equal(opened.modelFallbackRequests,0);assert.equal(opened.physicalClicks,0);assert.equal(opened.textReplacements,0);assert.equal(opened.answer,'Calculator is open.');
    const unknown=await run('Organize the files on my desktop',{fallback:true});
    assert.equal(unknown.modelFallbackRequests,1);assert.equal(unknown.toolCalls,0);assert.equal(unknown.physicalClicks,0);assert.equal(unknown.textReplacements,0);
    report.status='passed';report.total={physicalClicks:clicks,textReplacements:writes,blockedModelFallbacks:modelRequests,realNetworkRequests:0};
  }catch(error){report.status='failed';report.error=error.message;throw error;}
  finally{
    ai.cancel();computer.client.call=native;if(activeScope)desktopActivity.endScope(activeScope);
    for(const fixture of fixtures)if(!fixture.window.isDestroyed())fixture.window.destroy();
    save();
  }
};
