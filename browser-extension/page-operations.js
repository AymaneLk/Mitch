(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MitchPageOperations=api;})(globalThis,function(){
  'use strict';
  const LEDGER='mitchBrowserPageLedger',MAX_LEDGER=4096;
  const refused=(code,message)=>({status:'refused',code,message,verified:false,action_attempted:false});
  function createPageOperations(chrome,{now=Date.now,plan=globalThis.MitchPlan}={}){
    let serial=Promise.resolve();const active=new Map();
    // Fixed isolated-world inspection, never planner-supplied JavaScript.
    const frameIdentity=()=>({url:location.href,title:document.title});
    async function frameInventory(tabId){
      const rows=await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'ISOLATED',func:frameIdentity});
      return (rows||[]).filter(r=>r.frameId>0&&typeof r.documentId==='string'&&/^https?:/.test(r.result?.url||'')).slice(0,16).map(r=>({frame_id:r.frameId,browser_document_id:r.documentId,url:r.result.url,title:String(r.result.title||'').slice(0,200)}));
    }
    async function inspectFrame(tabId,frame,context){
      if(!Number.isSafeInteger(frame?.frame_id)||frame.frame_id<=0||typeof frame.browser_document_id!=='string'||frame.browser_document_id.length>160)throw Object.assign(Error('Read an embedded frame before acting.'),{code:'invalid_frame'});
      const url=new URL(frame.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Object.assign(Error('Unsupported frame URL.'),{code:'invalid_frame'});
      if(!await chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']}))throw Object.assign(Error('This embedded origin needs page access.'),{code:'page_permission_required'});
      assertActive(context);
      const rows=await chrome.scripting.executeScript({target:{tabId,documentIds:[frame.browser_document_id]},world:'ISOLATED',func:frameIdentity});assertActive(context);
      if(rows?.length!==1||rows[0].frameId!==frame.frame_id||rows[0].documentId!==frame.browser_document_id||rows[0].result?.url!==frame.url)throw Object.assign(Error('The embedded document changed; observe it again.'),{code:'stale_frame'});
    }
    function assertActive(context){if(context.isCancelled?.())throw Object.assign(Error('The page request was stopped.'),{code:'cancelled'});if(!Number.isFinite(context.deadline)||context.deadline<=now())throw Object.assign(Error('The page request expired.'),{code:'deadline_exceeded'});}
    async function inspect(expected,context){
      assertActive(context);
      if(!expected||!Number.isInteger(expected.id)||!Number.isInteger(expected.windowId)||typeof expected.url!=='string'||typeof expected.pinned!=='boolean'||Object.keys(expected).some(key=>!['id','windowId','url','pinned'].includes(key)))throw Object.assign(Error('An exact observed tab identity is required.'),{code:'invalid_target'});
      let url;try{url=new URL(expected.url);}catch{throw Object.assign(Error('The tab URL is invalid.'),{code:'invalid_target'});}
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Object.assign(Error('Only ordinary HTTP and HTTPS pages support page controls.'),{code:'unsupported_page'});
      const tab=await chrome.tabs.get(expected.id);assertActive(context);
      if(tab.incognito||tab.id!==expected.id||tab.windowId!==expected.windowId||tab.url!==expected.url||Boolean(tab.pinned)!==expected.pinned||tab.pendingUrl||tab.status==='loading')throw Object.assign(Error('The target tab changed or is still navigating. Observe it again.'),{code:'stale_target'});
      const window=await chrome.windows.get(tab.windowId);assertActive(context);
      if(window.incognito||window.type!=='normal')throw Object.assign(Error('Private and special browser windows are unsupported.'),{code:'unsupported_window'});
      // Chrome host match patterns scope hosts (all ports), unlike URL origins.
      const allowed=await chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']});assertActive(context);
      if(!allowed)throw Object.assign(Error('Enable page controls in the Mitch Browser Bridge popup first.'),{code:'page_permission_required'});
      return tab;
    }
    async function cancel(id){const job=active.get(id);if(!job)return;job.cancelled=true;try{await chrome.tabs.sendMessage(job.tabId,{type:'mitch_page_cancel',id},job.frameOptions||{frameId:0});}catch{}}
    async function recoverAfterInput(result,expected,context){
      // An unknown delivery must never issue a second plan. A navigation can
      // destroy its reply port, however, so inspect the same eligible tab once
      // for read-only completion review. Unknown input remains unknown.
      if(!result?.outcome_unknown)return result;
      const recoveryContext={...context,deadline:Math.min(context.deadline,now()+1500)};
      const check=()=>assertActive(recoveryContext);
      const timed=async operation=>{
        check();let timer;
        try{return await Promise.race([Promise.resolve().then(()=>{check();return operation();}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('Read-only recovery expired.'),{code:'recovery_timeout'})),Math.max(1,recoveryContext.deadline-now()));})]);}
        finally{clearTimeout(timer);}
      };
      try{
        check();const expectedOrigin=new URL(expected.url).origin;
        const readTarget=async()=>{
          check();const tab=await timed(()=>chrome.tabs.get(expected.id));check();
          let url;try{url=new URL(tab.url);}catch{throw Object.assign(Error('The tab URL is unavailable.'),{code:'recovery_scope_changed'});}
          if(tab.id!==expected.id||tab.windowId!==expected.windowId||tab.incognito||!['http:','https:'].includes(url.protocol)||url.origin!==expectedOrigin||url.username||url.password)throw Object.assign(Error('The page moved outside its observed scope.'),{code:'recovery_scope_changed'});
          if(tab.pendingUrl){let pending;try{pending=new URL(tab.pendingUrl);}catch{throw Object.assign(Error('The page is navigating outside its observed scope.'),{code:'recovery_scope_changed'});}if(pending.origin!==expectedOrigin)throw Object.assign(Error('The page is navigating outside its observed scope.'),{code:'recovery_scope_changed'});}
          const window=await timed(()=>chrome.windows.get(tab.windowId));check();
          if(window.incognito||window.type!=='normal')throw Object.assign(Error('The browser window changed.'),{code:'recovery_scope_changed'});
          if(!await timed(()=>chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']})))throw Object.assign(Error('Page permission was removed.'),{code:'page_permission_required'});check();
          return tab;
        };
        let tab=await readTarget();
        // Cancel only the exact old request. This is harmless if navigation
        // already removed the old document or the plan already settled.
        try{await timed(()=>chrome.tabs.sendMessage(tab.id,{type:'mitch_page_cancel',id:context.id},{frameId:0}));}catch(error){check();if(error.code==='recovery_timeout')throw error;}
        while(tab.pendingUrl||tab.status==='loading'){
          await timed(()=>new Promise(resolve=>setTimeout(resolve,50)));tab=await readTarget();
        }
        await timed(()=>chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',files:['action-plan.js','page-agent.js']}));check();
        const current=await readTarget();
        if(current.url!==tab.url||current.pendingUrl||current.status==='loading')throw Object.assign(Error('The page changed during read-only inspection.'),{code:'recovery_scope_changed'});
        const observation=await timed(()=>chrome.tabs.sendMessage(tab.id,{type:'mitch_page_observe',id:context.id,deadline:recoveryContext.deadline,expectedUrl:current.url},{frameId:0}));check();
        if(observation?.status!=='observed'||typeof observation.snapshot!=='string'||typeof observation.document_id!=='string'||observation.url!==current.url||!Array.isArray(observation.controls))throw Object.assign(Error('No fresh page observation was returned.'),{code:'recovery_observation_failed'});
        const final=await readTarget();if(final.url!==current.url||final.pendingUrl||final.status==='loading')throw Object.assign(Error('The page changed before read-only recovery finished.'),{code:'recovery_scope_changed'});
        return {...result,recovery_required:true,recovery_kind:'read_only_after_input',observation};
      }catch(error){return {...result,recovery_error:typeof error.code==='string'&&/^[a-z_0-9]+$/.test(error.code)?error.code:'page_recovery_failed'};}
    }
    async function openTab(args,context){
      let issued=false,created,ledger,entry;const job={tabId:null,cancelled:false};
      const bounded={...context,deadline:Math.min(context.deadline,now()+30000),isCancelled:()=>job.cancelled||context.isCancelled?.()};
      const fail=(code,message)=>{throw Object.assign(Error(message||code),{code});};
      const timed=async operation=>{assertActive(bounded);let timer;try{return await Promise.race([Promise.resolve().then(()=>{assertActive(bounded);return operation();}),new Promise((_,reject)=>{timer=setTimeout(()=>{job.cancelled=true;reject(Object.assign(Error('The tab request expired.'),{code:'deadline_exceeded'}));},Math.max(1,bounded.deadline-now()));})]);}finally{clearTimeout(timer);}};
      try{
        assertActive(bounded);
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['windowIds','url'].includes(key))||typeof args.url!=='string'||args.url.length>8192||!Array.isArray(args.windowIds)||!args.windowIds.length||args.windowIds.length>100||args.windowIds.some(id=>!Number.isSafeInteger(id)||id<0)||new Set(args.windowIds).size!==args.windowIds.length)return refused('invalid_args','An exact browser inventory and explicit HTTP URL are required.');
        if(typeof context.id!=='string'||!context.id||context.id.length>128||['__proto__','constructor','prototype'].includes(context.id))return refused('invalid_request','A bounded request ID is required.');
        let url;try{url=new URL(args.url);}catch{fail('invalid_url');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)fail('invalid_url');
        const permission=async()=>{if(!await timed(()=>chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']})))fail('page_permission_required');};
        ledger=(await timed(()=>chrome.storage.session.get(LEDGER)))[LEDGER]||{};
        if(Object.hasOwn(ledger,context.id))return {...refused('duplicate_request','This tab creation was already issued; it will not be repeated.'),outcome_unknown:ledger[context.id].state!=='complete'||ledger[context.id].result?.outcome_unknown===true};
        if(Object.keys(ledger).length>=MAX_LEDGER)return refused('ledger_full','Restart the browser before issuing more page plans.');
        const windows=[];for(const id of args.windowIds){const window=await timed(()=>chrome.windows.get(id));if(window.id!==id||window.incognito||window.type!=='normal')fail('stale_browser_window');windows.push(window);}
        const focused=windows.filter(window=>window.focused===true),window=focused.length===1?focused[0]:windows.length===1?windows[0]:null;
        if(!window)fail('ambiguous_browser_window','Select one browser window before opening a tab.');await permission();
        entry={state:'pending',at:now()};ledger[context.id]=entry;await timed(()=>chrome.storage.session.set({[LEDGER]:ledger}));
        const latest=await timed(()=>chrome.windows.get(window.id));if(latest.id!==window.id||latest.incognito||latest.type!=='normal')fail('stale_browser_window');await permission();
        active.set(context.id,job);
        created=await timed(()=>{assertActive(bounded);issued=true;return chrome.tabs.create({windowId:window.id,url:url.href,active:true});});
        if(!Number.isSafeInteger(created?.id)||created.id<0||created.windowId!==window.id||created.incognito||created.pinned)fail('tab_creation_not_acknowledged');job.tabId=created.id;
        const expectedOrigin=url.origin;let committed=false;
        const initialDocument=tab=>!committed&&(tab.url===undefined||tab.url===''||tab.url==='about:blank');
        const read=async()=>{
          const tab=await timed(()=>chrome.tabs.get(created.id));
          if(tab.id!==created.id||tab.windowId!==window.id||tab.incognito||tab.pinned)fail('page_scope_changed');
          // Chromium can acknowledge create before url/pendingUrl are filled
          // in. Only this exact newly-created tab may wait in its initial empty
          // or blank document. No injection or DOM read is allowed there, and
          // a later return to blank after an HTTP commit is a scope failure.
          if(!initialDocument(tab)){
            let current;try{current=new URL(tab.url);}catch{fail('page_scope_changed');}
            if(!['http:','https:'].includes(current.protocol)||current.origin!==expectedOrigin||current.username||current.password)fail('page_scope_changed');committed=true;
          }
          if(tab.pendingUrl){let pending;try{pending=new URL(tab.pendingUrl);}catch{fail('page_scope_changed');}if(pending.origin!==expectedOrigin||pending.username||pending.password)fail('page_scope_changed');}
          const currentWindow=await timed(()=>chrome.windows.get(window.id));if(currentWindow.id!==window.id||currentWindow.incognito||currentWindow.type!=='normal')fail('page_scope_changed');await permission();return tab;
        };
        let tab=await read();const until=Math.min(bounded.deadline,now()+8000);
        while(initialDocument(tab)||tab.pendingUrl||tab.status==='loading'){if(now()>=until)fail('navigation_timeout');await timed(()=>new Promise(resolve=>setTimeout(resolve,50)));tab=await read();}
        await timed(()=>chrome.scripting.executeScript({target:{tabId:created.id,frameIds:[0]},world:'ISOLATED',files:['action-plan.js','page-agent.js']}));
        const before=await read();if(before.pendingUrl||before.status==='loading')fail('page_scope_changed');
        const observation=await timed(()=>chrome.tabs.sendMessage(created.id,{type:'mitch_page_observe',id:context.id,deadline:bounded.deadline,expectedUrl:before.url},{frameId:0}));
        tab=await read();if(observation?.status!=='observed'||typeof observation.document_id!=='string'||typeof observation.snapshot!=='string'||!Array.isArray(observation.controls)||typeof observation.complete!=='boolean'||observation.url!==before.url||tab.url!==before.url||tab.pendingUrl||tab.status==='loading')fail('navigation_observation_failed');
        const result={status:'opened',verified:true,action_attempted:true,input_delivered:true,creation:{accepted:true,requested_url:url.href,tab_id:created.id,window_id:window.id},tab:{id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title||'',active:tab.active===true,pinned:false,incognito:false,windowType:'normal'},observation};
        entry.state='complete';entry.result={status:'opened',verified:true,outcome_unknown:false};await timed(()=>chrome.storage.session.set({[LEDGER]:ledger}));return result;
      }catch(error){
        const reason=typeof error.code==='string'?error.code:'page_open_failed',result={status:issued?'interrupted':'refused',reason,code:reason,verified:false,action_attempted:issued,...(issued?{outcome_unknown:true}:{})};
        return issued&&created?.id!==undefined?await recoverAfterInput(result,{id:created.id,windowId:created.windowId,url:args.url,pinned:false},bounded):result;
      }finally{active.delete(context.id);}
    }
    async function followLink(args,context){
      let issued=false,ledger,entry,receipt;const job={tabId:args?.expectedTab?.id,cancelled:false};
      const bounded={...context,deadline:Math.min(context.deadline,now()+30000),isCancelled:()=>job.cancelled||context.isCancelled?.()};
      const timed=async operation=>{assertActive(bounded);let timer;try{return await Promise.race([Promise.resolve().then(()=>{assertActive(bounded);return operation();}),new Promise((_,reject)=>{timer=setTimeout(()=>{job.cancelled=true;reject(Object.assign(Error('The link request expired.'),{code:'deadline_exceeded'}));},Math.max(1,bounded.deadline-now()));})]);}finally{clearTimeout(timer);}};
      const fail=(code,message)=>{throw Object.assign(Error(message||code),{code});};
      try{
        assertActive(bounded);
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!['expectedTab','snapshot','target','completion'].includes(key))||typeof args.snapshot!=='string'||args.snapshot.length>160)return refused('invalid_args','An observed page and typed link selector are required.');
        if(typeof context.id!=='string'||!context.id||context.id.length>128||['__proto__','constructor','prototype'].includes(context.id))return refused('invalid_request','A bounded request ID is required.');
        if(!plan?.validatePlan)return refused('page_adapter_update_required','Reload the browser extension.');
        const validated=plan.validatePlan({steps:[{op:'assert',target:args.target}],completion:args.completion}),target=validated.steps[0].target;
        ledger=(await timed(()=>chrome.storage.session.get(LEDGER)))[LEDGER]||{};
        if(Object.hasOwn(ledger,context.id))return {...refused('duplicate_request','This navigation was already issued; it will not be repeated.'),outcome_unknown:ledger[context.id].state!=='complete'||ledger[context.id].result?.outcome_unknown===true};
        if(Object.keys(ledger).length>=MAX_LEDGER)return refused('ledger_full','Restart the browser before issuing more page plans.');
        await timed(()=>inspect(args.expectedTab,bounded));
        await timed(()=>chrome.scripting.executeScript({target:{tabId:job.tabId,frameIds:[0]},world:'ISOLATED',files:['action-plan.js','page-agent.js']}));
        active.set(context.id,job);
        const resolve=async()=>{
          await timed(()=>inspect(args.expectedTab,bounded));
          const link=await timed(()=>chrome.tabs.sendMessage(job.tabId,{type:'mitch_page_resolve_link',id:context.id,deadline:bounded.deadline,expectedUrl:args.expectedTab.url,snapshot:args.snapshot,target},{frameId:0}));
          if(link?.status!=='resolved_link')fail(link?.reason||link?.code||'link_resolution_failed','Refresh this tab if its page adapter is outdated. No navigation was sent.');
          let href;try{href=new URL(link.href);}catch{fail('invalid_link');}
          if(!['http:','https:'].includes(href.protocol)||href.origin!==new URL(args.expectedTab.url).origin||href.username||href.password||href.href.length>8192||link.source_url!==args.expectedTab.url||typeof link.document_id!=='string'||link.document_id.length>160||typeof link.target?.name!=='string'||link.target.role!=='link'||link.target.match!=='exact'||plan.matchControls([link.target],target).length!==1)fail('invalid_link','The page did not return an eligible observed link.');
          return link;
        };
        const first=await resolve();
        // Reserve durably before issuance. Resolve once more after the await so
        // a changed href cannot silently replace the observed destination.
        entry={state:'pending',at:now()};ledger[context.id]=entry;await timed(()=>chrome.storage.session.set({[LEDGER]:ledger}));
        const link=await resolve();
        if(link.href!==first.href||link.document_id!==first.document_id||JSON.stringify(link.target)!==JSON.stringify(first.target))fail('stale_link','The link changed before navigation. Observe it again.');
        await timed(()=>inspect(args.expectedTab,bounded));assertActive(bounded);
        const updated=await timed(()=>{assertActive(bounded);issued=true;return chrome.tabs.update(job.tabId,{url:link.href});});
        if(updated?.id!==job.tabId)fail('navigation_not_acknowledged');
        receipt={accepted:true,source_document_id:link.document_id,source_url:args.expectedTab.url,requested_url:link.href,target:link.target};
        const origin=new URL(args.expectedTab.url).origin;
        const currentTab=async()=>{
          const tab=await timed(()=>chrome.tabs.get(job.tabId));let url;try{url=new URL(tab.url);}catch{fail('page_scope_changed');}
          if(tab.id!==job.tabId||tab.windowId!==args.expectedTab.windowId||tab.incognito||Boolean(tab.pinned)!==args.expectedTab.pinned||!['http:','https:'].includes(url.protocol)||url.origin!==origin||url.username||url.password)fail('page_scope_changed');
          if(tab.pendingUrl){let pending;try{pending=new URL(tab.pendingUrl);}catch{fail('page_scope_changed');}if(pending.origin!==origin||pending.username||pending.password)fail('page_scope_changed');}
          const window=await timed(()=>chrome.windows.get(tab.windowId));if(window.incognito||window.type!=='normal')fail('page_scope_changed');
          if(!await timed(()=>chrome.permissions.contains({origins:[url.protocol+'//'+url.hostname+'/*']})))fail('page_permission_required');
          return tab;
        };
        const readyDeadline=Math.min(bounded.deadline,now()+8000);let tab=await currentTab();
        while(tab.pendingUrl||tab.status==='loading'||tab.url===args.expectedTab.url&&link.href!==args.expectedTab.url){if(now()>=readyDeadline)fail('navigation_timeout');await timed(()=>new Promise(resolve=>setTimeout(resolve,50)));tab=await currentTab();}
        await timed(()=>chrome.scripting.executeScript({target:{tabId:job.tabId,frameIds:[0]},world:'ISOLATED',files:['action-plan.js','page-agent.js']}));
        const observe=async selector=>{
          const before=await currentTab();if(before.pendingUrl||before.status==='loading')fail('page_scope_changed');
          const observation=await timed(()=>chrome.tabs.sendMessage(job.tabId,{type:'mitch_page_observe',id:context.id,deadline:bounded.deadline,expectedUrl:before.url,...(selector?{selector}:{})},{frameId:0}));
          const after=await currentTab();
          if(observation?.status!=='observed'||typeof observation.document_id!=='string'||typeof observation.snapshot!=='string'||!Array.isArray(observation.controls)||typeof observation.complete!=='boolean'||observation.url!==before.url||after.url!==before.url||after.pendingUrl||after.status==='loading')fail('navigation_observation_failed');
          return observation;
        };
        // Updating an identical URL is a reload. Do not certify the old
        // document merely because Chrome acknowledged scheduling navigation.
        if(link.href===args.expectedTab.url){const current=await observe();if(current.document_id===link.document_id)fail('navigation_observation_failed');}
        const proofDeadline=Math.min(bounded.deadline,now()+1500);let proofs=[],passed=false;
        do{
          proofs=[];for(const predicate of validated.completion){const observation=await observe(predicate.target);proofs.push({...predicate,passed:observation.complete&&plan.testCondition(observation,predicate),observation});}
          passed=proofs.every(proof=>proof.passed)&&new Set(proofs.map(proof=>proof.observation.document_id)).size===1;
          if(passed||now()>=proofDeadline)break;await timed(()=>new Promise(resolve=>setTimeout(resolve,50)));
        }while(true);
        const observation=await observe();
        if(proofs.some(proof=>proof.observation.document_id!==observation.document_id||proof.observation.url!==observation.url))fail('page_scope_changed');
        receipt.final_url=observation.url;
        const delivered={index:0,op:'follow_link',target:link.target};
        const result={status:passed?'completed':'interrupted',verified:passed,attempted:1,completed:passed?1:0,action_attempted:true,input_delivered:true,navigation:receipt,steps:[{index:0,op:'follow_link',status:'delivered',known_delivery:true,resolved_target:link.target}],delivered_steps:[delivered],completion:proofs,observation,...(!passed?{recovery_required:true,reason:'completion_not_met'}:{})};
        entry.state='complete';entry.result={status:result.status,verified:result.verified,outcome_unknown:false};await timed(()=>chrome.storage.session.set({[LEDGER]:ledger}));
        return result;
      }catch(error){
        const reason=typeof error.code==='string'?error.code:'page_navigation_failed';
        const result={status:issued?'interrupted':'refused',reason,code:reason,verified:false,action_attempted:issued,...(issued?{outcome_unknown:true}:{})};
        return issued?await recoverAfterInput(result,args.expectedTab,bounded):result;
      }finally{active.delete(context.id);}
    }
    async function run(method,args,context){
      const mutating=method==='page.plan';let issued=false,ledger,entry;
      if(!['page.observe','page.plan'].includes(method))return refused('unsupported_method','This page operation is unsupported.');
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(key=>!(mutating?['expectedTab','expectedFrame','snapshot','steps','completion']:['expectedTab','expectedFrame','selector']).includes(key)))return refused('invalid_args','Unexpected page operation arguments.');
      if(typeof context.id!=='string'||!context.id||context.id.length>128||['__proto__','constructor','prototype'].includes(context.id))return refused('invalid_request','A bounded request ID is required.');
      const bounded={...context,deadline:Math.min(context.deadline,now()+30000)};
      try{
        assertActive(bounded);
        if(mutating){
          if(typeof args.snapshot!=='string'||args.snapshot.length>160||!Array.isArray(args.steps)||!Array.isArray(args.completion))return refused('invalid_plan','An observed page snapshot and a typed action plan are required.');
          ledger=(await chrome.storage.session.get(LEDGER))[LEDGER]||{};assertActive(bounded);
          if(Object.hasOwn(ledger,context.id))return {...refused('duplicate_request','This plan was already issued; it will not be repeated.'),outcome_unknown:ledger[context.id].state!=='complete'||ledger[context.id].result?.outcome_unknown===true,previous:ledger[context.id].result};
          if(Object.keys(ledger).length>=MAX_LEDGER)return refused('ledger_full','Restart the browser before issuing more page plans.');
        }
        await inspect(args.expectedTab,bounded);
        if(args.expectedFrame)await inspectFrame(args.expectedTab.id,args.expectedFrame,bounded);
        const frameOptions=args.expectedFrame?{documentId:args.expectedFrame.browser_document_id}:{frameId:0};
        await chrome.scripting.executeScript({target:{tabId:args.expectedTab.id,...(args.expectedFrame?{documentIds:[args.expectedFrame.browser_document_id]}:{frameIds:[0]})},world:'ISOLATED',files:['action-plan.js','page-agent.js']});
        await inspect(args.expectedTab,bounded);
        if(mutating){
          entry={state:'pending',at:now()};ledger[context.id]=entry;
          await chrome.storage.session.set({[LEDGER]:ledger});assertActive(bounded);
          // Revalidate after durable reservation, immediately before the only issuance.
          await inspect(args.expectedTab,bounded);
        }
        if(args.expectedFrame)await inspectFrame(args.expectedTab.id,args.expectedFrame,bounded);
        const job={tabId:args.expectedTab.id,cancelled:false,frameOptions};active.set(context.id,job);
        const payload={type:mutating?'mitch_page_plan':'mitch_page_observe',id:context.id,deadline:bounded.deadline,expectedUrl:args.expectedFrame?.url||args.expectedTab.url,...(mutating?{snapshot:args.snapshot,steps:args.steps,completion:args.completion}:{selector:args.selector})};
        issued=mutating;
        let timer;
        const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{cancel(context.id);reject(Object.assign(Error('No confirmed page result arrived before the deadline.'),{code:'deadline_exceeded'}));},Math.max(1,bounded.deadline-now()));});
        let result;try{result=await Promise.race([chrome.tabs.sendMessage(job.tabId,payload,frameOptions),timeout]);}finally{clearTimeout(timer);active.delete(context.id);}
        if(!result||typeof result!=='object'||Array.isArray(result))throw Object.assign(Error('The page returned no usable result.'),{code:'invalid_reply'});
        if(!mutating&&!args.expectedFrame&&result.has_iframes){try{result.frames=await frameInventory(job.tabId);}catch{result.frames_unavailable=true;}}
        if(mutating){
          entry.state='complete';entry.result={status:result.status,verified:result.verified===true,outcome_unknown:result.outcome_unknown===true,reason:result.reason||result.code};
          await chrome.storage.session.set({[LEDGER]:ledger});
        }
        return mutating&&!args.expectedFrame?await recoverAfterInput(result,args.expectedTab,bounded):result;
      }catch(error){
        const code=error.code||'page_operation_failed';
        const result={status:code==='cancelled'?'cancelled':issued?'interrupted':'refused',code,reason:code,message:error.message||'The page could not confirm this operation.',verified:false,action_attempted:issued,...(issued?{outcome_unknown:true}:{})};
        return issued&&!args.expectedFrame?await recoverAfterInput(result,args.expectedTab,bounded):result;
      }finally{active.delete(context.id);}
    }
    function execute(method,args,context={}){
      if(!['page.plan','page.follow_link','page.open_tab'].includes(method))return run(method,args,context);
      const result=serial.then(()=>method==='page.open_tab'?openTab(args,context):method==='page.follow_link'?followLink(args,context):run(method,args,context));serial=result.catch(()=>{});return result;
    }
    return {execute,cancel};
  }
  return {createPageOperations};
});
