'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PlanTaskGuard}=require('../plan-task-guard');
test('unknown plan outcome blocks every input route in its task, including live delegation',async()=>{
  for(const plan of ['folders_open','computer_execute_plan','browser_execute_plan']){
    const guard=new PlanTaskGuard(),context={activityScope:Symbol('voice-task')};
    await guard.run(plan,context,async()=>({status:'interrupted',outcome_unknown:true}));
    for(const name of ['folders_open','computer_execute_plan','browser_execute_plan','computer_input','computer_action','computer_action_sequence','type_in_app','open_app','browser_close_tabs']){
      const result=await guard.run(name,context,()=>assert.fail('Unknown input must not be replayed through another tool'));
      assert.equal(result.stop_task,true);assert.equal(result.input_suppressed,true);
    }
    assert.deepEqual(await guard.run('computer_find_window',context,async()=>({status:'observed'})),{status:'observed'});
    assert.equal(await guard.run(plan,{activityScope:Symbol('new-task')},async()=>'new'), 'new');
  }
});

test('thrown uncertain folder delivery blocks later input but a pre-input refusal does not',async()=>{
  for(const error of [Object.assign(Error('Lost helper reply'),{action_attempted:true,outcome_unknown:true}),Object.assign(Error('Unknown folder result'),{outcome_unknown:true})]){
    const guard=new PlanTaskGuard(),context={activityScope:Symbol('folder-task')};
    await assert.rejects(guard.run('folders_open',context,async()=>{throw error;}),value=>value===error);
    for(const name of ['folders_open','computer_input','open_app'])assert.equal((await guard.run(name,context,()=>assert.fail('Uncertain folder open must block other input'))).stop_task,true);
    assert.equal(await guard.run('computer_list_windows',context,async()=>'read'),'read');
    assert.equal(await guard.run('folders_open',{activityScope:Symbol('new-task')},async()=>'new'),'new');
  }
  const guard=new PlanTaskGuard(),context={activityScope:Symbol('refused-folder')};
  await assert.rejects(guard.run('folders_open',context,async()=>{throw Object.assign(Error('Folder missing'),{refused:true,action_attempted:false});}),/Folder missing/);
  assert.equal(await guard.run('computer_input',context,async()=>'allowed'),'allowed');
});
test('known plan completion and pre-input refusals do not block further phases',async()=>{
  const guard=new PlanTaskGuard(),context={activityScope:Symbol('task')};
  for(const result of [{status:'completed',verified:true},{status:'interrupted',attempted:0}]){
    await guard.run('computer_execute_plan',context,async()=>result);
    assert.equal(await guard.run('computer_action',context,async()=>'continued'),'continued');
  }
});

test('known browser partial delivery blocks cross-route replay while allowing page continuation and reads',async()=>{
  const guard=new PlanTaskGuard(),context={activityScope:Symbol('partial-page-task')};
  const observation={source:'browser_dom',snapshot:'fresh-menu',controls:[{id:'repositories',role:'link',name:'Your repositories'}]};
  const partial={status:'interrupted',recovery_required:true,delivered_steps:[{index:0,op:'click',target:{role:'button',name:'Open user navigation menu'}}],observation};
  await guard.run('browser_execute_plan',context,async()=>partial);
  for(const name of ['computer_action','computer_action_sequence','computer_input','computer_execute_plan','click_app_control','type_in_app']){
    const result=await guard.run(name,context,()=>assert.fail('A delivered browser prefix cannot be replayed through a different input route.'));
    assert.equal(result.code,'cross_route_replay_blocked');assert.equal(result.input_suppressed,true);assert.equal(result.recovery_required,true);assert.notEqual(result.stop_task,true);assert.equal(result.observation,observation);
  }
  for(const name of ['browser_read_page','browser_list_tabs','computer_find_window'])assert.equal(await guard.run(name,context,async()=>'read'),'read');
  assert.equal(await guard.run('browser_execute_plan',context,async()=>'distinct page step'),'distinct page step');
  assert.equal(await guard.run('computer_action',{activityScope:Symbol('new-task')},async()=>'new task'),'new task');
});
