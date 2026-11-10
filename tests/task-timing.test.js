'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {toolDiagnostics,taskTimingSummary}=require('../task-timing');

test('tool diagnostics retain only useful fixed-vocabulary failure metadata',()=>{
  const result=toolDiagnostics({status:'interrupted',reason:'page_outcome_unknown',source_reason:'condition_unmet',code:'browser_timeout',attempted:1,completed:0,verified:false,outcome_unknown:true,message:'secret message',args:{text:'secret input'},observation:{url:'https://secret.test/?token=secret'}});
  assert.deepEqual(result,{status:'interrupted',reason:'page_outcome_unknown',code:'browser_timeout',source_reason:'condition_unmet',attempted:1,completed:0,verified:false,outcome_unknown:true});
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('malicious labels and invalid diagnostic scalars cannot persist content',()=>{
  const result=toolDiagnostics({status:'secret_status',reason:'secret_credential',code:'secret_api_key',source_reason:'https://secret.test',attempted:100000,completed:-1,verified:'secret',outcome_unknown:{secret:true},message:'secret',title:'secret'});
  assert.deepEqual(result,{status:'other',reason:'other',code:'other',source_reason:'other'});
  assert.deepEqual(toolDiagnostics({status:'error',message:'Invalid action arguments: secret field and secret URL'}),{status:'error',code:'invalid_tool_arguments'});
  assert.deepEqual(toolDiagnostics({status:'error'},new SyntaxError('secret JSON')),{status:'error',code:'invalid_tool_json'});
  assert.deepEqual(toolDiagnostics(undefined,Object.assign(Error('secret'),{code:'secret_exception'})),{code:'other'});
});

test('publisher re-sanitizes timing records instead of trusting arbitrary step fields',()=>{
  const summary=taskTimingSummary({route:'secret_route',totalMs:Infinity,modelRequests:4,modelMs:12,toolCalls:1,toolMs:3,args:'secret',steps:[
    {kind:'tool',name:'browser_execute_plan',ms:3,reason:'condition_unmet',source_reason:'secret_code',attempted:1,completed:0,message:'secret',args:{url:'https://secret.test'}},
    {kind:'secret_kind',name:'secret_tool',ms:-3,code:'secret_code'},
  ]},new Set(['browser_execute_plan']));
  assert.equal(summary.route,'other');assert.equal(summary.totalMs,0);assert.equal(summary.modelRequests,4);
  assert.deepEqual(summary.steps,[{kind:'tool',name:'browser_execute_plan',ms:3,reason:'condition_unmet',source_reason:'other',attempted:1,completed:0},{kind:'other',ms:0}]);
  assert.ok(!JSON.stringify(summary).includes('secret'));
  assert.equal(taskTimingSummary({steps:Array(1000).fill({kind:'decision',ms:1})},[]).steps.length,256);
});

test('AI timing preserves plan failure cause and counts without tool arguments or response content',async()=>{
  const ai=new AI(()=>({chatProvider:'chatgpt',chatModel:'test',allowDesktop:false,allowScreen:false}),()=>assert.fail('No credentials'),async()=>({status:'interrupted',reason:'page_outcome_unknown',source_reason:'completion_unmet',attempted:1,completed:1,verified:false,outcome_unknown:true,message:'secret response',observation:{url:'https://secret.test'}}),()=>assert.fail('No network'));
  ai.request=async()=>({status:'completed',output:[{type:'function_call',call_id:'owned',name:'browser_execute_plan',arguments:JSON.stringify({snapshot:'secret snapshot',steps:[{text:'secret user content'}]})}]});
  await ai.chat('A synthetic request');
  const step=ai.lastTaskTiming.steps.find(item=>item.kind==='tool');
  assert.equal(step.name,'browser_execute_plan');assert.equal(step.source_reason,'completion_unmet');assert.equal(step.reason,'page_outcome_unknown');assert.equal(step.attempted,1);assert.equal(step.completed,1);assert.equal(step.outcome_unknown,true);
  assert.ok(!JSON.stringify(ai.lastTaskTiming).includes('secret'));
  assert.ok(!JSON.stringify(taskTimingSummary(ai.lastTaskTiming,['browser_execute_plan'])).includes('secret'));
});

test('AI timing distinguishes malformed JSON and thrown schema errors without saving messages',async()=>{
  for(const malformed of [true,false]){
    let request=0;
    const ai=new AI(()=>({chatProvider:'test',chatModel:'test'}),()=>assert.fail('No credentials'),async()=>{throw Error('Invalid action arguments: secret');},()=>assert.fail('No network'));
    ai.request=async()=>({status:'completed',output:++request===1?[{type:'function_call',call_id:'owned',name:'browser_execute_plan',arguments:malformed?'{':'{}'}]:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Fixture ended.'}]}]});
    assert.equal(await ai.chat('Synthetic request'),'Fixture ended.');
    const step=ai.lastTaskTiming.steps.find(item=>item.kind==='tool');
    assert.equal(step.code,malformed?'invalid_tool_json':'invalid_tool_arguments');assert.ok(!JSON.stringify(ai.lastTaskTiming).includes('secret'));
  }
});
