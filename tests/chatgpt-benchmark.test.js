'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {summarize,percentile}=require('../scripts/benchmark-chatgpt');
test('transport benchmark excludes warmups and failures from latency, but counts task failures',()=>{
  const call=ms=>({success:true,ms,firstTextMs:ms/2});
  const result=summarize([{transport:'http',warmup:true,verified:true,ms:9999,calls:[call(9999)]},{transport:'http',verified:true,ms:200,calls:[call(100)]},{transport:'http',verified:false,ms:90000,calls:[{success:false,ms:90000}]},{transport:'websocket',verified:true,ms:50,calls:[call(25)]}]);
  assert.equal(result.http.tasks,2);assert.equal(result.http.verifiedTasks,1);assert.equal(result.http.taskSuccessRate,.5);assert.equal(result.http.medianModelMs,100);assert.equal(result.http.p95ModelMs,100);assert.equal(result.http.errorRecoverySuccessRate,null);assert.equal(result.websocket.medianFirstTextMs,12.5);assert.equal(percentile([],.5),null);
});
