const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AI}=require('../ai');
const {localURL,chatPayload}=require('../local-ai');
const settings=()=>({chatProvider:'local',transcriptionProvider:'local',localChatModel:'mitch-local',allowScreen:true,formatDictation:true});
const noKey=async()=>{throw new Error('Cloud key must not be read');};
const reply=message=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message}]})});

test('local tool loop preserves IDs and returns outputs without cloud authentication',async()=>{
  const requests=[],actions=[];
  const ai=new AI(settings,noKey,async(name,args)=>{actions.push([name,args]);return {status:'saved',id:'note1'};},async(url,options)=>{
    requests.push({url,...options});
    return requests.length===1?reply({tool_calls:[{id:'local-call',function:{name:'create_note',arguments:'{"title":"Test","text":"Local"}'}}]}):reply({content:'Saved.'});
  });
  assert.equal(await ai.chat('Save a note'),'Saved.');
  assert.equal(actions[0][0],'create_note');
  assert.ok(requests.every(r=>r.url==='http://127.0.0.1:22130/v1/chat/completions'&&!r.headers.Authorization&&r.redirect==='error'));
  const body=JSON.parse(requests[1].body);
  assert.equal(body.messages.at(-1).tool_call_id,'local-call');
  assert.equal(JSON.parse(body.messages.at(-1).content).id,'note1');
  assert.equal(body.tools[0].type,'function');
});

test('local images remain multimodal and are removed when screen sharing is revoked',()=>{
  const body={input:[{type:'function_call_output',call_id:'a',output:[{type:'input_text',text:'{"status":"observed"}'},{type:'input_image',image_url:'data:image/png;base64,AAAA'}]}]};
  assert.equal(chatPayload(body,{allowScreen:true}).messages[1].content[1].type,'image_url');
  assert.equal(chatPayload(body,{allowScreen:false}).messages.length,1);
});

test('local transcription does not call cloud formatting even when enabled',async()=>{
  const urls=[];const ai=new AI(settings,noKey,()=>{},async(url,options)=>{urls.push(url);assert.equal(options.headers,undefined);return {ok:true,json:async()=>({text:'Bonjour Mitch.'})};});
  assert.equal(await ai.transcribe(Buffer.from('recording')),'Bonjour Mitch.');
  assert.deepEqual(urls,['http://127.0.0.1:22132/transcribe']);
});

test('local failure does not fall back to OpenAI and releases the busy flag',async()=>{
  let count=0;const ai=new AI(settings,noKey,()=>{},async()=>{count++;throw new Error('Service unavailable');});
  await assert.rejects(ai.chat('Hi'),/Service unavailable/);assert.equal(count,1);assert.equal(ai.busy,false);
});

test('truncated tool calls are never dispatched',async()=>{
  let called=false;const ai=new AI(settings,noKey,()=>{called=true;},async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{tool_calls:[{function:{name:'open_app',arguments:'{}'}}]}}]})}));
  await assert.rejects(ai.chat('Open app'),/truncated/);assert.equal(called,false);
});

test('local endpoint validation rejects remote addresses and embedded credentials',()=>{
  for(const address of ['https://example.com','http://127.0.0.1.evil.test','http://user:secret@localhost','file:///test','http://localhost?key=secret'])assert.throws(()=>localURL(address,'test'),/local AI|loopback/);
  assert.equal(localURL('http://127.0.0.1:22130/v1/','chat/completions'),'http://127.0.0.1:22130/v1/chat/completions');
});

test('cancelling local inference aborts the request before any action',async()=>{
  let entered;const started=new Promise(r=>entered=r);
  const ai=new AI(settings,noKey,()=>assert.fail('No tool should run'),async(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();}));
  const pending=ai.chat('Wait');await started;ai.cancel();await assert.rejects(pending,/stopped/);assert.equal(ai.busy,false);
});
