'use strict';
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runBenchmark}=require('./benchmark-rocket-workflows');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-output');
const originalProfile=path.join(app.getPath('appData'),'Pixie Windows Companion');
const temporaryProfile=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-rocket-benchmark-'));
const state=JSON.parse(fs.readFileSync(path.join(originalProfile,'Local State'),'utf8'));
if(!state.os_crypt?.encrypted_key)throw Error('Encrypted storage metadata is unavailable.');
fs.writeFileSync(path.join(temporaryProfile,'Local State'),JSON.stringify({os_crypt:state.os_crypt}));
app.setName('Mitch');app.setPath('userData',temporaryProfile);app.setAppUserModelId('local.independent.pixie.windows');
let key='',passed=false;
app.whenReady().then(async()=>{
  const saved=JSON.parse(fs.readFileSync(path.join(originalProfile,'library.json'),'utf8'));
  key=(await safeStorage.decryptStringAsync(Buffer.from(saved.encryptedDeepSeekKey,'base64'))).result;
  const report=await runBenchmark({key,directory,onProgress:event=>console.log(JSON.stringify(event))});
  passed=report.status==='completed';console.log(JSON.stringify({status:report.status,summary:report.summary}));
}).catch(error=>{
  const report={status:'failed',error:String(error.message).replaceAll(key||'__unset_key__','[REDACTED]').slice(0,250)};
  fs.writeFileSync(path.join(directory,'rocket-benchmark-startup.json'),JSON.stringify(report));console.error(JSON.stringify(report));
}).finally(()=>{
  key='';try{fs.unlinkSync(path.join(temporaryProfile,'Local State'));}catch{}
  console.log(JSON.stringify({temporary_profile:temporaryProfile,encrypted_metadata_removed:!fs.existsSync(path.join(temporaryProfile,'Local State'))}));
  app.exit(passed?0:1);
});
