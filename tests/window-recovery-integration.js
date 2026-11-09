'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
module.exports=async function({BrowserWindow,dispatch,computer,desktopActivity,directory}){
  const report={status:'running',at:new Date().toISOString(),checks:[]};let parent,popup;
  const original=computer.client.call.bind(computer.client);
  try{
    for(const failAfterDelivery of process.argv.includes('--navigation-only')?[]:[false,true]){
      const scope=desktopActivity.beginScope(),context={activityScope:scope,fromModel:true};let physicalClicks=0,popupWasCovered=false,covered;
      const popupReady=new Promise(resolve=>{covered=resolve;});const focusEvents=[];
      const title=`Mitch local popup test ${process.pid}`;
      try{
        parent=new BrowserWindow({title,width:840,height:550,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
        const allowed=pathToFileURL(path.join(__dirname,'popup-window.html')).href;
        parent.webContents.setWindowOpenHandler(({url})=>url===allowed?{action:'allow',overrideBrowserWindowOptions:{show:false,width:420,height:280}}:{action:'deny'});
        parent.webContents.on('did-create-window',child=>{popup=child;child.once('ready-to-show',()=>{child.showInactive();parent.show();parent.focus();popupWasCovered=!child.isFocused();covered();});});
        await parent.loadFile(path.join(__dirname,'popup-parent.html'));await parent.webContents.executeJavaScript(`document.title=${JSON.stringify(title)}`);parent.show();parent.focus();
        await new Promise(r=>setTimeout(r,300));
        const list=await dispatch('computer_list_windows',{query:title},context),window=list.windows.find(w=>w.pid===process.pid&&w.title===title);assert.ok(window);
        const observation=await dispatch('computer_observe',{scope:'window',pid:window.pid,window_id:window.window_id},context);
        const button=observation.targets.find(t=>t.name==='Open test popup');assert.ok(button,'Fixture button must be measured.');
        computer.client.call=async(name,args)=>{
          const result=await original(name,args);
          if(name==='bring_to_front')focusEvents.push({args,result:result.structuredContent});
          if(name==='click'&&args.target?.pid===window.pid&&args.target?.window_id===window.window_id){
            physicalClicks++;
            // Finish the fixture's intentional covering before recovery runs;
            // otherwise its delayed ready-to-show callback can steal focus back.
            await Promise.race([popupReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fixture popup did not load')),5000))]);
            if(failAfterDelivery)return {isError:true,structuredContent:{code:'tool_invocation_failed',message:'Simulated lost response after delivered fixture input'}};
          }
          return result;
        };
        const started=Date.now();
        const output=await dispatch('computer_input',{snapshot:observation.snapshot,kind:'click',target_id:button.target_id,expected_name:button.name},context);
        assert.equal(output.recovered_window,true,JSON.stringify({...output,_images:undefined}));
        assert.equal(output.observation.window.title,'Mitch local call-window fixture');
        assert.equal(await parent.webContents.executeJavaScript('window.clicks'),1);assert.equal(physicalClicks,1);
        assert.ok(popupWasCovered,'The popup must initially be behind its parent.');
        for(let i=0;i<10&&!popup.isFocused();i++)await new Promise(r=>setTimeout(r,25));
        assert.ok(popup.isFocused(),'Recovery must bring the popup forward. '+JSON.stringify({focusEvents,parentFocused:parent.isFocused(),current:BrowserWindow.getFocusedWindow()?.getTitle(),popup:popup.getTitle()}));
        if(failAfterDelivery){
          const refreshed=await dispatch('computer_observe',{scope:'window',pid:window.pid,window_id:window.window_id},context);
          const target=refreshed.targets.find(t=>t.name===button.name);
          const duplicate=await dispatch('computer_input',{snapshot:refreshed.snapshot,kind:'click',target_id:target.target_id,expected_name:target.name},context);
          assert.equal(duplicate.input_suppressed,true);assert.equal(duplicate.stop_task,undefined);assert.ok(duplicate.observation.snapshot);assert.equal(physicalClicks,1);
          await dispatch('computer_focus_window',{pid:output.observation.window.pid,window_id:output.observation.window.window_id},context);
        }
        report.checks.push({failAfterDelivery,physicalClicks,popupWasCovered,popupRecovered:true,duplicateBlocked:failAfterDelivery,duration_ms:Date.now()-started});
      }finally{computer.client.call=original;desktopActivity.endScope(scope);if(popup&&!popup.isDestroyed())popup.destroy();if(parent&&!parent.isDestroyed())parent.destroy();popup=null;parent=null;}
    }
    // Reproduce a lost acknowledgement while navigating inside ONE window.
    // The old guard froze the whole window, so the next contact click failed.
    const scope=desktopActivity.beginScope(),context={activityScope:scope,fromModel:true};let physicalClicks=0;
    try{
      parent=new BrowserWindow({width:840,height:550,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
      await parent.loadFile(path.join(__dirname,'navigation-recovery.html'));parent.show();parent.focus();
      const listed=await dispatch('computer_list_windows',{query:'Mitch local navigation recovery fixture'},context);
      const window=listed.windows.find(w=>w.pid===process.pid);assert.ok(window);
      const observed=await dispatch('computer_inspect_window',{pid:window.pid,window_id:window.window_id},context);
      assert.ok(observed.controls,JSON.stringify(observed));
      const button=observed.controls.find(c=>c.name==='Messages');assert.ok(button);
      computer.client.call=async(name,args)=>{
        const result=await original(name,args);
        if(name==='click'&&args.target?.pid===window.pid&&args.target?.window_id===window.window_id){
          physicalClicks++;
          report.nativeNavigationClick={isError:result.isError,data:result.structuredContent};
          if(physicalClicks===1)return{isError:true,structuredContent:{code:'tool_invocation_failed',message:'Simulated lost navigation acknowledgement'}};
        }
        return result;
      };
      const started=Date.now();
      const first=await dispatch('computer_action',{snapshot:observed.snapshot,kind:'click',control_id:button.control_id,expected_name:button.name},context);
      report.navigationProbe={counts:await parent.webContents.executeJavaScript('window.inputs'),status:first.status,recovered_window:first.recovered_window,recovery:first.recovery,observationWindow:first.observation?.window,controls:first.observation?.controls?.map(c=>({name:c.name,type:c.type}))};
      assert.equal(first.outcome_unknown,true);assert.equal(first.recovery?.state_changed,true);
      assert.ok(first.observation.controls.some(c=>c.name==='Test contact'));
      assert.equal(await parent.webContents.executeJavaScript("document.getElementById('heading').textContent"),'Inbox');
      const duplicateTarget=first.observation.controls.find(c=>c.name==='Messages');assert.ok(duplicateTarget);
      const duplicate=await dispatch('computer_action',{snapshot:first.observation.snapshot,kind:'click',control_id:duplicateTarget.control_id,expected_name:duplicateTarget.name},context);
      assert.equal(duplicate.input_suppressed,true);assert.equal(duplicate.stop_task,undefined);
      const contact=duplicate.observation.controls.find(c=>c.name==='Test contact');assert.ok(contact);
      const next=await dispatch('computer_action',{snapshot:duplicate.observation.snapshot,kind:'click',control_id:contact.control_id,expected_name:contact.name},context);
      assert.ok(next.observation?.snapshot,JSON.stringify(next));
      assert.equal(await parent.webContents.executeJavaScript("document.getElementById('heading').textContent"),'Test conversation');
      const counts=await parent.webContents.executeJavaScript('window.inputs');
      assert.deepEqual(counts,{messages:1,contact:1});assert.equal(physicalClicks,2);
      report.checks.push({scenario:'same-window navigation after lost acknowledgement',duplicateBlocked:true,taskContinued:true,physicalClicks,counts,duration_ms:Date.now()-started});
    }finally{computer.client.call=original;desktopActivity.endScope(scope);if(parent&&!parent.isDestroyed())parent.destroy();parent=null;}
    report.status='passed';
  }catch(error){report.status='failed';report.error=error.message;throw error;}
  finally{computer.client.call=original;fs.writeFileSync(path.join(directory,'window-recovery-integration.json'),JSON.stringify(report,null,2));}
};
