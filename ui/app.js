const $=id=>document.getElementById(id);
const api=window.companion;
let currentState,chatBusy=false,recorder=null,recordStream=null,recordTimeout,transcribing=false,giant=false,captionText='',captionSpeaker='';
let wakeState={status:'off'},dictationLease=null,dictationGeneration=0,dictationStarting=false;
function releaseDictation(lease){if(lease)api.releaseMicrophone(lease).catch(()=>{});if(dictationLease===lease)dictationLease=null;}
function cancelDictation(){dictationGeneration++;dictationStarting=false;clearTimeout(recordTimeout);if(recorder){recorder.onstop=null;recorder.onerror=null;if(recorder.state!=='inactive')recorder.stop();}recorder=null;recordStream?.getTracks().forEach(track=>track.stop());recordStream=null;releaseDictation(dictationLease);transcribing=false;$('record').disabled=false;$('record').classList.remove('recording');$('recordLabel').textContent='Ready when you are';}
function renderWake(state){
  wakeState=state;
  const labels={off:'Voice wake is off.',starting:'Getting the local microphone ready…',listening:'Listening locally for “Mitch”.',waking:'Heard you. Connecting…',busy:'Wake detection pauses during your conversation or dictation.',paused:'Voice wake paused by Stop.',setup:'Add your API key to use voice wake.',error:state.message||'Wake listener is unavailable.'};
  $('wakeStatus').textContent=labels[state.status]||labels.off;$('resumeWake').hidden=!state.enabled||!['paused','error'].includes(state.status);
  if(typeof live!=='undefined'&&live.state==='idle')$('connectionLabel').textContent=state.status==='listening'?'Say “Hi Mitch”':state.status==='starting'?'Getting voice wake ready…':state.status==='waking'?'Mitch is waking…':'Ready when you are';
}
function toast(message){$('toast').textContent=String(message).replace(/^Error invoking remote method '[^']+': Error: /,'');$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,7000);}
function go(page){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===page));document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('pageLabel').textContent={home:'Home',chat:'Conversation',dictation:'Dictation',library:'Notes & reminders',settings:'Settings'}[page];if(page==='library')loadLibrary();if(page==='settings')loadState();}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
document.querySelector('.brand').onclick=e=>{e.preventDefault();go('home');};
async function loadState(){
  currentState=await api.state();const s=currentState.settings;
  document.querySelector('.version').textContent='PREVIEW '+currentState.version;
  const configured=s.chatProvider==='local'||(s.chatProvider==='deepseek'&&currentState.hasDeepSeekKey&&s.deepseekChatModel);
  $('setupBanner').hidden=configured;$('setupBanner').style.display=configured?'none':'flex';
  $('keyStatus').textContent=currentState.hasKey?'Saved securely':'Not connected';$('apiKey').placeholder=currentState.hasKey?'Leave blank to keep your saved key':'Paste your API key';
  for(const key of ['voiceModel','chatModel','transcriptionModel'])$(key).value=s[key];
  for(const key of ['chatProvider','transcriptionProvider','localChatModel','localChatUrl','localSpeechUrl','localVoiceLanguage','deepseekChatModel'])$(key).value=s[key]||'';
  $('deepseekKeyStatus').textContent=currentState.hasDeepSeekKey?'DeepSeek key saved securely. Leave blank to keep it.':'No DeepSeek key saved.';
  showDeepSeekSettings();
  for(const key of ['allowScreen','allowDesktop','formatDictation','wakeEnabled'])$(key).checked=s[key];
  for(const key of ['workflowEngine','fastWorkflowPlanning','speculativePlanning','reuseWorkflows'])$(key).checked=s[key]!==false;
  $('screenId').replaceChildren(...currentState.screens.map(d=>{const o=document.createElement('option');o.value=d.id;o.textContent=`${d.label} · ${d.width} × ${d.height}`;return o;}));
  if(s.screenId)$('screenId').value=s.screenId;
  $('calendarStatus').textContent=currentState.calendar?' Calendar imported':' No calendar imported';
  renderComputerStatus(await api.computerStatus());
  renderWake(await api.wakeStatus());
  renderBrowserStatus(await api.browserStatus());renderTaskTiming(await api.taskTiming());
  $('localGrounding').checked=s.localGrounding===true;renderGroundingStatus(await api.groundingStatus());
}
function renderBrowserStatus(state){$('browserStatus').textContent=state.message||(!state.running?'Browser connection unavailable.':state.connected===1?(state.pageCapable&&(!state.recoveryCapable||!state.navigationCapable)?'Reload Mitch Browser Bridge in the browser extensions page, then refresh your tabs to finish the faster navigation update.':state.pageAccess?'Browser connected · fast tab and page controls ready.':state.pageCapable?'Tab controls ready. Enable page controls in the browser extension for faster webpage actions.':'Tab controls ready. Reload the browser extension to add page controls.'):state.connected>1?'Several browser profiles connected. Name the browser in your request.':'Load the Mitch Browser extension to connect.');$('browserFolderPath').textContent=state.directory||'';}
function renderTaskTiming(timing){const routes={browser:'direct browser controls',folder:'direct folder access',local:'familiar task',workflow:'planned steps',replay:'reused verified steps'};$('taskTiming').textContent=timing?`Last task: ${(timing.totalMs/1000).toFixed(2)} seconds · ${timing.modelRequests} AI requests · ${routes[timing.route]||'general assistant'}.`:'';}
function renderGroundingStatus(state){$('groundingStatus').textContent=!state.enabled?'Local targeting is off.':state.ready?`${state.model} ready on ${state.device}. Your AI provider confirms visual targets.`:'Local model unavailable or loading. Your configured vision provider remains available.';}
$('checkGrounding').onclick=async()=>{try{renderGroundingStatus(await api.groundingStatus());}catch(error){toast(error.message);}};
$('checkBrowser').onclick=async()=>{try{renderBrowserStatus(await api.browserStatus());}catch(error){toast(error.message);}};
$('browserFolder').onclick=async()=>{try{renderBrowserStatus(await api.browserExtensionFolder());}catch(error){toast(error.message);}};
api.on('taskTiming',renderTaskTiming);
function renderComputerStatus(state){$('computerAccess').textContent=state.administrator?'Running as Administrator.':'Running with standard Windows access.';$('computerStatus').textContent=!state.installed?'Computer use component missing. Reinstall the complete app.':!state.enabled?'Enable and save Desktop actions to get started.':state.paused?'Paused. Resume when you’re ready.':state.running?'Connected · Cua'+(state.version?' '+state.version:''):'Ready · connects when needed';$('resumeComputer').hidden=!state.paused||!state.enabled;$('checkComputer').disabled=!state.installed||!state.enabled||state.paused;}
$('stopTasks').onclick=async()=>{try{await api.stopTasks();toast('Tasks stopped. Resume computer use in Settings when ready.');}catch(e){toast(e.message);}};
$('checkComputer').onclick=async()=>{const button=$('checkComputer');button.disabled=true;$('computerResult').textContent='Checking…';try{const state=await api.checkComputer();renderComputerStatus(state);$('computerResult').textContent=`Connected. Found ${state.windowsFound} open windows.`;}catch(e){$('computerResult').textContent=e.message;}finally{renderComputerStatus(await api.computerStatus());}};
$('resumeComputer').onclick=async()=>{try{renderComputerStatus(await api.resumeComputer());$('computerResult').textContent='Ready for a new request.';}catch(e){toast(e.message);}};
api.on('computerState',renderComputerStatus);
function showDeepSeekSettings(){$('deepseekSettings').hidden=$('chatProvider').value!=='deepseek';}
$('chatProvider').onchange=showDeepSeekSettings;
function deepseekForm(){return {deepseekChatModel:$('deepseekChatModel').value.trim(),deepseekKey:$('deepseekKey').value.trim()};}
$('testDeepSeek').onclick=async()=>{const values=deepseekForm();$('testDeepSeek').disabled=true;$('deepseekConnectionResult').textContent='Connecting to DeepSeek…';try{const result=await api.testDeepSeek(values);$('deepseekChatModel').value=result.model;$('deepseekConnectionResult').textContent='Connected to '+result.model+'. Save settings to use it.';}catch(e){$('deepseekConnectionResult').textContent=e.message.replace(/^Error invoking.*?Error: /,'');}finally{$('testDeepSeek').disabled=false;}};
$('removeDeepSeekKey').onclick=async()=>{try{await api.deleteDeepSeekKey();$('deepseekKey').value='';await loadState();toast('DeepSeek key removed.');}catch(e){toast(e.message);}};
$('settingsForm').onsubmit=async e=>{e.preventDefault();try{const values={key:$('apiKey').value.trim(),screenId:$('screenId').value,...deepseekForm()};for(const key of ['voiceModel','chatModel','transcriptionModel','chatProvider','transcriptionProvider','localChatModel','localChatUrl','localSpeechUrl','localVoiceLanguage'])values[key]=$(key).value.trim();for(const key of ['allowScreen','allowDesktop','formatDictation','wakeEnabled','localGrounding','workflowEngine','fastWorkflowPlanning','speculativePlanning','reuseWorkflows'])values[key]=$(key).checked;await api.saveSettings(values);$('apiKey').value='';$('deepseekKey').value='';$('settingsResult').textContent='Saved. You’re all set.';await loadState();toast('Settings saved.');}catch(e){toast(e.message);}};
$('removeKey').onclick=async()=>{await api.deleteKey();$('apiKey').value='';await loadState();toast('Saved key removed.');};
$('calendarImport').onclick=async()=>{try{const r=await api.chooseCalendar();if(r.status==='imported'){toast('Calendar imported.');loadState();}}catch(e){toast(e.message);}};
function bubble(text,who='assistant',error=false){$('emptyChat')?.remove();const b=document.createElement('div');b.className='bubble '+who+(error?' error':'');const label=document.createElement('span');label.className='speaker';label.textContent=who==='user'?'YOU':'MITCH';b.append(label,document.createTextNode(text));$('messages').append(b);$('messages').scrollTop=$('messages').scrollHeight;return b;}
async function chat(text){if(chatBusy||!text.trim())return;chatBusy=true;$('sendMessage').disabled=true;bubble(text,'user');$('message').value='';$('activity').textContent='Thinking…';try{const result=await api.chat(text);bubble(result);}catch(e){bubble(e.message.replace(/^Error invoking.*?Error: /,''),'assistant',true);}finally{chatBusy=false;$('sendMessage').disabled=false;$('activity').textContent='';}}
$('chatForm').onsubmit=e=>{e.preventDefault();chat($('message').value);};$('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();chat($('message').value);}};
document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>chat(b.dataset.prompt));
$('clearChat').onclick=async()=>{try{await api.resetChat();$('messages').replaceChildren();bubble('A fresh conversation. What would you like to do?');}catch(e){toast(e.message);}};
const live=new LocalVoice({status:(state,label,phase)=>{
  api.voiceDisplay({type:'status',state,phase}).catch(()=>{});
  $('voiceBar').hidden=state==='idle';$('voiceStatus').textContent=label;$('connectionLabel').textContent=state==='idle'?'Ready when you are':label;
  document.querySelectorAll('.voice-toggle').forEach(b=>{b.textContent=state==='idle'?'Start talking ↗':state==='active'?'End conversation':'Connecting…';b.disabled=['connecting','closing'].includes(state);});
  $('endVoice').disabled=state==='connecting'||state==='closing';if(state==='idle'){captionText='';captionSpeaker='';$('voiceCaption').textContent='Your microphone is on.';}
  if(state==='idle')renderWake(wakeState);
},caption:(delta,speaker,options={})=>{if(speaker!==captionSpeaker||options.replace||options.newTurn){captionText='';captionSpeaker=speaker;}captionText=(captionText+delta).slice(-1200);$('voiceCaption').textContent=speaker+': '+captionText.slice(-260);api.voiceDisplay({type:'caption',delta:delta.slice(-8192),speaker,...options}).catch(()=>{});},error:toast,level:value=>$('microphoneLevel').value=value,microphone:name=>{$('microphoneName').textContent=name;refreshMicrophones().catch(()=>{});},readySound:window.playWakeChime});
api.on('wakeState',renderWake);
async function refreshMicrophones(){
  const devices=await navigator.mediaDevices.enumerateDevices(),select=$('microphoneInput');
  const choices=[{deviceId:'',label:'System default microphone'},...devices.filter(d=>d.kind==='audioinput'&&d.deviceId&&d.deviceId!=='default')];
  if(live.microphoneId&&!choices.some(d=>d.deviceId===live.microphoneId))choices.push({deviceId:live.microphoneId,label:'Previously selected microphone (unavailable)'});
  select.replaceChildren(...choices.map((device,index)=>{const option=document.createElement('option');option.value=device.deviceId;option.textContent=device.label||`Microphone ${index}`;return option;}));select.value=live.microphoneId;
}
live.microphoneId=localStorage.getItem('mitch.microphoneId')||'';
$('microphoneInput').onchange=async e=>{live.microphoneId=e.target.value;localStorage.setItem('mitch.microphoneId',live.microphoneId);if(live.state!=='idle')await live.stop();if(recorder||dictationStarting)cancelDictation();toast('Microphone selected. Start a new recording to use it.');};
navigator.mediaDevices.addEventListener('devicechange',()=>refreshMicrophones().catch(()=>{}));
refreshMicrophones().catch(()=>{});
api.on('wakeDetected',event=>{if(live.state==='idle'&&!recorder&&!transcribing&&!dictationStarting)live.start({wakeId:event.id});});
$('resumeWake').onclick=async()=>{try{renderWake(await api.resumeWake());}catch(error){toast(error.message);}};
$('previewWakeChime').onclick=()=>window.playWakeChime().catch(error=>toast(error.message));
api.on('tasksStopped',()=>{live.cleanup();cancelDictation();$('activity').textContent='Stopped';});
api.on('voiceError',message=>{live.cleanup();toast(message);});
async function toggleVoice(){if(recorder||transcribing||dictationStarting){toast('Finish dictation before starting a conversation.');return;}if(live.state==='idle')await live.start();else await live.stop();}
document.querySelectorAll('.voice-toggle').forEach(b=>b.onclick=toggleVoice);$('endVoice').onclick=()=>live.stop();
async function toggleRecord(){
  go('dictation');
  if(recorder){recorder.stop();return;}
  if(transcribing||dictationStarting)return;
  if(live.state!=='idle'){toast('End your voice conversation before dictating.');return;}
  const generation=++dictationGeneration;dictationStarting=true;let ownedLease;
  try{
    const state=await api.state();if(!state.hasKey&&state.settings.transcriptionProvider!=='local'){go('settings');toast('Add your API key or select local dictation in Settings.');return;}
    if(generation!==dictationGeneration)return;
    ownedLease=await api.claimMicrophone('dictation');if(generation!==dictationGeneration){releaseDictation(ownedLease);return;}dictationLease=ownedLease;
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(live.microphoneId?{deviceId:{exact:live.microphoneId}}:{})},video:false});
    if(generation!==dictationGeneration){stream.getTracks().forEach(track=>track.stop());releaseDictation(ownedLease);return;}recordStream=stream;
    const chunks=[];recorder=new MediaRecorder(recordStream,{mimeType:'audio/webm;codecs=opus'});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=async()=>{
      clearTimeout(recordTimeout);recordStream.getTracks().forEach(t=>t.stop());recordStream=null;recorder=null;transcribing=true;
      $('record').classList.remove('recording');$('record').disabled=true;$('recordLabel').textContent='Turning your voice into words…';$('recordHint').textContent='One moment.';
      try{const bytes=await new Blob(chunks,{type:'audio/webm'}).arrayBuffer();if(generation!==dictationGeneration)return;const text=await api.transcribe(new Uint8Array(bytes));if(generation!==dictationGeneration)return;$('transcript').value=text;$('recordLabel').textContent=text?'Ready to copy.':'No words detected.';}
      catch(e){if(generation===dictationGeneration){toast(e.message);$('recordLabel').textContent='Couldn’t transcribe. Try again.';}}
      finally{releaseDictation(ownedLease);if(generation===dictationGeneration){transcribing=false;$('record').disabled=false;$('recordHint').textContent='Click to record another thought.';}}
    };
    recorder.onerror=e=>{if(generation!==dictationGeneration)return;toast(e.error?.message||'Recording failed.');recordStream?.getTracks().forEach(t=>t.stop());recorder=null;releaseDictation(ownedLease);$('record').classList.remove('recording');};
    recorder.start(250);recordTimeout=setTimeout(()=>recorder?.stop(),120000);$('record').classList.add('recording');$('recordLabel').textContent='Listening…';$('recordHint').textContent='Click again or press Ctrl + Alt + D to finish.';
  }catch(e){releaseDictation(ownedLease);if(generation===dictationGeneration){recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;recorder=null;toast(e.message);}}
  finally{if(generation===dictationGeneration)dictationStarting=false;}
}
$('record').onclick=toggleRecord;$('copyTranscript').onclick=async()=>{if(!$('transcript').value.trim())return toast('Record something first.');await api.copy($('transcript').value);toast('Copied. Press Ctrl + V in your app.');};
$('noteForm').onsubmit=async e=>{e.preventDefault();const result=await api.localAction('create_note',{title:$('noteTitle').value,text:$('noteText').value});if(result.status==='error')return toast(result.message);e.target.reset();loadLibrary();toast('Note saved.');};
$('reminderForm').onsubmit=async e=>{e.preventDefault();const result=await api.localAction('create_reminder',{title:$('reminderTitle').value,due_at:$('reminderDue').value?new Date($('reminderDue').value).toISOString():''});if(result.status==='error')return toast(result.message);e.target.reset();loadLibrary();toast('Reminder added.');};
function item(title,text,action,label){const el=document.createElement('article');el.className='item';const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=text;el.append(h,p);if(action){const b=document.createElement('button');b.className='text-button';b.textContent=label;b.onclick=action;el.append(b);}return el;}
function empty(list,text){if(!list.childElementCount){const p=document.createElement('p');p.className='empty-list';p.textContent=text;list.append(p);}}
async function loadLibrary(){const lib=await api.library();$('notesList').replaceChildren(...[...lib.notes].reverse().map(n=>item(n.title,n.text,async()=>{await api.copy(n.text);toast('Note copied.');},'Copy note')));$('remindersList').replaceChildren(...[...lib.reminders].reverse().map(r=>{const el=item(r.title,r.due_at?new Date(r.due_at).toLocaleString():'No date',r.completed?null:async()=>{await api.localAction('complete_reminder',{id:r.id});loadLibrary();},'Mark complete ✓');if(r.completed)el.classList.add('done');return el;}));$('alertsList').replaceChildren(...lib.alerts.filter(a=>!a.notified).map(a=>item(a.title,new Date(a.due_at).toLocaleString(),async()=>{await api.localAction('cancel_alert',{id:a.id});loadLibrary();},'Cancel timer')));empty($('notesList'),'Your saved thoughts will appear here.');empty($('remindersList'),'A little less to remember.');empty($('alertsList'),'Ask in chat: “Remind me in 10 minutes.”');}
$('drawHome').onclick=()=>api.drawMode(true).catch(e=>toast(e.message));
$('resizePet').onclick=async()=>{giant=!giant;await api.localAction('set_pixie_size',{size:giant?'giant':'small'});$('resizePet').textContent=giant?'Make companion smaller ↗':'Make companion bigger ↗';};
$('hide').onclick=()=>api.window('hide');$('quit').onclick=()=>api.window('quit');
$('previewScreen').onclick=async()=>{try{const shot=await api.screenPreview();$('screenImage').src=shot.dataURL;$('screenDialog').showModal();}catch(e){toast(e.message);}};$('closePreview').onclick=()=>$('screenDialog').close();
api.on('shortcut',value=>{if(value==='voice')toggleVoice();if(value==='dictation')toggleRecord();});api.on('activity',value=>{$('activity').textContent=value.label+'…';});api.on('notice',toast);api.on('stateChanged',()=>{if($('library').classList.contains('active'))loadLibrary();});
window.mergeScreenshot=(base,marks)=>Promise.all([base,marks].map(src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src;}))).then(([image,ink])=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);ctx.drawImage(ink,0,0,c.width,c.height);return c.toDataURL('image/png');});
loadState().catch(e=>toast(e.message));
