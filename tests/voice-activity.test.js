const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

function harness() {
  const finished=[],tools=[],sent=[],errors=[];
  const companion={
    voiceTool:async call=>{tools.push(call);return{status:'ok'};},
    voiceTaskFinished:async generation=>{finished.push(generation);},
    voiceReset:async()=>({generation:72}),
  };
  const context={window:{companion},crypto,setTimeout,clearTimeout,console};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/voice.js'),'utf8'),context);
  const live=new context.window.LiveVoice({status:()=>{},caption:()=>{},error:error=>errors.push(error)});
  live.state='active';live.generation=8;live.backendGeneration=71;
  live.channel={readyState:'open',send:text=>sent.push(JSON.parse(text)),close(){this.readyState='closed';}};
  const emit=event=>live.receive({type:'response.event',event});
  return{live,emit,finished,tools,sent,errors,companion};
}

test('voice tool responses keep activity alive until a completed response has no tools',async()=>{
  const {live,emit,finished,tools,sent}=harness();
  const item={type:'function_call',call_id:'click-1',name:'computer_action',arguments:'{}'};
  await emit({type:'response.created',response:{id:'tool-response'}});
  await emit({type:'response.output_item.done',item,response_id:'tool-response'});
  await emit({type:'response.completed',response:{id:'tool-response',output:[item]}});
  await live.queue;assert.equal(tools.length,1);assert.equal(sent.at(-1).type,'response.create');assert.deepEqual(finished,[]);
  const final={type:'response.completed',response:{id:'final-response',output:[{type:'message',content:[{type:'output_text',text:'Done.'}]}]}};
  await emit(final);assert.deepEqual(finished,[71]);
  await emit(final);assert.deepEqual(finished,[71],'duplicate response must not finish another task');
});

test('stale session generations and stale channels cannot finish current activity',async()=>{
  const {live,finished}=harness(),current=live.channel;
  const final={type:'response.event',event:{type:'response.completed',response:{id:'old-final',output:[]}}};
  await live.receive(final,7,current);
  await live.receive(final,8,{readyState:'open'});
  assert.deepEqual(finished,[]);
  await live.receive(final,8,current);assert.deepEqual(finished,[71]);
});

test('backend generation returned at voice activation is used for completion',async()=>{
  const {live,emit,finished}=harness();live.state='connecting';
  await live.receive({type:'session.started'});assert.equal(live.state,'active');
  await emit({type:'response.completed',response:{id:'fresh',output:[]}});
  assert.deepEqual(finished,[72]);
});

test('voice failure and cancellation finish activity without reporting success',async()=>{
  const {emit,finished,errors}=harness();
  await emit({type:'response.failed',response:{error:{message:'Provider failed'}}});
  await emit({type:'response.cancelled'});
  assert.deepEqual(finished,[71,71]);assert.deepEqual(errors,['Provider failed']);
});

test('idle or closing voice never signals a new response completion',async()=>{
  const {live,emit,finished}=harness();
  live.state='idle';await emit({type:'response.completed',response:{id:'idle',output:[]}});
  live.state='closing';await emit({type:'response.completed',response:{id:'closing',output:[]}});
  assert.deepEqual(finished,[]);
});

test('failure sending tool results finishes the current desktop activity',async()=>{
  const {live,emit,finished,errors}=harness();
  live.channel.send=()=>{throw Error('Channel send failed');};
  const item={type:'function_call',call_id:'send-fails',name:'computer_action',arguments:'{}'};
  await emit({type:'response.completed',response:{id:'send-fails-response',output:[item]}});
  await live.queue;
  assert.deepEqual(finished,[71]);assert.deepEqual(errors,['Channel send failed']);
});

test('a queued send failure from an obsolete channel does not finish a replacement task',async()=>{
  const {live,emit,finished,errors}=harness();
  const obsolete=live.channel;
  obsolete.send=()=>{live.generation++;live.channel={readyState:'open',send:()=>{}};live.backendGeneration=72;throw Error('Old send failed');};
  const item={type:'function_call',call_id:'old-send-fails',name:'computer_action',arguments:'{}'};
  await emit({type:'response.completed',response:{id:'old-send-response',output:[item]}});
  await live.queue;
  assert.deepEqual(finished,[]);assert.deepEqual(errors,[]);
});

test('sideband delivery failure ends activity without claiming a result was sent',async()=>{
  const {live,emit,finished,errors,companion,sent}=harness();
  companion.voiceContinue=async()=>{throw Error('Sideband failed');};
  const item={type:'function_call',call_id:'sideband-fails',name:'computer_observe',arguments:'{}'};
  await emit({type:'response.completed',response:{id:'sideband-response',output:[item]}});await live.queue;
  assert.deepEqual(finished,[71]);assert.deepEqual(errors,['Sideband failed']);assert.equal(sent.length,0);assert.equal(live.calls.get(item.call_id).sent,false);
});

test('a stopped sideband submission cannot mark or finish work in the replacement session',async()=>{
  const {live,emit,finished,errors,companion,sent}=harness();
  let rejectSubmission,entered;const started=new Promise(resolve=>{entered=resolve;});
  companion.voiceContinue=()=>{entered();return new Promise((resolve,reject)=>{rejectSubmission=reject;});};
  const item={type:'function_call',call_id:'old-sideband',name:'computer_observe',arguments:'{}'};
  await emit({type:'response.completed',response:{id:'old-response',output:[item]}});await started;
  const original=live.calls.get(item.call_id);live.generation++;live.channel={readyState:'open',send:()=>{}};live.backendGeneration=72;
  rejectSubmission(Error('Old delivery stopped'));await live.queue;
  assert.deepEqual(finished,[]);assert.deepEqual(errors,[]);assert.equal(sent.length,0);assert.equal(original.sent,false);
});
