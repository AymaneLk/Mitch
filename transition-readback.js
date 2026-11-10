'use strict';
// A predicted post-navigation assertion can fail before the browser commits.
// Refresh only the exact originating tab; never authorize/repeat an input.
const profile=f=>/^[a-f0-9]{64}$/.test(f?.profile_revision||'')?f.profile_revision:f?.session_id;
async function refreshTransition(frame,read,signal,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(frame?.source!=='browser_dom'||!profile(frame)||!Number.isSafeInteger(frame.tab_id)||!Number.isSafeInteger(frame.window_id))return null;
 let origin;try{origin=new URL(frame.url).origin;}catch{return null;}
 const deadline=now()+1500;
 do{
  signal?.throwIfAborted();const inventory=await read('browser_list_tabs',{browser:frame.browser});signal?.throwIfAborted();
  if(inventory?.status!=='ok'||inventory.complete!==true||inventory.browser!==frame.browser||profile(inventory)!==profile(frame)||!Array.isArray(inventory.tabs))return null;
  const found=inventory.tabs.filter(t=>t.tab_id===frame.tab_id&&t.window_id===frame.window_id&&!t.pinned);
  if(found.length!==1)return null;
  const tab=found[0];try{if(new URL(tab.url).origin!==origin)return null;}catch{return null;}
  if(!tab.navigating){const observed=await read('browser_read_page',{snapshot:inventory.snapshot,tab_id:frame.tab_id});signal?.throwIfAborted();return observed;}
  if(now()>=deadline)return null;await sleep(Math.min(75,deadline-now()));
 }while(now()<=deadline);
 return null;
}
module.exports={refreshTransition};
