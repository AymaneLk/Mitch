(function(root){'use strict';
  if(root.__mitchSiteAgent)return;root.__mitchSiteAgent=true;
  const documentId=crypto.randomUUID(),links=new Map(),text=e=>String(e?.textContent||'').replace(/\s+/g,' ').trim().slice(0,400);
  const displayed=e=>!!e&&e.isConnected&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  function observe(site){
    const u=new URL(location.href),results=[],seen=new Set();links.clear();
    const add=(a,kind)=>{if(!displayed(a))return;let url;try{url=new URL(a.href);}catch{return;}if(url.origin!==u.origin||url.username||url.password||seen.has(url.href))return;const title=text(a)||a.getAttribute('title')||a.getAttribute('aria-label');if(!title)return;seen.add(url.href);links.set(url.href,a);results.push({title,url:url.href,kind});};
    if(site==='youtube')for(const row of document.querySelectorAll('ytd-video-renderer')){if(row.closest('ytd-ad-slot-renderer,ytd-promoted-video-renderer'))continue;const a=row.querySelector('a#video-title');if(a&&new URL(a.href).pathname==='/watch')add(a,'video');if(results.length>=10)break;}
    if(site==='github')for(const a of document.querySelectorAll('div.search-title a')){if(/^\/[^/]+\/[^/]+\/?$/.test(new URL(a.href).pathname))add(a,'repository');if(results.length>=10)break;}
    if(site==='wikipedia')for(const a of document.querySelectorAll('.mw-search-result-heading a')){add(a,'article');if(results.length>=10)break;}
    const watch=document.querySelector('ytd-watch-flexy:not([hidden])'),player=watch?.querySelector('#movie_player'),video=player?.querySelector('video'),media=video?{videoId:watch.getAttribute('video-id'),paused:video.paused,ended:video.ended,readyState:video.readyState,time:video.currentTime,observedAt:Date.now(),ad:player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting'),visible:displayed(video)}:null;
    return {url:location.href,documentId,ready:document.readyState,heading:text(document.querySelector('h1')),query:u.searchParams.get(site==='youtube'?'search_query':site==='github'?'q':'search'),results,media,...(site==='github'?{repository:document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')?.content||''}:{})};
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id||!['mitch_site_observe','mitch_site_play','mitch_site_open'].includes(message?.type))return;
    const hosts={youtube:'www.youtube.com',github:'github.com',wikipedia:'en.wikipedia.org'};
    if(!Object.hasOwn(hosts,message.site)||location.hostname!==hosts[message.site]||location.protocol!=='https:'||!Number.isFinite(message.deadline)||Date.now()>message.deadline||message.deadline>Date.now()+120000){reply({status:'refused',reason:'site_scope_changed'});return;}
    if(message.type==='mitch_site_observe'){reply({status:'observed',...observe(message.site)});return;}
    if(message.type==='mitch_site_open'){
      const frame=observe(message.site),result=frame.results[message.rank-1],anchor=links.get(message.url);
      if(message.site!=='youtube'||frame.documentId!==message.documentId||frame.query!==message.query||!Number.isInteger(message.rank)||message.rank<1||message.rank>10||result?.url!==message.url||!displayed(anchor)){reply({status:'refused',reason:'result_order_changed'});return;}
      // Follow the observed anchor so YouTube can keep its loaded application.
      // Completion still requires the exact selected video to advance in time.
      anchor.click();reply({status:'issued'});return;
    }
    (async()=>{
      if(message.site!=='youtube'||new URL(location.href).searchParams.get('v')!==message.videoId||message.documentId!==documentId)throw Error('playback_scope_changed');
      const watch=document.querySelector('ytd-watch-flexy:not([hidden])'),v=watch?.querySelector('#movie_player video');if(watch?.getAttribute('video-id')!==message.videoId||!v||!displayed(v))throw Error('video_unavailable');
      if(v.paused){try{await v.play();}catch(error){throw Error(error.name==='NotAllowedError'?'playback_needs_user_gesture':'playback_failed');}}
      return {status:'observed',...observe('youtube')};
    })().then(reply,error=>reply({status:'refused',reason:error.message}));return true;
  });
})(globalThis);
