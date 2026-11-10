'use strict';
const {executePlan, normalizeRole}=require('./action-plan');
const {NativePlanAdapter}=require('./native-plan-adapter');
const key=w=>`${w?.pid}:${w?.window_id}`;
const normalized=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
const complete=f=>f?.source==='native-accessibility'&&f.complete===true&&Array.isArray(f.controls)&&!f.degraded&&!f.truncated&&!f.scope_error;
const cleanDelivery=r=>r&&!r.requires_review&&!r.outcome_unknown&&!r.refused&&['verified','unverified'].includes(r.status)&&['confirmed','unverifiable'].includes(r.effect);
const recoverableReasons=new Set(['ambiguous_target','condition_unmet','completion_unmet','non_interactive_target','unavailable_target','not_editable','focus_unconfirmed','target_changed']);
const signature=(step,control)=>JSON.stringify([step.op==='select'?'click':step.op,normalized(control.name),normalizeRole(control.role||control.type)]);
// Ignore focus, token churn, clocks, and unrelated text/value updates. A new
// interactive control set is navigation progress, not proof of task success.
const interactive=f=>JSON.stringify(f.controls.filter(c=>c.editable||['button','link','menuitem','option','tab','checkbox','radio','combobox','textbox'].includes(normalizeRole(c.role||c.type))).map(c=>[normalized(c.name),normalizeRole(c.role||c.type),c.enabled!==false]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
function changed(before,after,control){
  if(!complete(before)||!complete(after)||key(before.window)!==key(after.window)||before.snapshot===after.snapshot)return false;
  if(interactive(before)!==interactive(after))return true;
  const matches=after.controls.filter(c=>normalized(c.name)===normalized(control.name)&&normalizeRole(c.role||c.type)===normalizeRole(control.role||control.type));
  return matches.length===1&&['checked','selected'].some(k=>typeof control[k]==='boolean'&&typeof matches[0][k]==='boolean'&&control[k]!==matches[0][k]);
}
function distinctRecovery(result){return result?.outcome_unknown===true&&result.distinct_action_recovery===true&&result.recovery?.state_changed===true&&complete(result.observation)&&!result.evidence_truncated&&!result.stop_task&&!result.input_suppressed;}

/** A task-local ledger for interrupted native plans. Successful complete plans
 * are unaffected. An uncertain input is never replayed, including via a newly
 * inspected token or a more specific selector. Other routes are guarded by
 * PlanTaskGuard; only this executor can admit a distinct continuation. */
class NativePlanRecovery{
  constructor(computer){this.computer=computer;this.tasks=new Map();this.defaultScope=Symbol('native-plan');}
  async run(args,context={}){
    const initial=this.computer.getSnapshot(args.snapshot,this.computer.generation),scope=context.activityScope??this.defaultScope;
    const prior=this.tasks.get(scope),attempts=[];
    if(prior&&prior.window!==key(initial.window))return {status:'refused',input_suppressed:true,recovery_required:true,reason:'replay_blocked',message:'Continue in the recovered window. Switching windows cannot replay an interrupted native plan.'};
    const adapter=new NativePlanAdapter({computer:this.computer,target:initial.window,initialSnapshot:initial,context,
      beforeInput:entry=>{
        if(prior?.blocked.has(signature(entry.step,entry.control)))throw Object.assign(Error('This control was already attempted. Use the returned state to choose the next distinct control; no input was repeated.'),{code:'replay_blocked',refused:true});
        attempts.push({...entry});
      },
      afterInput:result=>{attempts.at(-1).result=result;}
    });
    const result=await executePlan({steps:args.steps,completion:args.completion,adapter,context});
    if(result.status==='completed')return result;
    if(result.reason==='replay_blocked'){result.input_suppressed=true;result.recovery_required=true;}
    if(attempts.length){
      const ledger=prior||{window:key(initial.window),blocked:new Set()};
      for(const a of attempts)ledger.blocked.add(signature(a.step,a.control));
      this.tasks.set(scope,ledger);
      if(this.tasks.size>128)this.tasks.delete(this.tasks.keys().next().value);
      result.attempted_steps=attempts.map(a=>({op:a.step.op,target:{name:a.control.name,role:normalizeRole(a.control.role||a.control.type),match:'exact'}}));
    }
    if(context.signal?.aborted||['cancelled','deadline_exceeded'].includes(result.reason))return result;
    if(result.outcome_unknown&&recoverableReasons.has(result.reason)&&attempts.length&&attempts.every(a=>cleanDelivery(a.result))){
      // Re-read only. Do not infer delivery from the driver's 'unverifiable'
      // effect and do not clear outcome_unknown. Require actual UI progress
      // after every unconfirmed input before admitting a different control.
      try{result.observation=await adapter.snapshot({refresh:true},context);}catch{return result;}
      if(!complete(result.observation))return result;
      result.read_only_recovery=true;
      const uncertain=attempts.map((a,i)=>({...a,next:attempts[i+1]?.frame||result.observation})).filter(a=>a.result.verified!==true&&a.result.input_delivered!==true);
      if(uncertain.length&&uncertain.every(a=>changed(a.frame,a.next,a.control))){
        result.distinct_action_recovery=true;
        result.recovery={observed:true,state_changed:true};
      }
    }
    if((result.recovery_required&&!result.outcome_unknown&&attempts.length)||distinctRecovery(result)){
      result.recovery_required=true;
      result.message='The plan stopped at a missing or ambiguous target. Earlier inputs are blocked from replay. Continue only the unfinished task with a distinct control in the returned window using computer_execute_plan.';
    }
    return result;
  }
}
module.exports={NativePlanRecovery,distinctRecovery};
