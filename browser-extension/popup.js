'use strict';
const label=document.getElementById('status'),button=document.getElementById('reconnect');
const enablePages=document.getElementById('enable-pages'),pageStatus=document.getElementById('page-status');
async function refresh(type='mitch_browser_status'){
  try{const state=await chrome.runtime.sendMessage({type});label.textContent=state?.status||'Open Mitch to connect.';enablePages.hidden=state?.pageAccess===true;pageStatus.textContent=state?.pageAccess?'Page controls enabled.':'Page controls are off until you grant access.';}
  catch{label.textContent='Open Mitch to connect.';}
}
button.addEventListener('click',()=>refresh('mitch_browser_reconnect'));
enablePages.addEventListener('click',async()=>{
  try{const granted=await chrome.permissions.request({origins:['http://*/*','https://*/*']});await refresh('mitch_browser_permissions_changed');if(!granted)pageStatus.textContent='Page controls remain off. Tab controls still work.';}
  catch{pageStatus.textContent='Access was not enabled. You can try again.';}
});
refresh();
setInterval(()=>refresh(),1000);
