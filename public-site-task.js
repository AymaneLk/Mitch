(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MitchPublicSites=api;})(globalThis,function(){
  'use strict';
  const hosts={youtube:'www.youtube.com',wikipedia:'en.wikipedia.org',github:'github.com'},ordinals={first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
  const ordinal='(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten|[1-9](?:st|nd|rd|th)?|10(?:th)?)';
  const query=value=>{if(typeof value!=='string')return null;const q=value.trim().replace(/^"([\s\S]*)"$/,'$1');return q&&q.length<=500&&!/[\r\n\x00-\x1f]/.test(q)&&!/(?:,|\band\b|\bthen\b)\s*(?:then\s+)?(?:send|delete|download|subscribe|comment|like|share|buy|upload|open|close|play|pause|read|summarize|copy|save|write|search|find|go|click|log|sign)\b/i.test(q)?q:null;};
  function validate(plan){
    if(!plan||typeof plan!=='object'||Array.isArray(plan)||Object.keys(plan).some(k=>!['site','action','query','rank','browser'].includes(k))||!Object.hasOwn(hosts,plan.site)||!['search','open','play'].includes(plan.action)||query(plan.query||'')!==plan.query)throw Error('Invalid public-site task');
    if(plan.browser!==undefined&&!['opera','chrome','edge'].includes(plan.browser))throw Error('Invalid browser');
    if(plan.action==='play'&&plan.site!=='youtube'||plan.action==='open'&&plan.site==='youtube')throw Error('Unsupported site action');
    if((plan.action==='search'||plan.site==='wikipedia')?plan.rank!==undefined:!Number.isInteger(plan.rank)||plan.rank<1||plan.rank>10)throw Error('Invalid result rank');
    return {...plan};
  }
  function parse(text){
    if(typeof text!=='string'||text.length>800||/[\r\n]/.test(text))return null;
    let s=text.trim().replace(/^(?:please |can you |could you )/i,'').replace(/[.!?]$/,'');let browser;
    s=s.replace(/ (?:in|on) (opera gx|opera|chrome|edge)$/i,(_,b)=>{browser=b.toLowerCase().replace(' gx','');return '';});
    const make=(site,action,q,rank)=>{q=query(q);if(!q)return null;try{return validate({site,action,query:q,...(rank?{rank}:{}),...(browser?{browser}:{})});}catch{return null;}};
    const n=v=>ordinals[v.toLowerCase()]||Number.parseInt(v,10);
    let natural=/^(?:bring up|show me) youtube (?:results|search results) for (.+)$/i.exec(s);if(natural)return make('youtube','search',natural[1]);
    natural=/^take me to (?:the )?wikipedia (?:page|article) (?:about|on|for) (.+)$/i.exec(s);if(natural)return make('wikipedia','open',natural[1]);
    natural=new RegExp('^on github,? (?:look|search) for repositories (?:about|for) (.+?),? (?:and |then )(?:take me to|open) (?:the )?(?:result|repository)(?: number)? '+ordinal+'$','i').exec(s);if(natural)return make('github','open',natural[1],n(natural[2]));
    let m=new RegExp('^(?:open youtube,? (?:and )?search for|search youtube for) (.+?),? (?:and |then )play (?:the )?'+ordinal+' (?:video|result)$','i').exec(s);
    if(m)return make('youtube','play',m[1],n(m[2]));
    m=/^(?:open youtube,? and search for|open youtube,? search for|search youtube for) (.+)$/i.exec(s);if(m)return make('youtube','search',m[1]);
    m=/^(?:open wikipedia,? and (?:find|open) (?:the )?article|(?:find|open) (?:the )?wikipedia article) (.+)$/i.exec(s);if(m)return make('wikipedia','open',m[1]);
    m=/^(?:open wikipedia,? and search for|search wikipedia for) (.+)$/i.exec(s);if(m)return make('wikipedia','search',m[1]);
    m=new RegExp('^(?:open github,? (?:and )?search repositories for|search github repositories for) (.+?),? (?:and |then )open (?:the )?'+ordinal+' (?:repository|result)$','i').exec(s);if(m)return make('github','open',m[1],n(m[2]));
    m=/^(?:open github,? and search repositories for|search github repositories for) (.+)$/i.exec(s);if(m)return make('github','search',m[1]);
    return null;
  }
  function searchURL(plan){validate(plan);if(plan.site==='youtube')return 'https://www.youtube.com/results?search_query='+encodeURIComponent(plan.query);if(plan.site==='github')return 'https://github.com/search?q='+encodeURIComponent(plan.query)+'&type=repositories';return 'https://en.wikipedia.org/w/index.php?title=Special:Search&search='+encodeURIComponent(plan.query);}
  function permittedURL(site,value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname===hosts[site]&&!u.username&&!u.password&&!u.port;}catch{return false;}}
  const sameText=(a,b)=>String(a||'').normalize('NFKC').replace(/_/g,' ').replace(/\s+/g,' ').trim().toLowerCase()===String(b||'').normalize('NFKC').replace(/_/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
  function verify(plan,result){
    try{validate(plan);}catch{return false;}
    if(!result||result.status!=='completed'||result.verified!==true||result.outcome_unknown||result.cancelled||result.refused||result.goal?.site!==plan.site||result.goal?.action!==plan.action||result.goal?.query!==plan.query||result.goal?.rank!==plan.rank||!permittedURL(plan.site,result.observation?.url))return false;
    const frame=result.observation,u=new URL(frame.url);
    if(plan.action==='search')return (frame.query===plan.query&&Array.isArray(frame.results)&&frame.results.length>0)||(plan.site==='wikipedia'&&u.pathname.startsWith('/wiki/')&&sameText(frame.heading,plan.query));
    if(plan.site==='wikipedia')return u.pathname.startsWith('/wiki/')&&sameText(frame.heading,plan.query);
    const selection=result.selection;if(!selection||selection.rank!==plan.rank||selection.query!==plan.query||!Array.isArray(selection.results)||selection.results.length<plan.rank||selection.results[plan.rank-1].url!==selection.url||!permittedURL(plan.site,selection.url))return false;
    const chosen=new URL(selection.url);
    if(plan.site==='github')return /^\/[^/]+\/[^/]+\/?$/.test(chosen.pathname)&&u.pathname.replace(/\/$/,'')===chosen.pathname.replace(/\/$/,'')&&frame.repository===chosen.pathname.replace(/^\/|\/$/g,'');
    const before=result.playbackBefore,after=frame.media;return chosen.pathname==='/watch'&&u.pathname==='/watch'&&u.searchParams.get('v')===chosen.searchParams.get('v')&&before&&after&&before.videoId===chosen.searchParams.get('v')&&after.videoId===before.videoId&&!before.ad&&!after.ad&&!after.paused&&!after.ended&&after.readyState>=2&&Number.isFinite(before.time)&&Number.isFinite(after.time)&&after.time-before.time>=.15&&after.observedAt-before.observedAt>=150;
  }
  function answer(plan,result){if(plan.action==='search')return `Search results for ${plan.query} are ready.`;if(plan.site==='wikipedia')return `Opened ${result.observation.heading}.`;return plan.site==='youtube'?`Playing video ${plan.rank}: ${result.selection.title}.`:`Opened ${result.selection.title}.`;}
  async function run({text,dispatch,context={}}){
    const plan=parse(text),events=[];if(!plan)return {handled:false,events};
    const call=async(name,args)=>{context.signal?.throwIfAborted();const output=await dispatch(name,args,context);events.push({name,args,output});return output;};
    try{
      const list=await call('browser_list_tabs',plan.browser?{browser:plan.browser}:{});if(list?.status!=='ok'||list.complete!==true||typeof list.snapshot!=='string')return {handled:false,events,reason:'Public-site browser inventory is unavailable.'};
      const result=await call('browser_site_task',{snapshot:list.snapshot,...plan});
      if(verify(plan,result))return {handled:true,events,answer:answer(plan,result)};
      if(result?.action_attempted===false&&!result.outcome_unknown)return {handled:false,events,reason:result.message||'The public-site adapter is unavailable.'};
      return {handled:true,events,answer:result?.message||'I reached the page but could not verify the requested result. I stopped without repeating the action.'};
    }catch(error){context.signal?.throwIfAborted();return {handled:!!events.some(e=>e.name==='browser_site_task'),events,reason:error.message,answer:'The website did not confirm the requested result. I stopped the task.'};}
  }
  return {hosts,validate,parse,searchURL,permittedURL,verify,answer,run};
});
