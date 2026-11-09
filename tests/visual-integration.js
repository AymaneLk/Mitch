'use strict';

// Opt-in native input check. Creates its own window and never targets user apps.
// The canvas targets have no accessible button entries, so successful readback
// demonstrates real screenshot-grounded mouse input rather than UIA invocation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkVisualInput({BrowserWindow,screen,dispatch,activityScope,directory,version}) {
  const title=`Pixie Visual Input Check ${process.pid}`;
  const win=new BrowserWindow({
    title,width:760,height:640,useContentSize:true,frame:false,
    show:false,resizable:false,maximizable:false,fullscreenable:false,
    backgroundColor:'#f7f8fc',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false},
  });
  const primary=screen?.getPrimaryDisplay();
  if(primary){
    const area=primary.workArea;
    win.setPosition(Math.round(area.x+Math.max(0,(area.width-760)/2)),Math.round(area.y+Math.max(0,(area.height-640)/2)));
  }
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  const run=(name,args)=>dispatch(name,args,{activityScope});
  const read=()=>win.webContents.executeJavaScript('window.fixture.readState()');
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const describe=value=>JSON.stringify(value,(key,item)=>key==='_images'?'[screenshot omitted]':item).slice(0,6000);
  const checks=[];
  let observation;
  const checkObservation=result=>{
    assert.ok(result&&typeof result.snapshot==='string',describe(result));
    assert.ok(Number.isFinite(result.width)&&result.width>100,'Screenshot width must be available.');
    assert.ok(Number.isFinite(result.height)&&result.height>100,'Screenshot height must be available.');
    assert.ok(Array.isArray(result._images)&&result._images.length>0,'The reasoning model must receive a screenshot.');
    return result;
  };
  const saveNativeScreenshot=(state,filename)=>{
    const data=state._images?.[0]?.data_url;
    assert.ok(typeof data==='string'&&data.startsWith('data:image/png;base64,'),'The native fixture screenshot must be a PNG data URL.');
    fs.writeFileSync(path.join(directory,filename),Buffer.from(data.slice('data:image/png;base64,'.length),'base64'));
  };
  try {
    await win.loadFile(path.join(__dirname,'visual-fixture.html'));
    win.webContents.setZoomFactor(1);
    await win.webContents.executeJavaScript(`document.title=${JSON.stringify(title)}`);
    win.setTitle(title);win.show();win.focus();
    await delay(150);
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'visual-fixture-before.png'),(await win.webContents.capturePage()).toPNG());
    const geometry=await win.webContents.executeJavaScript('window.fixture.targets()');
    // The test window has no non-client frame. Coordinates are fractions of the
    // actual returned PNG, never desktop pixels or assumptions about monitor DPI.
    const point=name=>({x:geometry[name].x/geometry.width,y:geometry[name].y/geometry.height});
    const clickBox=name=>{
      const b=geometry.boxes[name];
      return {target_box:{left:b.left/geometry.width,top:b.top/geometry.height,right:b.right/geometry.width,bottom:b.bottom/geometry.height}};
    };
    const desktopBox=name=>{
      const b=geometry.boxes[name],content=win.getContentBounds();
      return {target_box:{left:(content.x-primary.bounds.x+b.left)/primary.bounds.width,top:(content.y-primary.bounds.y+b.top)/primary.bounds.height,right:(content.x-primary.bounds.x+b.right)/primary.bounds.width,bottom:(content.y-primary.bounds.y+b.bottom)/primary.bounds.height}};
    };
    const atCenter=(state,name)=>{
      const actual=state.clickLocations[name],expected=geometry[name];
      return actual&&Math.abs(actual.x-expected.x)<=2&&Math.abs(actual.y-expected.y)<=2;
    };
    const desktopPoint=name=>{
      assert.ok(primary,'Primary-display metadata is required for desktop coordinates.');
      const content=win.getContentBounds(),scale=primary.scaleFactor;
      const x=(content.x-primary.bounds.x+geometry[name].x)*scale/(primary.bounds.width*scale);
      const y=(content.y-primary.bounds.y+geometry[name].y)*scale/(primary.bounds.height*scale);
      assert.ok(x>0&&x<1&&y>0&&y<1,'The desktop input target must stay inside the fixture on the primary display.');
      return{x,y};
    };
    let target,list;
    for(let i=0;i<12;i++){
      list=await run('computer_list_windows',{query:title});
      target=list.windows?.find(item=>item.title===title&&item.pid===process.pid);
      if(target)break;
      await delay(100);
    }
    assert.ok(target,'Isolated visual fixture not discovered: '+JSON.stringify(list));
    observation=checkObservation(await run('computer_observe',{scope:'window',pid:target.pid,window_id:target.window_id}));
    saveNativeScreenshot(observation,'visual-native-before.png');
    if(observation.window){assert.equal(observation.window.pid,target.pid);assert.equal(observation.window.window_id,target.window_id);}

    async function act(label,args,verify){
      const started=performance.now(),previous=observation.snapshot;
      const result=await run('computer_input',{snapshot:previous,...args});
      assert.ok(!['error','refused','cancelled','interrupted'].includes(result.status),`${label}: ${describe(result)}`);
      observation=checkObservation(result.observation||result);
      assert.notEqual(observation.snapshot,previous,'Each input must produce a fresh observation.');
      let actual;
      for(let i=0;i<8;i++){
        actual=await read();
        if(verify(actual))break;
        await delay(25);
      }
      assert.ok(verify(actual),`${label}: independent fixture readback failed: ${JSON.stringify(actual)}`);
      checks.push({name:label,kind:args.kind,duration_ms:Math.round(performance.now()-started),native_verified:result.verified===true});
      return{result,previous,actual};
    }

    const windowMove=await run('computer_input',{snapshot:observation.snapshot,kind:'move',...point('click')});
    assert.equal(windowMove.status,'error','Window-scoped native movement is decorative and must not claim a real hover.');
    checks.push({name:'unsupported window hover reports an actionable refusal'});
    observation=checkObservation(await run('computer_observe',{scope:'window',pid:target.pid,window_id:target.window_id}));
    const pointOnly=await run('computer_input',{snapshot:observation.snapshot,kind:'click',...point('click')});
    assert.equal(pointOnly.status,'error');assert.equal((await read()).clicks,0,'Point-only clicks must not send input.');
    checks.push({name:'point-only click refused without input'});
    const clicked=await act('center click on a canvas-only target',{kind:'click',...clickBox('click')},state=>state.clicks===1&&atCenter(state,'click'));
    const stale=await run('computer_input',{snapshot:clicked.previous,kind:'click',...clickBox('click')});
    assert.equal(stale.status,'error','Consumed screenshots must not authorize another click.');
    assert.equal((await read()).clicks,1,'Refusing a stale capture must not deliver input.');
    checks.push({name:'stale screenshot refused without input'});
    await act('center double click',{kind:'double_click',...clickBox('double_click')},state=>state.doubleClicks===1&&atCenter(state,'double_click'));
    await act('center right click',{kind:'right_click',...clickBox('right_click')},state=>state.rightClicks===1&&atCenter(state,'right_click'));
    const start=point('drag_start'),end=point('drag_end');
    await act('drag canvas object to its destination',{kind:'drag',...start,x2:end.x,y2:end.y},state=>state.dragCompleted===1&&state.dragStarted===1&&state.dragMoves>0);
    await act('focus a text field at its center',{kind:'click',...clickBox('text')},state=>state.activeElement==='editor'&&atCenter(state,'text'));
    await act('Ctrl+A selection',{kind:'hotkey',keys:['ctrl','a']},state=>state.activeElement==='editor'&&state.selectionStart===0&&state.selectionEnd===state.text.length);
    const text='Pixie visual input — سلام';
    await act('Unicode keyboard text entry',{kind:'type',text},state=>state.text===text&&state.typedEvents>0);
    await act('ordinary Ctrl+S app shortcut',{kind:'hotkey',keys:['ctrl','s']},state=>state.saveCount===1&&state.savedText===text);
    await act('Enter key',{kind:'key',key:'Enter'},state=>state.text===text+'\n');
    await act('typing continues at the caret',{kind:'type',text:'Second line'},state=>state.text===text+'\nSecond line');
    await act('scroll at an observed panel',{kind:'scroll',direction:'down',amount:4,...point('scroll')},state=>state.scrollTop>0);
    const replaced=await act('focus select and replace in one tool call',{kind:'type',...point('text'),replace:true,text:'Fast replacement — سلام'},state=>state.text==='Fast replacement — سلام'&&state.activeElement==='editor');
    assert.equal(replaced.result.steps_completed,2,'Both local text steps must be delivered.');

    if(primary){
      observation=checkObservation(await run('computer_observe',{scope:'desktop'}));
      const beforeDesktopClick=await read();
      await act('desktop center click focuses the isolated editor',{kind:'click',...desktopBox('text')},state=>state.activeElement==='editor'&&state.editorClicks===beforeDesktopClick.editorClicks+1&&atCenter(state,'text'));
      await act('desktop Ctrl+A selects the isolated editor',{kind:'hotkey',keys:['ctrl','a']},state=>state.activeElement==='editor'&&state.selectionStart===0&&state.selectionEnd===state.text.length);
      await act('desktop Unicode typing uses the selected field',{kind:'type',text:'Desktop path — سلام'},state=>state.text==='Desktop path — سلام');
      await act('desktop pointer movement over the isolated canvas',{kind:'move',...desktopPoint('right_click')},state=>state.pointerMoves>0&&state.lastPointer?.x>=368&&state.lastPointer.x<=522&&state.lastPointer.y>=18&&state.lastPointer.y<=83);
      // Save only our own window's native screenshot, never the full desktop.
      observation=checkObservation(await run('computer_observe',{scope:'window',pid:target.pid,window_id:target.window_id}));
    }

    const finalState=await read();
    saveNativeScreenshot(observation,'visual-native-after.png');
    fs.writeFileSync(path.join(directory,'visual-fixture-after.png'),(await win.webContents.capturePage()).toPNG());
    const centerErrors=Object.entries(finalState.clickLocations).map(([name,p])=>({name,dx:p.x-geometry[name].x,dy:p.y-geometry[name].y}));
    const report={status:'passed',at:new Date().toISOString(),appVersion:version,window:{pid:target.pid,window_id:target.window_id,title},desktopInputTested:!!primary,scaleFactor:primary?.scaleFactor,centerErrors,checks,finalState,verification:'Independent pointer-event coordinates (center tolerance 2 CSS pixels), event counters, text value, selection, saved test value, drag location and scroll offset; no model/API calls.'};
    fs.writeFileSync(path.join(directory,'visual-integration.json'),JSON.stringify(report,null,2));
    return report;
  } catch(error){
    fs.writeFileSync(path.join(directory,'visual-integration-failure.json'),JSON.stringify({status:'failed',at:new Date().toISOString(),checks,error:error.message,frame:observation?{width:observation.width,height:observation.height,window:observation.window,screen_width:observation.screen_width,screen_height:observation.screen_height}:null,fixture:win.isDestroyed()?null:{bounds:win.getContentBounds(),geometry:await win.webContents.executeJavaScript('window.fixture.targets()'),state:await read()},display:primary},null,2));
    throw error;
  } finally {if(!win.isDestroyed())win.destroy();}
};
