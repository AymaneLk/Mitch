'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WebSocketServer,WebSocket}=require('ws');
const {ChatGPTResponses,payload,ENDPOINT,SOCKET}=require('../chatgpt-responses');
const tool={type:'function',name:'open_app',description:'Open an observed app',parameters:{type:'object',properties:{app_id:{type:'string'}},required:['app_id'],additionalProperties:false}};
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const answer=(output=[message('Hello')],id='resp1')=>({type:'response.completed',response:{id,status:'completed',output}});
const call={type:'function_call',namespace:'mitch',name:'open_app',call_id:'call1',arguments:'{"app_id":"calculator"}',status:'completed'};
function stream(events,{split=false}={}){
  const text=events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('');
  return new Response(new ReadableStream({start(c){for(const part of split?[...text]:[text])c.enqueue(new TextEncoder().encode(part));c.close();}}),{headers:{'content-type':'text/event-stream'}});
}
function fixture(fetcher=async()=>stream([answer()]),transport='http'){
  const account={id:'a',models:[{id:'authorized-model',name:'Available model'}],catalogAt:Date.now(),transport},calls=[],metrics=[],statuses=[];
  const auth={epoch:0,data:{activeId:'a'},active:()=>account,lease:()=>({id:'a',epoch:auth.epoch}),check:l=>{if(l.epoch!==auth.epoch)throw Object.assign(new Error('Account changed'),{code:'account_changed'});},model:()=>account.models[0]?.id,access:async(l,o)=>{auth.check(l);calls.push(o);return 'oauth-secret';},catalog:async()=>{account.catalogAt=Date.now();}};
  const provider=new ChatGPTResponses({auth,fetcher,onMetrics:m=>metrics.push(m),onStatus:s=>statuses.push(s)});
  return {auth,account,calls,metrics,statuses,provider,body:{input:[{role:'user',content:'Hello'}],tools:[tool]}};
}
test('payload uses account models, tool namespaces and stateless context, excluding unsupported legacy options',()=>{
  const body={input:[{role:'system',content:'Instructions'},{type:'reasoning',encrypted_content:'encrypted'},{...call,_localReasoning:'private'},{type:'function_call_output',call_id:'call1',output:'Opened'}],tools:[tool],model:'old-model',max_output_tokens:42,temperature:0.5,previous_response_id:'old',reasoning:{effort:'invented'},localThinking:false};
  const p=payload(body,'authorized-model');assert.equal(p.model,'authorized-model');assert.equal(p.store,false);assert.equal(p.stream,true);assert.equal(p.tools[0].type,'namespace');assert.equal(p.tools[0].name,'mitch');assert.equal(p.tools[0].tools[0].strict,false);assert.equal(p.input[0].role,'developer');assert.equal(p.input[2].call_id,'call1');assert.equal(p.input[3].call_id,'call1');assert.equal(p.input[1].encrypted_content,'encrypted');
  for(const key of ['max_output_tokens','temperature','previous_response_id','reasoning','localThinking'])assert.equal(p[key],undefined);assert.equal(p.input[2]._localReasoning,undefined);
});
test('native computer tools are rejected; revoked screenshot permission removes images at send boundary',()=>{
  assert.throws(()=>payload({input:[],tools:[{type:'computer'}]},'model'),{code:'unsupported_tool'});
  const p=payload({input:[{role:'user',content:[{type:'input_text',text:'where'},{type:'input_image',image_url:'data:image/png;base64,secret'}]},{type:'function_call_output',call_id:'c',output:[{type:'input_image',image_url:'private'},{type:'input_text',text:'result'}]}]},'model',false);
  assert.equal(JSON.stringify(p).includes('input_image'),false);assert.equal(p.input[1].output[0].text,'result');
});
test('HTTP streams text across split UTF-8/SSE boundaries and requires completed output',async()=>{
  let sent;const f=fixture(async(url,o)=>{sent={url,...o};return stream([{type:'response.created',response:{id:'resp1'}},{type:'response.output_text.delta',delta:'Hello 🌍'},answer([message('Hello 🌍')])],{split:true});});const text=[];
  const result=await f.provider.request(f.body,{onText:d=>text.push(d)});assert.equal(result.status,'completed');assert.equal(text.join(''),'Hello 🌍');assert.equal(sent.url,ENDPOINT);assert.equal(sent.headers.Authorization,'Bearer oauth-secret');assert.equal(sent.redirect,'error');assert.equal(f.metrics[0].success,true);assert.ok(f.metrics[0].firstTextMs>=0);
});
test('only completed namespaced tool calls reach the caller with their original call IDs',async()=>{
  const f=fixture(async()=>stream([{type:'response.output_item.added',item:{type:'function_call',name:'open_app'}},{type:'response.function_call_arguments.delta',delta:'{"app_id":'},answer([call])]));
  assert.deepEqual((await f.provider.request(f.body)).output,[call]);
});
test('the live OAuth route may omit Content-Type but still must supply a completed SSE event',async()=>{
  const bytes=text=>new Response(new TextEncoder().encode(text));
  const f=fixture(async()=>bytes('data: '+JSON.stringify(answer([call]))+'\n\n'));
  assert.deepEqual((await f.provider.request(f.body)).output,[call]);
  f.provider.fetch=async()=>bytes('data: '+JSON.stringify({type:'response.output_item.added',item:call})+'\n\n');
  await assert.rejects(f.provider.request(f.body),{code:'stream_interrupted'});
  f.provider.fetch=async()=>bytes(JSON.stringify(answer([call])));
  await assert.rejects(f.provider.request(f.body),{code:'stream_interrupted'});
  f.provider.fetch=async()=>bytes(JSON.stringify({error:{code:'subscription_sharing_usage_limit_exceeded'}}));
  await assert.rejects(f.provider.request(f.body),{code:'subscription_sharing_usage_limit_exceeded'});
});
test('unknown namespace, unknown tools, duplicate IDs and malformed arguments cannot reach executor',async()=>{
  for(const output of [[{...call,namespace:'hostile'}],[{...call,name:'run_anything'}],[call,call],[{...call,arguments:'{'}],[{...call,status:'incomplete'}],[{...call,async:true}]]){
    const f=fixture(async()=>stream([answer(output)]));await assert.rejects(f.provider.request(f.body),e=>['invalid_tool_call','invalid_tool_arguments'].includes(e.code));
  }
});
test('failed, incomplete, malformed, non-stream and prematurely closed responses never succeed',async()=>{
  const cases=[()=>stream([{type:'response.output_text.delta',delta:'Done'}]),()=>stream([{type:'response.incomplete',response:{id:'resp1'}}]),()=>stream([{type:'response.failed',response:{error:{code:'server_error'}}}]),()=>new Response('data: {invalid}\n\n',{headers:{'content-type':'text/event-stream'}}),()=>Response.json({status:'completed'})];
  for(const response of cases){const f=fixture(async()=>response());await assert.rejects(f.provider.request(f.body));assert.equal(f.metrics[0].success,false);}
});
test('mid-stream subscription usage limits pause new calls until explicit user resume',async()=>{
  let requests=0;const f=fixture(async()=>{requests++;return stream([{type:'response.output_text.delta',delta:'Starting'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}]);});
  for(let i=0;i<2;i++)await assert.rejects(f.provider.request(f.body),{code:'subscription_sharing_usage_limit_exceeded'});assert.equal(requests,1);assert.ok(f.statuses.includes('usage_limit'));await f.provider.resume();await assert.rejects(f.provider.request(f.body));assert.equal(requests,2);
});
test('JSON admission failures are recognized even with HTTP 200; usage pause survives a new provider',async()=>{
  let requests=0;const f=fixture(async()=>{requests++;return Response.json({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}});});
  f.auth.setUsagePaused=async value=>{f.account.usagePaused=value;};
  await assert.rejects(f.provider.request(f.body),{code:'subscription_sharing_usage_limit_exceeded'});assert.equal(f.account.usagePaused,true);
  const next=new ChatGPTResponses({auth:f.auth,fetcher:f.provider.fetch});await assert.rejects(next.request(f.body),{code:'subscription_sharing_usage_limit_exceeded'});assert.equal(requests,1);
  await next.resume();assert.equal(f.account.usagePaused,false);
});
test('a 401 refreshes once before streaming, never uses a separate billing path',async()=>{
  const sent=[];const f=fixture(async(url,o)=>{sent.push(url);return sent.length===1?Response.json({detail:'not accepted'},{status:401}):stream([answer()]);});await f.provider.request(f.body);assert.equal(f.calls[1].force,true);assert.deepEqual(sent,[ENDPOINT,ENDPOINT]);
});
test('permission/admission errors retain structured diagnostics without arbitrary echoed text',async()=>{
  const f=fixture(async()=>Response.json({error:{code:'chatpass_v2_scope_not_authorized',param:'input',message:'secret echoed content'}},{status:403,headers:{'x-request-id':'req_safe'}}));
  await assert.rejects(f.provider.request(f.body),e=>e.status===403&&e.param==='input'&&e.requestId==='req_safe'&&e.bodyShape==='error'&&!e.message.includes('secret'));assert.equal(f.calls.length,1);
});
test('temporary admission failures back off without deleting the account',async()=>{
  let requests=0;const f=fixture(async()=>{requests++;return Response.json({detail:'unavailable'},{status:503});});await assert.rejects(f.provider.request(f.body));await assert.rejects(f.provider.request(f.body));assert.equal(requests,1);assert.equal(f.auth.data.activeId,'a');
});
test('unavailable preferred models do not silently select another model',async()=>{
  const f=fixture();f.auth.model=()=> 'removed';await assert.rejects(f.provider.request(f.body),{code:'model_unavailable'});assert.equal(f.calls.length,0);
});
test('structured desktop verification maps text.format and validates JSON locally',async()=>{
  const f=fixture(async()=>stream([answer([message('{"verified":false}')])])),body={...f.body,tools:[],response_format:{type:'json_schema',json_schema:{name:'verification',strict:true,schema:{type:'object',properties:{verified:{type:'boolean'}},required:['verified'],additionalProperties:false}}}};
  const p=payload(body,'model');assert.equal(p.text.format.name,'verification');await f.provider.request(body);f.provider.fetch=async()=>stream([answer([message('{"verified":"yes"}')])]);await assert.rejects(f.provider.request(body),{code:'invalid_structured_output'});
});
test('network failures, cancellation and account changes cannot return late results',async()=>{
  const f=fixture(async()=>{throw new Error('network data secret');});await assert.rejects(f.provider.request(f.body),{code:'network_error'});
  const controller=new AbortController();controller.abort();await assert.rejects(f.provider.request(f.body,{signal:controller.signal}));
  f.provider.fetch=async()=>{f.auth.epoch++;return stream([answer([call])]);};await assert.rejects(f.provider.request(f.body),{code:'account_changed'});
});
async function socketFixture(t,handler,transport='websocket'){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
  const f=fixture(undefined,transport),requests=[],headers=[];let connections=0;
  server.on('connection',(ws,req)=>{connections++;headers.push(req.headers);ws.on('message',raw=>{const request=JSON.parse(raw);requests.push(request);handler(ws,request,requests.length,connections);});});
  f.provider.WebSocket=class extends WebSocket{constructor(url,options){assert.equal(url,SOCKET);super('ws://127.0.0.1:'+server.address().port,options);}};
  t.after(async()=>{f.provider.close();for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));});
  return {...f,server,requests,headers,connections:()=>connections};
}
test('persistent WebSocket reuses same-connection parent for tools and replays all context on reconnect',async t=>{
  const f=await socketFixture(t,(ws,_request,n)=>ws.send(JSON.stringify(answer(n===1?[call]:[message('Done')],'resp'+n))));
  const first=await f.provider.request(f.body),input=[...f.body.input,...first.output,{type:'function_call_output',call_id:'call1',output:'opened'}];
  await f.provider.request({...f.body,input});assert.equal(f.connections(),1);assert.equal(f.requests[1].previous_response_id,'resp1');assert.deepEqual(f.requests[1].input,[input.at(-1)]);assert.equal(f.requests[0].stream,undefined);assert.equal(f.requests[0].store,false);assert.equal(f.headers[0].authorization,'Bearer oauth-secret');
  f.provider.close();await f.provider.request({...f.body,input});assert.equal(f.connections(),2);assert.equal(f.requests[2].previous_response_id,undefined);assert.deepEqual(f.requests[2].input,input);
});
test('evicted WebSocket parent retries full context once without executing any tools',async t=>{
  const f=await socketFixture(t,(ws,_r,n)=>ws.send(JSON.stringify(n===2?{type:'error',error:{code:'previous_response_not_found'}}:answer(n===1?[call]:[message('done')],'resp'+n))));
  const first=await f.provider.request(f.body),input=[...f.body.input,...first.output,{type:'function_call_output',call_id:'call1',output:'opened'}];await f.provider.request({...f.body,input});assert.equal(f.requests.length,3);assert.equal(f.requests[2].previous_response_id,undefined);assert.deepEqual(f.requests[2].input,input);
});
test('changed context and changed instructions cannot reuse a cached parent',async t=>{
  const f=await socketFixture(t,(ws,_r,n)=>ws.send(JSON.stringify(answer([message('ok')],'r'+n))));await f.provider.request(f.body);await f.provider.request({...f.body,input:[{role:'user',content:'new task'}]});assert.equal(f.requests[1].previous_response_id,undefined);
});
test('mid-response socket close never falls back to HTTP or silently replays generation',async t=>{
  const f=await socketFixture(t,ws=>{ws.send(JSON.stringify({type:'response.output_text.delta',delta:'part'}));ws.close();},'auto');let http=0;f.provider.fetch=async()=>{http++;return stream([answer()]);};await assert.rejects(f.provider.request(f.body),{code:'stream_interrupted'});assert.equal(http,0);assert.equal(f.requests.length,1);
});
test('WebSocket cancellation closes the socket and prevents late tool delivery',async t=>{
  const controller=new AbortController(),f=await socketFixture(t,()=>controller.abort(new Error('Stopped')));await assert.rejects(f.provider.request(f.body,{signal:controller.signal}),/Stopped/);assert.equal(f.provider.socket,null);
});
test('auto transport falls back to streamed HTTP only before sending a WebSocket request',async()=>{
  const f=fixture(undefined,'auto');f.provider.connect=async()=>{throw Object.assign(new Error('Upgrade unavailable'),{beforeSend:true,fallbackAllowed:true});};await f.provider.request(f.body);assert.equal(f.metrics[0].transport,'http');assert.equal(f.metrics[0].fallback,true);
  f.provider.connect=async()=>{throw Object.assign(new Error('Forbidden'),{beforeSend:true,fallbackAllowed:false});};await assert.rejects(f.provider.request(f.body),/Forbidden/);
});
