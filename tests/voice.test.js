const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
test('Live tool events are deduplicated and resumed once with all completed outputs',async()=>{
 const executed=[],sent=[];const context={window:{companion:{voiceTool:async c=>{executed.push(c);return{status:'saved'};}}},crypto,setTimeout,clearTimeout,console};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/voice.js'),'utf8'),context);
 const live=new context.window.LiveVoice({status:()=>{},caption:()=>{},error:e=>{throw new Error(e);}});live.state='active';live.channel={readyState:'open',send:s=>sent.push(JSON.parse(s))};
 const emit=event=>live.receive({type:'response.event',event});const item={type:'function_call',call_id:'call-a',name:'create_note',arguments:'{"title":"Hi","text":"There"}'};
 await emit({type:'response.created',response:{id:'response-a'}});await emit({type:'response.output_item.done',item});await emit({type:'response.output_item.done',item});await emit({type:'response.completed',response:{id:'response-a',output:[item]}});await emit({type:'response.completed',response:{id:'response-a',output:[item]}});await live.queue;
 assert.equal(executed.length,1);assert.equal(sent.length,2);assert.equal(sent[0].item.call_id,'call-a');assert.equal(sent[1].type,'response.create');
});
test('Live delivers screenshot result IDs via the backend sideband and never the data channel',async()=>{
 const executed=[],sent=[],continued=[];const context={window:{companion:{voiceTool:async c=>{executed.push(c);return{status:'observed',screenshot_available:true};},voiceContinue:async(ids,generation)=>{continued.push({ids:[...ids],generation});return{status:'submitted'};}}},crypto,setTimeout,clearTimeout,console};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/voice.js'),'utf8'),context);
 const live=new context.window.LiveVoice({status:()=>{},caption:()=>{},error:e=>{throw new Error(e);}});live.state='active';live.backendGeneration=7;live.channel={readyState:'open',send:s=>sent.push(JSON.parse(s))};
 const item={type:'function_call',call_id:'screen',name:'computer_observe',arguments:'{}'},event={type:'response.event',event:{type:'response.completed',response:{id:'r',output:[item]}}};
 await live.receive(event);await live.receive(event);await live.queue;
 assert.equal(executed.length,1);assert.deepEqual(continued,[{ids:['screen'],generation:7}]);assert.equal(sent.length,0);assert.equal(live.calls.get('screen').sent,true);
});
