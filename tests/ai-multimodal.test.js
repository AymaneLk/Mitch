const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const settings=()=>({chatModel:'gpt-6-luna',voiceModel:'gpt-live-1'});
const response=output=>({ok:true,json:async()=>({status:'completed',output})});
const call=(id,name,args={})=>({type:'function_call',call_id:id,name,arguments:JSON.stringify(args)});
const final=()=>[{type:'message',role:'assistant',content:[{type:'output_text',text:'The result is 42.'}]}];
test('chat sends screenshot directly to its existing reasoning model and forgets old pixels',async()=>{
  const requests=[],image='data:image/png;base64,aGVsbG8=';
  const ai=new AI(settings,async()=>'test-key',async(name,args)=>({status:'observed',snapshot:name==='computer_observe'?'first':'second',_images:[{data_url:image,detail:'high'}]}),async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body)});
    return response(requests.length===1?[call('one','computer_observe')]:requests.length===2?[call('two','computer_input',{snapshot:'first',kind:'key',key:'Enter'})]:final());
  });
  assert.equal(await ai.chat('Calculate 6 * 7'),'The result is 42.');
  assert.equal(requests.length,3);assert.ok(requests.every(r=>r.url.endsWith('/responses')&&r.body.model==='gpt-6-luna'&&r.body.reasoning.effort==='low'));
  const second=requests[1].body.input.at(-1);
  assert.equal(second.call_id,'one');assert.equal(second.output[1].type,'input_image');assert.equal(second.output[1].image_url,image);
  assert.ok(!second.output[0].text.includes('base64'));
  const toolOutputs=requests[2].body.input.filter(item=>item.type==='function_call_output');
  assert.deepEqual(toolOutputs.map(item=>item.output.filter(p=>p.type==='input_image').length),[0,1]);
  assert.deepEqual(toolOutputs.map(item=>item.call_id),['one','two']);
  assert.ok(!JSON.stringify(ai.history).includes(image));assert.equal(ai.history.length,2);
});
test('ordinary workflows can pass the former twelve-step ceiling',async()=>{
  let requests=0,actions=0;
  const ai=new AI(settings,async()=>'test-key',async()=>{actions++;return{status:'observed'};},async()=>response(++requests<=13?[call('c'+requests,'computer_find_window')]:final()));
  assert.equal(await ai.chat('Finish the requested workflow'),'The result is 42.');assert.equal(actions,13);
});
test('a cancelled voice session creation cannot restore its sideband state',async()=>{
  let resolve,entered;const started=new Promise(r=>{entered=r;});
  const ai=new AI(settings,async()=>'test-key',async()=>{},async()=>{entered();return new Promise(r=>{resolve=r;});});
  const pending=ai.voice('v=0\r\n');await started;ai.closeVoice();resolve({ok:true,json:async()=>({session:{id:'late-session'},transport:{sdp:'answer'}})});await pending;
  assert.equal(ai.liveToolChannel.sessionId,null);await assert.rejects(ai.continueVoice([{call_id:'late',output:{status:'ok'}}]),/stopped or session changed/);
});
test('revoking screen sharing during a tool or before the request sends removes captured pixels',async()=>{
  for(const revokeDuring of ['tool','credentials']){
    let allowScreen=true,keys=0;const requests=[],image='data:image/png;base64,aGVsbG8=';
    const ai=new AI(()=>({...settings(),allowScreen}),async()=>{if(++keys===2&&revokeDuring==='credentials')allowScreen=false;return'test-key';},async()=>{if(revokeDuring==='tool')allowScreen=false;return{status:'observed',snapshot:'private',_images:[{data_url:image}]};},async(url,options)=>{
      requests.push(JSON.parse(options.body));return response(requests.length===1?[call('one','computer_observe')]:final());
    });
    await ai.chat('Check the window');
    assert.equal(requests.length,2);assert.ok(!JSON.stringify(requests[1]).includes(image));assert.ok(JSON.stringify(requests[1]).includes('private'));
  }
});
