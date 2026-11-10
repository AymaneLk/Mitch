(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MitchSiteOperations=api;})(globalThis,function(){
  'use strict';const KEY='mitchPublicSiteLedger';
  function createSiteOperations(chrome,{sites=globalThis.MitchPublicSites,now=Date.now}={}){
    let queue=Promise.resolve();
    async function run(args,context){
      let issued=false,tab,goal,selection,playbackBefore,ledger,entry;const steps=[],started=now(),timing={};const mark=name=>timing[name]=now()-started;
      const fail=code=>{throw Object.assign(Error(code),{code});};
      const check=()=>{if(context.isCancelled?.())fail('cancelled');if(!Number.isFinite(context.deadline)||now()>=context.deadline)fail('site_task_timeout');};
      const timed=async fn=>{check();let timer;try{const value=await Promise.race([Promise.resolve().then(()=>{check();return fn();}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('site_task_timeout'),{code:'site_task_timeout'})),Math.max(1,context.deadline-now()));})]);check();return value;}finally{clearTimeout(timer);}};
      const pause=()=>timed(()=>new Promise(r=>setTimeout(r,80)));
      try{
        goal=sites.validate(args.goal);if(typeof context.id!=='string'||!/^[\w-]{1,128}$/.test(context.id)||context.deadline>now()+120000)fail('invalid_request');
        if(!Array.isArray(args.windowIds)||!args.windowIds.length||args.windowIds.length>100||args.windowIds.some(id=>!Number.isSafeInteger(id)||id<0))fail('invalid_window');
        if(!await timed(()=>chrome.permissions.contains({origins:['https://'+sites.hosts[goal.site]+'/*']})))fail('page_permission_required');
        const stored=await timed(()=>chrome.storage.session.get(KEY)),saved=stored[KEY]||{};
        if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).length>=4096)fail('operation_ledger_unavailable');ledger=Object.assign(Object.create(null),saved);
        if(Object.hasOwn(ledger,context.id))fail('duplicate_request');
        entry={state:'pending',at:now()};ledger[context.id]=entry;await timed(()=>chrome.storage.session.set({[KEY]:ledger}));
        let win;
        if(args.expectedTab){
          const expected=args.expectedTab;tab=await timed(()=>chrome.tabs.get(expected.id));
          if(tab.id!==expected.id||tab.windowId!==expected.windowId||tab.url!==expected.url||tab.incognito||tab.pinned||tab.pendingUrl||!sites.permittedURL(goal.site,tab.url)||!args.windowIds.includes(tab.windowId))fail('stale_target');
          win=await timed(()=>chrome.windows.get(tab.windowId));
        }else{
          const windows=[];for(const id of args.windowIds){const w=await timed(()=>chrome.windows.get(id));if(w.type==='normal'&&!w.incognito)windows.push(w);}
          win=windows.find(w=>w.focused)|| (windows.length===1?windows[0]:null);if(!win)fail('ambiguous_window');
        }
        if(win.incognito||win.type!=='normal')fail('invalid_window');
        const queryURL=sites.searchURL(goal);
        if(!tab){issued=true;tab=await timed(()=>chrome.tabs.create({windowId:win.id,url:queryURL,active:true}));if(!Number.isSafeInteger(tab?.id)||tab.windowId!==win.id||tab.incognito||tab.pinned)fail('tab_creation_unknown');steps.push('open_search');}
        else{issued=true;tab=await timed(()=>chrome.tabs.update(tab.id,{url:queryURL,active:true}));steps.push('navigate_search');}
        await timed(()=>chrome.windows.update(win.id,{focused:true}));
        const tabId=tab.id,windowId=win.id;let installedURL='',documentId;
        async function state(){
          const current=await timed(()=>chrome.tabs.get(tabId));
          if(current.id!==tabId||current.windowId!==windowId||current.incognito||current.pinned)fail('site_scope_changed');
          if(!current.url||current.url==='about:blank')return null;
          if(!sites.permittedURL(goal.site,current.url))fail('site_scope_changed');
          if(current.pendingUrl&&!sites.permittedURL(goal.site,current.pendingUrl))fail('site_scope_changed');
          if(!await timed(()=>chrome.permissions.contains({origins:['https://'+sites.hosts[goal.site]+'/*']})))fail('page_permission_required');
          // A committed page may still be loading ads/images. Read its own
          // bounded semantic state instead of waiting for all network activity.
          try{
            if(installedURL!==current.url){await timed(()=>chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',files:['site-agent.js']}));installedURL=current.url;}
            const frame=await timed(()=>chrome.tabs.sendMessage(tabId,{type:'mitch_site_observe',site:goal.site,deadline:context.deadline},{frameId:0}));
            const after=await timed(()=>chrome.tabs.get(tabId));if(frame?.status!=='observed'||after.url!==frame.url||after.windowId!==windowId||!sites.permittedURL(goal.site,frame.url)){installedURL='';return null;}
            if(frame.media?.ad)timing.adObserved=true;documentId=frame.documentId;return frame;
          }catch(error){check();if(['site_scope_changed','page_permission_required','site_task_timeout'].includes(error.code))throw error;installedURL='';return null;}
        }
        async function until(predicate){while(true){check();const frame=await state();if(frame&&predicate(frame))return frame;await pause();}}
        let frame=await until(f=>goal.site==='wikipedia'&&new URL(f.url).pathname.startsWith('/wiki/')||f.query===goal.query&&f.results?.length>=(goal.rank||1));mark('resultsReadyMs');
        if(goal.action!=='search'&&goal.site!=='wikipedia'){
          const selected=frame.results[goal.rank-1];if(!selected||!sites.permittedURL(goal.site,selected.url))fail('result_unavailable');
          selection={query:goal.query,rank:goal.rank,title:selected.title,url:selected.url,results:frame.results.slice(0,goal.rank)};
          // Re-read the ranked list in this exact document immediately before
          // navigation, to avoid acting on a re-ordered result.
          const fresh=await state();if(!fresh||fresh.documentId!==frame.documentId||fresh.query!==goal.query||fresh.results?.[goal.rank-1]?.url!==selection.url)fail('result_order_changed');
          check();if(goal.site==='youtube'){
            const opened=await timed(()=>chrome.tabs.sendMessage(tabId,{type:'mitch_site_open',site:goal.site,query:goal.query,rank:goal.rank,url:selection.url,documentId:fresh.documentId,deadline:context.deadline},{frameId:0}));
            if(opened?.status!=='issued')fail(opened?.reason||'result_navigation_unknown');
          }else await timed(()=>chrome.tabs.update(tabId,{url:selection.url,active:true}));steps.push('open_result');installedURL='';
          const expected=new URL(selection.url);frame=await until(f=>goal.site==='youtube'?new URL(f.url).pathname==='/watch'&&new URL(f.url).searchParams.get('v')===expected.searchParams.get('v')&&f.media?.visible:new URL(f.url).pathname===expected.pathname&&f.repository===expected.pathname.replace(/^\/|\/$/g,'')&&f.ready!=='loading');mark('destinationReadyMs');
          if(goal.action==='play'){
            // The player may replace its media source while loading an ad or
            // the chosen video. Wait for usable content before sending Play.
            frame=await until(f=>f.media?.videoId===expected.searchParams.get('v')&&f.media.readyState>=2);
            if(frame.media.paused){
              const played=await timed(()=>chrome.tabs.sendMessage(tabId,{type:'mitch_site_play',site:'youtube',videoId:expected.searchParams.get('v'),documentId:frame.documentId,deadline:context.deadline},{frameId:0}));
              if(played?.status==='refused')fail(played.reason||'playback_failed');steps.push('play');
            }
            frame=await until(f=>f.media?.videoId===expected.searchParams.get('v')&&!f.media.ad&&!f.media.paused&&f.media.readyState>=2);playbackBefore=frame.media;mark('playingMs');
            frame=await until(f=>f.media?.videoId===playbackBefore.videoId&&!f.media.ad&&!f.media.paused&&f.media.time-playbackBefore.time>=.15&&f.media.observedAt-playbackBefore.observedAt>=150);
          }
        }
        mark('verifiedMs');const result={status:'completed',verified:true,action_attempted:issued,goal,tab_id:tabId,window_id:windowId,observation:frame,steps,timing,...(selection?{selection}:{}),...(playbackBefore?{playbackBefore}:{})};
        if(!sites.verify(goal,result))fail('site_completion_unverified');entry.state='completed';await timed(()=>chrome.storage.session.set({[KEY]:ledger}));return result;
      }catch(error){
        return {status:issued?'interrupted':'refused',verified:false,action_attempted:issued,reason:error.code||'site_task_failed',...(!error.code?{sourceError:String(error.message).slice(0,200)}:{}),message:error.code==='playback_needs_user_gesture'?'The video is open, but this browser requires a real Play click before audio can start.':error.code==='site_task_timeout'?'The website did not finish the requested task before its deadline.':error.code==='site_completion_unverified'?'The page opened, but it did not prove the exact requested result.':'The website could not confirm the requested task.',...(issued?{outcome_unknown:true,tab_id:tab?.id,steps}:{})};
      }
    }
    return {execute(method,args,context){if(method!=='site.task')return Promise.resolve({status:'refused',verified:false,action_attempted:false,reason:'unsupported_site_method'});const result=queue.then(()=>run(args,context));queue=result.catch(()=>{});return result;}};
  }
  return {createSiteOperations};
});
