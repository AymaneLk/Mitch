'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai');
const {ChatGPTResponses}=require('../chatgpt-responses');
const {LocalConversation}=require('../local-conversation');
const {createDispatcher}=require('../core');
const msg=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]}),call=(name,args)=>({type:'function_call',namespace:'mitch',call_id:'c1',name,arguments:JSON.stringify(args)});
function harness(outputs){
  const settings={chatProvider:'chatgpt',transcriptionProvider:'local',localSpeechUrl:'http://127.0.0.1:22132',localOnly:true,allowDesktop:false,allowScreen:true},requests=[],actions=[],metrics=[];
  const account={id:'test',models:[{id:'available',name:'Available'}],catalogAt:Date.now(),transport:'http'};
  const auth={data:{activeId:'test'},active:()=>account,lease:()=>({id:'test'}),check(){},access:async()=> 'private-oauth',model:()=> 'available'};
  const provider=new ChatGPTResponses({auth,onMetrics:m=>metrics.push(m),fetcher:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});const output=outputs.shift();assert.ok(output,'Unexpected request');return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Draft'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{id:'r'+requests.length,status:'completed',output}})+'\n\n',{headers:{'content-type':'text/event-stream'}});}});
  const dispatch=createDispatcher({create_note:async args=>{actions.push(args);return {status:'saved',id:'note'};}});
  const ai=new AI(()=>settings,()=>assert.fail('Never read an API key'),dispatch,()=>assert.fail('No legacy remote request'),provider);
  return {ai,provider,auth,settings,requests,actions,metrics};
}
test('real AI loop preserves encrypted reasoning, call IDs and tool results through the Responses adapter',async()=>{
  const h=harness([[{type:'reasoning',id:'reason1',summary:[],encrypted_content:'opaque-encrypted'},call('create_note',{title:'Test',text:'Hello'})],[msg('Saved.')],[msg('It was Test.')]]),deltas=[];h.ai.onStream=e=>deltas.push(e);
  assert.equal(await h.ai.chat('Save a note called Test saying Hello'),'Saved.');assert.equal(h.actions.length,1);
  const next=h.requests[1].body.input;assert.equal(next.find(i=>i.type==='reasoning').encrypted_content,'opaque-encrypted');assert.equal(next.find(i=>i.type==='function_call_output').call_id,'c1');assert.equal(next.find(i=>i.type==='function_call').namespace,'mitch');assert.match(next.find(i=>i.type==='function_call_output').output,/note/);
  assert.equal(await h.ai.chat('What did you call it?'),'It was Test.');assert.ok(h.requests[2].body.input.some(i=>i.role==='assistant'&&i.content==='Saved.'));assert.equal(JSON.stringify(h.ai.history).includes('opaque-encrypted'),false);assert.ok(deltas.some(e=>e.type==='delta'));assert.equal(h.metrics.length,3);
});
test('GPT function arguments still pass through Mitch schema validation',async()=>{
  const h=harness([[call('create_note',{title:'Test',text:'Hello',unexpected:'extra'})],[msg('Could not save.')]]);await h.ai.chat('Save note');assert.equal(h.actions.length,0);assert.match(h.requests[1].body.input.find(i=>i.type==='function_call_output').output,/error|invalid/i);
});
test('voice sends only locally transcribed text to GPT and uses the existing local speech output',async()=>{
  const h=harness([[call('create_note',{title:'Voice',text:'Hello'})],[msg('Saved the voice note.')]]),localURLs=[];
  const voice=new LocalConversation(h.ai,()=>h.settings,async(url,options)=>{localURLs.push(url);assert.equal(options.headers?.Authorization,undefined);return url.endsWith('/transcribe')?{ok:true,json:async()=>({text:'Save a note called Voice saying Hello'})}:{ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};});
  const generation=voice.start(),result=await voice.turn(Buffer.from('microphone-bytes'),generation);assert.equal(result.answer,'Saved the voice note.');assert.deepEqual(result.audio,[1,2,3]);assert.equal(h.actions.length,1);assert.ok(localURLs.every(url=>url.startsWith('http://127.0.0.1:22132/')));assert.equal(JSON.stringify(h.requests).includes('microphone-bytes'),false);voice.stop();
});
test('revoking screenshot sharing during token retrieval removes pixels before sending',async()=>{
  const h=harness([[msg('No screenshot.')]]);h.auth.access=async()=>{h.settings.allowScreen=false;return 'oauth';};await h.ai.chat('Describe this','data:image/png;base64,PRIVATE');assert.equal(JSON.stringify(h.requests).includes('PRIVATE'),false);
});
test('unconfigured ChatGPT never falls back to local models or API-key billing',async()=>{
  const ai=new AI(()=>({chatProvider:'chatgpt',localOnly:true}),()=>assert.fail('No key'),()=>assert.fail('No tool'),()=>assert.fail('No fallback'));await assert.rejects(ai.chat('Hello'),/Connect your ChatGPT/);
});
