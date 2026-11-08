'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {formatToolOutput,pruneToolObservations}=require('../tool-output');
const {AI}=require('../ai');

const observation=(snapshot,pid=10,window_id=20)=>({status:'inspected',snapshot,window:{pid,window_id,title:'Test window'},controls:[{control_id:'0',name:'Input',value:snapshot,editable:true}],degraded:false,truncated:false});
const pair=(id,name,result)=>[{type:'function_call',call_id:id,name,arguments:'{}'},{type:'function_call_output',call_id:id,output:formatToolOutput(result)}];
const output=(input,id)=>{const value=input.find(item=>item.type==='function_call_output'&&item.call_id===id).output;return JSON.parse(typeof value==='string'?value:value.find(part=>part.type==='input_text').text);};

test('only replaced controls are compacted; call correlation, outcomes and other windows survive',()=>{
  const first=observation('a1'),other=observation('b1',11,21),current=observation('a2');
  const result={status:'unverified',completed:2,attempted:2,results:[{step:1,verified:true},{step:2,verified:false}],message:'Read the result.',observation:current};
  const input=[{role:'user',content:'Use both apps'},...pair('one','computer_inspect_window',first),...pair('two','computer_find_window',other),...pair('three','computer_action_sequence',result)];
  const identities=input.map(item=>({type:item.type,call_id:item.call_id,name:item.name,arguments:item.arguments}));
  pruneToolObservations(input);
  const old=output(input,'one');
  assert.equal(old.controls,undefined);assert.equal(old.controls_omitted,1);assert.equal(old.snapshot_superseded,true);
  assert.equal(old.snapshot,'a1');assert.deepEqual(old.window,first.window);assert.equal(old.status,'inspected');
  assert.deepEqual(output(input,'two'),other);assert.deepEqual(output(input,'three'),result);
  assert.deepEqual(input.map(item=>({type:item.type,call_id:item.call_id,name:item.name,arguments:item.arguments})),identities);
  assert.equal(first.controls.length,1,'Formatting/compaction must not mutate controller observations.');
});

test('a fresh same-window visual observation invalidates old AX lists without touching image blocks',()=>{
  const image={data_url:'data:image/png;base64,aGVsbG8=',detail:'high'};
  const prior={status:'verified',verified:true,effect:'confirmed',observation:observation('old')};
  const visual={status:'unverified',snapshot:'visual',window:{pid:10,window_id:20,title:'Test window'},_images:[image]};
  const input=[...pair('old','computer_action',prior),...pair('new','computer_input',visual)];
  const imageOutput=input.at(-1).output;
  pruneToolObservations(input);
  const old=output(input,'old');
  assert.equal(old.observation.controls,undefined);assert.equal(old.observation.snapshot_superseded,true);
  assert.equal(old.verified,true);assert.equal(old.effect,'confirmed');assert.equal(old.status,'verified');
  assert.equal(input.at(-1).output,imageOutput);assert.equal(imageOutput[1].image_url,image.data_url);
});

test('notes, uncorrelated outputs, incomplete identities and repeated current snapshots are unchanged',()=>{
  const input=[
    ...pair('one','computer_inspect_window',observation('same')),
    ...pair('repeat','computer_action',{status:'cancelled',observation:observation('same')}),
    ...pair('note','read_notes',{notes:[observation('note')],...observation('note')}),
    ...pair('other-pid','computer_inspect_window',observation('other-pid',11,20)),
    ...pair('other-handle','computer_inspect_window',observation('other-handle',10,21)),
    ...pair('invalid','computer_action',{observation:{...observation('invalid'),window:{pid:10}}}),
    {type:'function_call_output',call_id:'unknown',output:JSON.stringify(observation('unknown'))},
    {type:'function_call',call_id:'bad-json',name:'computer_inspect_window',arguments:'{}'},
    {type:'function_call_output',call_id:'bad-json',output:'not JSON'},
  ];
  const before=JSON.stringify(input);pruneToolObservations(input);assert.equal(JSON.stringify(input),before);
});

test('long workflows retain one current list and substantially shrink repeated control payloads',()=>{
  const input=[];
  for(let step=1;step<=10;step++){
    const state=observation('state-'+step);
    state.controls=Array.from({length:200},(_,index)=>({control_id:String(index),name:'Observed control '+index,value:'Content '+step,enabled:true,editable:false,protected:false}));
    input.push(...pair('step-'+step,step===1?'computer_find_window':'computer_action',{status:'unverified',effect:'unverifiable',observation:state}));
  }
  const before=Buffer.byteLength(JSON.stringify(input));pruneToolObservations(input);
  const after=Buffer.byteLength(JSON.stringify(input));
  assert.ok(after<before*.15,`${before} -> ${after} bytes`);
  assert.equal(output(input,'step-10').observation.controls.length,200);
  for(let step=1;step<10;step++){const value=output(input,'step-'+step);assert.equal(value.effect,'unverifiable');assert.equal(value.observation.controls_omitted,200);}
  const compacted=JSON.stringify(input);pruneToolObservations(input);assert.equal(JSON.stringify(input),compacted);
});

test('chat compacts superseded same-window controls before sending its next request',async()=>{
  const requests=[],states=[observation('a1'),observation('b1',11,21),observation('a2')];let actions=0;
  const names=['computer_find_window','computer_find_window','computer_action'];
  const ai=new AI(()=>({chatModel:'gpt-6-luna'}),async()=>'test-key',async()=>states[actions++],async(_url,options)=>{
    const body=JSON.parse(options.body);requests.push(body);const index=requests.length-1;
    return{ok:true,json:async()=>({status:'completed',output:index<3?[{type:'function_call',call_id:'call-'+index,name:names[index],arguments:'{}'}]:[{type:'message',content:[{type:'output_text',text:'Done.'}]}]})};
  });
  assert.equal(await ai.chat('Update the first app while keeping the second available'),'Done.');
  assert.equal(requests.length,4);assert.equal(actions,3);
  assert.equal(output(requests[1].input,'call-0').controls.length,1);
  const last=requests.at(-1).input;
  assert.equal(output(last,'call-0').controls,undefined);assert.equal(output(last,'call-0').snapshot_superseded,true);
  assert.deepEqual(output(last,'call-1'),states[1]);assert.deepEqual(output(last,'call-2'),states[2]);
  assert.deepEqual(last.filter(item=>item.type==='function_call_output').map(item=>item.call_id),['call-0','call-1','call-2']);
  assert.ok(!JSON.stringify(ai.history).includes('snapshot'));
});
