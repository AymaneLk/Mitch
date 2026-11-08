const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AI}=require('../ai');
const {createDispatcher,validateTool}=require('../core');

const settings=()=>({chatModel:'gpt-6-luna',voiceModel:'gpt-live-1',transcriptionModel:'gpt-4o-mini-transcribe'});
const response=output=>({ok:true,json:async()=>({status:'completed',output})});
const message=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const call=(id,name='computer_list_windows',args={query:''})=>({type:'function_call',call_id:id,name,arguments:JSON.stringify(args)});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('Stop aborts an outstanding model request and leaves no partial history',async()=>{
  const entered=deferred();let signal,actions=0;
  const ai=new AI(settings,async()=>'test-key',async()=>{actions++;},async(_url,options)=>{
    signal=options.signal;entered.resolve();
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  const pending=ai.chat('Inspect Calculator.');
  const rejected=assert.rejects(pending,/Task stopped/);
  await entered.promise;assert.equal(ai.busy,true);ai.cancel();await rejected;
  assert.equal(signal.aborted,true);assert.equal(actions,0);assert.equal(ai.busy,false);assert.equal(ai.controller,null);assert.deepEqual(ai.history,[]);
});

test('A late model response after Stop cannot dispatch a desktop action',async()=>{
  const entered=deferred(),reply=deferred();let actions=0;
  const ai=new AI(settings,async()=>'test-key',async()=>{actions++;},async()=>{entered.resolve();return reply.promise;});
  const pending=ai.chat('Inspect Calculator.');const rejected=assert.rejects(pending,/Task stopped/);
  await entered.promise;ai.cancel();reply.resolve(response([call('late')]));await rejected;
  assert.equal(actions,0);assert.equal(ai.busy,false);assert.deepEqual(ai.history,[]);
  ai.fetch=async()=>response([message('Ready for a new request.')]);
  assert.equal(await ai.chat('Are you ready?'),'Ready for a new request.');
  assert.deepEqual(ai.history,[{role:'user',content:'Are you ready?'},{role:'assistant',content:'Ready for a new request.'}]);
});

test('Stop during one tool prevents later tools and further model requests',async()=>{
  const entered=deferred(),finish=deferred(),names=[];let requests=0;
  const ai=new AI(settings,async()=>'test-key',async(name,_args,{signal})=>{
    names.push(name);entered.resolve();await finish.promise;assert.equal(signal.aborted,true);return{status:'delivered'};
  },async()=>{requests++;return response([call('first'),call('second','computer_inspect_window',{pid:10,window_id:'42'})]);});
  const pending=ai.chat('Inspect a window.');const rejected=assert.rejects(pending,/Task stopped/);
  await entered.promise;ai.cancel();finish.resolve();await rejected;
  assert.deepEqual(names,['computer_list_windows']);assert.equal(requests,1);assert.equal(ai.busy,false);assert.deepEqual(ai.history,[]);
});

test('Dispatcher Stop invalidates queued work and a pending approval before mutation',async()=>{
  const entered=deferred(),approval=deferred(),mutations=[];
  const run=createDispatcher({create_note:async(args,{assertActive})=>{entered.resolve();await approval.promise;assertActive();mutations.push(args.title);return{status:'saved'};}});
  const first=run('create_note',{title:'pending approval',text:'first'});
  await entered.promise;
  const queued=run('create_note',{title:'queued before Stop',text:'second'});
  run.cancel();approval.resolve();
  const results=await Promise.all([first,queued]);
  for(const result of results){assert.equal(result.status,'error');assert.match(result.message,/cancelled/);}
  assert.deepEqual(mutations,[]);
  assert.equal((await run('create_note',{title:'new request',text:'third'})).status,'saved');
  assert.deepEqual(mutations,['new request']);
});

test('A voice/session AbortSignal invalidates an already-queued action',async()=>{
  const firstEntered=deferred(),finishFirst=deferred(),controller=new AbortController();let secondExecuted=false;
  const run=createDispatcher({create_note:async()=>{firstEntered.resolve();await finishFirst.promise;return{status:'saved'};},read_notes:()=>{secondExecuted=true;return{status:'ok',notes:[]};}});
  const first=run('create_note',{title:'blocking',text:'first'});await firstEntered.promise;
  const second=run('read_notes',{query:''},{signal:controller.signal});controller.abort();finishFirst.resolve();
  await first;const result=await second;assert.equal(result.status,'error');assert.match(result.message,/cancelled/);assert.equal(secondExecuted,false);
});

test('An aborted request never enters the dispatcher handler or activity callback',async()=>{
  const controller=new AbortController();controller.abort();let entered=0;
  const run=createDispatcher({read_notes:()=>{entered++;}},()=>{entered++;});
  assert.equal((await run('read_notes',{query:''},{signal:controller.signal})).status,'error');assert.equal(entered,0);
});

test('Chat and live voice offer the same Cua tools and navigation-only key schema',async()=>{
  const bodies=[];
  const ai=new AI(settings,async()=>'test-key',async()=>{},async(_url,{body})=>{bodies.push(JSON.parse(body));return response([message('Ready.')]);});
  await ai.chat('Hello');await ai.voice('v=0\r\n');
  const chatTools=bodies[0].tools,voiceTools=bodies[1].session.delegation.responses.tools;
  for(const name of ['computer_list_windows','computer_find_window','computer_restore_window','computer_inspect_window','computer_action','computer_action_sequence','computer_observe','computer_input']){
    const chat=chatTools.find(tool=>tool.name===name);assert.ok(chat,name);assert.deepEqual(voiceTools.find(tool=>tool.name===name),chat);
  }
  assert.doesNotThrow(()=>validateTool('computer_action',{snapshot:'fresh',kind:'key',key:'Tab'}));
  for(const key of ['Win+R','Control+L','Ctrl+Enter','A','powershell'])assert.throws(()=>validateTool('computer_action',{snapshot:'fresh',kind:'key',key}),/Invalid action arguments/);
  assert.throws(()=>validateTool('computer_action',{snapshot:'fresh',kind:'key',key:'Tab',command:'anything'}),/Invalid action arguments/);
  assert.throws(()=>validateTool('computer_action',{snapshot:'fresh',kind:'scroll',direction:'down',amount:100}),/Invalid action arguments/);
});
