'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AI}=require('../ai');
const {DesktopEvidence,unverifiedReply}=require('../desktop-evidence');

const call=(name,args)=>({type:'function_call',call_id:Math.random().toString(36),name,arguments:JSON.stringify(args)});
const say=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const see=()=>call('computer_find_window',{query:'Spotify'});
const click=()=>call('computer_input',{snapshot:'frame',kind:'click',x:0.5,y:0.9});
const key=()=>call('computer_input',{snapshot:'frame',kind:'key',key:'space'});
const frame=playing=>({status:'inspected',snapshot:'frame',window:{title:'Spotify'},controls:[{control_id:'transport',name:playing?'Pause':'Lire',type:'Button'}]});

function fixture({provider='local',playing=false,failAfterInput=false,lag=false,responses}={}){
  let inputs=0,requests=0;const calls=[],bodies=[];
  const ai=new AI(()=>({chatProvider:provider,allowScreen:true,allowDesktop:true}),()=>assert.fail('No network credentials'),async(name,args)=>{
    calls.push({name,args});
    if(['computer_input','computer_action','click_app_control','control_media'].includes(name)){
      inputs++;playing=!playing;
      if(failAfterInput)throw new Error('Connection lost after input; outcome unknown.');
      if(lag)return {status:'unverified',observation:frame(false)};
      return {status:'unverified',observation:frame(playing)};
    }
    return lag&&inputs?{status:'partial',snapshot:'frame',window:{title:'Spotify'},controls:[],degraded:true}:frame(playing);
  });
  ai.request=async(_endpoint,body)=>{requests++;bodies.push(body);assert.ok(requests<15,'Bounded verification');return {status:'completed',output:responses.shift()??[say('Done.')]};};
  return {ai,calls,bodies,get inputs(){return inputs;},get playing(){return playing;},get requests(){return requests;}};
}

for(const provider of ['local','kaggle','openai'])test(`${provider}: verified playback ends before a second screenshot click or Space key`,async()=>{
  const f=fixture({provider,responses:[[see()],[click()],[key()],[click()],[say('Playing.')]]});
  assert.equal(await f.ai.chat('Play the music on Spotify.'),'Spotify is playing.');
  assert.equal(f.inputs,1);assert.equal(f.playing,true);assert.equal(f.requests,2);
});

test('verification cannot replay playback after a delayed or incomplete UI update',async()=>{
  const f=fixture({lag:true,responses:[[see()],[click()],[see()],[key()],[click()],[say('Playing.')]]});
  assert.equal(await f.ai.chat('Play the music on Spotify.'),unverifiedReply);
  assert.equal(f.inputs,1);assert.equal(f.playing,true);
  assert.ok(f.bodies.slice(2).every(b=>!b.tools?.some(t=>['computer_input','computer_action','control_media','click_app_control'].includes(t.name))));
});

test('an input whose result times out cannot be replayed through another tool',async()=>{
  const f=fixture({failAfterInput:true,lag:true,responses:[[see()],[click()],[call('click_app_control',{snapshot:'frame',control_id:'transport',expected_name:'Lire'})],[key()],[say('Done.')]]});
  assert.equal(await f.ai.chat('Play the music on Spotify.'),unverifiedReply);
  assert.equal(f.inputs,1);assert.equal(f.playing,true);
});

test('multiple tool calls in one reply cannot cause play-pause-play',async()=>{
  const f=fixture({responses:[[see()],[click(),key(),click()],[say('Done.')]]});
  assert.equal(await f.ai.chat('Play the music on Spotify.'),'Spotify is playing.');
  assert.equal(f.inputs,1);
});

test('an already-playing observation ends the task without dispatching input',async()=>{
  const f=fixture({playing:true,responses:[[see(),key()],[say('Done.')]]});
  assert.equal(await f.ai.chat('Play music on Spotify.'),'Spotify is playing.');
  assert.equal(f.inputs,0);
});

test('a later explicit pause request gets its own single input allowance',async()=>{
  const f=fixture({responses:[[see()],[click()],[see()],[key()]]});
  assert.equal(await f.ai.chat('Play music on Spotify.'),'Spotify is playing.');
  assert.equal(await f.ai.chat('Pause music on Spotify.'),'Spotify is paused.');
  assert.equal(f.inputs,2);assert.equal(f.playing,false);
});

test('one playback request cannot hide multiple inputs inside a sequence or double-click',()=>{
  const e=new DesktopEvidence();const text='Play the music on Spotify.';
  const transport={kind:'click',control_id:'transport',expected_name:'Lire'};
  assert.equal(e.guard(text,'computer_action_sequence',{snapshot:'frame',actions:[transport,transport]}).input_suppressed,true);
  assert.equal(e.guard(text,'computer_input',{snapshot:'frame',kind:'double_click',x:0.5,y:0.9}).input_suppressed,true);
  assert.equal(e.mediaAttempted,false,'Rejected operations do not consume the allowed single click');
  assert.equal(e.guard(text,'computer_action_sequence',{snapshot:'frame',actions:[transport]}),null);
  e.admit(text,'computer_action_sequence',{snapshot:'frame',actions:[transport]});
  assert.equal(e.guard(text,'click_app_control',{snapshot:'frame',control_id:'transport',expected_name:'Lire'}).input_suppressed,true);
  assert.equal(e.guard(text,'computer_observe',{scope:'desktop'}),null);
});

test('the legacy accessibility click cannot press Pause for a play request',()=>{
  const e=new DesktopEvidence();
  e.record('inspect_app',{status:'inspected',snapshot:'legacy',window:{title:'Spotify'},controls:[{id:'button',type:'ControlType.Button',name:'Pause'}]});
  assert.equal(e.guard('Play music on Spotify.','click_app_control',{snapshot:'legacy',control_id:'button',expected_name:'Pause'}).status,'not_needed');
});

test('a delayed but successful readback finishes without a second input',async()=>{
  let playing=false,reads=0,inputs=0;
  const responses=[[see()],[click()],[see()]];
  const ai=new AI(()=>({chatProvider:'local'}),()=>assert.fail('No credentials'),async(name)=>{
    if(name==='computer_input'){inputs++;playing=true;return {status:'observation_failed'};}
    reads++;return frame(playing);
  });
  ai.request=async()=>({status:'completed',output:responses.shift()});
  assert.equal(await ai.chat('Play music on Spotify.'),'Spotify is playing.');
  assert.equal(inputs,1);assert.equal(reads,2);
});
