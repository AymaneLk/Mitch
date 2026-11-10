'use strict';
const {validateTaskProgram}=require('./task-program');
// Fuse adjacent phases in the SAME binding. Preserve every intermediate
// completion as an assertion; never fuse across branches, reads or navigation.
function optimizeWorkflow(program,bindings={}){
  const source=validateTaskProgram(program,bindings),copy=structuredClone(source);
  let merged=0;
  const optimize=steps=>{
    const result=[];
    for(const original of steps){
      const step=original.op==='if'?{...original,then:optimize(original.then),...(original.else?{else:optimize(original.else)}:{})}:original;
      const previous=result.at(-1);
      if(previous?.op==='act'&&step.op==='act'&&!previous.steps.some(action=>['assert','wait'].includes(action.op))&&!step.steps.some(action=>['assert','wait'].includes(action.op))&&previous.steps.length+previous.completion.length+step.steps.length<=12){
        previous.steps.push(...previous.completion.map(condition=>({op:'assert',...condition})),...step.steps);previous.completion=step.completion;merged++;
      }else result.push(step);
    }
    return result;
  };
  copy.steps=optimize(copy.steps);return {program:validateTaskProgram(copy,bindings),mergedPhases:merged};
}
module.exports={optimizeWorkflow};
