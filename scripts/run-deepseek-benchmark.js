'use strict';
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runBenchmark}=require('./benchmark-deepseek');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-output');
const originalProfile=path.join(app.getPath('appData'),'Pixie Windows Companion');
// SafeStorage needs the profile's encrypted wrapping key. Copy only that
// encrypted field into an isolated temporary profile; never modify Mitch's
// live profile, persist the decrypted key, or place it in process arguments.
const temporaryProfile=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-speed-benchmark-'));
const state=JSON.parse(fs.readFileSync(path.join(originalProfile,'Local State'),'utf8'));
if(!state.os_crypt?.encrypted_key)throw new Error('Encrypted storage metadata is unavailable.');
fs.writeFileSync(path.join(temporaryProfile,'Local State'),JSON.stringify({os_crypt:state.os_crypt}));
app.setName('Mitch');app.setPath('userData',temporaryProfile);
app.setAppUserModelId('local.independent.pixie.windows');
let key='',passed=false;
app.whenReady().then(async()=>{
  const saved=JSON.parse(fs.readFileSync(path.join(originalProfile,'library.json'),'utf8'));
  key=(await safeStorage.decryptStringAsync(Buffer.from(saved.encryptedDeepSeekKey,'base64'))).result;
  const report=await runBenchmark({key,directory,onProgress:p=>console.log(JSON.stringify(p))});
  passed=report.status==='completed';
  console.log(JSON.stringify({status:report.status,summary:report.summary}));
}).catch(error=>{
  const report={status:'failed',phase:'benchmark startup',error:String(error.message).replaceAll(key||'__unset_key__','[REDACTED]').slice(0,300)};
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'deepseek-benchmark-startup.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report));
}).finally(()=>{
  key='';
  // Delete only the isolated encrypted metadata; normal app data is untouched.
  try{fs.unlinkSync(path.join(temporaryProfile,'Local State'));}catch{}
  console.log(JSON.stringify({temporary_profile:temporaryProfile,encrypted_metadata_removed:!fs.existsSync(path.join(temporaryProfile,'Local State'))}));
  app.exit(passed?0:1);
});
