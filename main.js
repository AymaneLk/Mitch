const {app,BrowserWindow,ipcMain,screen,desktopCapturer,safeStorage,shell,dialog,globalShortcut,Tray,Menu,nativeImage,Notification,clipboard,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const {tools,Store,SnapshotCache,createDispatcher,webURL,isoDate}=require('./core');
const {AI}=require('./ai');
const {openSpotifySearch,normalizeSpotifyWebURL}=require('./spotify');
const {CuaClient}=require('./cua-client');
const {ComputerUse}=require('./computer-use');
const {ComputerVisual}=require('./computer-visual');
const {ActivityOverlay}=require('./activity-overlay');
const {DesktopActivity}=require('./desktop-activity');
const {WakeListener,WakeService}=require('./wake-listener');
const {PetPresentation}=require('./pet-presentation');
const petPresentation=new PetPresentation();
const root=__dirname;
const smoke=process.argv.includes('--smoke-test');
app.setName('Mitch');
// Only trusted bundled pages are loaded; spoken wake must play its ready cue
// without a mouse gesture, including while the main window is hidden.
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
// Retain the existing profile identity so renaming keeps saved keys and notes.
app.setPath('userData',path.join(app.getPath('appData'),'Pixie Windows Companion'));
if(smoke) app.setPath('userData',path.join(process.cwd(),'test-output','profile'));
app.setAppUserModelId('local.independent.pixie.windows');
let main,pet,overlay,tray,store,ai,dispatch,quitting=false,inkMode=false,apiKey='',appsCache=[],lastAppsAt=0,voiceActive=false,voiceGeneration=0;
let computer,visual,cua,activityOverlay,desktopActivity,voiceActivityScope,administrator=false,voiceController=new AbortController();
let wake;
const windowsChildren=new Set();
const voiceCalls=new Map();
const voiceContinuations=new Map(),voiceClaimedCalls=new Set();
const appSnapshot=new SnapshotCache();
const screenSnapshot=new SnapshotCache();
let shapes=[],colorIndex=0;
const localPages=new Set(['index.html','pet.html','overlay.html'].map(f=>pathToFileURL(path.join(root,'ui',f)).href));
function send(event,payload) { for(const win of [main,pet,overlay]) if(win&&!win.isDestroyed()) win.webContents.send('companion:'+event,payload); }
function stateChanged() { send('stateChanged',{}); }
function publishPet(){
  if(!pet||pet.isDestroyed())return;
  const state=petPresentation.snapshot(),bounds=pet.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
  if(bounds.width!==state.width||bounds.height!==state.height){
    pet.setBounds({width:state.width,height:state.height,
      x:Math.max(area.x,Math.min(Math.round(bounds.x+(bounds.width-state.width)/2),area.x+area.width-state.width)),
      y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-state.height))});
  }
  pet.webContents.send('companion:petState',state);
}
function updateVoiceDisplay(message){if(petPresentation.update(message))publishPet();return {status:'ok'};}
function wakeStateChanged(status) {
  petPresentation.setWake(status.status);publishPet();
  send('wakeState',status);
  // Troubleshooting metadata only: never audio, recognized words or credentials.
  if(!smoke)try{fs.writeFileSync(path.join(app.getPath('userData'),'wake-status.json'),JSON.stringify({...status,updatedAt:new Date().toISOString()}));}catch{}
}
function publicVoiceOutput(output){if(!output||typeof output!=='object')return output;const {_images,...metadata}=output;return metadata;}
function failVoice(error){voiceController.abort();voiceActive=false;voiceGeneration++;voiceCalls.clear();voiceContinuations.clear();voiceClaimedCalls.clear();ai?.closeVoice();if(voiceActivityScope)desktopActivity.endScope(voiceActivityScope);voiceActivityScope=null;updateVoiceDisplay({type:'status',state:'idle'});send('voiceError',error.message||String(error));send('voiceState',false);}
function targetDisplay() { return screen.getAllDisplays().find(d=>String(d.id)===store.data.settings.screenId)||screen.getPrimaryDisplay(); }
function ps(data) {
  return new Promise((resolve,reject)=>{
    const helperRoot=app.isPackaged?root.replace(/app\.asar$/, 'app.asar.unpacked'):root;
    const child=spawn(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(helperRoot,'windows.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    windowsChildren.add(child);child.once('close',()=>windowsChildren.delete(child));child.once('error',()=>windowsChildren.delete(child));
    let output='',error=''; const timeout=setTimeout(()=>{child.kill();reject(new Error('Windows action timed out.'));},20000);
    child.stdout.on('data',b=>{output+=b.toString('utf8');if(output.length>2e6)child.kill();}); child.stderr.on('data',b=>{error+=b.toString('utf8');});
    child.on('error',e=>{clearTimeout(timeout);reject(e);});
    child.on('close',()=>{clearTimeout(timeout);try {const result=JSON.parse(output.trim());if(result.status==='error')throw new Error(result.message);resolve(result);}catch(e){reject(new Error(e.message.startsWith('Unexpected')?(error.slice(0,500)||'Windows action returned invalid data.'):e.message));}});
    child.stdin.end(JSON.stringify(data));
  });
}
function secureWindow(options,page) {
  const win=new BrowserWindow({...options,webPreferences:{preload:path.join(root,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  win.loadFile(path.join(root,'ui',page)); return win;
}
function showMain() { if(main.isMinimized()) main.restore(); main.show();main.focus(); }
function makeWindows() {
  activityOverlay=new ActivityOverlay({BrowserWindow,screen,root});
  desktopActivity=new DesktopActivity({show:()=>activityOverlay.show(),hide:()=>activityOverlay.hide()});
  main=secureWindow({width:1120,height:790,minWidth:850,minHeight:620,backgroundColor:'#f6f4ef',title:'Mitch',autoHideMenuBar:true,show:false,icon:path.join(root,'assets','companion.ico')},'index.html');
  main.once('ready-to-show',()=>main.show());
  main.on('close',e=>{if(!quitting){e.preventDefault();main.hide();}});
  const display=screen.getPrimaryDisplay();
  pet=secureWindow({width:180,height:112,x:Math.round(display.workArea.x+display.workArea.width/2-90),y:display.workArea.y,transparent:true,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,focusable:false},'pet.html');
  pet.setAlwaysOnTop(true,'floating');
  pet.webContents.on('did-finish-load',publishPet);
  overlay=secureWindow({x:display.bounds.x,y:display.bounds.y,width:display.bounds.width,height:display.bounds.height,transparent:true,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,show:false,focusable:false},'overlay.html');
  overlay.setIgnoreMouseEvents(true,{forward:true});
  overlay.setAlwaysOnTop(true,'screen-saver');
  const trayImage=nativeImage.createFromPath(path.join(root,'assets','tray.png'));
  tray=new Tray(trayImage);tray.setToolTip('Mitch');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Open companion',click:showMain},{label:'Voice · Ctrl+Alt+Space',click:()=>send('shortcut','voice')},{label:'Dictation · Ctrl+Alt+D',click:()=>{showMain();send('shortcut','dictation');}},{label:'Draw · Ctrl+Alt+M',click:()=>setInk(!inkMode)},{type:'separator'},{label:'Quit',click:()=>{quitting=true;app.quit();}}]));
  tray.on('double-click',showMain);
  if(!globalShortcut.register('CommandOrControl+Alt+Escape',()=>stopTasks().catch(e=>send('notice',e.message))))send('notice','Stop shortcut Ctrl+Alt+Escape is unavailable. Use Stop in Mitch.');
  const shortcuts={'CommandOrControl+Alt+Space':()=>send('shortcut','voice'),'CommandOrControl+Alt+D':()=>{showMain();send('shortcut','dictation');},'CommandOrControl+Alt+M':()=>setInk(!inkMode),'CommandOrControl+Alt+Backspace':()=>{shapes=[];updateOverlay();}};
  for(const [key,fn]of Object.entries(shortcuts)) if(!globalShortcut.register(key,fn)) send('notice',`Shortcut ${key} is already used by another app.`);
}
function updateOverlay() { if(overlay&&!overlay.isDestroyed()){overlay.webContents.send('companion:overlay',{shapes,inkMode});if(shapes.length||inkMode)overlay.showInactive();else overlay.hide();} }
function setInk(value) {
  inkMode=!!value;
  if(inkMode) {
    const b=targetDisplay().bounds;overlay.setBounds(b);overlay.setFocusable(true);overlay.setIgnoreMouseEvents(false);overlay.show();overlay.focus();
    globalShortcut.register('Escape',()=>setInk(false));
  } else { overlay.setIgnoreMouseEvents(true,{forward:true});overlay.setFocusable(false);globalShortcut.unregister('Escape'); }
  send('inkMode',inkMode); updateOverlay(); return {status:inkMode?'drawing':'finished'};
}
function requireDesktop() { if(!store.data.settings.allowDesktop) throw new Error('Enable desktop actions in Settings first.');if(computer?.paused)throw new Error('Computer use is paused. Click Resume computer use in Settings.'); }
function computerStatus() {return {installed:fs.existsSync(cua.executable),running:cua.running,version:cua.version||null,paused:computer.paused,enabled:store.data.settings.allowDesktop,administrator};}
async function stopTasks() {
  updateVoiceDisplay({type:'status',state:'idle'});
  ai?.cancel();dispatch?.cancel();voiceController.abort();voiceController=new AbortController();voiceGeneration++;voiceActive=false;voiceCalls.clear();
  desktopActivity?.stop();voiceActivityScope=null;
  visual?.clear();ai?.closeVoice();voiceContinuations.clear();voiceClaimedCalls.clear();
  for(const child of windowsChildren)child.kill();
  appSnapshot.value=null;send('tasksStopped',{});
  const wakeStopping=wake?.pause();
  const stopping=computer?.stop();send('computerState',computerStatus());await Promise.all([stopping,wakeStopping]);
  send('computerState',computerStatus());return {status:'stopped',message:'Pending work cancelled. An action already delivered to an app cannot be undone.'};
}
async function performControl(kind,args,context) {
  const snapshot=appSnapshot.get(args.snapshot);
  const control=snapshot.controls.find(c=>c.id===args.control_id);
  if(!control||control.password) throw new Error('This control is unavailable or protected. Inspect again.');
  if(kind==='click'&&control.name!==args.expected_name) throw new Error('The requested label does not match the inspected control.');
  context.assertActive();requireDesktop();
  appSnapshot.get(args.snapshot);
  return ps({action:kind,pid:snapshot.window.pid,handle:snapshot.window.handle,control_id:control.id,expected_name:args.expected_name,text:args.text});
}
async function apps(query) {
  if(Date.now()-lastAppsAt>60000){appsCache=(await ps({action:'apps'})).apps;lastAppsAt=Date.now();}
  return appsCache.filter(a=>a.name.toLowerCase().includes(query.toLowerCase())).slice(0,60).map(a=>({name:a.name,app_id:a.id}));
}
async function capture() {
  if(!store.data.settings.allowScreen) throw new Error('Enable screen sharing in Settings first.');
  if(inkMode)setInk(false);
  const display=targetDisplay();
  const wasMain=main.isVisible(),wasPet=pet.isVisible(); main.hide();pet.hide();overlay.hide();
  try {
    await new Promise(r=>setTimeout(r,240));
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.min(display.size.width*display.scaleFactor,1920),height:Math.min(display.size.height*display.scaleFactor,1080)}});
    const source=sources.find(s=>s.display_id===String(display.id))||(sources.length===1?sources[0]:null);
    if(!source||source.thumbnail.isEmpty())throw new Error('Could not capture the selected display.');
    let image=source.thumbnail;
    // Overlay user marks into the image without exposing the overlay toolbar or companion window.
    if(shapes.length) {
      overlay.setBounds(display.bounds); updateOverlay();
      const rendered=await overlay.webContents.executeJavaScript('window.exportMarks()');
      image=nativeImage.createFromDataURL(await main.webContents.executeJavaScript(`window.mergeScreenshot(${JSON.stringify(image.toDataURL())},${JSON.stringify(rendered)})`));
    }
    return screenSnapshot.set({dataURL:image.toDataURL(),displayId:display.id,bounds:display.bounds,width:image.getSize().width,height:image.getSize().height});
  } finally {if(wasMain)main.showInactive();if(wasPet)pet.showInactive();updateOverlay();}
}
function addShape(args) {
  const shot=screenSnapshot.get(args.snapshot);if(shot.displayId!==targetDisplay().id)throw new Error('Selected display changed. Capture it again.');
  const color=args.color==='auto'?['green','yellow','blue'][colorIndex++%3]:args.color;
  if(shapes.length>=200)shapes.shift();shapes.push({...args,color});overlay.setBounds(shot.bounds);updateOverlay();return {status:'drawn'};
}
async function readCalendar({from,to}) {
  const start=new Date(isoDate(from)),end=new Date(isoDate(to));
  if(end<=start||end-start>31*86400000)throw new Error('Choose a calendar range between 1 minute and 31 days.');
  const file=path.join(app.getPath('userData'),'calendar.ics');if(!fs.existsSync(file))throw new Error('Import an ICS calendar in Settings first.');
  const ical=require('node-ical'); const events=ical.sync.parseICS(fs.readFileSync(file,'utf8'));const result=[];
  for(const event of Object.values(events)) {
    if(event.type!=='VEVENT')continue;
    if(event.status==='CANCELLED')continue;
    const instances=ical.expandRecurringEvent(event,{from:start,to:end,expandOngoing:true});
    for(const occurrence of instances) {
      if(occurrence.start>=end)continue;
      result.push({title:occurrence.summary||'Untitled',start:occurrence.start.toISOString(),end:occurrence.end?.toISOString()||occurrence.start.toISOString(),location:occurrence.location||'',allDay:!!occurrence.isFullDay});
      if(result.length>=250)break;
    }
    if(result.length>=250)break;
  }
  return {status:'ok',source:'imported ICS snapshot; not live sync',events:result.sort((a,b)=>a.start.localeCompare(b.start)),limit:250};
}
function makeDispatcher() {
  const handlers={
    list_apps:async a=>({status:'ok',apps:await apps(a.query)}),
    open_app:async a=>{requireDesktop();await apps('');const item=appsCache.find(x=>x.id===a.app_id);if(!item)throw new Error('Use an exact app_id returned by list_apps.');await new Promise((resolve,reject)=>{const launcher=spawn(path.join(process.env.SystemRoot,'explorer.exe'),['shell:AppsFolder\\'+item.id],{windowsHide:true,stdio:'ignore'});launcher.once('spawn',resolve);launcher.once('error',reject);});return {status:'launch_requested',app:item.name};},
    open_website:async a=>{const url=normalizeSpotifyWebURL(webURL(a.url));await shell.openExternal(url);return {status:'opened',url};},
    search_web:async a=>{await shell.openExternal('https://www.google.com/search?q='+encodeURIComponent(a.query));return {status:'opened_search'};},
    inspect_app:async a=>{requireDesktop();const result=await ps({action:'inspect',query:a.query});if(result.status==='inspected'){const snapshot=appSnapshot.set(result);return {...result,snapshot:snapshot.id};}return result;},
    click_app_control:async (a,context)=>{requireDesktop();return performControl('click',a,context);},
    type_in_app:async (a,context)=>{requireDesktop();return performControl('type',a,context);},
    computer_list_windows:async a=>{requireDesktop();return computer.listWindows(a);},
    computer_find_window:async (a,context)=>{requireDesktop();return computer.findWindow(a,context);},
    computer_restore_window:async (a,context)=>{requireDesktop();return computer.restore(a,context);},
    computer_observe:async (a,context)=>{requireDesktop();return visual.observe(a,context);},
    computer_input:async (a,context)=>{requireDesktop();return visual.input(a,context);},
    computer_inspect_window:async a=>{requireDesktop();return computer.inspect(a);},
    computer_action:async (a,context)=>{requireDesktop();return computer.action(a,context);},
    computer_action_sequence:async (a,context)=>{requireDesktop();return computer.sequence(a,context);},
    control_media:async a=>{requireDesktop();return ps({action:'media',key:a.action});},
    search_spotify:async a=>{requireDesktop();return openSpotifySearch(a.query,uri=>shell.openExternal(uri));},
    create_note:a=>{const item=store.add('notes',{title:a.title,text:a.text});stateChanged();return {status:'saved',id:item.id,title:item.title};},
    read_notes:a=>({status:'ok',notes:store.data.notes.filter(n=>(n.title+' '+n.text).toLowerCase().includes(a.query.toLowerCase())).slice(-30)}),
    create_reminder:a=>{const due_at=a.due_at?isoDate(a.due_at):'';const item=store.add('reminders',{title:a.title,due_at,completed:false,notified:false});stateChanged();return {status:'created',...item};},
    read_reminders:a=>({status:'ok',reminders:store.data.reminders.filter(r=>a.include_completed||!r.completed).slice(-100)}),
    complete_reminder:a=>{const item=store.complete(a.id);stateChanged();return {status:'completed',...item};},
    schedule_alert:a=>{const item=store.add('alerts',{title:a.title,due_at:new Date(Date.now()+a.seconds*1000).toISOString(),notified:false});stateChanged();return {status:'scheduled',...item};},
    list_alerts:()=>({status:'ok',alerts:store.data.alerts.filter(a=>!a.notified)}),
    cancel_alert:a=>{const item=store.data.alerts.find(x=>x.id===a.id&&!x.notified);if(!item)throw new Error('Pending alert not found.');item.notified=true;item.cancelled=true;store.save();stateChanged();return {status:'cancelled'};},
    read_calendar:readCalendar,
    look_at_screen:async (a,context)=>{const shot=await capture();context.assertActive();const findings=await ai.see(shot.dataURL,a.question,context.signal);context.assertActive();return {status:'captured',snapshot:shot.id,width:shot.width,height:shot.height,findings};},
    draw_on_screen:addShape,draw_screen_path:addShape,
    clear_screen_drawings:()=>{shapes=[];updateOverlay();return {status:'cleared'};},
    set_pixie_size:a=>{petPresentation.setSize(a.size);publishPet();return {status:'resized',size:a.size};}
  };
  const desktopTools=['list_apps','open_app','open_website','search_web','inspect_app','click_app_control','type_in_app','computer_list_windows','computer_find_window','computer_restore_window','computer_inspect_window','computer_action','computer_action_sequence','computer_observe','computer_input','control_media','search_spotify','look_at_screen'];
  const visualInvalidators=new Set(['open_app','open_website','search_web','inspect_app','click_app_control','type_in_app','computer_find_window','computer_restore_window','computer_inspect_window','computer_action','computer_action_sequence','control_media','search_spotify','look_at_screen']);
  for(const name of desktopTools){
    const handler=handlers[name];
    handlers[name]=(args,context)=>desktopActivity.run(context.activityScope,async()=>{context.assertActive();if(visualInvalidators.has(name))visual?.clear();return handler(args,context);});
  }
  dispatch=createDispatcher(handlers,name=>send('activity',{name,label:name==='set_pixie_size'?'resize Mitch':name.replaceAll('_',' ')}));
}
function handle(name,fn,pages=['index.html']) {
  ipcMain.handle('companion:'+name,async(event,...args)=>{
    const allowed=pages.map(f=>pathToFileURL(path.join(root,'ui',f)).href);
    if(event.senderFrame!==event.sender.mainFrame||!allowed.includes(event.senderFrame.url))throw new Error('Untrusted app frame.');
    try{return await fn(...args);}catch(e){throw new Error(e.message||'Action failed.');}
  });
}
function registerIPC() {
  handle('voiceDisplay',updateVoiceDisplay);
  handle('petState',()=>petPresentation.snapshot(),['pet.html']);
  handle('wakeStatus',()=>wake.status());
  handle('resumeWake',async()=>{await wake.resume();return wake.status();});
  handle('claimMicrophone',(kind,wakeId)=>wake.claim(kind,wakeId));
  handle('releaseMicrophone',id=>{wake.release(id);return {status:'ok'};});
  handle('computerStatus',()=>computerStatus());
  handle('checkComputer',async()=>{requireDesktop();return desktopActivity.run(null,async()=>{const result=await computer.listWindows({query:''});send('computerState',computerStatus());return {...computerStatus(),windowsFound:result.windows.length};});});
  handle('stopTasks',stopTasks,['index.html','pet.html']);
  handle('resumeComputer',()=>{if(!store.data.settings.allowDesktop)throw new Error('Enable and save Desktop actions first.');computer.resume();send('computerState',computerStatus());return computerStatus();});
  handle('state',()=>({version:app.getVersion(),settings:{...store.data.settings,screenId:String(targetDisplay().id)},hasKey:!!apiKey,screens:screen.getAllDisplays().map(d=>({id:String(d.id),label:d.label||`Display ${d.id}`,width:d.size.width,height:d.size.height})),calendar:fs.existsSync(path.join(app.getPath('userData'),'calendar.ics')),voiceActive}));
  handle('saveSettings',async values=>{
    if(!values||typeof values!=='object')throw new Error('Invalid settings.');
    for(const key of ['voiceModel','chatModel','transcriptionModel']) {if(typeof values[key]!=='string'||!/^[a-zA-Z0-9._-]{1,80}$/.test(values[key]))throw new Error('Invalid model name.');}
    if(values.key){if(typeof values.key!=='string'||values.key.length>500||/\s/.test(values.key))throw new Error('Invalid API key.');if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('Windows secure storage is unavailable.');store.data.encryptedKey=(await safeStorage.encryptStringAsync(values.key)).toString('base64');apiKey=values.key;}
    if(store.data.settings.screenId!==String(values.screenId||'')){shapes=[];screenSnapshot.value=null;updateOverlay();}
    const desktopWasEnabled=store.data.settings.allowDesktop,wakeWasEnabled=store.data.settings.wakeEnabled;
    store.data.settings={voiceModel:values.voiceModel,chatModel:values.chatModel,transcriptionModel:values.transcriptionModel,screenId:String(values.screenId||''),allowScreen:!!values.allowScreen,allowDesktop:!!values.allowDesktop,wakeEnabled:!!values.wakeEnabled,formatDictation:!!values.formatDictation};
    store.save();if(desktopWasEnabled&&!values.allowDesktop)await stopTasks();
    await wake.configure({enabled:values.wakeEnabled,available:!!apiKey});if(values.wakeEnabled&&!wakeWasEnabled)await wake.resume();stateChanged();return {status:'saved'};
  });
  handle('deleteKey',async()=>{apiKey='';store.data.encryptedKey='';store.save();await wake.configure({enabled:store.data.settings.wakeEnabled,available:false});stateChanged();return {status:'removed'};});
  handle('chat',async text=>{const scope=desktopActivity.beginScope();try{return await ai.chat(text,undefined,scope);}finally{desktopActivity.endScope(scope);}});
  handle('resetChat',()=>{if(ai.busy)throw new Error('Wait for the current reply.');ai.history=[];return {status:'cleared'};});
  handle('voiceOffer',sdp=>ai.voice(sdp));
  handle('voiceReset',active=>{
    voiceController.abort();voiceController=new AbortController();voiceActive=!!active;voiceGeneration++;voiceCalls.clear();voiceContinuations.clear();voiceClaimedCalls.clear();
    if(!active)ai.closeVoice();
    else{
      // Prepare the existing session's tool connection while the user speaks,
      // instead of making the first desktop action wait for its handshake.
      const generation=voiceGeneration;
      ai.prepareVoice({signal:voiceController.signal}).catch(error=>{if(voiceActive&&generation===voiceGeneration)failVoice(error);});
    }
    if(voiceActivityScope)desktopActivity.endScope(voiceActivityScope);voiceActivityScope=null;send('voiceState',voiceActive);return {status:'ok',generation:voiceGeneration};
  });
  handle('voiceTaskFinished',generation=>{if(generation===voiceGeneration&&voiceActivityScope){desktopActivity.endScope(voiceActivityScope);voiceActivityScope=null;}return {status:'ok'};});
  handle('voiceTool',async call=>{
    if(!voiceActive)throw new Error('Voice session is not active.');
    if(!call||typeof call.call_id!=='string'||call.call_id.length>200||typeof call.arguments!=='string')throw new Error('Invalid voice action.');
    if(voiceCalls.has(call.call_id))return voiceCalls.get(call.call_id).then(publicVoiceOutput);
    if(voiceCalls.size>=500)throw new Error('Session action limit reached. Restart voice.');
    const generation=voiceGeneration,signal=voiceController.signal;
    if(!voiceActivityScope)voiceActivityScope=desktopActivity.beginScope();
    const activityScope=voiceActivityScope;
    const result=(async()=>{try{if(generation!==voiceGeneration)throw new Error('Session ended.');return await dispatch(call.name,JSON.parse(call.arguments),{signal,activityScope});}catch(e){return {status:'error',message:e.message};}})();voiceCalls.set(call.call_id,result);return result.then(publicVoiceOutput);
  });
  handle('voiceContinue',async(callIds,generation)=>{
    if(!voiceActive||generation!==voiceGeneration)throw new Error('Voice session ended.');
    if(!Array.isArray(callIds)||!callIds.length||callIds.length>50||callIds.some(id=>typeof id!=='string'||!id||id.length>200||!voiceCalls.has(id))||new Set(callIds).size!==callIds.length)throw new Error('Invalid voice result batch.');
    const key=JSON.stringify(callIds),prior=voiceContinuations.get(key);if(prior)return prior;
    if(callIds.some(id=>voiceClaimedCalls.has(id)))throw new Error('Voice result was already submitted; do not replay it.');
    callIds.forEach(id=>voiceClaimedCalls.add(id));
    const signal=voiceController.signal;
    const check=()=>{signal.throwIfAborted();if(!voiceActive||generation!==voiceGeneration)throw new Error('Voice session ended.');};
    const pending=(async()=>{
      const outputs=await Promise.all(callIds.map(id=>voiceCalls.get(id)));check();
      if(!store.data.settings.allowScreen&&outputs.some(output=>output?._images?.length))throw new Error('Screen sharing was disabled before the visual result was sent.');
      await ai.continueVoice(callIds.map((call_id,index)=>({call_id,output:outputs[index]})),{signal});check();
      callIds.forEach((id,index)=>voiceCalls.set(id,Promise.resolve(publicVoiceOutput(outputs[index]))));
      return {status:'sent'};
    })();voiceContinuations.set(key,pending);return pending;
  });
  handle('transcribe',data=>ai.transcribe(Buffer.from(data)));
  handle('copy',text=>{if(typeof text!=='string'||text.length>30000)throw new Error('Invalid clipboard text.');clipboard.writeText(text);return {status:'copied'};});
  handle('library',()=>({notes:store.data.notes,reminders:store.data.reminders,alerts:store.data.alerts}));
  handle('localAction',(name,args)=>{if(!['create_note','create_reminder','complete_reminder','schedule_alert','cancel_alert','clear_screen_drawings','set_pixie_size'].includes(name))throw new Error('Action not available here.');return dispatch(name,args);});
  handle('window',action=>{if(action==='open')showMain();else if(action==='hide')main.hide();else if(action==='voice')send('shortcut','voice');else if(action==='quit'){quitting=true;app.quit();}return {status:'ok'};},['index.html','pet.html']);
  handle('drawMode',value=>setInk(value),['index.html','pet.html','overlay.html']);
  handle('ink',points=>{if(!inkMode||!Array.isArray(points)||points.length<2||points.length>5000||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error('Invalid stroke.');if(shapes.length>=200)shapes.shift();shapes.push({shape:'polyline',points,color:'red'});updateOverlay();},['overlay.html']);
  handle('chooseCalendar',async()=>{const result=await dialog.showOpenDialog(main,{title:'Import a calendar snapshot',filters:[{name:'iCalendar',extensions:['ics']}],properties:['openFile']});if(result.canceled)return {status:'cancelled'};const file=result.filePaths[0];if(fs.statSync(file).size>5e6)throw new Error('Choose an ICS file smaller than 5 MB.');const text=fs.readFileSync(file,'utf8');if(!text.includes('BEGIN:VCALENDAR'))throw new Error('Invalid ICS file.');require('node-ical').sync.parseICS(text);fs.writeFileSync(path.join(app.getPath('userData'),'calendar.ics'),text);stateChanged();return {status:'imported'};});
  handle('screenPreview',async()=>{const shot=await capture();return {dataURL:shot.dataURL,width:shot.width,height:shot.height};});
}
async function smokeTest() {
  const dir=path.join(process.cwd(),'test-output');fs.mkdirSync(dir,{recursive:true});
  await main.webContents.executeJavaScript('document.fonts.ready');
  await new Promise(r=>setTimeout(r,600));
  const assert=require('node:assert/strict');
  assert.equal(typeof require('undici').WebSocket,'function','Voice image delivery dependency must be bundled.');
  const state=await main.webContents.executeJavaScript('window.companion.state()');assert.equal(state.hasKey,false);
  const markup=await main.webContents.executeJavaScript('document.body.innerText');assert.match(markup,/Your little\s+Windows companion/);
  const png=await main.webContents.capturePage();fs.writeFileSync(path.join(dir,'home.png'),png.toPNG());
  await main.webContents.executeJavaScript("document.querySelector('[data-page=settings]').click()");
  await new Promise(r=>setTimeout(r,100));
  fs.writeFileSync(path.join(dir,'settings.png'),(await main.webContents.capturePage()).toPNG());
  const computerBefore=await main.webContents.executeJavaScript('window.companion.computerStatus()');assert.equal(computerBefore.installed,true);
  if(app.isPackaged)assert.equal(computerBefore.administrator,true,'Packaged Mitch must launch as Administrator.');
  store.data.settings.allowDesktop=true;
  const computerCheck=await main.webContents.executeJavaScript('window.companion.checkComputer()');assert.equal(computerCheck.running,true);assert.ok(computerCheck.windowsFound>0);
  await main.webContents.executeJavaScript('window.companion.stopTasks()');assert.equal(computer.paused,true);assert.equal(cua.running,false);
  assert.equal((await dispatch('computer_list_windows',{query:''})).status,'error');
  await main.webContents.executeJavaScript('window.companion.resumeComputer()');assert.equal(computer.paused,false);
  const testScope=desktopActivity.beginScope(),originalDialog=dialog.showMessageBox;
  const controlTitle=`Pixie Automated Control Check ${process.pid}`;
  main.setTitle(controlTitle);
  dialog.showMessageBox=async()=>{throw new Error('Unexpected per-action permission dialog.');};
  try {
    await main.webContents.executeJavaScript("document.querySelector('[data-page=chat]').click()");
    // Shell elevation may launch with an initial hidden show command. Make our
    // isolated test target visible before asking the on-screen window provider.
    main.show();
    let windows,window;
    for(let i=0;i<15;i++){
      windows=await dispatch('computer_list_windows',{query:controlTitle},{activityScope:testScope});
      window=windows.windows?.find(w=>w.pid===process.pid);
      if(window)break;
      await new Promise(r=>setTimeout(r,200));
    }
    assert.ok(window,JSON.stringify({windows,visible:main.isVisible(),title:main.getTitle()}));
    const observed=await dispatch('computer_inspect_window',{pid:window.pid,window_id:window.window_id},{activityScope:testScope});
    const input=observed.controls?.find(c=>c.name==='Your message');assert.ok(input,JSON.stringify(observed));
    const typed=await dispatch('computer_action',{snapshot:observed.snapshot,kind:'type',control_id:input.control_id,expected_name:input.name,text:'Automatic Cua input — سلام'},{activityScope:testScope});
    assert.notEqual(typed.status,'error',JSON.stringify(typed));
    assert.equal(await main.webContents.executeJavaScript("document.getElementById('message').value"),'Automatic Cua input — سلام');
    const fixtureOutput=path.join(dir,`automatic-legacy-${Date.now()}.txt`);
    const fixture=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(process.cwd(),'tests/windows-fixture.ps1'),'-OutputFile',fixtureOutput],{windowsHide:true,stdio:'ignore'});
    try {
      let legacy;
      for(let i=0;i<12;i++){legacy=await dispatch('inspect_app',{query:'Companion Accessibility Test Fixture'},{activityScope:testScope});if(legacy.status==='inspected')break;await new Promise(r=>setTimeout(r,200));}
      assert.equal(legacy.window?.pid,fixture.pid,JSON.stringify(legacy));
      const fast=await dispatch('computer_find_window',{query:'Companion Accessibility Test Fixture'},{activityScope:testScope});
      assert.equal(fast.window?.pid,fixture.pid,JSON.stringify(fast));
      const fastInput=fast.controls.find(control=>control.name==='Test input'),fastButton=fast.controls.find(control=>control.name==='Confirm test');
      assert.ok(fastInput&&fastButton);
      const fastResult=await dispatch('computer_action_sequence',{snapshot:fast.snapshot,actions:[{kind:'type',control_id:fastInput.control_id,expected_name:fastInput.name,text:'Fast sequence — سلام'},{kind:'click',control_id:fastButton.control_id,expected_name:fastButton.name}]},{activityScope:testScope});
      assert.ok(['completed','unverified'].includes(fastResult.status),JSON.stringify(fastResult));assert.equal(fastResult.completed,2);
      assert.equal(fastResult.results[0].verified,true,JSON.stringify(fastResult));
      assert.equal(fs.readFileSync(fixtureOutput,'utf8').replace(/^\uFEFF/,''),'Fast sequence — سلام');
      const legacyInput=legacy.controls?.find(c=>c.type==='Win32.Edit'&&!c.password);assert.ok(legacyInput,JSON.stringify(legacy));
      const legacyTyped=await dispatch('type_in_app',{snapshot:legacy.snapshot,control_id:legacyInput.id,text:'Automatic legacy input'},{activityScope:testScope});
      assert.notEqual(legacyTyped.status,'error',JSON.stringify(legacyTyped));
      const legacyButton=legacy.controls.find(c=>c.name==='Confirm test');assert.ok(legacyButton);
      const clicked=await dispatch('click_app_control',{snapshot:legacy.snapshot,control_id:legacyButton.id,expected_name:legacyButton.name},{activityScope:testScope});
      assert.notEqual(clicked.status,'error',JSON.stringify(clicked));
      for(let i=0;i<10&&!fs.existsSync(fixtureOutput);i++)await new Promise(r=>setTimeout(r,50));
      assert.equal(fs.readFileSync(fixtureOutput,'utf8').replace(/^\uFEFF/,''),'Automatic legacy input');
    } finally {fixture.kill();}
    if(process.argv.includes('--calculator-test'))await require(path.join(process.cwd(),'tests/calculator-integration.js'))({dispatch,activityScope:testScope,directory:dir,version:app.getVersion()});
    if(process.argv.includes('--visual-test')){
      const screenAllowed=store.data.settings.allowScreen;store.data.settings.allowScreen=true;
      try{
        await require(path.join(process.cwd(),'tests/visual-integration.js'))({BrowserWindow,screen,dispatch,activityScope:testScope,directory:dir,version:app.getVersion()});
        const originalContinue=ai.continueVoice;let submissions=0;
        ai.continueVoice=async results=>{submissions++;assert.equal(results.length,1);assert.ok(results[0].output._images?.[0].data_url.startsWith('data:image/'));return {status:'submitted',count:1};};
        try{
          const activation=await main.webContents.executeJavaScript('window.companion.voiceReset(true)');
          const call={call_id:'smoke-visual-output',name:'computer_observe',arguments:JSON.stringify({scope:'window',pid:window.pid,window_id:window.window_id})};
          const visibleResult=await main.webContents.executeJavaScript(`window.companion.voiceTool(${JSON.stringify(call)})`);
          assert.ok(visibleResult.snapshot,JSON.stringify(visibleResult));assert.equal(visibleResult._images,undefined,'Screenshot bytes must stay in the backend.');
          const submit=`window.companion.voiceContinue(["smoke-visual-output"],${activation.generation})`;
          await main.webContents.executeJavaScript(submit);await main.webContents.executeJavaScript(submit);assert.equal(submissions,1,'Do not replay a voice continuation.');
          await main.webContents.executeJavaScript('window.companion.voiceReset(false)');
          await assert.rejects(main.webContents.executeJavaScript(submit),/ended/);
        }finally{ai.continueVoice=originalContinue;await main.webContents.executeJavaScript('window.companion.voiceReset(false)');}
      }
      finally{store.data.settings.allowScreen=screenAllowed;visual.clear();}
    }
    assert.equal(desktopActivity.active,true);
    await activityOverlay.ready();
    for(const [id,win]of activityOverlay.windows){assert.equal(win.isVisible(),true);const shot=await win.webContents.capturePage();const size=shot.getSize(),pixels=shot.toBitmap();assert.equal(pixels[(Math.floor(size.height/2)*size.width+Math.floor(size.width/2))*4+3],0,'Overlay center must remain transparent.');fs.writeFileSync(path.join(dir,`blue-corners-${id}.png`),shot.toPNG());}
  } finally {dialog.showMessageBox=originalDialog;main.setTitle('Mitch');desktopActivity.endScope(testScope);}
  assert.equal(desktopActivity.active,false);
  for(const win of activityOverlay.windows.values())assert.equal(win.isVisible(),false);
  await main.webContents.executeJavaScript("document.querySelector('[data-page=settings]').click()");
  await main.webContents.executeJavaScript("document.getElementById('computerStatus').scrollIntoView({block:'center'})");
  await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(dir,'computer-settings.png'),(await main.webContents.capturePage()).toPNG());
  store.data.settings.allowDesktop=false;
  assert.equal((await dispatch('create_note',{title:'Smoke test',text:'Local note verified.'})).status,'saved');
  const saved=await main.webContents.executeJavaScript('window.companion.library()');assert.ok(saved.notes.some(n=>n.title==='Smoke test'));
  const resized=await dispatch('set_pixie_size',{size:'giant'});assert.equal(resized.status,'resized');assert.equal(pet.getBounds().width,360);
  assert.equal((await dispatch('open_website',{url:'file:///C:/Windows'})).status,'error');
  const originalOpenExternal=shell.openExternal,launched=[];
  const originalDesktopSetting=store.data.settings.allowDesktop;
  try {
    shell.openExternal=async uri=>{launched.push(uri);};
    store.data.settings.allowDesktop=true;
    const search=await dispatch('search_spotify',{query:'Michael+Jackson+Smooth+Criminal'});
    assert.equal(search.query,'Michael Jackson Smooth Criminal');
    assert.equal(launched[0],'spotify:search:Michael%20Jackson%20Smooth%20Criminal');
    await dispatch('open_website',{url:'https://open.spotify.com/search/Michael+Jackson+Smooth+Criminal'});
    assert.equal(launched[1],'https://open.spotify.com/search/Michael%20Jackson%20Smooth%20Criminal');
  } finally {shell.openExternal=originalOpenExternal;store.data.settings.allowDesktop=originalDesktopSetting;}
  const secure=await safeStorage.encryptStringAsync('smoke-not-a-real-key');assert.equal((await safeStorage.decryptStringAsync(secure)).result,'smoke-not-a-real-key');
  const list=await ps({action:'apps'});assert.ok(list.apps.length>0);
  store.data.settings.allowScreen=true;
  const captured=await capture();assert.ok(captured.width>100&&captured.height>100);assert.ok(captured.dataURL.startsWith('data:image/png;base64,'));
  const marked=await dispatch('draw_on_screen',{snapshot:captured.id,shape:'circle',x:.3,y:.3,x2:.4,y2:.4,label:'Test',color:'green'});assert.equal(marked.status,'drawn');
  const ink=await overlay.webContents.executeJavaScript('window.exportMarks()');assert.ok(ink.startsWith('data:image/png;base64,'));
  const merged=await capture();assert.ok(merged.dataURL.startsWith('data:image/png;base64,'));
  assert.equal((await dispatch('draw_on_screen',{snapshot:captured.id,shape:'circle',x:.3,y:.3,x2:.4,y2:.4,label:'Old',color:'green'})).status,'error');
  shapes=[];updateOverlay();store.data.settings.allowScreen=false;
  const calendarFile=path.join(app.getPath('userData'),'calendar.ics');
  fs.writeFileSync(calendarFile,'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test-calendar\r\nDTSTART:20261107T090000Z\r\nDTEND:20261107T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261108T090000Z\r\nSUMMARY:Test event\r\nEND:VEVENT\r\nEND:VCALENDAR');
  const calendar=await readCalendar({from:'2026-11-07T00:00:00Z',to:'2026-11-10T00:00:00Z'});assert.equal(calendar.events.length,2);fs.unlinkSync(calendarFile);
  await require(path.join(process.cwd(),'tests/pet-integration.js'))({main,pet,screen,directory:dir,version:app.getVersion()});
  if(process.argv.includes('--wake-test'))await require(path.join(process.cwd(),'tests/wake-integration.js'))({helper:path.join(app.isPackaged?root.replace(/app\.asar$/,'app.asar.unpacked'):root,'wake-word.ps1'),main,directory:dir,version:app.getVersion()});
  fs.writeFileSync(path.join(dir,'smoke-result.json'),JSON.stringify({status:'passed',version:app.getVersion(),packaged:app.isPackaged,administrator,checks:['renderer loads','settings navigation','Cua executable bundled','Cua connection via trusted renderer IPC','Stop cancels and terminates driver','paused tool refusal','explicit Resume','Cua text input without a permission dialog','combined window discovery and inspection','fast local sequence with exact text readback and independent click verification','legacy text and button actions without permission dialogs','blue corners visible on every monitor','overlay center transparent','corners hidden after task completion','local note via IPC','pet resize','unsafe URL refusal','Spotify desktop query encoding (mock OS launcher)','Spotify web search encoding (mock OS launcher)','Windows secure storage round trip','Windows app discovery','screen capture','overlay drawing','composite capture of user marks','stale screenshot refusal','recurring ICS events and exclusions'],appsFound:list.apps.length},null,2));
  if(process.argv.includes('--launch-after-smoke'))app.relaunch({args:process.argv.slice(1).filter(arg=>!['--smoke-test','--launch-after-smoke','--calculator-test','--visual-test','--wake-test'].includes(arg))});
  quitting=true;app.quit();
}
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>main&&showMain());
  app.whenReady().then(async()=>{
    store=new Store(app.getPath('userData'));
    administrator=(await ps({action:'privileges'})).administrator===true;
    const helperRoot=app.isPackaged?root.replace(/app\.asar$/, 'app.asar.unpacked'):root;
    cua=new CuaClient({executable:path.join(helperRoot,'vendor','cua-driver','cua-driver.exe')});
    // Desktop permission is granted once in Settings. Target and cancellation checks still run per action.
    computer=new ComputerUse({client:cua,getSettings:()=>store.data.settings,confirm:async()=>true,restoreWindow:args=>ps({action:'restore_window',...args})});
    visual=new ComputerVisual({computer});
    wake=new WakeService({listener:new WakeListener({helper:path.join(helperRoot,'wake-word.ps1')}),onState:wakeStateChanged,onWake:event=>{if(main&&!main.isDestroyed())main.webContents.send('companion:wakeDetected',event);}});
    if(store.data.encryptedKey){try{const unlocked=await safeStorage.decryptStringAsync(Buffer.from(store.data.encryptedKey,'base64'));apiKey=unlocked.result;if(unlocked.shouldReEncrypt){store.data.encryptedKey=(await safeStorage.encryptStringAsync(apiKey)).toString('base64');store.save();}}catch{dialog.showErrorBox('API key unavailable','Windows could not unlock the saved key. Enter it again in Settings.');}}
    session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(permission==='media'&&localPages.has(contents.getURL())&&contents===main?.webContents&&!details.mediaTypes?.includes('video')));
    session.defaultSession.setPermissionCheckHandler((contents,permission)=>permission==='media'&&contents===main?.webContents&&localPages.has(contents.getURL()));
    makeDispatcher();ai=new AI(()=>store.data.settings,async()=>apiKey,dispatch);ai.onVoiceError=failVoice;registerIPC();makeWindows();
    main.webContents.on('render-process-gone',()=>stopTasks().catch(()=>{}));
    main.webContents.once('did-finish-load',()=>{if(!smoke)wake.configure({enabled:store.data.settings.wakeEnabled,available:!!apiKey}).catch(error=>send('notice',error.message));});
    setInterval(()=>{const due=store.due();for(const item of due){if(Notification.isSupported())new Notification({title:'Mitch reminder',body:item.title}).show();send('notice',item.title);}if(due.length)stateChanged();},1000).unref();
    if(smoke){await new Promise(r=>main.webContents.once('did-finish-load',r));await smokeTest();}
  }).catch(error=>{fs.mkdirSync(path.join(process.cwd(),'test-output'),{recursive:true});fs.writeFileSync(path.join(process.cwd(),'test-output','startup-error.txt'),error.stack);if(!smoke)dialog.showErrorBox('Companion could not start',error.message);app.exit(1);});
}
app.on('before-quit',()=>{quitting=true;wake?.close().catch(()=>{});globalShortcut.unregisterAll();ai?.cancel();ai?.closeVoice();dispatch?.cancel();voiceController.abort();visual?.clear();desktopActivity?.stop();activityOverlay?.destroy();computer?.stop().catch(()=>{});for(const child of windowsChildren)child.kill();});
app.on('window-all-closed',()=>{if(quitting)app.quit();});
