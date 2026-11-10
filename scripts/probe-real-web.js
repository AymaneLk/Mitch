'use strict';
const fs=require('node:fs'),path=require('node:path'),{start,waitFor,delay,independent,consent,OUT}=require('./real-browser-lab');
(async()=>{let lab;const report={status:'running',at:new Date().toISOString(),rows:[]};try{
 lab=await start();report.browser=lab.version;
 for(const url of ['https://www.youtube.com/results?search_query=NASA+Artemis','https://en.wikipedia.org/wiki/Ada_Lovelace','https://github.com/search?q=microsoft+playwright&type=repositories']){
  const id=await lab.reset(url);await waitFor(()=>lab.evaluate(id,'location.protocol==="https:"&&document.readyState==="complete"'),30000,'Public page loading');if(await consent(lab,id))await waitFor(()=>lab.evaluate(id,'!location.hostname.startsWith("consent.")&&document.readyState==="complete"'),30000,'Cookie redirect');await delay(500);
  const actual=await lab.evaluate(id,independent),list=await lab.bridge.list({browser:'opera'}),tab=list.tabs.find(t=>t.active),observed=await lab.bridge.observePage({snapshot:list.snapshot,tab_id:tab.tab_id});
  const structure=await lab.evaluate(id,`({videoRenderers:document.querySelectorAll('ytd-video-renderer').length,videoTitles:document.querySelectorAll('a#video-title').length,repoLinks:[...document.querySelectorAll('div.search-title a')].map(e=>({text:e.textContent,href:e.href})).slice(0,5)})`);
  report.rows.push({requested:url,actual,observed,structure});fs.writeFileSync(path.join(OUT,'real-web-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({url,status:observed.status,controls:observed.controls?.length,complete:observed.complete,actualTitle:actual.title,results:actual.videos.length,structure}));
  await lab.screenshot(id,path.join(OUT,'real-web-probe-'+report.rows.length+'.png'));
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;console.error(error.message);}finally{await lab?.close();fs.writeFileSync(path.join(OUT,'real-web-probe.json'),JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:1;}})();
