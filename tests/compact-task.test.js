'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateTool,createDispatcher,tools}=require('../core');
const {validateTaskProgram,executeTaskProgram}=require('../task-program');
const {executePlan}=require('../action-plan');
const {compactWorkflowTools}=require('../compact-task');
const program={version:2,steps:[{in:'Owned workspace'},{do:[['fill','Display name','Harbor']],expect:[['value','Display name','Harbor']]},{ensure:['checked','Weekly digest',true]}]};
function fixture(checked){
 const controls=[{id:'name',name:'Display name',role:'textbox',editable:true,value:'Old'},{id:'digest',name:'Weekly digest',role:'checkbox',...(checked===undefined?{}:{checked})}];let revision=0;const actions=[];
 const frame=()=>({snapshot:'f'+revision,revision,complete:true,controls:structuredClone(controls),window:{pid:1,window_id:2},source:'native-accessibility'});
 const adapter={snapshot:async()=>frame(),act:async(step,control)=>{actions.push(step.op);const c=controls.find(c=>c.id===control.id);if(step.op==='fill')c.value=step.text;else c.checked=!c.checked;revision++;return {status:'verified',verified:true,input_delivered:true,observation:frame()};}};
 const host={bind:async()=>frame(),observe:async()=>frame(),transition:async()=>frame(),perform:(steps,completion,context)=>executePlan({steps,completion,context,adapter})};
 return {host,controls,actions};
}
test('compact plans compile to the existing bounded representation and preserve independent final assertions',()=>{
 const compiled=validateTaskProgram(program);assert.equal(compiled.version,1);assert.equal(compiled.steps[1].op,'act');assert.equal(compiled.steps[2].op,'if');assert.equal(compiled.completion[0].condition,'checked');assert.equal(compiled.completion[0].value,'true');
 assert.equal(program.version,2);assert.equal(program.steps[0].in,'Owned workspace');
});
test('one compact call edits fields and sets a Boolean state only when its opposite is known',async()=>{
 for(const state of [true,false,undefined]){
  const f=fixture(state),out=await executeTaskProgram({program,host:f.host});
  assert.equal(f.controls[0].value,'Harbor');assert.equal(f.actions.filter(a=>a==='click').length,state===false?1:0);
  assert.equal(out.status,state===undefined?'interrupted':'completed');
 }
});
test('dispatcher validates and normalizes the entire compact program before admitting any child input',async()=>{
 let calls=0;const dispatch=createDispatcher({computer_run_workflow:args=>{calls++;assert.equal(args.version,1);return {status:'completed'};}});
 assert.equal((await dispatch('computer_run_workflow',program)).status,'completed');
 for(const bad of [
  {...program,script:'process.exit()'},
  {version:2,steps:[{in:'Owned'},{do:[['click','Save'],['shell','x']],expect:[['exists','Done']]}]},
  {version:2,steps:[{in:'Owned'},{when:['exists','Hidden'],then:[{do:[['click',{name:'Save',x:10}]],expect:[['exists','Done']]}]}],completion:[['exists','Done']]},
  {version:2,steps:[{in:{host:'example.com',url:'https://other.test',open_if_missing:true}},{expect:[['exists','Done']]}]},
  {version:2,steps:[{in:'Owned'},{ensure:['checked','Flag','true']}]},
  {version:2,steps:[{in:'Owned'},{do:[['fill','Name',{ref:'undefinedVariable'}]],expect:[['value','Name','X']]}]}
 ])assert.equal((await dispatch('computer_run_workflow',bad)).status,'error');
 assert.equal(calls,1);
});
test('cross-scope reads, conditional branches, navigation and original v1 programs remain validated',()=>{
 const compact={version:2,steps:[{in:'Source'},{read:['Code','code']},{in:{host:'example.com',browser:'opera'}},{when:['exists','Unlock'],then:[{do:[['click','Unlock']],expect:[['absent','Unlock']]}]},{do:[['fill','Reference',{ref:'code'}],['click','Store']],expect:[['value','Status','Stored']]}]};
 const compiled=validateTool('computer_run_workflow',compact);assert.equal(compiled.version,1);assert.equal(compiled.steps[1].as,'code');assert.equal(compiled.steps[2].target.hostname,'example.com');assert.equal(compiled.steps[4].steps[0].text.ref,'code');assert.deepEqual(validateTool('computer_run_workflow',compiled),compiled);
});
test('compact planner metadata is smaller without changing other tool definitions',()=>{
 const compact=compactWorkflowTools(tools),before=tools.find(t=>t.name==='computer_run_workflow'),after=compact.find(t=>t.name===before.name);
 assert.ok(JSON.stringify(after).length<JSON.stringify(before).length/3);assert.equal(after.parameters.properties.version.enum[0],2);assert.equal(compact.find(t=>t.name==='computer_input'),tools.find(t=>t.name==='computer_input'));
});

test('empty optional else branches are valid and rejected schemas carry a definite no-input receipt',async()=>{
 const compiled=validateTaskProgram({version:2,steps:[{in:'Owned'},{when:['exists','Optional'],then:[],else:[]},{expect:[['exists','Done']]}]});assert.deepEqual(compiled.steps[1].else,[]);
 const dispatch=createDispatcher({computer_run_workflow:()=>assert.fail('Invalid plan executed')});const result=await dispatch('computer_run_workflow',{version:2,steps:[{bad:true}]});assert.equal(result.validation_failed,true);assert.equal(result.action_attempted,false);assert.equal(result.refused,true);
});

test('prepared scope references bind only supplied identities and never guess a similar window',()=>{
 const {materializeCompactScopes}=require('../compact-task'),context={scopes:[{target:{kind:'native',app:'Exact long window 95ae2fee'}},{target:{kind:'browser',hostname:'example.test',browser:'opera'}}]};
 const raw={version:2,steps:[{in:0},{expect:[['exists','Ready']]}]},mapped=materializeCompactScopes(raw,context);assert.equal(mapped.steps[0].in.app,'Exact long window 95ae2fee');assert.equal(raw.steps[0].in,0);assert.equal(validateTaskProgram(mapped).steps[0].target.app,'Exact long window 95ae2fee');
 for(const index of [-1,2,0.5,99])assert.throws(()=>materializeCompactScopes({...raw,steps:[{in:index}]},context));assert.throws(()=>materializeCompactScopes(raw));
});
