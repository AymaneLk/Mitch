'use strict';
// Read-only probes using the current token; never refresh while Mitch is running.
const fs=require('node:fs'),path=require('node:path');
const token=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Pixie Windows Companion/mcp/spotify/tokens.json'),'utf8'));
if(!token.access_token||token.expires_at<Date.now()+30000)throw Error('Session needs a coordinated refresh; no request sent.');
const probes=[['search','/search?q='+encodeURIComponent('Smooth Criminal Michael Jackson')+'&type=track&limit=3'],['devices','/me/player/devices'],['playback','/me/player']];
Promise.all(probes.map(async([name,route])=>{
 const start=performance.now(),response=await fetch('https://api.spotify.com/v1'+route,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(15000)}),data=await response.json().catch(()=>null);
 return {name,status:response.status,ms:Math.round(performance.now()-start),error:data?.error,
 ...(name==='search'&&response.ok?{tracks:data?.tracks?.items?.map(t=>({name:t.name,artists:t.artists?.map(a=>a.name),uri:t.uri,playable:t.is_playable}))}:{}),
 ...(name==='devices'&&response.ok?{devices:data?.devices?.map(d=>({id:d.id,name:d.name,active:d.is_active,restricted:d.is_restricted,type:d.type}))}:{}),
 ...(name==='playback'&&response.ok?{playing:data?.is_playing,track:data?.item?.name,uri:data?.item?.uri,linkedFrom:data?.item?.linked_from,context:data?.context?.uri,progress:data?.progress_ms,device:data?.device?.name,disallows:data?.actions?.disallows}:{}),
 };
})).then(probes=>{const report={at:new Date().toISOString(),probes};fs.writeFileSync(path.resolve(__dirname,'../test-output/spotify-diagnosis.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}).catch(error=>{console.error(error.message);process.exitCode=1;});
