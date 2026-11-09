const { contextBridge, ipcRenderer } = require('electron');
const methods=['state','saveSettings','deleteKey','chat','resetChat','voiceOffer','voiceTool','voiceContinue','voiceReset','voiceTaskFinished','transcribe','copy','library','localAction','window','drawMode','ink','chooseCalendar','screenPreview','computerStatus','checkComputer','stopTasks','resumeComputer','wakeStatus','resumeWake','claimMicrophone','releaseMicrophone'];
methods.push('voiceDisplay','petState');
methods.push('localVoiceStart','localVoiceTurn','localVoiceStop','localVoiceInput','localVoiceAudio');
methods.push('testDeepSeek','deleteDeepSeekKey');
methods.push('browserStatus','browserExtensionFolder','taskTiming','groundingStatus');
const api=Object.fromEntries(methods.map(name=>[name,(...args)=>ipcRenderer.invoke('companion:'+name,...args)]));
api.on=(name,callback)=>{
  if(!['shortcut','activity','overlay','inkMode','stateChanged','voiceState','voiceError','notice','tasksStopped','computerState','wakeState','wakeDetected','petState','localVoiceProgress','taskTiming'].includes(name)) return ()=>{};
  const listener=(_event,value)=>callback(value); ipcRenderer.on('companion:'+name,listener);
  return ()=>ipcRenderer.removeListener('companion:'+name,listener);
};
contextBridge.exposeInMainWorld('companion',Object.freeze(api));
