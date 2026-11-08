'use strict';

// Opt-in native benchmark. All input is restricted to this process's test form.
// No model/API calls are made; timings measure the local controller and driver.
const {spawn} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {CuaClient} = require('../cua-client');
const {ComputerUse} = require('../computer-use');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rounded = value => Math.round(value * 100) / 100;

function stats(values) {
  const sorted = [...values].sort((a,b) => a-b);
  return {count:values.length,minMs:rounded(sorted[0]),medianMs:rounded(sorted[Math.floor(sorted.length/2)]),p95Ms:rounded(sorted[Math.ceil(sorted.length*.95)-1]),maxMs:rounded(sorted.at(-1))};
}

async function run() {
  const label = process.argv[2] || 'current';
  const fastCursor = process.argv.includes('--fast-cursor');
  const sequenceMode = process.argv.includes('--sequence');
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(label)) throw new Error('Use an alphanumeric benchmark label.');
  const directory = path.join(root, 'test-output');
  fs.mkdirSync(directory, {recursive:true});
  const output = path.join(directory, `performance-fixture-${Date.now()}.txt`);
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const fixture = spawn(shell, ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-fixture.ps1'),'-OutputFile',output], {windowsHide:true,stdio:['ignore','ignore','pipe']});
  let fixtureError='';fixture.stderr.on('data',data=>fixtureError+=data.toString());
  const client = new CuaClient({timeoutMs:20000});
  const rawCalls=[],sessionCursorMotions=[];
  const originalCall=client.call.bind(client);
  client.call=async(name,args)=>{
    const started=performance.now();
    if(name==='start_session'&&args.cursor_motion)sessionCursorMotions.push({...args.cursor_motion});
    try{return await originalCall(name,args);}
    finally{rawCalls.push({name,durationMs:rounded(performance.now()-started)});}
  };
  const computer = new ComputerUse({client,getSettings:()=>({allowDesktop:true,allowScreen:false}),confirm:async request=>{
    assert.equal(request.window.pid,fixture.pid,'Never act outside our own fixture.');return true;
  }});
  const measurements=[],actionOutcomes=[];
  let fixtureStructure;
  const timed=async(name,fn,iteration)=>{
    const started=performance.now();const result=await fn();
    measurements.push({name,iteration,durationMs:rounded(performance.now()-started)});return result;
  };
  try {
    await timed('coldHandshake',()=>client.connect(),0);
    let cursorConfiguration;
    if(fastCursor)cursorConfiguration=await client.call('start_session',{session:computer.session,cursor_motion:{timing:'fixed',glide_duration_ms:1,dwell_after_click_ms:0}});
    let fixtureWindow;
    for(let i=0;i<25;i++){
      const list=await computer.listWindows({query:'Companion Accessibility Test Fixture'});
      fixtureWindow=list.windows.find(item=>item.pid===fixture.pid);
      if(fixtureWindow)break;
      await delay(200);
    }
    assert.ok(fixtureWindow,'Fixture not discovered. '+fixtureError);
    const setupRawCalls=rawCalls.splice(0);
    for(let iteration=1;iteration<=5;iteration++){
      const started=performance.now();
      if(sequenceMode){
        const observed=await timed('findWindow',()=>computer.findWindow({query:'Companion Accessibility Test Fixture'}),iteration);
        assert.equal(observed.window?.pid,fixture.pid,'Only this benchmark fixture may receive input.');
        const input=observed.controls.find(control=>control.name==='Test input');
        const button=observed.controls.find(control=>control.name==='Confirm test');
        assert.ok(input);assert.ok(button);
        const value=`Pixie sequence performance ${iteration} — سلام`;
        const result=await timed('typeClickSequence',()=>computer.sequence({snapshot:observed.snapshot,actions:[
          {kind:'type',control_id:input.control_id,expected_name:input.name,text:value},
          {kind:'click',control_id:button.control_id,expected_name:button.name}
        ]}),iteration);
        actionOutcomes.push({iteration,status:result.status,attempted:result.attempted,completed:result.completed,results:result.results});
        assert.equal(result.attempted,2,JSON.stringify(result));
        assert.ok(result.observation,JSON.stringify(result));
        assert.equal(result.observation.controls.find(control=>control.name==='Test input')?.value,value);
        for(let i=0;i<20;i++){
          if(fs.existsSync(output)&&fs.readFileSync(output,'utf8').replace(/^\uFEFF/,'')===value)break;
          await delay(50);
        }
        assert.equal(fs.readFileSync(output,'utf8').replace(/^\uFEFF/,''),value,'Independent file confirms the real two-step sequence.');
        measurements.push({name:'findTypeClickSequence',iteration,durationMs:rounded(performance.now()-started)});
        continue;
      }
      const list=await timed('discover',()=>computer.listWindows({query:'Companion Accessibility Test Fixture'}),iteration);
      const target=list.windows.find(item=>item.pid===fixture.pid);
      assert.ok(target);
      let observed=await timed('inspect',()=>computer.inspect(target),iteration);
      if(!fixtureStructure)fixtureStructure=computer.snapshots.get(observed.snapshot).elements.map(({element_index,parent_index,depth,role,label})=>({element_index,parent_index,depth,role,label}));
      const input=observed.controls.find(control=>control.name==='Test input');assert.ok(input);
      const value=`Pixie performance ${iteration} — سلام`;
      const typed=await timed('typeWithFreshObservation',()=>computer.action({snapshot:observed.snapshot,kind:'type',control_id:input.control_id,expected_name:input.name,text:value}),iteration);
      actionOutcomes.push({iteration,kind:'type',verified:typed.verified,effect:typed.effect,status:typed.status});
      observed=typed.observation;assert.ok(observed,JSON.stringify(typed));
      assert.equal(observed.controls.find(control=>control.name==='Test input')?.value,value);
      const button=observed.controls.find(control=>control.name==='Confirm test');assert.ok(button);
      const clicked=await timed('clickWithFreshObservation',()=>computer.action({snapshot:observed.snapshot,kind:'click',control_id:button.control_id,expected_name:button.name}),iteration);
      actionOutcomes.push({iteration,kind:'click',verified:clicked.verified,effect:clicked.effect,status:clicked.status});
      assert.ok(clicked.observation,JSON.stringify(clicked));
      for(let i=0;i<20;i++){
        if(fs.existsSync(output)&&fs.readFileSync(output,'utf8').replace(/^\uFEFF/,'')===value)break;
        await delay(50);
      }
      assert.equal(fs.readFileSync(output,'utf8').replace(/^\uFEFF/,''),value,'Independent file confirms real input and click.');
      measurements.push({name:'discoverInspectTypeClick',iteration,durationMs:rounded(performance.now()-started)});
    }
    const grouped=rows=>Object.fromEntries([...new Set(rows.map(row=>row.name))].map(name=>[name,stats(rows.filter(row=>row.name===name).map(row=>row.durationMs))]));
    const equivalentAgentToolPlan=sequenceMode?['computer_find_window','computer_sequence']:['computer_list_windows','computer_inspect_window','computer_action(type)','computer_action(click)'];
    const report={status:'passed',label,at:new Date().toISOString(),appVersion:require('../package.json').version,driverVersion:client.version,iterations:5,explicitFastCursorRequested:fastCursor,sequenceMode,sessionCursorMotions,cursorConfiguration,scope:'Local Cua only; excludes model/network latency and test-form launch.',equivalentAgentToolPlan,independentPostconditions:['Fresh exact field value matches requested text','Fixture output file matches requested text after click'],summary:grouped(measurements),rawSummary:grouped(rawCalls),measurements,rawCalls,setupRawCalls,fixtureStructure,actionOutcomes};
    const filename=path.join(directory,`computer-performance-${label}.json`);
    fs.writeFileSync(filename,JSON.stringify(report,null,2));
    console.log(JSON.stringify({file:filename,...report,measurements:undefined,rawCalls:undefined,setupRawCalls:undefined,fixtureStructure:undefined},null,2));
  } finally {await computer.stop();fixture.kill();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
