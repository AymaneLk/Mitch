// Deterministic pause-policy comparison, not an ASR accuracy or desktop benchmark.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={};vm.createContext(context);
vm.runInContext(fs.readFileSync('ui/local-voice.js','utf8'),context);
const cases=[
  ['Open Calculator.',true,850],
  ['Open Instagram',true,850],
  ['Go to my messages',true,850],
  ['Calculate 1.5 times 188',true,850],
  ['Open Instagram and go to my profile',true,1000],
  ['Open Notes and create',true,1800],
  ['Open Instagram and go to my',true,1800],
  ['Calculate 1.5 times',true,1800],
  ['Type hello there',true,1800],
  ['Call Omar Lammari',true,1800],
  ['Open Calculator.',false,1800],
];
const results=cases.map(([text,streamHealthy,expected])=>{
  const newPause=vm.runInContext(`voiceEndpointDelay(${JSON.stringify(text)},600,${streamHealthy})`,context);
  assert.equal(newPause,expected);
  return {text,streamHealthy,baselinePauseMs:1800,newPauseMs:newPause,savedPauseMs:1800-newPause};
});
const completed=results.slice(0,5).map(result=>result.savedPauseMs).sort((a,b)=>a-b);
const report={status:'passed',completedRequestMedianPauseSavedMs:completed[Math.floor(completed.length/2)],results,scope:'Deterministic endpoint policy on stable synthetic transcript strings. Timer polling is 100 ms. These numbers exclude ASR finalization, reasoning, app execution, network and speech playback; they are not measured real microphone task latency or recognition accuracy.'};
fs.mkdirSync('test-output',{recursive:true});fs.writeFileSync('test-output/voice-endpoint-benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
