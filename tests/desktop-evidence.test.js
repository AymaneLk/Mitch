const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AI}=require('../ai');
const {DesktopEvidence,unverifiedReply,spotifyCompletion}=require('../desktop-evidence');
const settings=()=>({chatProvider:'local',localOnly:true,allowScreen:true,allowDesktop:true});
const reply=message=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message}]})});
const call=(name,args)=>({tool_calls:[{id:name,function:{name,arguments:JSON.stringify(args)}}]});
const review=(decision,answer,reason='')=>({content:JSON.stringify({decision,answer,reason})});
const observation={status:'inspected',snapshot:'frame',controls:[{control_id:'1',name:'Lire',type:'Button'}]};

test('Spotify completion requires the playlist content and interprets transport actions as the opposite current state',()=>{
  const state={window:{title:'Spotify'},controls:[{name:'Accueil',type:'Heading'},{name:'Titres likés',type:'Link'},{name:'Lire',type:'Button'}]};
  assert.equal(spotifyCompletion('Open Spotify and go to my liked songs.',state).decision,'continue');
  assert.equal(spotifyCompletion('Play Spotify.',state).decision,'continue');
  assert.equal(spotifyCompletion('Pause Spotify.',state).decision,'complete');
  state.controls=[{name:'Titres likés',type:'Heading'},{name:'Track',type:'Row'},{name:'Pause',type:'Button'}];
  assert.equal(spotifyCompletion('Open Spotify and go to my liked songs.',state).decision,'complete');
  assert.equal(spotifyCompletion('Play Spotify.',state).decision,'complete');
  assert.equal(spotifyCompletion('Pause Spotify.',state).decision,'continue');
  assert.equal(spotifyCompletion('Play Spotify.',{...state,degraded:true}).decision,'continue');
  assert.equal(spotifyCompletion('Play Spotify.',{snapshot:'image-only',window:{title:'Spotify'}}).decision,'continue');
  assert.equal(spotifyCompletion('Open Calculator.',state),null);
  assert.equal(spotifyCompletion('Play Smooth Criminal on Spotify.',state),null,'Existing playback does not prove a named-song request succeeded');
  assert.equal(spotifyCompletion('Open Spotify and go to my liked songs and delete a song.',state),null,'Navigation alone does not complete a larger task');
});

test('a media key, launch, or failed input cannot satisfy the post-action observation gate',()=>{
  const evidence=new DesktopEvidence();
  evidence.record('computer_find_window',observation);
  evidence.record('control_media',{status:'sent'});
  assert.equal(evidence.needsObservation,true);
  evidence.record('computer_inspect_window',{status:'error',message:'Unavailable'});
  assert.equal(evidence.needsObservation,true);
  evidence.record('computer_inspect_window',observation);
  assert.equal(evidence.needsObservation,false);
  evidence.record('open_app',{status:'launch_requested'});
  assert.equal(evidence.needsObservation,true);
  evidence.record('computer_action',{status:'unverified',observation});
  assert.equal(evidence.needsObservation,false);
});

test('play and pause requests cannot toggle Spotify in the opposite direction',()=>{
  let now=0;const evidence=new DesktopEvidence(()=>now);
  evidence.record('computer_find_window',{...observation,window:{title:'Spotify'},controls:[{control_id:'1',name:'Pause',type:'Button'}]});
  const click={snapshot:'frame',kind:'click',control_id:'1',expected_name:'Pause'};
  assert.equal(evidence.guard('Play the song on Spotify.','computer_action',click).status,'not_needed');
  assert.equal(evidence.guard('Pause Spotify.','computer_action',click),null);
  assert.equal(evidence.guard('Play Spotify.','control_media',{action:'play_pause'}).status,'error');
  assert.equal(evidence.guard('Toggle playback.','control_media',{action:'play_pause'}),null);
  assert.equal(evidence.guard('Play Spotify.','computer_action',{...click,snapshot:'stale'}),null);
  evidence.record('computer_find_window',{...observation,window:{title:'Spotify'}});
  assert.equal(evidence.guard('Pause Spotify.','computer_action',{...click,expected_name:'Lire'}).status,'not_needed');
  assert.equal(evidence.guard('Play Spotify.','computer_action',{...click,expected_name:'Lire'}),null);
  now=90001;
  assert.equal(evidence.guard('Pause Spotify.','computer_action',{...click,expected_name:'Lire'}),null,'Expired observations cannot justify already-complete claims');
});

test('launch-only success is held until a fresh observation and an evidence-only review',async()=>{
  const actions=[],requests=[];
  const responses=[call('open_app',{app_id:'spotify'}),{content:'The song is playing.'},call('computer_find_window',{query:'Spotify'}),{content:'The song is playing.'},review('complete','Spotify is open.')];
  const ai=new AI(settings,()=>assert.fail('No cloud'),async name=>{actions.push(name);return name==='open_app'?{status:'launch_requested'}:observation;},async(_url,opt)=>{requests.push(JSON.parse(opt.body));return reply(responses.shift());});
  assert.equal(await ai.chat('Open Spotify.'),'Spotify is open.');
  assert.deepEqual(actions,['open_app','computer_find_window']);
  const audit=requests.at(-1);
  assert.equal(audit.tools,undefined);
  assert.equal(audit.response_format.type,'json_schema');
  assert.ok(!JSON.stringify(audit).includes('The song is playing.'));
  assert.ok(JSON.stringify(audit).includes('Lire'));
  assert.deepEqual(ai.history,[{role:'user',content:'Open Spotify.'},{role:'assistant',content:'Spotify is open.'}]);
});

test('an incomplete review continues the requested task and does not return the draft claim',async()=>{
  let playing=false;
  const responses=[call('computer_find_window',{query:'Spotify'}),{content:'Already playing.'},review('continue','Playback is paused.','The Play control still offers to start playback.'),call('computer_action',{snapshot:'frame',kind:'click',control_id:'1',expected_name:'Lire'}),{content:'Done.'},review('complete','Playback has started.')];
  const ai=new AI(settings,()=>assert.fail('No cloud'),async name=>{if(name==='computer_action')playing=true;return observation;},async()=>reply(responses.shift()));
  assert.equal(await ai.chat('Start playback in Music.'),'Playback has started.');
  assert.equal(playing,true);
});

test('repeated launch-only claims stop with an unverified answer instead of endless retries',async()=>{
  let requests=0,actions=0;
  const ai=new AI(settings,()=>assert.fail('No cloud'),async()=>{actions++;return {status:'launch_requested'};},async()=>reply(++requests===1?call('open_app',{app_id:'spotify'}):{content:'Done, playing.'}));
  assert.equal(await ai.chat('Play Spotify.'),unverifiedReply);
  assert.equal(requests,4);assert.equal(actions,1);
});

test('a direct Spotify completion claim without any tool evidence cannot escape verification',async()=>{
  let requests=0;
  const ai=new AI(settings,()=>assert.fail('No cloud'),()=>assert.fail('No action requested'),async()=>{requests++;return reply({content:'Spotify is already playing.'});});
  assert.equal(await ai.chat('Play the song on Spotify.'),unverifiedReply);
  assert.equal(requests,3);
});

test('a malformed completion review fails closed without new inputs',async()=>{
  const responses=[call('computer_find_window',{query:'Spotify'}),{content:'Playing.'},{content:'invalid review'}];
  let actions=0;
  const ai=new AI(settings,()=>assert.fail('No cloud'),async()=>{actions++;return observation;},async()=>reply(responses.shift()));
  assert.equal(await ai.chat('Start playback in Music.'),unverifiedReply);assert.equal(actions,1);
});

test('cancelling during the completion review prevents a reply or any additional action',async()=>{
  let entered;const started=new Promise(resolve=>entered=resolve);let requests=0;
  const ai=new AI(settings,()=>assert.fail('No cloud'),async()=>observation,async(_url,{signal})=>{
    if(++requests===1)return reply(call('computer_find_window',{query:'Spotify'}));
    if(requests===2)return reply({content:'Playing.'});
    return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();});
  });
  const pending=ai.chat('Start playback in Music.');await started;ai.cancel();
  await assert.rejects(pending,/stopped/);assert.equal(ai.busy,false);assert.equal(ai.history.length,0);
});
