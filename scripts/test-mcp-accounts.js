'use strict';
// Read-only account checks. No messages, playback changes or cloud file writes.
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {McpHub}=require('../mcp-hub'),{protectedStorage}=require('../chatgpt-storage');
const directory=path.join(app.getPath('appData'),'Pixie Windows Companion');
app.setName('Mitch');app.setPath('userData',directory);
if(!app.requestSingleInstanceLock()){console.error('Close Mitch before account checks.');app.exit(1);}
app.whenReady().then(async()=>{
 const hub=new McpHub({directory:path.join(directory,'mcp'),runtimeFile:path.resolve(__dirname,'../outputs/mcp-runtime/mcp-runtime.json'),storage:protectedStorage(directory,safeStorage,'mcp-auth.json')});
 const report={status:'running',at:new Date().toISOString(),checks:[],schemas:[]};
 try{await hub.init();for(const id of ['github','spotify','google']){
  await hub.check(id);
  report.schemas.push(...hub.describe('',[id],1000).filter(t=>/^(get_me|now_playing|devices|list_calendars|list_gmail_labels|list_drive_items|list_task_lists)$/.test(t.name)));
 }
 const email=hub.secrets.google.email;
 const cases=[
  {server:'github',tool:'get_me',arguments:{},valid:text=>/"login"\s*:\s*"AymaneLk"/i.test(text)},
  {server:'spotify',tool:'now_playing',arguments:{},valid:text=>/Nothing is playing|Playing|Paused/.test(text)},
  {server:'google',tool:'list_calendars',arguments:{user_google_email:email,max_results:1},valid:text=>/^(Successfully listed|No calendars)/.test(text)},
  {server:'google',tool:'list_gmail_labels',arguments:{user_google_email:email,compact:true,prefix:'INBOX'},valid:text=>{const v=JSON.parse(text);return v.count===1&&v.labels?.[0]?.id==='INBOX';}},
  {server:'google',tool:'list_drive_items',arguments:{user_google_email:email,page_size:1,detailed:false},valid:text=>/^(Found \d+ items|No items)/.test(text)},
  {server:'google',tool:'list_task_lists',arguments:{user_google_email:email,max_results:1},valid:text=>/^(Task Lists for|No task lists found)/.test(text)},
 ];
 for(const {valid,...step} of cases){const result=await hub.execute({steps:[step]}),receipt=result.receipts?.[0];let passed=false;try{passed=result.status==='completed'&&!!valid(receipt?.text||'');}catch{}report.checks.push({server:step.server,tool:step.tool,passed,ms:receipt?.ms,status:result.status,...(!passed?{diagnostic:(receipt?.text||result.message||'').slice(0,350)}:{})});}
 report.status=report.checks.every(c=>c.passed)?'passed':'failed';if(report.status==='failed')process.exitCode=1;
 delete report.schemas;
 }catch(e){report.status='failed';report.message=e.message;process.exitCode=1;}
 finally{fs.writeFileSync(path.resolve(__dirname,'../test-output/mcp-account-tests.json'),JSON.stringify(report,null,2));try{await hub.close();}finally{app.exit(process.exitCode||0);}}
});
