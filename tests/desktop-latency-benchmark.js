'use strict';
// Baseline/current recovery scheduling with deterministic native fixtures.
// Real setTimeout waits are measured; this is not a real-app or model benchmark.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {DesktopRecovery}=require('../desktop-recovery');
const {ComputerUse}=require('../computer-use');
function baseline(file,original){
  const module={exports:{}};
  new Function('require','module','exports',fs.readFileSync(file,'utf8'))(createRequire(path.resolve(original)),module,module.exports);
  return module.exports;
}
const BeforeRecovery=baseline('test-output/desktop-recovery-before-rocket.js','desktop-recovery.js').DesktopRecovery;
const BeforeComputer=baseline('test-output/computer-use-before-rocket.js','computer-use.js').ComputerUse;
async function recoveryRun(Recovery,scenario){
  let reads=0,inputs=0,delayedMs=0,focused=0;
  const window={pid:42,window_id:1,title:scenario==='calculator'?'Calculatrice':'Editor',on_screen:true};
  const name=scenario==='calculator'?'Six':scenario==='delayed-call'?'Call':'Bold';
  const control={control_id:'0',name,type:'Button'};
  const popup={...window,window_id:2,title:'Call window',on_screen:false};
  const before={window,controls:[control,{name:'Display',type:'Text',value:'0'}]};
  const computer={snapshots:new Map([['a',before]]),listWindows:async()=>({windows:++reads>=4&&scenario==='delayed-call'?[window,popup]:[window]}),focus:async()=>{focused++;return {snapshot:'popup',window:popup,controls:[{name:'Connecting',type:'Text'}]};}};
  const recovery=new Recovery({computer,visual:{clear(){}},delay:async ms=>{delayedMs+=ms;await new Promise(resolve=>setTimeout(resolve,ms));}});
  const started=performance.now();
  const result=await recovery.run('computer_action',{snapshot:'a',kind:'click',control_id:'0',expected_name:name},{activityScope:Symbol('bench')},async()=>{
    inputs++;return {status:'verified',verified:true,observation:{snapshot:'b',window,controls:[control,{name:'Display',type:'Text',value:'6'}]}};
  });
  assert.equal(inputs,1);assert.equal(focused,scenario==='delayed-call'?1:0);
  if(scenario==='delayed-call')assert.equal(result.recovered_window,true);
  return {durationMs:Math.round(performance.now()-started),inventoryReads:reads,scheduledWaitMs:delayedMs,physicalInputs:inputs,popupRecovered:focused===1};
}
async function focusRun(Computer){
  let inspections=0,restores=0,focuses=0;
  const client={async call(name){
    if(name==='start_session')return {};
    if(name==='list_windows')return {windows:[{pid:42,window_id:1,title:'Editor',minimized:true}]};
    if(name==='get_window_state'){inspections++;return {window_title:'Editor',elements:[{element_token:'one',role:'edit',label:'Document'}]};}
    if(name==='bring_to_front'){focuses++;return {landed_on_target:true,now_fg_hwnd:1};}
    throw Error('Unexpected call');
  },async stop(){}};
  const computer=new Computer({client,getSettings:()=>({allowDesktop:true}),confirm:async()=>true,restoreWindow:async()=>{restores++;}});
  await computer.listWindows();const result=await computer.focus({pid:42,window_id:1});assert.equal(result.focus_verified,true);
  return {inspections,restores,focuses};
}
(async()=>{
  const rows=[];
  for(const scenario of ['ordinary-control','calculator','delayed-call']){
    const before=[],after=[];
    for(let repeat=0;repeat<3;repeat++){
      if(repeat%2){after.push(await recoveryRun(DesktopRecovery,scenario));before.push(await recoveryRun(BeforeRecovery,scenario));}
      else {before.push(await recoveryRun(BeforeRecovery,scenario));after.push(await recoveryRun(DesktopRecovery,scenario));}
    }
    const median=values=>values.map(x=>x.durationMs).sort((a,b)=>a-b)[1];
    rows.push({scenario,beforeMedianMs:median(before),afterMedianMs:median(after),before,after});
  }
  const report={status:'passed',at:new Date().toISOString(),scope:'Synthetic window/control fixtures. Actual recovery timers, no model API, UI interaction or real app timing. Three alternating repeats per variant.',rows,restoreFocus:{before:await focusRun(BeforeComputer),after:await focusRun(ComputerUse)}};
  fs.writeFileSync('test-output/desktop-latency-benchmark.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,rows:rows.map(({scenario,beforeMedianMs,afterMedianMs,before,after})=>({scenario,beforeMedianMs,afterMedianMs,beforeReads:before[0].inventoryReads,afterReads:after[0].inventoryReads})),restoreFocus:report.restoreFocus},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
