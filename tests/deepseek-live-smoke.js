'use strict';
// Explicit opt-in check of the real saved connection, without desktop actions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function({main,ai,directory}){
  const evaluate=code=>main.webContents.executeJavaScript(code);
  await evaluate('loadState()');
  const state=await evaluate('window.companion.state()');
  assert.equal(state.settings.chatProvider,'deepseek');assert.equal(state.hasDeepSeekKey,true);
  assert.equal(await evaluate("document.getElementById('setupBanner').hidden"),true);
  const savedDispatch=ai.dispatch,started=Date.now();
  ai.dispatch=async()=>{throw new Error('This connection check does not permit actions.');};
  try{await evaluate("go('chat');chat('Reply with exactly: DeepSeek is connected.')");}finally{ai.dispatch=savedDispatch;}
  const answer=await evaluate("document.querySelector('#messages .bubble.assistant:last-child')?.textContent||''");
  assert.ok(answer.includes('DeepSeek is connected.'),answer);
  fs.writeFileSync(path.join(directory,'deepseek-app-verification.json'),JSON.stringify({status:'passed',provider:state.settings.chatProvider,model:state.settings.deepseekChatModel,encryptedKeyUnlocked:true,setupBannerHidden:true,chatMs:Date.now()-started,answer,desktopActions:false},null,2));
  await evaluate("go('settings');loadState()");
  await evaluate("document.getElementById('deepseekSettings').scrollIntoView({block:'center'})");
  try{fs.writeFileSync(path.join(directory,'deepseek-live-settings.png'),(await main.webContents.capturePage()).toPNG());}catch{console.warn('Live settings capture unavailable. Connection checks passed.');}
  await evaluate("go('chat')");main.show();main.focus();
};
