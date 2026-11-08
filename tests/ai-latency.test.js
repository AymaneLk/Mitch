const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const {AI}=require('../ai');

const settings=model=>()=>({chatModel:model,voiceModel:'gpt-live-1'});
const answer={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Done.'}]}]};
const response=data=>({ok:true,json:async()=>data});

test('the default model uses supported low effort for chat and voice without changing the model or service tier',async()=>{
  const requests=[];
  const ai=new AI(settings('gpt-6-luna'),async()=>'test-key',()=>{},async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return response(url.endsWith('/live/sessions')?{transport:{sdp:'answer'}}:answer);
  });
  assert.equal(await ai.chat('Hello'),'Done.');
  await ai.voice('v=0\r\n');
  for(const body of [requests[0].body,requests[1].body.session.delegation.responses]){
    assert.equal(body.model,'gpt-6-luna');
    assert.deepEqual(body.reasoning,{effort:'low'});
    assert.equal(body.service_tier,undefined);
    assert.equal(body.parallel_tool_calls,false);
  }
});

test('custom model settings do not receive unsupported speed parameters',async()=>{
  const requests=[];
  const ai=new AI(settings('gpt-4.1'),async()=>'test-key',()=>{},async(url,options)=>{
    requests.push(JSON.parse(options.body));
    return response(url.endsWith('/live/sessions')?{transport:{sdp:'answer'}}:answer);
  });
  await ai.chat('Hello');await ai.voice('v=0\r\n');
  for(const body of [requests[0],requests[1].session.delegation.responses]){
    assert.equal(body.model,'gpt-4.1');
    assert.equal(body.reasoning,undefined);
  }
});

test('a tool loop keeps its instruction prefix and model stable while appending each result',async()=>{
  let tick=Date.parse('2026-11-07T00:00:00Z');
  class AdvancingDate extends Date{constructor(...args){super(...(args.length?args:[tick+=60000]));}}
  const aiFile=path.join(__dirname,'../ai.js'),sandbox={module:{exports:{}},require:createRequire(aiFile),Date:AdvancingDate,AbortController,AbortSignal};
  vm.runInNewContext(fs.readFileSync(aiFile,'utf8'),sandbox,{filename:aiFile});
  const requests=[];let configuredModel='gpt-6-luna';
  const ai=new sandbox.module.exports.AI(()=>({chatModel:configuredModel}),async()=>'test-key',async()=>{
    configuredModel='gpt-4.1';return {status:'verified',observation:{snapshot:'new-observation'}};
  },async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    return response(requests.length===1?{status:'completed',output:[{type:'function_call',call_id:'call1',name:'computer_action',arguments:'{}'}]}:answer);
  });
  assert.equal(await ai.chat('Click the selected control'),'Done.');
  assert.equal(requests.length,2);
  assert.equal(requests[0].instructions,requests[1].instructions);
  assert.equal(requests[0].model,requests[1].model);
  const returned=requests[1].input.at(-1);
  assert.equal(returned.call_id,'call1');
  assert.equal(JSON.parse(returned.output).observation.snapshot,'new-observation');
});
