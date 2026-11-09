'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildTasks,median,summarize}=require('../scripts/benchmark-deepseek');
test('benchmark fixtures use actual tools and equal High-thinking request parameters',async()=>{
  const tasks=await buildTasks();assert.equal(tasks.length,4);
  for(const task of tasks){
    assert.equal(task.payload.thinking.type,'enabled');assert.equal(task.payload.reasoning_effort,'high');assert.equal(task.payload.stream,false);assert.equal(task.payload.max_tokens,8192);
    assert.ok(task.payload.tools.some(t=>t.function.name==='computer_action'));
    assert.ok(!JSON.stringify(task.payload).includes('data:image'));
  }
});
test('benchmark medians exclude warmup and report failed responses separately',()=>{
  assert.equal(median([4,1,3,2]),2.5);assert.equal(median([3,1,2]),2);assert.equal(median([]),null);
  const report=summarize([{model:'deepseek-flash',warmup:true,status:'ok',duration_ms:999},{model:'deepseek-flash',status:'ok',duration_ms:100,correct:true},{model:'deepseek-flash',status:'ok',duration_ms:300,correct:false},{model:'deepseek-flash',status:'error',duration_ms:90000}]);
  assert.equal(report['deepseek-flash'].median_ms,200);assert.equal(report['deepseek-flash'].attempts,3);assert.equal(report['deepseek-flash'].responses,2);assert.equal(report['deepseek-flash'].correct,1);
});
