(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MitchPageAgent=api;
  if(root.document&&root.chrome?.runtime?.onMessage&&!root.__mitchPageAgentInstalled){root.__mitchPageAgentInstalled=true;const agent=api.createPageAgent({window:root,document:root.document,plan:root.MitchPlan});root.chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(sender.id!==root.chrome.runtime.id||!message?.type?.startsWith('mitch_page_'))return;agent.handle(message).then(reply,error=>reply({status:'interrupted',verified:false,outcome_unknown:true,reason:'page_error',message:String(error.message||error).slice(0,200)}));return true;});}
})(globalThis,function(){
  'use strict';
  const CANDIDATES='button,a[href],input,textarea,select,[contenteditable="true"],[role],h1,h2,h3,h4,h5,h6,summary';
  const compact=(value,max=160)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
  const fail=(reason,message)=>Object.assign(Error(message||reason),{code:reason});
  function createPageAgent({window,document,plan,now=Date.now}){
    if(!plan?.executePlan)throw Error('The typed plan executor is unavailable.');
    const documentId=window.crypto?.randomUUID?.()||'doc-'+Math.random().toString(36).slice(2),origin=new URL(window.location.href).origin;
    let sequence=0,revision=0,nextId=0,candidates=null,candidateScans=0,indexComplete=true;const ids=new WeakMap(),nodes=new Map(),snapshots=new Map(),jobs=new Map(),waiters=new Set(),shadowObservers=new Map();
    const changed=(structural=false)=>{revision++;if(structural)candidates=null;for(const wake of [...waiters])wake();};
    const observer=new window.MutationObserver(()=>changed(true));
    observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
    const events=['input','change','focusin','focusout','scroll','resize','pageshow','popstate','hashchange','transitionend','animationend'];
    const eventChanged=()=>changed(false);
    for(const name of events)window.addEventListener?.(name,eventChanged,true);
    function candidateElements(){
      // Flush mutations queued in this task before consulting the index. Values,
      // visibility, focus and enabled state are always read live, never cached.
      if(observer.takeRecords?.().length)changed(true);
      for(const [root,watch] of shadowObservers){if(!root.host.isConnected){watch.disconnect();shadowObservers.delete(root);changed(true);}else if(watch.takeRecords?.().length)changed(true);}
      // Open roots are inspected locally, including roots attached to existing
      // hosts without a DOM mutation. Closed roots remain a native/visual fallback.
      const roots=[document];let scanned=0;indexComplete=true;
      for(let i=0;i<roots.length;i++){
        for(const element of roots[i].querySelectorAll('*')){
          if(++scanned>10000){indexComplete=false;break;}
          const shadow=element.shadowRoot;if(!shadow)continue;
          if(roots.length>=64){indexComplete=false;break;}
          roots.push(shadow);
          if(!shadowObservers.has(shadow)){const watch=new window.MutationObserver(()=>changed(true));watch.observe(shadow,{subtree:true,childList:true,attributes:true,characterData:true});shadowObservers.set(shadow,watch);changed(true);}
        }
        if(!indexComplete)break;
      }
      if(!candidates){candidates=roots.flatMap(root=>Array.from(root.querySelectorAll(CANDIDATES)));candidateScans++;}
      return candidates;
    }
    const parentOf=element=>element.parentElement||element.getRootNode?.().host||null;
    const focused=element=>{let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;return active===element;};
    function ancestorsOf(element){const rows=[];let parent=parentOf(element),depth=0;while(parent&&depth++<40&&rows.length<8){const role=roleOf(parent),named=parent.getAttribute('aria-label')||parent.getAttribute('aria-labelledby');if(named||['group','dialog','region','row','listitem','form','fieldset'].includes(role)){const name=nameOf(parent);if(name)rows.push({name,role});}parent=parentOf(parent);}return rows;}
    function assertActive(context={}){context.signal?.throwIfAborted?.();if(context.isCancelled?.())throw fail('cancelled','The page plan was stopped.');if(context.deadline!==undefined&&now()>=context.deadline)throw fail('deadline_exceeded','The page plan expired.');if(new URL(window.location.href).origin!==origin)throw fail('navigation_changed','The page left its observed origin.');}
    function roleOf(element){
      const explicit=compact(element.getAttribute('role')).split(' ')[0].toLowerCase();if(explicit)return explicit;
      const tag=element.tagName.toLowerCase(),type=(element.type||'').toLowerCase();
      if(tag==='button'||tag==='summary'||tag==='input'&&['button','submit','reset','image'].includes(type))return 'button';
      if(tag==='a')return 'link';if(tag==='select')return element.multiple?'listbox':'combobox';
      if(tag==='input'&&['checkbox','radio'].includes(type))return type;
      if(tag==='input'&&type==='range')return 'slider';if(tag==='input'&&type==='number')return 'spinbutton';
      if(tag==='input'||tag==='textarea'||element.isContentEditable)return 'textbox';
      if(/^h[1-6]$/.test(tag))return 'heading';if(tag==='fieldset')return 'group';if(tag==='dialog')return 'dialog';if(tag==='section')return 'region';if(tag==='form')return 'form';if(tag==='tr')return 'row';if(tag==='li')return 'listitem';return 'generic';
    }
    function nameOf(element){
      const aria=element.getAttribute('aria-label');if(aria)return compact(aria);
      const labelled=element.getAttribute('aria-labelledby');if(labelled){const name=labelled.split(/\s+/).slice(0,8).map(id=>(element.getRootNode?.()||document).getElementById?.(id)?.textContent||'').join(' ');if(name.trim())return compact(name);}
      if(element.tagName.toLowerCase()==='fieldset'){const legend=element.querySelector?.(':scope > legend');if(legend)return compact(legend.textContent);}
      if(element.labels?.length){const name=Array.from(element.labels).map(label=>label.textContent).join(' ');if(name.trim())return compact(name);}
      const tag=element.tagName.toLowerCase();if(tag==='input'&&['button','submit','reset'].includes(element.type))return compact(element.value);
      if(['input','textarea','select'].includes(tag))return compact(element.getAttribute('placeholder')||element.getAttribute('title')||element.getAttribute('name'));
      return compact(element.innerText||element.textContent||element.getAttribute('title'));
    }
    function protectedField(element){
      const type=(element.type||'').toLowerCase(),autocomplete=element.getAttribute('autocomplete')||'';
      const identity=[element.id,element.getAttribute('name'),nameOf(element),autocomplete].join(' ');
      return ['password','file','hidden'].includes(type)||/password|one-time-code|cc-|credit.?card|card.?number|security.?code|\bcvv\b|\bcvc\b|\bssn\b|social.?security|api.?key|access.?token|auth.?token|secret|private.?key/i.test(identity);
    }
    function visible(element){
      if(!element.isConnected||element.hidden||element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
      const style=window.getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;
      for(let parent=parentOf(element);parent;parent=parentOf(parent)){const css=window.getComputedStyle(parent);if(parent.hidden||parent.hasAttribute?.('inert')||parent.getAttribute('aria-hidden')==='true'||css.display==='none'||css.visibility==='hidden'||Number(css.opacity)===0)return false;}
      const rect=element.getBoundingClientRect();return rect.width>0&&rect.height>0;
    }
    function describe(element){
      let id=ids.get(element);if(!id){id='e'+(++nextId);ids.set(element,id);}nodes.set(id,element);
      const role=roleOf(element),type=compact(element.type||element.tagName.toLowerCase(),40),protectedValue=protectedField(element);
      const result={id,role,name:nameOf(element),type,enabled:!element.disabled&&!element.matches?.(':disabled')&&element.getAttribute('aria-disabled')!=='true'&&!element.closest('[inert]'),editable:!element.readOnly&&element.getAttribute('aria-readonly')!=='true'&&(element.isContentEditable||element.tagName.toLowerCase()==='textarea'||element.tagName.toLowerCase()==='input'&&!['button','submit','reset','image','checkbox','radio','range','file','hidden','color'].includes(type)),protected:protectedValue};
      if(!protectedValue&&('value' in element||element.isContentEditable))result.value=String(element.isContentEditable?element.textContent:element.value).slice(0,12000);
      if('checked' in element)result.checked=Boolean(element.checked);
      if(element.getAttribute('aria-checked')!==null)result.checked=element.getAttribute('aria-checked')==='true';
      if(element.getAttribute('aria-selected')!==null)result.selected=element.getAttribute('aria-selected')==='true';
      if(role==='combobox'||role==='listbox')result.options=Array.from(element.options||[]).slice(0,40).map(option=>({name:compact(option.label),value:String(option.value).slice(0,160),selected:option.selected}));
      const ancestors=ancestorsOf(element);if(ancestors.length)result.ancestors=ancestors;
      result.focused=focused(element);return result;
    }
    function selectorMatches(control,selector){if(!selector)return true;return plan.matchControls([control],selector).length===1;}
    async function snapshot({selector}={},context={}){
      assertActive(context);for(const [id,element] of nodes)if(!element.isConnected)nodes.delete(id);const controls=[];let complete=true,bytes=0;
      const indexed=candidateElements();complete=indexComplete;let inspected=0;
      for(const element of indexed){if(++inspected>10000){complete=false;break;}if(selector&&!selectorMatches({role:roleOf(element),name:nameOf(element),...(selector.within?{ancestors:ancestorsOf(element)}:{})},selector))continue;if(!visible(element))continue;const control=describe(element);
        bytes+=JSON.stringify(control).length;if(controls.length>=300||bytes>90000){complete=false;break;}controls.push(control);
      }
      const token=documentId+':'+(++sequence),url=window.location.href;
      const frame={status:'observed',snapshot:token,document_id:documentId,url,origin,revision,complete,controls,top_frame_only:true,has_iframes:Boolean(document.querySelector('iframe,frame')),untrusted_page_data:true};
      snapshots.set(token,{url,revision});if(snapshots.size>64)snapshots.delete(snapshots.keys().next().value);
      assertActive(context);return frame;
    }
    function freshElement(control,context){
      assertActive(context);const element=nodes.get(control.id);if(!element||!visible(element))throw fail('stale_control','The observed control no longer exists or is hidden.');
      const current=describe(element);
      for(const key of ['role','name','type','value','checked','protected','editable'])if(control[key]!==current[key])throw fail('stale_control','The observed control changed before input.');
      if(JSON.stringify(control.ancestors)!==JSON.stringify(current.ancestors))throw fail('stale_control','The control moved into another container.');
      if(!current.enabled)throw fail('disabled_control','The control is disabled.');if(current.protected)throw fail('protected_control','Protected fields cannot be read or filled by this adapter.');
      return element;
    }
    function actionable(element){
      element.scrollIntoView?.({block:'center',inline:'center',behavior:'instant'});
      const rect=element.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      if(x<0||y<0||x>=window.innerWidth||y>=window.innerHeight)throw fail('offscreen_control','The control is outside the visible viewport.');
      let top=document.elementFromPoint(x,y),depth=0;while(top?.shadowRoot&&depth++<16){const inner=top.shadowRoot.elementFromPoint?.(x,y);if(!inner||inner===top)break;top=inner;}if(top!==element&&!element.contains(top))throw fail('occluded_control','Another element covers the center of this control.');
    }
    const emit=(element,type)=>element.dispatchEvent(new window.Event(type,{bubbles:true,composed:true}));
    async function act(step,control,context){
      let inputStarted=false;
      try{
      const element=freshElement(control,context);actionable(element);freshElement(control,context);assertActive(context);
      if(step.op==='click'){
        if(typeof element.click!=='function')return {status:'refused',reason:'unsupported_click'};
        inputStarted=true;
        element.click();
      }else if(step.op==='fill'){
        if(!control.editable)return {status:'refused',reason:'not_editable'};
        element.focus();if(!focused(element))return {status:'refused',reason:'focus_failed'};freshElement(control,context);actionable(element);
        assertActive(context);
        if(element.isContentEditable){inputStarted=true;element.textContent=step.text;}
        else {const prototype=element.tagName.toLowerCase()==='textarea'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter)return {status:'refused',reason:'unsupported_fill'};inputStarted=true;setter.call(element,step.text);}
        emit(element,'input');emit(element,'change');
      }else if(step.op==='select'){
        if(element.tagName.toLowerCase()!=='select')return {status:'refused',reason:'unsupported_select'};
        const options=Array.from(element.options).filter(option=>!option.disabled&&option.value===step.value);
        if(options.length!==1)return {status:'refused',reason:options.length?'ambiguous_option':'option_missing'};
        inputStarted=true;element.value=options[0].value;emit(element,'input');emit(element,'change');
      }else if(step.op==='press'){
        element.focus();if(!focused(element))return {status:'refused',reason:'focus_failed'};freshElement(control,context);actionable(element);assertActive(context);
        // Synthetic keyboard events cannot reliably perform browser default actions.
        // Support the semantic Enter activation only; callers use fill/select/click otherwise.
        if(step.key==='Enter'&&['button','link'].includes(control.role)&&typeof element.click==='function'){inputStarted=true;element.click();}
        else return {status:'refused',reason:'unsupported_key',message:'This control needs native keyboard input; no synthetic key was sent.'};
      }else return {status:'refused',reason:'unsupported_action'};
      await Promise.resolve();assertActive(context);return {status:'issued',verified:false,input_delivered:true};
      }catch(error){
        // A stale/covered control or focus-triggered rerender can refuse before
        // any click/value event. Do not turn that refusal into unknown input.
        if(!inputStarted){error.refused=true;error.action_attempted=false;}
        else{error.action_attempted=true;error.outcome_unknown=true;}
        throw error;
      }
    }
    async function waitForChange({timeout_ms=100,revision:seenRevision},context={}){
      assertActive(context);if(seenRevision!==undefined&&seenRevision!==revision)return;
      await new Promise(resolve=>{let timer;const finish=()=>{clearTimeout(timer);waiters.delete(finish);resolve();};waiters.add(finish);timer=setTimeout(finish,Math.max(1,Math.min(timeout_ms,250)));});assertActive(context);
    }
    const adapter={snapshot,act,waitForChange};
    async function handle(message){
      if(message.type==='mitch_page_cancel'){const job=jobs.get(message.id);if(job)job.cancelled=true;for(const wake of [...waiters])wake();return {status:'cancelled'};}
      if(!['mitch_page_observe','mitch_page_plan','mitch_page_resolve_link'].includes(message.type))return {status:'refused',reason:'unsupported_method',verified:false,action_attempted:false};
      if(typeof message.id!=='string'||!Number.isFinite(message.deadline)||message.deadline>now()+31000)return {status:'refused',reason:'invalid_request',verified:false};
      if(window.location.href!==message.expectedUrl)return {status:'refused',reason:'stale_target',verified:false};
      const job={cancelled:false},context={deadline:message.deadline,isCancelled:()=>job.cancelled};
      try{
        assertActive(context);
        if(message.type==='mitch_page_observe')return await snapshot({selector:message.selector},context);
        const observed=snapshots.get(message.snapshot);if(!observed||observed.url!==window.location.href)return {status:'refused',reason:'stale_snapshot',verified:false,action_attempted:false};
        if(jobs.size)return {status:'refused',reason:'page_busy',verified:false,action_attempted:false};jobs.set(message.id,job);
        if(message.type==='mitch_page_resolve_link'){
          // Resolve an actual link from a fresh unique DOM match. No URL from
          // the planner, click, script, or synthetic event can enter this path.
          const checked=plan.validatePlan({steps:[{op:'assert',target:message.target}],completion:[{target:message.target}]}).completion[0].target;
          const frame=await snapshot({selector:checked},context),matches=plan.matchControls(frame.controls,checked);
          if(!frame.complete||matches.length!==1)throw fail(matches.length>1?'ambiguous_control':'control_missing','A single visible link is required.');
          const control=matches[0],element=freshElement(control,context);
          const linkTarget=element.getAttribute('target')||document.querySelector('base[target]')?.getAttribute('target')||'';
          if(control.role!=='link'||element.tagName.toLowerCase()!=='a'||!element.getAttribute('href')||element.getAttribute('download')!==null||!['','_self'].includes(linkTarget.toLowerCase()))throw fail('unsupported_link','Only ordinary same-tab links support direct navigation.');
          const href=new URL(element.href||element.getAttribute('href'),document.baseURI||window.location.href);
          if(!['http:','https:'].includes(href.protocol)||href.origin!==origin||href.username||href.password||href.href.length>8192)throw fail('link_scope_changed','The link must remain on the current HTTP origin.');
          freshElement(control,context);assertActive(context);
          return {status:'resolved_link',href:href.href,source_url:window.location.href,document_id:documentId,target:{name:control.name,role:'link',match:'exact'}};
        }
        const result=await plan.executePlan({steps:message.steps,completion:message.completion,adapter,context,timeoutMs:Math.max(1,message.deadline-now()),now});
        // Per-step selectors keep reads cheap and proofs precise, but the next
        // planning phase needs the surrounding menu/page, not just the last
        // failed selector. This read never dispatches or repeats input.
        try{result.observation=await snapshot({},context);}
        catch(error){result.observation_error=compact(error.code||'page_observation_failed',80);}
        return result;
      }catch(error){return {status:message.type==='mitch_page_resolve_link'?'refused':'interrupted',reason:error.code||'page_error',message:compact(error.message,200),verified:false,...(message.type==='mitch_page_resolve_link'?{action_attempted:false}:{})};}
      finally{jobs.delete(message.id);}
    }
    return {handle,adapter,diagnostics:()=>({candidateScans,revision}),disconnect:()=>{observer.disconnect();for(const watch of shadowObservers.values())watch.disconnect();shadowObservers.clear();candidates=null;for(const name of events)window.removeEventListener?.(name,eventChanged,true);for(const wake of [...waiters])wake();}};
  }
  return {createPageAgent};
});
