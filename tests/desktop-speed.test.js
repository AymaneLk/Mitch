const {test}=require('node:test'),assert=require('node:assert/strict');
const {desktopTools}=require('../desktop-speed');

const event=(overrides={})=>({name:'computer_inspect_window',output:{status:'inspected',snapshot:'fresh',controls:[{name:'Messages',type:'Button',enabled:true}],degraded:false,truncated:false,...overrides}});
test('complete native observations hide incompatible legacy IDs; fallback retains all tools',()=>{
  const tools=['computer_action','computer_observe','inspect_app','click_app_control','type_in_app','create_note'].map(name=>({name}));
  assert.deepEqual(desktopTools(tools,[event()]).map(t=>t.name),['computer_action','computer_observe','create_note']);
  assert.equal(desktopTools(tools,[event({recovery_required:true})]),tools);
  assert.equal(desktopTools(tools,[{name:'inspect_app',output:event().output}]),tools);
});
test('uncertain, review-required and cancelled native actions preserve every recovery tool',()=>{
  const tools=['computer_action','computer_observe','inspect_app','click_app_control','type_in_app'].map(name=>({name}));
  for(const output of [{status:'unverified'},{status:'verified',requires_review:true},{status:'cancelled'},{status:'verified',outcome_unknown:true}]){
    const latest={name:'computer_action',output:{...output,observation:event().output}};
    assert.equal(desktopTools(tools,[latest]),tools,JSON.stringify(output));
  }
});

test('a usable native observation makes general plans primary while preserving observation and visual recovery',()=>{
  const tools=['computer_execute_plan','computer_action','computer_action_sequence','inspect_app','click_app_control','type_in_app','browser_execute_plan','computer_observe','computer_inspect_window','computer_list_windows','create_note'].map(name=>({name}));
  const expected=['computer_execute_plan','computer_observe','computer_inspect_window','computer_list_windows','create_note'];
  assert.deepEqual(desktopTools(tools,[event()]).map(tool=>tool.name),expected);
  const finished={name:'computer_execute_plan',output:{status:'completed',verified:true,observation:event({complete:true}).output}};
  assert.deepEqual(desktopTools(tools,[finished]).map(tool=>tool.name),expected);
  assert.deepEqual(tools.map(tool=>tool.name),['computer_execute_plan','computer_action','computer_action_sequence','inspect_app','click_app_control','type_in_app','browser_execute_plan','computer_observe','computer_inspect_window','computer_list_windows','create_note'],'Tool routing must not mutate the master catalog.');
});

test('an interrupted plan or unusable native observation restores single-action fallback',()=>{
  const tools=['computer_execute_plan','computer_action','computer_action_sequence','inspect_app','click_app_control','type_in_app','browser_execute_plan','computer_observe'].map(name=>({name}));
  for(const issue of [{status:'interrupted'},{status:'refused'},{status:'error'},{status:'cancelled'},{status:'unverified'},{status:'completed',outcome_unknown:true},{status:'completed',requires_review:true},{status:'completed',recovery_required:true},{status:'completed',input_suppressed:true}]){
    const latest={name:'computer_execute_plan',output:{...issue,observation:event({complete:true}).output}};
    assert.equal(desktopTools(tools,[latest]),tools,JSON.stringify(issue));
  }
  for(const issue of [{degraded:true},{truncated:true},{accessibility_partial:true},{controls:[]}]){
    assert.equal(desktopTools(tools,[event(issue)]),tools,JSON.stringify(issue));
  }
});
