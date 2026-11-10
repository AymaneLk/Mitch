'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async({mcp,dispatch,desktopActivity})=>{
 const report={at:new Date().toISOString(),status:'running',request:'Play Smooth Criminal by Michael Jackson on Spotify',checks:[]},file=path.resolve(__dirname,'../test-output/spotify-recovery-live.json');
 const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)),scope=desktopActivity.beginScope();save();
 try{
  const client=await mcp.connect('spotify');
  const before=await client.call('devices',{action:'list'},undefined,10000);report.before=(before.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');save();
  const start=performance.now();
  const result=await dispatch('mcp_execute',{steps:[{server:'spotify',tool:'play',arguments:{query:'Smooth Criminal Michael Jackson',type:'track'}}]},{activityScope:scope,fromModel:true});
  report.ms=Math.round(performance.now()-start);report.result=result;save();
  if(result.status!=='completed')throw Error(result.message||'Playback failed.');
  let verified=false;
  for(let i=0;i<4;i++){
   const playback=await client.call('now_playing',{},undefined,10000),text=(playback.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
   report.playback=text;verified=!playback.isError&&/▶ Playing/.test(text)&&/Smooth Criminal/i.test(text)&&/Michael Jackson/i.test(text);
   if(verified)break;await new Promise(r=>setTimeout(r,350));
  }
  if(!verified)throw Error('Spotify did not confirm the requested track is playing.');
  const position=text=>{const m=/Position: (\d+):(\d+)/.exec(text);return m?Number(m[1])*60+Number(m[2]):null;};
  const initialPosition=position(report.playback);
  await new Promise(r=>setTimeout(r,1500));
  const later=await client.call('now_playing',{},undefined,10000),laterText=(later.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  report.progress={before:initialPosition,after:position(laterText)};save();
  if(later.isError||!/▶ Playing/.test(laterText)||!/Smooth Criminal/i.test(laterText)||!/Michael Jackson/i.test(laterText)||initialPosition===null||report.progress.after<=initialPosition)throw Error('Requested playback did not advance.');
  for(const action of ['pause','resume']){
   const started=performance.now();
   const control=await dispatch('mcp_execute',{steps:[{server:'spotify',tool:'playback',arguments:{action}}]},{activityScope:scope,fromModel:true});
   const check={action,ms:Math.round(performance.now()-started),result:control,verified:false};report.checks.push(check);save();
   if(control.status!=='completed')throw Error('Playback '+action+' failed.');
   for(let n=0;n<4;n++){
    const read=await client.call('now_playing',{},undefined,10000),value=(read.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
    check.playback=value;check.verified=!read.isError&&(action==='pause'?/⏸ Paused/.test(value):/▶ Playing/.test(value))&&/Smooth Criminal/i.test(value)&&/Michael Jackson/i.test(value);
    if(check.verified)break;await new Promise(r=>setTimeout(r,250));
   }
   if(!check.verified)throw Error('Spotify did not confirm '+action+'.');
  }
  report.status='passed';
 }catch(e){report.status='failed';report.message=e.message;process.exitCode=1;}
 finally{desktopActivity.endScope(scope);save();}
};
