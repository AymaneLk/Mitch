'use strict';
// Imports credentials without printing them; separate from ChatGPT token storage.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {protectedStorage}=require('../chatgpt-storage');
const {McpHub}=require('../mcp-hub');
app.setName('Mitch');app.setPath('userData',path.join(app.getPath('appData'),'Pixie Windows Companion'));
if(!app.requestSingleInstanceLock()){console.error('Close Mitch before importing account credentials.');app.exit(1);}
app.whenReady().then(async()=>{
 const directory=path.join(app.getPath('appData'),'Pixie Windows Companion'),staging=path.resolve(__dirname,'../test-output/mcp-account-setup.json');
 const hub=new McpHub({runtimeFile:path.join(directory,'mcp-runtime.json'),directory:path.join(directory,'mcp'),storage:protectedStorage(directory,safeStorage,'mcp-auth.json')});
 try{await hub.init();const values=JSON.parse(fs.readFileSync(staging,'utf8'));for(const id of ['google','spotify','github'])if(values[id])await hub.configure(id,values[id]);fs.unlinkSync(staging);console.log('MCP credentials imported into Windows encrypted storage.');}
 catch(e){console.error('Credential import failed: '+e.message);process.exitCode=1;}finally{try{await hub.close();}finally{app.exit(process.exitCode||0);}}
});
