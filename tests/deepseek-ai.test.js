const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AI}=require('../ai');
const {Store}=require('../core');
const {LocalConversation}=require('../local-conversation');
const {deepseekURL,deepseekHeaders,checkDeepSeek,deepseekPayload}=require('../deepseek-ai');
const base={localOnly:true,chatProvider:'deepseek',transcriptionProvider:'local',deepseekChatModel:'deepseek-flash',localSpeechUrl:'http://127.0.0.1:22132',allowScreen:false};
const noCloud=async()=>assert.fail('OpenAI key must not be read');
const reply=message=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message}]})});

test('DeepSeek tools use a dedicated key and supported payload; switching local drops authentication',async()=>{
  const settings={...base},requests=[],actions=[];
  const ai=new AI(()=>settings,noCloud,async(name,args)=>{actions.push({name,args});return {status:'saved',id:'fixture-note'};},async(url,options)=>{
    requests.push({url,...options});
    return requests.length===1?reply({tool_calls:[{id:'d1',function:{name:'create_note',arguments:JSON.stringify({title:'Fixture',text:'Hello'})}}]}):reply({content:'Done.'});
  },async()=>'deepseek-fixture-key');
  assert.equal(await ai.chat('Save a note'),'Done.');assert.equal(actions.length,1);assert.equal(actions[0].name,'create_note');
  assert.ok(requests.every(r=>r.url===deepseekURL()&&r.headers.Authorization==='Bearer deepseek-fixture-key'&&r.redirect==='error'));
  const payload=JSON.parse(requests[1].body);
  assert.equal(payload.model,'deepseek-flash');assert.deepEqual(payload.thinking,{type:'enabled'});assert.equal(payload.reasoning_effort,'high');assert.equal(payload.max_tokens,8192);
  assert.equal(payload.messages.at(-1).tool_call_id,'d1');
  for(const field of ['top_k','min_p','chat_template_kwargs'])assert.equal(payload[field],undefined);
  settings.chatProvider='local';await ai.chat('Hello');
  assert.equal(requests.at(-1).headers.Authorization,undefined);assert.equal(requests.at(-1).url,'http://127.0.0.1:22130/v1/chat/completions');
});

test('DeepSeek failure never falls back and missing credentials never send a request',async()=>{
  let calls=0;const ai=new AI(()=>base,noCloud,()=>assert.fail('No action'),async()=>{calls++;throw new Error('Service unavailable');});
  await assert.rejects(ai.chat('Hello'),/DeepSeek API key/);assert.equal(calls,0);
  ai.getDeepSeekKey=async()=>'fixture';await assert.rejects(ai.chat('Hello'),/Service unavailable/);assert.equal(calls,1);assert.equal(ai.busy,false);
});

test('DeepSeek destination cannot be overridden and invalid headers are rejected',async()=>{
  for(const endpoint of ['https://evil.test','user/balance','../models'])assert.throws(()=>deepseekURL(endpoint));
  for(const key of ['',undefined,'bad\nheader'])assert.throws(()=>deepseekHeaders(key));
  const ai=new AI(()=>({...base,deepseekChatUrl:'https://evil.test'}),noCloud,()=>{},async(url,options)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'error');return reply({content:'Hello'});
  },async()=>'fixture');await ai.chat('Hello');
});

test('connection check verifies model availability and a small inference request',async()=>{
  const requests=[];const result=await checkDeepSeek(async(url,options)=>{requests.push({url,...options});return requests.length===1?{ok:true,json:async()=>({data:[{id:'deepseek-flash'}]})}:reply({content:'OK'});},base,'fixture');
  assert.deepEqual(result,{status:'connected',model:'deepseek-flash'});assert.equal(JSON.parse(requests[1].body).max_tokens,1024);assert.equal(JSON.parse(requests[1].body).thinking.type,'enabled');assert.equal(JSON.parse(requests[1].body).reasoning_effort,'high');
  assert.ok(requests.every(r=>r.redirect==='error'&&r.headers.Authorization==='Bearer fixture'));
});

test('unavailable model does not issue an inference request',async()=>{
  let calls=0;await assert.rejects(checkDeepSeek(async()=>{calls++;return {ok:true,json:async()=>({data:[{id:'another-model'}]})};},base,'fixture'),/not available/);assert.equal(calls,1);
});

test('DeepSeek errors explain insufficient credit without echoing server secrets',async()=>{
  const ai=new AI(()=>base,noCloud,()=>assert.fail('No action'),async()=>({ok:false,status:402,json:async()=>({error:{message:'secret-fixture'}})}),async()=>'fixture');
  await assert.rejects(ai.chat('Hello'),error=>/balance is insufficient/.test(error.message)&&!error.message.includes('secret-fixture'));
});

test('DeepSeek JSON schema requests use JSON mode and validate locally',async()=>{
  const format={type:'json_schema',json_schema:{schema:{type:'object',properties:{status:{const:'ok'}},required:['status'],additionalProperties:false}}};
  let content='{"status":"ok"}';
  const ai=new AI(()=>base,noCloud,()=>{},async(_url,options)=>{
    const body=JSON.parse(options.body);assert.deepEqual(body.response_format,{type:'json_object'});assert.match(body.messages[0].content,/JSON schema/);assert.equal(body.thinking.type,'enabled');assert.equal(body.max_tokens,8192);return reply({content});
  },async()=>'fixture');
  const body={input:[{role:'user',content:'Check'}],response_format:format};
  await ai.request('responses',body);
  for(content of ['   ','{"status":"wrong"}','{"status":"ok","unexpected":true}'])await assert.rejects(ai.request('responses',body),/JSON/);
});

test('DeepSeek images follow screen permission including revocation during key retrieval',async()=>{
  const settings={...base,allowScreen:true};let captured;
  const ai=new AI(()=>settings,noCloud,()=>{},async(_url,options)=>{captured=JSON.parse(options.body);return reply({content:'Observed.'});},async()=>'fixture');
  const body={input:[{role:'user',content:[{type:'input_text',text:'Look'},{type:'input_image',image_url:'data:image/png;base64,AAAA'}]}]};
  await ai.request('responses',body);assert.ok(JSON.stringify(captured).includes('data:image'));
  ai.getDeepSeekKey=async()=>{settings.allowScreen=false;return 'fixture';};
  await ai.request('responses',body);assert.ok(!JSON.stringify(captured).includes('data:image'));
});

test('truncated DeepSeek tool calls are never dispatched',async()=>{
  const ai=new AI(()=>base,noCloud,()=>assert.fail('No action'),async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{tool_calls:[{function:{name:'open_app',arguments:'{}'}}]}}]})}),async()=>'fixture');
  await assert.rejects(ai.chat('Open app'),/truncated/);
});

test('cancelling DeepSeek inference stops before any action',async()=>{
  let entered;const started=new Promise(r=>entered=r);
  const ai=new AI(()=>base,noCloud,()=>assert.fail('No action'),async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();}),async()=>'fixture');
  const pending=ai.chat('Wait');await started;ai.cancel();await assert.rejects(pending,/stopped/);assert.equal(ai.busy,false);
});

test('DeepSeek provider survives restart while OpenAI remains disabled',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-deepseek-'));
  try {const store=new Store(directory);Object.assign(store.data.settings,base);store.save();const restored=new Store(directory);assert.equal(restored.data.settings.chatProvider,'deepseek');assert.equal(restored.data.settings.localOnly,true);assert.equal(restored.data.settings.transcriptionProvider,'local');}finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('DeepSeek voice keeps audio recognition and synthesis on loopback',async()=>{
  const urls=[];const conversation=new LocalConversation({cancel(){},async chat(text){assert.equal(text,'Hello Mitch');return 'Hello.';}},()=>base,async(url)=>{urls.push(url);return url.endsWith('/transcribe')?{ok:true,json:async()=>({text:'Hello Mitch'})}:{ok:true,arrayBuffer:async()=>new Uint8Array([1,2]).buffer};});
  const generation=conversation.start(),result=await conversation.turn(Buffer.from('fake-audio'),generation);
  assert.equal(result.answer,'Hello.');assert.deepEqual(urls,['http://127.0.0.1:22132/transcribe','http://127.0.0.1:22132/speech','http://127.0.0.1:22132/speech']);conversation.stop();
});

test('thinking retains full reasoning and mixed text/tool responses over multiple calls and user turns',async()=>{
  const requests=[],actions=[];
  const call=(id)=>({id,function:{name:'read_notes',arguments:'{"query":"fixture"}'}});
  const responses=[
    {content:'I will check.',reasoning_content:'private-step-one',tool_calls:[call('a'),call('b')]},
    {reasoning_content:'private-step-two',tool_calls:[call('c')]},
    {reasoning_content:'private-final-one',content:'ORCHID.'},
    {reasoning_content:'private-final-two',content:'Yes, ORCHID.'}
  ];
  const ai=new AI(()=>base,noCloud,async(name)=>{actions.push(name);return{notes:[{text:'ORCHID'}]};},async(_url,options)=>{requests.push(JSON.parse(options.body));return reply(responses[requests.length-1]);},async()=>'fixture');
  assert.equal(await ai.chat('Read the fixture notes'),'ORCHID.');
  assert.equal(actions.length,3);
  const first=requests[1].messages.filter(m=>m.role==='assistant');
  assert.equal(first.length,1);assert.equal(first[0].tool_calls.length,2);
  assert.equal(first[0].reasoning_content,'private-step-one');assert.equal(first[0].content[0].text,'I will check.');
  const third=requests[2].messages.filter(m=>m.role==='assistant');
  assert.deepEqual(third.map(m=>m.reasoning_content),['private-step-one','private-step-two']);
  assert.equal(await ai.chat('Confirm the code'),'Yes, ORCHID.');
  assert.equal(requests[3].messages.find(m=>m.role==='assistant').reasoning_content,'private-final-one');
  assert.ok(!JSON.stringify(ai.history).includes('private-'));
  assert.ok(requests.every(r=>r.thinking.type==='enabled'&&r.reasoning_effort==='high'));
});

test('fast screenshot helpers explicitly disable thinking without mutating continuation data',()=>{
  const original={messages:[{role:'assistant',content:'Earlier reply',reasoning_content:'private-fixture'}],max_tokens:1024};
  const fast=deepseekPayload(original,{localThinking:false},base);
  assert.equal(fast.thinking.type,'disabled');assert.equal(fast.reasoning_effort,undefined);assert.equal(fast.max_tokens,1024);
  assert.equal(fast.messages[0].reasoning_content,undefined);assert.equal(original.messages[0].reasoning_content,'private-fixture');
});

test('non-thinking history can be reused without inventing missing reasoning',()=>{
  const output=deepseekPayload({messages:[{role:'assistant',content:'Old reply'}],max_tokens:4096},{},base);
  assert.equal(output.messages[0].reasoning_content,'');
});
