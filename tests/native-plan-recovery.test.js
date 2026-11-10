'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {NativePlanRecovery}=require('../native-plan-recovery');
const {NativePlanAdapter}=require('../native-plan-adapter');
const {executePlan}=require('../action-plan');
const {PlanTaskGuard}=require('../plan-task-guard');
const {AI}=require('../ai');
const target={pid:42,window_id:99};
const button=name=>({name,type:'Button',enabled:true});
const click=name=>({op:'click',target:{role:'button',name}});
const exists=name=>({target:{role:'button',name},condition:'exists'});
const plan={steps:[click('Menu'),{op:'click',target:{role:'button',name:'Continue',match:'contains'}}],completion:[exists('Done')]};
function fixture({mode='changed',delivery={status:'unverified',verified:false,effect:'unverifiable'}}={}){
 let serial=0;
 const computer={generation:0,windows:new Map([['42:99',target]]),snapshots:new Map(),inputs:[],controls:[button('Menu')],reads:0,
  assertReady(){},getSnapshot(id){const s=this.snapshots.get(id);if(!s)throw Error('expired');return s;},
  async inspect(){this.reads++;const id='frame-'+ ++serial,controls=this.controls.map((c,i)=>({...c,control_id:String(i),protected:false,editable:c.editable===true}));const s={id,created:Date.now(),generation:0,window:target,controls,elements:controls.map(c=>({...c,role:c.type,element_token:id+':'+c.control_id})),degraded:mode==='incomplete'&&serial>1};this.snapshots.clear();this.snapshots.set(id,s);return {snapshot:id,window:target,controls};},
  async action(args){this.inputs.push(args.expected_name);if(mode==='throw')throw Error('lost reply');if(args.expected_name==='Menu'){
   if(mode==='changed'||mode==='incomplete')this.controls=[button('Menu'),button('Continue Alpha'),button('Continue Beta')];
   else if(mode==='clock')this.controls=[button('Menu'),{name:'11:40',type:'Text'}];
  }else if(args.expected_name==='Continue Alpha')this.controls=[button('Done')];
  const observation=await this.inspect();if(mode==='delayed')this.controls=[button('Menu'),button('Continue Alpha'),button('Continue Beta')];return {...delivery,observation};}
 };
 const runner=new NativePlanRecovery(computer),guard=new PlanTaskGuard(),context={activityScope:Symbol('task')};
 const run=args=>guard.run('computer_execute_plan',context,()=>runner.run(args,context));
 return {computer,runner,guard,context,run};
}
test('reproduces ambiguous-target false stop, then recovers without asserting delivery or replaying its prefix',async()=>{
 const old=fixture(),initial=await old.computer.inspect();
 const baseline=await executePlan({...plan,adapter:new NativePlanAdapter({computer:old.computer,target,initialSnapshot:initial.snapshot})});
 assert.equal(baseline.reason,'ambiguous_target');assert.equal(baseline.outcome_unknown,true);
 const f=fixture(),first=await f.computer.inspect(),result=await f.run({snapshot:first.snapshot,...plan});
 assert.equal(result.reason,'ambiguous_target');assert.equal(result.outcome_unknown,true);assert.equal(result.verified,false);assert.equal(result.distinct_action_recovery,true);assert.equal(result.read_only_recovery,true);assert.equal(result.attempted_steps.length,1);
 const repeat=await f.run({snapshot:result.observation.snapshot,steps:[click('Menu')],completion:[exists('Menu')]});
 assert.equal(repeat.reason,'replay_blocked');assert.equal(repeat.input_suppressed,true);assert.deepEqual(f.computer.inputs,['Menu']);
 const final=await f.run({snapshot:repeat.observation.snapshot,steps:[click('Continue Alpha')],completion:[exists('Done')]});
 assert.equal(final.status,'completed');assert.equal(final.verified,true);assert.deepEqual(f.computer.inputs,['Menu','Continue Alpha']);
});
test('native recovery prohibits alternate input routes and another window but permits scoped reads',async()=>{
 const f=fixture(),initial=await f.computer.inspect();await f.run({snapshot:initial.snapshot,...plan});
 for(const name of ['computer_action','computer_input','computer_action_sequence','browser_execute_plan','open_app','computer_focus_window']){
  const out=await f.guard.run(name,f.context,()=>assert.fail('cross-route replay'));assert.equal(out.input_suppressed,true);assert.equal(out.code,'cross_route_replay_blocked');
 }
 assert.equal(await f.guard.run('computer_inspect_window',f.context,async()=>'read'),'read');
 const another=await f.computer.inspect();f.computer.getSnapshot(another.snapshot).window={pid:43,window_id:100};
 const out=await f.run({snapshot:another.snapshot,...plan});assert.equal(out.reason,'replay_blocked');assert.deepEqual(f.computer.inputs,['Menu']);
});
test('fresh readback recovers a delayed accessibility update after the immediate post-action frame',async()=>{
 const f=fixture({mode:'delayed'}),initial=await f.computer.inspect();
 const out=await f.run({snapshot:initial.snapshot,steps:[click('Menu')],completion:[exists('Done')]});
 assert.equal(out.distinct_action_recovery,true);assert.equal(out.outcome_unknown,true);assert.ok(out.observation.controls.some(c=>c.name==='Continue Alpha'));assert.deepEqual(f.computer.inputs,['Menu']);
});
test('unchanged controls and unrelated clock text never authorize distinct input after an unconfirmed click',async()=>{
 for(const mode of ['unchanged','clock']){
  const f=fixture({mode}),initial=await f.computer.inspect();
  const out=await f.run({snapshot:initial.snapshot,steps:[click('Menu')],completion:[exists('Done')]});
  assert.equal(out.outcome_unknown,true);assert.equal(out.distinct_action_recovery,undefined);assert.equal(out.read_only_recovery,true);
  assert.equal((await f.guard.run('computer_execute_plan',f.context,()=>assert.fail('unknown replay'))).stop_task,true);
 }
});
test('transport loss, partial views and escalation never authorize native recovery input',async()=>{
 for(const options of [{mode:'throw'},{mode:'incomplete'},{delivery:{status:'unverified',effect:'unverifiable',requires_review:true}}]){
  const f=fixture(options),initial=await f.computer.inspect();const out=await f.run({snapshot:initial.snapshot,...plan});
  assert.equal(out.outcome_unknown,true);assert.equal(out.distinct_action_recovery,undefined);assert.equal(out.read_only_recovery,undefined);
  assert.equal((await f.guard.run('computer_action',f.context,()=>assert.fail('unknown replay'))).stop_task,true);
 }
});
test('acknowledged partial plans also reserve their delivered prefix without changing successful plans',async()=>{
 const f=fixture({delivery:{status:'verified',effect:'confirmed',verified:true}}),initial=await f.computer.inspect();
 const out=await f.run({snapshot:initial.snapshot,...plan});assert.equal(out.outcome_unknown,undefined);assert.equal(out.recovery_required,true);
 const repeat=await f.run({snapshot:out.observation.snapshot,steps:[click('Menu')],completion:[exists('Menu')]});assert.equal(repeat.reason,'replay_blocked');assert.deepEqual(f.computer.inputs,['Menu']);
});
test('AI continues a changed native interface, checks completion, and never replays the uncertain menu click',async()=>{
 const f=fixture(),initial=await f.computer.inspect();let phase=0,reviews=0;
 const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
 const ai=new AI(()=>({chatProvider:'chatgpt',chatModel:'test',allowDesktop:false}),()=>assert.fail('No credentials'),async(name,args)=>{assert.equal(name,'computer_execute_plan');return f.run(args);},()=>assert.fail('No network'));
 ai.request=async(endpoint,body)=>{
  if(body.response_format){reviews++;assert.ok(!body.tools?.length);assert.equal(f.computer.inputs.length,2);return {output:[message(JSON.stringify({decision:'complete',answer:'Done.',reason:'The fresh Done control confirms the result.'}))]};}
  phase++;assert.ok(phase<=2);const args=phase===1?{snapshot:initial.snapshot,...plan}:{snapshot:[...f.computer.snapshots.keys()][0],steps:[click('Continue Alpha')],completion:[exists('Done')]};
  return {output:[{type:'function_call',call_id:'phase'+phase,name:'computer_execute_plan',arguments:JSON.stringify(args)}]};
 };
 assert.equal(await ai.chat('Open the menu, then continue Alpha.'),'Done.');assert.equal(reviews,1);assert.deepEqual(f.computer.inputs,['Menu','Continue Alpha']);
});
