'use strict';
function failureDetail(raw){return (raw.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n').replace(/Bearer\s+\S+|github_pat_[\w]+|GOCSPX-[\w-]+/gi,'[redacted]').slice(0,900);}
function confirmedNotApplied(server,raw){
 // Only this pinned adapter is instrumented. Other servers remain conservative.
 const value=server==='spotify'?raw.structuredContent?.mitchExecution:null;
 return value?.version===1&&value.outcome==='not_applied'&&value.accepted===0&&value.unknown===0&&Number.isInteger(value.writes)&&value.writes>=0;
}
function needsDevice(server,raw){return confirmedNotApplied(server,raw)&&raw.structuredContent.mitchExecution.reason==='device_unavailable';}
async function recoverDevice(client,context,{application='Spotify',timeoutMs=6000,pollMs=250}={}){
 if(!context.dispatchChild)return {attempted:false,ready:false};
 context.assertActive?.();context.signal?.throwIfAborted();
 const listed=await context.dispatchChild('list_apps',{query:application});
 const candidates=(listed.apps||[]).filter(a=>String(a.name||'').toLowerCase()===application.toLowerCase());
 if(candidates.length!==1)return {attempted:true,ready:false,reason:'No unique installed application was found.'};
 const launch=await context.dispatchChild('open_app',{app_id:candidates[0].app_id});
 const launchReceipt={app_id:candidates[0].app_id,status:launch?.status,code:launch?.code,message:launch?.message};
 if(launch?.status==='error'||launch?.status==='refused'||launch?.stop_task)return {attempted:true,ready:false,launch:launchReceipt,reason:'Spotify could not be opened: '+(launch.message||'application launch failed')};
 const deadline=Date.now()+timeoutMs;
 do{
  context.assertActive?.();context.signal?.throwIfAborted();
  const result=await client.call('devices',{action:'list'},context.signal,Math.max(1000,deadline-Date.now()));
  if(result.isError)return {attempted:true,ready:false,launch:launchReceipt,reason:'Device availability check failed.'};
  if(/^Available devices:\n/.test(failureDetail(result)))return {attempted:true,ready:true,launch:launchReceipt};
  if(Date.now()>=deadline)break;
  await require('node:timers/promises').setTimeout(pollMs,undefined,{signal:context.signal});
 }while(Date.now()<deadline);
 return {attempted:true,ready:false,launch:launchReceipt,reason:'Spotify has not connected a playback device after the launch request. Check that Spotify is open and signed in to the connected account.'};
}
module.exports={failureDetail,confirmedNotApplied,needsDevice,recoverDevice};
