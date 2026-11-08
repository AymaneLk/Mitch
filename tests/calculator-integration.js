'use strict';

// Opt-in real Calculator check, invoked by Electron smoke with --calculator-test.
// Uses the same dispatcher, controller, target checks and blue overlay as Pixie.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function checkCalculator({dispatch,activityScope,directory,version}) {
  const run = (name,args) => dispatch(name,args,{activityScope});
  const listed=await run('computer_list_windows',{query:'Calculatrice'});
  const minimized=listed.windows?.filter(window=>window.title==='Calculatrice'&&window.minimized);
  let restoredFromMinimized=false;
  if(minimized?.length){
    assert.equal(minimized.length,1,'Choose one intended Calculator main window for this test.');
    const restored=await run('computer_restore_window',{pid:minimized[0].pid,window_id:minimized[0].window_id});
    assert.equal(restored.status,'inspected',JSON.stringify(restored));
    restoredFromMinimized=true;
  }
  let observation = await run('computer_find_window',{query:'Calculatrice'});
  assert.equal(observation.status,'inspected',JSON.stringify(observation));
  assert.equal(observation.window.title,'Calculatrice');
  const identity = {...observation.window};
  const display = state => state.controls?.find(control=>control.type==='Text'&&/^L.affichage est /.test(control.name));
  assert.ok(display(observation),'French Calculator display must be observed.');
  assert.equal(display(observation).editable,false);
  const refused = await run('computer_action',{snapshot:observation.snapshot,kind:'type',control_id:display(observation).control_id,expected_name:display(observation).name,text:'6*7'});
  assert.equal(refused.status,'error');
  assert.match(refused.message,/not editable|read.only/i);
  const cases = [
    {expression:'12.5 + 3.5',result:'16',buttons:['Effacer','Un','Deux','Séparateur décimal','Cinq','Plus','Trois','Séparateur décimal','Cinq','Est égal à']},
    {expression:'6 × 7',result:'42',buttons:['Effacer','Six','Multiplier par','Sept','Est égal à']},
  ];
  const checks = [];
  for (const check of cases) {
    const actions = check.buttons.map(label=>{
      const matches=observation.controls.filter(control=>control.name===label&&control.type==='Button');
      assert.equal(matches.length,1,`Expected one observed Calculator button: ${label}`);
      assert.equal(matches[0].editable,false);
      return {kind:'click',control_id:matches[0].control_id,expected_name:matches[0].name};
    });
    const started=performance.now();
    const result=await run('computer_action_sequence',{snapshot:observation.snapshot,actions});
    fs.writeFileSync(path.join(directory,'calculator-last-sequence.json'),JSON.stringify(result,null,2));
    assert.ok(['completed','unverified'].includes(result.status),JSON.stringify(result));
    assert.equal(result.completed,actions.length);
    observation=result.observation;
    // Only re-read a settling UI; never repeat any input to make the assertion pass.
    for(let i=0;i<5&&display(observation)?.name!==`L’affichage est ${check.result}`;i++){
      await new Promise(resolve=>setTimeout(resolve,50));
      observation=await run('computer_inspect_window',{pid:identity.pid,window_id:identity.window_id});
    }
    assert.equal(display(observation)?.name,`L’affichage est ${check.result}`,JSON.stringify(observation));
    checks.push({expression:check.expression,display:display(observation).name,clicks:actions.length,duration_ms:Math.round(performance.now()-started),nativeStatus:result.status});
  }
  fs.writeFileSync(path.join(directory,'calculator-integration.json'),JSON.stringify({status:'passed',at:new Date().toISOString(),appVersion:version,window:identity,checks,restoredFromMinimized,readOnlyTypeRefused:true,verification:'Actual Calculator display read after observed button input'},null,2));
};
