// Real local model, simulated Spotify UI. Never controls the user's apps.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {AI}=require('../ai');
const {validateTool}=require('../core');
async function run(){
  let page='Home',playing=false,revision=0,listed=false,discovered=false;
  const calls=[];
  const observation=()=>({status:'ok',snapshot:`fixture-${++revision}`,window:{pid:42,window_id:100,title:'Spotify'},controls:[
    {control_id:'heading',name:page==='Home'?'Accueil':'Titres likés',role:'heading'},
    {control_id:'liked-link',name:'Titres likés',role:'link'},
    {control_id:'transport',name:playing?'Pause':'Lire',role:'button'},
    {control_id:'progress',name:'Position de lecture',value:'0:23 / 3:39',role:'slider'},
    ...(page==='Liked Songs'?[{control_id:'song',name:'Test Song — Test Artist',role:'row'}]:[])
  ]});
  const settings=()=>({localOnly:true,chatProvider:'local',allowScreen:true,allowDesktop:true});
  const ai=new AI(settings,()=>{throw Error('Cloud key accessed');},async(name,args)=>{
    validateTool(name,args);calls.push({name,args});if(calls.length>16)throw Error('Fixture action limit');
    if(name==='list_apps'){listed=true;return {apps:[{id:'spotify-fixture',name:'Spotify'}]};}
    if(name==='open_app'){assert.ok(listed&&args.app_id==='spotify-fixture','Use an exact app_id returned by list_apps');return {status:'launch_requested',app:'Spotify'};}
    if(name==='computer_list_windows'){discovered=true;return {windows:!args.query||/spotify/i.test(args.query)?[{pid:42,window_id:100,title:'Spotify'}]:[]};}
    if(['computer_find_window','inspect_app'].includes(name)){
      if(!/spotify/i.test(args.query))return {status:'not_found',windows:[]};
      discovered=true;return observation();
    }
    if(['computer_inspect_window','computer_observe'].includes(name)){
      assert.ok(discovered&&args.pid===42&&args.window_id===100,'Select exact observed window IDs');return observation();
    }
    if(name==='look_at_screen')return {status:'captured',snapshot:'fixture-image',findings:`Spotify is on ${page}. A triangle Play button (Lire) means PAUSED. A Pause button means PLAYING. Current state: ${playing?'playing':'paused'}. A progress position alone does not prove playing.`};
    if(name==='control_media'&&args.action==='play_pause'){playing=!playing;return {status:'sent',message:'Global key delivered, playback unverified.'};}
    if(name==='computer_action'){
      assert.equal(args.snapshot,`fixture-${revision}`,'Use latest observation');assert.equal(args.kind,'click');
      if(args.control_id==='liked-link'){assert.equal(args.expected_name,'Titres likés');page='Liked Songs';}
      else if(args.control_id==='transport'){assert.equal(args.expected_name,playing?'Pause':'Lire');playing=!playing;}
      else throw Error('Unexpected target');
      return {status:'unverified',effect:'unverifiable',observation:observation()};
    }
    return {status:'error',message:'Unsupported fixture operation. Use accessible controls from computer_find_window.'};
  },async(url,options)=>{
    const response=await fetch(url,options);
    const data=await response.clone().json();
    if(process.env.MITCH_TEST_DEBUG)console.log(JSON.stringify({finish:data.choices?.[0]?.finish_reason,content:data.choices?.[0]?.message?.content,tools:data.choices?.[0]?.message?.tool_calls,reasoningLength:data.choices?.[0]?.message?.reasoning_content?.length,usage:data.usage}));
    return response;
  });
  const results=[];
  // Seeing a navigation tile and a timestamp must not pass as task completion.
  const incomplete=[{type:'function_call',call_id:'check',name:'computer_find_window',arguments:'{"query":"Spotify"}'},{type:'function_call_output',call_id:'check',output:JSON.stringify(observation())}];
  for(const prompt of ['Open Spotify and go to my liked songs.','Play the song on Spotify.']){
    const review=await ai.reviewDesktop(prompt,incomplete,undefined,true);
    console.log(JSON.stringify({negativeCheck:prompt,...review}));
    assert.notEqual(review.decision,'complete','Home with a Liked Songs link and a Play button is incomplete');
  }
  for(const prompt of ['Open Spotify and go to my liked songs.','Play the song on Spotify.','Play the song on Spotify.']){
    const start=Date.now();const answer=await ai.chat(prompt,undefined,undefined,{spoken:true});
    const result={prompt,answer,page,playing,ms:Date.now()-start,calls:[...calls]};results.push(result);console.log(JSON.stringify(result));
  }
  fs.mkdirSync('test-output',{recursive:true});
  fs.writeFileSync('test-output/local-desktop-reasoning.json',JSON.stringify(results,null,2));
  assert.equal(results[0].page,'Liked Songs','Must navigate, not just open Spotify');
  assert.doesNotMatch(results[0].answer,/\bplaying\b/i,'Do not invent unrelated playback');
  assert.equal(results[1].playing,true,'Must activate playback, not just describe it');
  assert.match(results[1].answer,/\bplaying\b/i);
  assert.equal(results[2].playing,true,'An already-playing song must not be paused by a blind toggle');
  assert.match(results[2].answer,/\bplaying\b/i);
  assert.ok(!results[2].calls.slice(results[1].calls.length).some(c=>c.name==='control_media'||c.name==='computer_action'),'Already-correct playback needs no input');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
