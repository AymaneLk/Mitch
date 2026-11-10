'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {optimizeWorkflow}=require('../workflow-optimize');
const act=name=>({op:'act',steps:[{op:'click',target:{name}}],completion:[{target:{name:name+' open'},condition:'exists'}]});
const program=()=>({version:1,steps:[{op:'bind',target:{kind:'native',app:'Example'}},act('Menu'),act('Settings')]});
test('adjacent phases coalesce without losing intermediate or final assertions',()=>{
  const original=program(),result=optimizeWorkflow(original);assert.equal(result.mergedPhases,1);assert.equal(original.steps.length,3);
  assert.deepEqual(result.program.steps[1].steps.map(s=>s.op),['click','assert','click']);assert.equal(result.program.steps[1].steps[1].target.name,'Menu open');assert.equal(result.program.completion[0].target.name,'Settings open');
});
test('binding changes and explicit wait/assert boundaries cannot be fused',()=>{
  const p=program();p.steps.splice(2,0,{op:'bind',target:{kind:'native',app:'Second'}});assert.equal(optimizeWorkflow(p).mergedPhases,0);
  const q=program();q.steps[1].steps.push({op:'wait',target:{name:'Ready'}});assert.equal(optimizeWorkflow(q).mergedPhases,0);
});
