(function(root){
  'use strict';
  const LEDGER_KEY='mitchBrowserOperationLedger',MAX_LEDGER=4096,MAX_TABS=500;
  const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const idValid=value=>Number.isSafeInteger(value)&&value>=0;
  const requestIdValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
  function refusal(code,message){return {status:'refused',code,message,verified:false,action_attempted:false};}
  function createTabOperations(api,{now=()=>Date.now()}={}){
    let queue=Promise.resolve(),loaded;
    const ledger=()=>loaded||(loaded=api.storage.session.get(LEDGER_KEY).then(data=>{
      const value=data[LEDGER_KEY];
      if(value===undefined)return Object.create(null);
      if(!isObject(value)||Object.keys(value).length>MAX_LEDGER)throw Error('Invalid browser operation ledger.');
      return Object.assign(Object.create(null),value);
    }));
    const save=entries=>api.storage.session.set({[LEDGER_KEY]:entries});
    const check=context=>{
      if(context.isCancelled?.()){const error=Error('Browser request was cancelled.');error.code='cancelled';throw error;}
      if(now()>=context.deadline){const error=Error('Browser request deadline expired.');error.code='deadline_expired';throw error;}
    };
    async function inventory(){
      const all=await api.tabs.query({windowType:'normal'});
      if(!Array.isArray(all)||all.length>MAX_TABS)throw Error('Browser tab inventory is unavailable or too large.');
      const eligible=all.filter(tab=>!tab.incognito);
      const tabs=eligible.map(tab=>{
        if(!idValid(tab.id)||!idValid(tab.windowId)||typeof tab.url!=='string'||tab.url.length>16384||typeof tab.title!=='string'||typeof tab.active!=='boolean'||typeof tab.pinned!=='boolean')throw Error('Browser returned incomplete tab metadata.');
        return {id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title.slice(0,1000),active:tab.active,pinned:tab.pinned,incognito:false,windowType:'normal',...(tab.pendingUrl?{pendingUrl:tab.pendingUrl}:{})};
      });
      if(new Set(tabs.map(tab=>tab.id)).size!==tabs.length)throw Error('Browser returned duplicate tab identities.');
      if(JSON.stringify(tabs).length>200*1024)throw Error('Browser tab inventory exceeds the response limit.');
      return tabs;
    }
    function validate(method,args,context){
      if(!requestIdValid(context.id)||!Number.isFinite(context.deadline)||context.deadline>now()+120000)return refusal('invalid_request','Invalid browser request identity or deadline.');
      if(!isObject(args))return refusal('invalid_arguments','Browser arguments must be an object.');
      if(method==='tabs.list')return Object.keys(args).length?refusal('invalid_arguments','Tab listing takes no arguments.'):null;
      if(!['tabs.close','tabs.activate'].includes(method))return refusal('unsupported_operation','This browser operation is unavailable.');
      if(Object.keys(args).some(key=>!['expectedTabs','allowPinned'].includes(key))||args.allowPinned!==false||!Array.isArray(args.expectedTabs)||args.expectedTabs.length<1||args.expectedTabs.length>20||(method==='tabs.activate'&&args.expectedTabs.length!==1))return refusal('invalid_arguments','Choose one to twenty exact tabs; pinned tabs are excluded.');
      for(const tab of args.expectedTabs){
        if(!isObject(tab)||Object.keys(tab).some(key=>!['id','windowId','url','pinned'].includes(key))||!idValid(tab.id)||!idValid(tab.windowId)||typeof tab.url!=='string'||!tab.url.length||tab.url.length>16384||tab.pinned!==false)return refusal('invalid_target','Tab identity, URL, window and pinned state are required.');
      }
      if(new Set(args.expectedTabs.map(tab=>tab.id)).size!==args.expectedTabs.length)return refusal('duplicate_target','A tab may occur only once in a request.');
      return null;
    }
    async function run(method,args,context){
      const invalid=validate(method,args,context);if(invalid)return invalid;
      let attempted=false,entries,record;
      const complete=async result=>{
        if(record){record.state='complete';record.status=result.status;record.action_attempted=result.action_attempted===true;await save(entries);}
        return result;
      };
      try{
        check(context);
        if(method==='tabs.list'){
          const tabs=await inventory();check(context);return {status:'ok',tabs};
        }
        entries=await ledger();check(context);
        const prior=entries[context.id];
        if(prior)return {...refusal('duplicate_request','This browser request was already processed; no action was repeated.'),action_attempted:prior.state==='pending'||prior.action_attempted===true,outcome_unknown:prior.state==='pending',prior_status:prior.status||'pending'};
        if(Object.keys(entries).length>=MAX_LEDGER)return refusal('ledger_full','The browser session operation ledger is full. Restart the browser before new tab changes.');
        record={state:'pending',method,at:now()};entries[context.id]=record;
        // Persist before dispatch: a worker restart cannot replay an operation
        // whose reply was lost. Session storage clears with the browser session.
        await save(entries);check(context);
        const before=await inventory();check(context);
        for(const expected of args.expectedTabs){
          const tab=before.find(item=>item.id===expected.id);
          if(!tab||tab.windowId!==expected.windowId||tab.url!==expected.url||tab.pinned!==expected.pinned||tab.pinned||tab.pendingUrl)return await complete(refusal('stale_target','A selected tab changed, is navigating, is pinned, or is no longer available. No action was sent.'));
        }
        const ids=args.expectedTabs.map(tab=>tab.id);
        // No await between this final cancellation check and the API mutation.
        check(context);attempted=true;
        if(method==='tabs.close'){
          await api.tabs.remove(ids);
          const tabs=await inventory(),closedIds=ids.filter(id=>!tabs.some(tab=>tab.id===id));
          const verified=closedIds.length===ids.length;
          return await complete({status:verified?'closed':'unverified',verified,action_attempted:true,...(!verified?{outcome_unknown:true}:{}),closedIds,tabs});
        }
        await api.tabs.update(ids[0],{active:true});check(context);
        await api.windows.update(args.expectedTabs[0].windowId,{focused:true});
        const tabs=await inventory(),window=await api.windows.get(args.expectedTabs[0].windowId);
        const current=tabs.find(tab=>tab.id===ids[0]),expected=args.expectedTabs[0];
        const verified=!!current&&current.active&&current.windowId===expected.windowId&&current.url===expected.url&&!current.pendingUrl&&window.type==='normal'&&window.focused===true;
        return await complete({status:verified?'activated':'unverified',verified,action_attempted:true,...(!verified?{outcome_unknown:true}:{}),activeId:ids[0],windowFocused:window.focused===true,tabs});
      }catch(error){
        const cancelled=error.code==='cancelled'||error.code==='deadline_expired';
        const result={status:cancelled?'cancelled':'error',code:error.code||'browser_operation_failed',message:attempted?'The browser action was issued, but its result could not be verified. Inspect the tabs before doing anything else.':(cancelled?error.message:'The browser state could not be checked; no tab action was sent.'),verified:false,action_attempted:attempted,...(attempted?{outcome_unknown:true}:{})};
        try{return await complete(result);}catch{return {...result,code:'ledger_write_failed',...(attempted?{outcome_unknown:true}:{})};}
      }
    }
    return {execute(method,args,context){
      // A pending browser confirmation must not block read-only recovery.
      if(method==='tabs.list')return run(method,args,context);
      const next=queue.then(()=>run(method,args,context));queue=next.catch(()=>{});return next;
    }};
  }
  const exported={createTabOperations};
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  else root.MitchTabOperations=exported;
})(globalThis);
