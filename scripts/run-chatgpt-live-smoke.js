'use strict';
// Explicit opt-in: real OAuth, CPU speech, one owned Windows button and its
// screenshot. No microphone recording, user app, document or desktop pixels.
const {connect,app}=require('./chatgpt-benchmark-host');
const {BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {AI}=require('../ai'),{LocalConversation}=require('../local-conversation');
const {createDispatcher,tools}=require('../core');
const {CuaClient}=require('../cua-client'),{ComputerUse}=require('../computer-use');
app.commandLine.appendSwitch('force-renderer-accessibility');
const directory=path.resolve(__dirname,'../test-output');
const report={status:'running',version:require('../package.json').version,at:new Date().toISOString(),scope:'Real OAuth using the selected account model. Synthetic local speech through production voice/AI/dispatcher; one GPT-selected native click in an owned Electron fixture, followed by independent readback and tool-result continuation; vision of that fixture only. Excludes physical microphone, arbitrary user apps and broad task accuracy.',checks:[],calls:[]};
let host,window,client,voice,ai,passed=false;
const save=()=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'chatgpt-live-smoke.json'),JSON.stringify(report,null,2));};
connect(metric=>report.calls.push(metric)).then(async value=>{
  host=value;report.model=host.auth.model();
  const request=host.provider.request.bind(host.provider);let requests=0;
  host.provider.request=(...args)=>{if(++requests>8)throw Error('Live smoke model request cap reached.');return request(...args);};
  const settings={...host.settings,chatProvider:'chatgpt',transcriptionProvider:'local',localSpeechUrl:'http://127.0.0.1:22132',allowDesktop:false,allowScreen:false};
  const notes=[],dispatch=createDispatcher({create_note:async args=>{notes.push(args);return {status:'saved',id:'owned-live-note'};}});
  ai=new AI(()=>settings,()=>{throw Error('No API keys');},dispatch,fetch,host.provider);
  voice=new LocalConversation(ai,()=>settings);
  if(!process.argv.includes('--desktop-only')){
  const synthesized=await voice.speech('Save a note titled Voice check with the text Hello. Then say Saved.',AbortSignal.timeout(15000));
  const started=performance.now(),generation=voice.start();
  const reply=await voice.turn(Buffer.from(synthesized),generation);
  const voiceCheck={name:'local_voice_gpt_tool_local_speech',passed:false,ms:Math.round(performance.now()-started),syntheticTranscript:reply.transcript,reply:reply.answer,outputAudioBytes:reply.audio.length,notes};report.checks.push(voiceCheck);save();
  assert.equal(notes.length,1);assert.equal(notes[0].title.toLowerCase(),'voice check');assert.match(notes[0].text,/^Hello\.?$/i);assert.ok(reply.answer&&reply.audio.length>1000);
  voiceCheck.passed=true;save();voice.stop();
  }
  settings.allowDesktop=true;
  window=new BrowserWindow({title:'Mitch GPT test fixture',width:640,height:460,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await window.loadFile(path.resolve(__dirname,'../tests/chatgpt-live-fixture.html'));window.show();
  // PowerShell's hidden startup hint can suppress the first native ShowWindow.
  if(!window.isVisible())window.show();window.focus();
  // The dispatcher below restricts input to this exact owned snapshot/button.
  client=new CuaClient();const computer=new ComputerUse({client,getSettings:()=>settings,confirm:async()=>true});
  const listed=await computer.listWindows({query:''}),owned=listed.windows.filter(w=>w.pid===process.pid&&w.title==='Mitch GPT test fixture');
  report.fixtureDiscovery={processId:process.pid,title:window.getTitle(),visible:window.isVisible(),listed:{...listed,windows:listed.windows.filter(w=>w.pid===process.pid)}};save();
  assert.equal(owned.length,1);const observation=await computer.inspect(owned[0]);assert.equal(observation.degraded,false);assert.equal(observation.truncated,false);
  const offered=tools.filter(t=>t.name==='computer_action'),input=[{role:'user',content:'Click the Confirm test button exactly once in this owned fixture. Use the provided observation and return the tool call. '+JSON.stringify(observation)}];
  const selected=await host.provider.request({input,tools:offered}),calls=selected.output.filter(i=>i.type==='function_call');assert.equal(calls.length,1);
  const nativeDispatch=createDispatcher({computer_action:async args=>{
    assert.equal(args.kind,'click');assert.equal(args.snapshot,observation.snapshot);assert.equal(observation.controls.find(c=>c.control_id===args.control_id)?.name,'Confirm test');
    return computer.action(args);
  }});
  const clickStart=performance.now(),result=await nativeDispatch(calls[0].name,JSON.parse(calls[0].arguments));
  report.nativeResult=result;save();
  assert.equal(await window.webContents.executeJavaScript('window.testClicks'),1);assert.equal(await window.webContents.executeJavaScript('document.getElementById("result").textContent'),'Test confirmed');
  const final=await host.provider.request({input:[...input,...selected.output,{type:'function_call_output',call_id:calls[0].call_id,output:JSON.stringify(result)},{role:'user',content:'Independent fixture readback: testClicks=1, result=Test confirmed. Reply exactly Confirmed.'}],tools:offered});
  assert.equal(final.output.flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join(''),'Confirmed.');
  report.checks.push({name:'gpt_native_click_and_continuation',passed:true,clicks:1,msIncludingFinalReply:Math.round(performance.now()-clickStart)});save();
  const shot=await window.webContents.capturePage(),image=shot.toDataURL();
  const vision=await host.provider.request({input:[{role:'user',content:[{type:'input_text',text:'Read the result below the button in this screenshot. Reply with that result only.'},{type:'input_image',image_url:image}]}]},{allowScreen:true});
  const visionText=vision.output.flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join('');assert.match(visionText,/Test confirmed/);
  report.checks.push({name:'owned_fixture_screenshot',passed:true});report.status='passed';passed=true;
}).catch(error=>{report.status='failed';report.errorCode=error.code||'assertion_or_runtime_failure';console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.stack);}).finally(()=>{voice?.stop();ai?.closeVoice();client?.stop();if(window&&!window.isDestroyed())window.destroy();host?.close();save();console.log(JSON.stringify(report));app.exit(passed?0:1);});
