'use strict';
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runBenchmark}=require('./benchmark-general-model');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-output');
const originalProfile=path.join(app.getPath('appData'),'Pixie Windows Companion');
let temporaryProfile,key='',passed=false,startupError;
// Copy only encrypted OS wrapping metadata into a disposable Electron profile.
// The decrypted API key stays in memory and is never passed via argv or files.
try{
  const state=JSON.parse(fs.readFileSync(path.join(originalProfile,'Local State'),'utf8'));
  if(!state.os_crypt?.encrypted_key)throw Object.assign(Error('Encrypted storage metadata is unavailable.'),{code:'encrypted_metadata_missing'});
  temporaryProfile=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-general-model-'));
  fs.writeFileSync(path.join(temporaryProfile,'Local State'),JSON.stringify({os_crypt:state.os_crypt}));
  app.setName('Mitch');app.setPath('userData',temporaryProfile);app.setAppUserModelId('local.independent.pixie.windows');
}catch(error){startupError=error;}
app.whenReady().then(async()=>{
  if(startupError)throw startupError;
  const saved=JSON.parse(fs.readFileSync(path.join(originalProfile,'library.json'),'utf8'));
  if(typeof saved.encryptedDeepSeekKey!=='string'||!saved.encryptedDeepSeekKey)throw Object.assign(Error('No encrypted DeepSeek key is saved.'),{code:'encrypted_key_missing'});
  key=(await safeStorage.decryptStringAsync(Buffer.from(saved.encryptedDeepSeekKey,'base64'))).result;
  const report=await runBenchmark({key,settings:saved.settings,directory,onlyCurrent:process.argv.includes('--current-only'),onProgress:progress=>console.log(JSON.stringify(progress))});
  passed=report.status==='completed';console.log(JSON.stringify({status:report.status,summary:report.summary}));
}).catch(error=>{
  const report={status:'failed',errorCode:typeof error.code==='string'&&/^[a-z_0-9]+$/.test(error.code)?error.code:'benchmark_startup_failed'};
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'general-model-startup.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report));
}).finally(()=>{
  key='';let encryptedMetadataRemoved=true;
  if(temporaryProfile){try{fs.unlinkSync(path.join(temporaryProfile,'Local State'));}catch{}encryptedMetadataRemoved=!fs.existsSync(path.join(temporaryProfile,'Local State'));}
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'general-model-runner.json'),JSON.stringify({temporaryProfile,encryptedMetadataRemoved},null,2));
  app.exit(passed?0:1);
});
