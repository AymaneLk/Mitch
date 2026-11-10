'use strict';
// One-shot setup. Waiting inspects local token availability only, never API tools.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {protectedStorage}=require('../chatgpt-storage'),{McpHub}=require('../mcp-hub');
const directory=path.join(app.getPath('appData'),'Pixie Windows Companion');
app.setName('Mitch');app.setPath('userData',directory);
if(!app.requestSingleInstanceLock()){console.error('Close Mitch before account setup.');app.exit(1);}
app.whenReady().then(async()=>{
 const report=path.resolve(__dirname,'../test-output/mcp-authorization.json'),state={status:'checking',services:{}};
 const save=()=>fs.writeFileSync(report,JSON.stringify(state,null,2));save();
 const hub=new McpHub({directory:path.join(directory,'mcp'),runtimeFile:path.join(directory,'mcp-runtime.json'),storage:protectedStorage(directory,safeStorage,'mcp-auth.json')});
 try{
  await hub.init();
  for(const id of ['github','spotify','google']){
   if(!hub.ready(id)){state.services[id]={status:'needs_credentials'};save();continue;}
   if(id==='google'&&!hub.hasAccountSession(id)&&!process.argv.includes('--check-only')){
    await hub.authorize(id,async url=>{state.services.google={status:'awaiting_consent',url};save();});
    const deadline=Date.now()+15*60*1000;
    while(!hub.hasAccountSession(id)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1500));
   }
   const started=performance.now();
   try{await hub.check(id);state.services[id]={status:'connected',checkMs:Math.round(performance.now()-started),tools:hub.definitions.get(id)?.length||0};}
   catch(e){state.services[id]={status:'not_connected',message:e.message};}
   save();
  }
  state.status=Object.values(state.services).every(s=>s.status==='connected')?'connected':'incomplete';save();
 }catch(e){state.status='failed';state.message=e.message;save();process.exitCode=1;}
 finally{try{await hub.close();}finally{app.exit(process.exitCode||0);}}
});
