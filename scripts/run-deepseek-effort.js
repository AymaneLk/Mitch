'use strict';
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runBenchmark}=require('./benchmark-deepseek-effort');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'test-output');
const nativeOnlySimple=process.argv.includes('--native-only-simple');
const originalProfile=path.join(app.getPath('appData'),'Pixie Windows Companion');
let temporaryProfile,key='',passed=false,startupError;
// No endpoint, profile or output-directory argument is accepted. The encrypted
// OS wrapping metadata goes to a disposable profile; the API key stays in RAM.
try{
  const state=JSON.parse(fs.readFileSync(path.join(originalProfile,'Local State'),'utf8'));
  if(!state.os_crypt?.encrypted_key)throw Error('Encrypted storage metadata is unavailable.');
  temporaryProfile=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-effort-benchmark-'));
  fs.writeFileSync(path.join(temporaryProfile,'Local State'),JSON.stringify({os_crypt:state.os_crypt}));
  app.setName('Mitch');app.setPath('userData',temporaryProfile);app.setAppUserModelId('local.independent.pixie.windows');
}catch(error){startupError=error;}
app.whenReady().then(async()=>{
  if(startupError)throw startupError;
  const saved=JSON.parse(fs.readFileSync(path.join(originalProfile,'library.json'),'utf8'));
  if(typeof saved.encryptedDeepSeekKey!=='string'||!saved.encryptedDeepSeekKey)throw Error('No encrypted DeepSeek key is saved.');
  key=(await safeStorage.decryptStringAsync(Buffer.from(saved.encryptedDeepSeekKey,'base64'))).result;
  const report=await runBenchmark({key,directory,nativeOnlySimple,onProgress:progress=>console.log(JSON.stringify(progress))});
  passed=report.status==='completed';
  console.log(JSON.stringify({status:report.status,summary:report.summary,by_category:report.by_category}));
}).catch(error=>{
  const report={status:'failed',phase:'effort benchmark startup',error:String(error.message).replaceAll(key||'__unset_key__','[REDACTED]').slice(0,250)};
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,nativeOnlySimple?'deepseek-effort-native-startup.json':'deepseek-effort-startup.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report));
}).finally(()=>{
  key='';
  if(temporaryProfile){
    // Remove only the copied encrypted metadata. The parent may remove this
    // exact generated temporary directory after Electron releases its files.
    try{fs.unlinkSync(path.join(temporaryProfile,'Local State'));}catch{}
    console.log(JSON.stringify({temporary_profile:temporaryProfile,encrypted_metadata_removed:!fs.existsSync(path.join(temporaryProfile,'Local State'))}));
  }
  app.exit(passed?0:1);
});
