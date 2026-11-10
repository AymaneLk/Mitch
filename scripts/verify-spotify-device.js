'use strict';
// Explicit diagnostic: activate the one observed computer, then play only if
// it becomes active. No repeated commands and no token refresh.
const fs=require('node:fs'),path=require('node:path');
const directory=path.join(process.env.APPDATA,'Pixie Windows Companion/mcp/spotify');
const token=JSON.parse(fs.readFileSync(path.join(directory,'tokens.json'),'utf8'));
if(token.expires_at<Date.now()+30000)throw Error('Token refresh required; nothing was sent.');
const report={at:new Date().toISOString(),status:'running',steps:[]};
async function request(route,method='GET',body){const start=performance.now();const response=await fetch('https://api.spotify.com/v1'+route,{method,headers:{Authorization:'Bearer '+token.access_token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});const data=await response.json().catch(()=>null);report.steps.push({route:route.split('?')[0],method,status:response.status,ms:Math.round(performance.now()-start),...(data?.error?{error:data.error}:{})});if(!response.ok)throw Error('Spotify returned '+response.status);return data;}
(async()=>{
 const current=await request('/me/player');if(current?.is_playing&&/Smooth Criminal/i.test(current.item?.name)&&current.item?.artists?.some(a=>a.name==='Michael Jackson')){report.status='already_playing';report.track=current.item.name;return;}
 const devices=(await request('/me/player/devices')).devices.filter(d=>d.type==='Computer'&&!d.is_restricted&&d.id);
 if(devices.length!==1)throw Error('Need one unambiguous computer device.');const device=devices[0];
 if(!device.is_active){await request('/me/player','PUT',{device_ids:[device.id],play:false});let active=false;for(let n=0;n<6;n++){await new Promise(r=>setTimeout(r,500));active=(await request('/me/player/devices')).devices.some(d=>d.id===device.id&&d.is_active);if(active)break;}if(!active)throw Error('Spotify accepted device activation but the player never became active. No new play request was sent.');}
 const matches=(await request('/search?q='+encodeURIComponent('track:Smooth Criminal artist:Michael Jackson')+'&type=track&limit=3')).tracks.items;
 const eligible=matches.filter(t=>/Smooth Criminal/i.test(t.name)&&t.artists.some(a=>a.name==='Michael Jackson')&&t.is_playable!==false);
 const track=eligible[process.argv.includes('--alternate')?1:0];if(!track)throw Error('Requested recording was not found.');report.requestedTrack={name:track.name,uri:track.uri};
 const body=process.argv.includes('--album-context')?{context_uri:track.album.uri,offset:{uri:track.uri},position_ms:0}:{uris:[track.uri]};report.playbackRequest=body;
 await request('/me/player/play?device_id='+encodeURIComponent(device.id),'PUT',body);
 let playing;for(let n=0;n<8;n++){await new Promise(r=>setTimeout(r,500));const state=await request('/me/player');if(state?.is_playing&&state.item?.uri===track.uri){playing=state;break;}}
 if(!playing)throw Error('Playback command accepted but requested playback was not observed.');
 await new Promise(r=>setTimeout(r,1200));const after=await request('/me/player');if(!after?.is_playing||after.item?.uri!==track.uri||after.progress_ms<=playing.progress_ms)throw Error('Playback progress did not advance.');
 report.status='passed';report.track=track.name;report.progress=[playing.progress_ms,after.progress_ms];
})().catch(e=>{report.status='failed';report.message=e.message;process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.resolve(__dirname,'../test-output/spotify-device-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));});
