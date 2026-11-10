'use strict';
// Benchmarks share the normal profile only after acquiring its process lock.
// Never copy rotating OAuth credentials into a second profile/process.
const {app,safeStorage,shell}=require('electron');
const path=require('node:path');
const {Store}=require('../core');
const {ChatGPTAuth}=require('../chatgpt-auth');
const {ChatGPTResponses}=require('../chatgpt-responses');
const {protectedStorage}=require('../chatgpt-storage');
app.setName('Mitch');app.setPath('userData',path.join(app.getPath('appData'),'Pixie Windows Companion'));
const locked=app.requestSingleInstanceLock();
app.on('window-all-closed',()=>{});
async function connect(onMetrics=()=>{}){
  if(!locked)throw Object.assign(Error('Quit Mitch before running this benchmark to protect refresh-token rotation.'),{code:'profile_in_use'});
  await app.whenReady();const store=new Store(app.getPath('userData'));
  const auth=new ChatGPTAuth({storage:protectedStorage(app.getPath('userData'),safeStorage),openBrowser:url=>shell.openExternal(url)});await auth.init();
  if(!auth.publicState().planUsage)throw Object.assign(Error('Connect ChatGPT in Mitch Settings before running this benchmark.'),{code:'session_expired'});
  await auth.catalog();const provider=new ChatGPTResponses({auth,onMetrics});
  return {auth,provider,settings:{...store.data.settings,chatProvider:'chatgpt'},close(){provider.close();auth.close();app.releaseSingleInstanceLock();}};
}
module.exports={connect,app};
