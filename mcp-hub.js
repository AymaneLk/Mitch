'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Ajv=require('ajv');
const Ajv2020=require('ajv/dist/2020');
const {catalog,byId,permitted}=require('./mcp-catalog');
const {connectMcp}=require('./mcp-client');
const {desktopRequest}=require('./workflow-assistant');
const {failureDetail,confirmedNotApplied,needsDevice,recoverDevice}=require('./mcp-errors');
const fail=(message,code='mcp_unavailable')=>({status:'unavailable',code,message,action_attempted:false,fallback_allowed:true});
const words=text=>String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[];
function rankTools(list,query){const terms=new Set(words(query));return list.map(t=>({t,score:words(t.name+' '+t.description).reduce((n,w)=>n+(terms.has(w)?1:0),0)})).sort((a,b)=>b.score-a.score||a.t.name.localeCompare(b.t.name)).map(x=>x.t);}
function resolveRefs(value,results){
 if(Array.isArray(value))return value.map(x=>resolveRefs(x,results));
 if(value&&typeof value==='object'){
  if(Object.hasOwn(value,'$mcp_ref')){if(Object.keys(value).length!==1)throw Error('A reference cannot have other keys.');const {step,path:parts}=value.$mcp_ref||{};if(!Number.isInteger(step)||step<0||step>=results.length||!Array.isArray(parts)||parts.length>20)throw Error('Invalid MCP result reference.');let result=results[step].raw;for(const key of parts){if(!['string','number'].includes(typeof key)||['__proto__','constructor','prototype'].includes(key)||result==null||!Object.hasOwn(result,key))throw Error('MCP result reference was not found.');result=result[key];}return structuredClone(result);}
  return Object.fromEntries(Object.entries(value).map(([k,v])=>{if(['__proto__','constructor','prototype'].includes(k))throw Error('Invalid argument key.');return [k,resolveRefs(v,results)];}));
 }return value;
}
function readOnly(tool){return tool.annotations?.readOnlyHint===true;}
function compactResult(result){
 const text=[];for(const item of result.content||[]){if(item.type==='text')text.push(String(item.text));else if(item.type==='image')text.push('[Image omitted; request structured information or use the existing visual fallback.]');else if(item.type==='resource_link')text.push(JSON.stringify({uri:item.uri,name:item.name}));}
 const raw={...result};delete raw.content;
 const full=JSON.stringify({text:text.join('\n'),structuredContent:result.structuredContent});
 return full.length>18000?{text:full.slice(0,18000),truncated:true}:{text:text.join('\n'),...(result.structuredContent!==undefined?{structuredContent:result.structuredContent}:{})};
}
class McpHub{
 constructor({runtimeFile,directory,storage,connector=connectMcp,confirm=async()=>false,onChange=()=>{},roots}={}){
  this.runtimeFile=runtimeFile;this.directory=directory;this.storage=storage;this.connector=connector;this.confirm=confirm;this.onChange=onChange;this.clients=new Map();this.connecting=new Map();this.definitions=new Map();this.errors=new Map();this.secrets={};this.enabled={};this.authorized={};this.roots=roots||['Documents','Desktop','Downloads'].map(x=>path.join(os.homedir(),x)).filter(fs.existsSync);this.ajv=new Ajv({strict:false,allErrors:true,validateFormats:false});this.ajv2020=new Ajv2020({strict:false,allErrors:true,validateFormats:false});this.generation=0;this.controller=new AbortController();
 }
 async init(){this.runtime={};this.checking=new Map();this.authorizing=new Map();this.authUrls=new Map();fs.mkdirSync(this.directory,{recursive:true});const saved=await this.storage?.read();if(saved){this.secrets=saved.secrets||{};this.enabled=saved.enabled||{};this.authorized=saved.authorized||{};if(saved.roots?.length)this.roots=saved.roots;}this.runtime=fs.existsSync(this.runtimeFile)?JSON.parse(fs.readFileSync(this.runtimeFile,'utf8')):{};return this.status();}
 async save(){await this.storage?.write({secrets:this.secrets,enabled:this.enabled,authorized:this.authorized,roots:this.roots});this.changed();}
 changed(){this.onChange(this.status());}
 ready(id){const p=byId(id);if(!p||this.enabled[id]===false)return false;if(id!=='github'&&!this.runtime[id])return false;return !p.fields?.some(([field])=>!this.secrets[id]?.[field]);}
 usable(id){return this.ready(id)&&(!['google','spotify'].includes(id)||this.authorized[id]===true);}
 status(){return {priority:true,roots:this.roots,servers:catalog.map(p=>({id:p.id,name:p.name,description:p.description,fields:p.fields||[],help:p.help,setup:p.setup,enabled:this.enabled[p.id]!==false,configured:!!this.ready(p.id),status:this.enabled[p.id]===false?'disabled':!this.runtime[p.id]&&p.id!=='github'?'not_installed':!this.ready(p.id)?'needs_credentials':this.errors.has(p.id)?'error':this.connecting.has(p.id)?'connecting':this.clients.has(p.id)?(['google','spotify'].includes(p.id)&&!this.authorized[p.id]?'needs_authorization':'connected'):'ready',tools:this.definitions.get(p.id)?.length||0,message:this.errors.get(p.id)||'',hasCredentials:!!this.secrets[p.id],email:this.secrets[p.id]?.email||''}))};}
 async configure(id,values){const p=byId(id);if(!p||!values||typeof values!=='object')throw Error('Unknown MCP connection.');const next={...this.secrets[id]};for(const [field] of p.fields||[]){if(values[field]!==undefined){if(typeof values[field]!=='string'||values[field].length>8000)throw Error('Invalid credential.');if(values[field].trim())next[field]=values[field].trim();}}
  if(id==='spotify'&&next.clientId&&!/^[a-f\d]{32}$/i.test(next.clientId))throw Error('Spotify Client ID must contain 32 hexadecimal characters.');
  this.secrets[id]=next;this.authorized[id]=false;this.enabled[id]=true;await this.disconnect(id);await this.save();return this.status();}
 async setEnabled(id,value){if(!byId(id)||typeof value!=='boolean')throw Error('Invalid MCP setting.');this.enabled[id]=value;if(!value)await this.disconnect(id);await this.save();return this.status();}
 async setRoots(roots){if(!Array.isArray(roots)||!roots.length||roots.length>12||roots.some(p=>!path.isAbsolute(p)||!fs.statSync(p).isDirectory()))throw Error('Choose existing local folders.');this.roots=[...new Set(roots)];await Promise.all(['filesystem','desktop','excel'].map(id=>this.disconnect(id)));await this.save();}
 spec(id){
  const credentials=this.secrets[id]||{},state=path.join(this.directory,id);fs.mkdirSync(state,{recursive:true});
  if(id==='github')return {url:'https://api.githubcopilot.com/mcp/',headers:{Authorization:'Bearer '+credentials.token,'X-MCP-Toolsets':'all'}};
  const base=this.runtime[id];if(!base)throw Error('MCP runtime is not installed.');const env={SystemRoot:process.env.SystemRoot||'',PATH:process.env.PATH||'',TEMP:process.env.TEMP||'',TMP:process.env.TMP||'',APPDATA:process.env.APPDATA||'',LOCALAPPDATA:process.env.LOCALAPPDATA||'',USERPROFILE:os.homedir(),MITCH_MCP_STATE_DIR:state,DO_NOT_TRACK:'1',DNT:'1'};
  const spec={command:base.command,args:[...base.args],cwd:state,env};
  if(id==='filesystem')spec.args.push(...this.roots);
  if(id==='excel')for(const root of this.roots)spec.args.push('--allow-dir',root);
  if(id==='desktop'){fs.writeFileSync(path.join(state,'config.json'),JSON.stringify({allowedDirectories:this.roots,telemetryEnabled:false,pendingWelcomeOnboarding:false,welcomeOnboardingEligible:false,defaultShell:'powershell.exe',blockedCommands:['format','diskpart','shutdown','bcdedit','runas','cipher','takeown']}));}
  if(id==='playwright')spec.args.push('--browser','msedge','--user-data-dir',path.join(state,'profile'),'--output-dir',path.join(state,'output'));
  if(id==='google')Object.assign(env,{GOOGLE_OAUTH_CLIENT_ID:credentials.clientId,GOOGLE_OAUTH_CLIENT_SECRET:credentials.clientSecret,USER_GOOGLE_EMAIL:credentials.email,WORKSPACE_MCP_CREDENTIALS_DIR:state,WORKSPACE_MCP_LOG_DIR:path.join(state,'logs'),WORKSPACE_ATTACHMENT_DIR:path.join(state,'attachments'),WORKSPACE_MCP_PORT:'22142',WORKSPACE_MCP_HOST:'127.0.0.1',GOOGLE_OAUTH_REDIRECT_URI:'http://localhost:22142/oauth2callback',MITCH_MCP_EXPLICIT_AUTH_ONLY:'1',MITCH_MCP_NO_AUTO_BROWSER:'1'});
  if(id==='spotify')Object.assign(env,{SPOTIFY_CLIENT_ID:credentials.clientId,SPOTIFY_REDIRECT_PORT:'8888'});
  return spec;
 }
 async connect(id,signal){
  if(!this.ready(id))throw Error('Connection needs setup in Settings → MCP connections.');if(this.clients.has(id))return this.clients.get(id);if(this.connecting.has(id))return this.connecting.get(id);
  const generation=this.generation,joined=AbortSignal.any([this.controller.signal,...(signal?[signal]:[])]);
  const pending=(async()=>{let client;try{client=await this.connector(this.spec(id),{roots:this.roots,signal:joined});const list=await client.list(joined);joined.throwIfAborted();if(generation!==this.generation)throw Error('Connection cancelled.');const definitions=list.filter(t=>permitted(id,t.name)).map(t=>({...t,validate:(t.inputSchema?.$schema?.includes('2020-12')?this.ajv2020:this.ajv).compile(t.inputSchema||{type:'object'})}));this.definitions.set(id,definitions);this.clients.set(id,client);this.errors.delete(id);return client;}catch(e){await client?.close().catch(()=>{});this.errors.set(id,'Connection failed. Check installation, credentials and account permissions.');throw Error(this.errors.get(id),{cause:e});}finally{this.connecting.delete(id);this.changed();}})();this.connecting.set(id,pending);this.changed();return pending;
 }
 async disconnect(id){await this.connecting.get(id)?.catch(()=>{});const client=this.clients.get(id);this.clients.delete(id);this.definitions.delete(id);this.errors.delete(id);this.authUrls?.delete(id);await client?.close().catch(()=>{});this.changed();}
 candidates(text){return catalog.filter(p=>this.usable(p.id)&&p.match.test(text)).sort((a,b)=>b.priority-a.priority);}
 shouldPrefer(text){return this.candidates(text).length>0||desktopRequest(text)&&catalog.some(p=>this.usable(p.id));}
 async prepare(text,signal){const candidates=this.candidates(text).slice(0,3);await Promise.all(candidates.map(p=>this.connect(p.id,signal).catch(()=>{})));signal?.throwIfAborted();const connected=candidates.filter(p=>this.clients.has(p.id));return {prefer:connected.length>0||(!candidates.length&&this.shouldPrefer(text)),roots:this.roots,tools:this.describe(text,connected.map(p=>p.id),18),servers:this.status().servers.map(({id,status,description})=>({id,status,description})),ui:false,uncertain:false};}
 describe(query,ids,limit=18){const all=(ids||[...this.clients.keys()]).flatMap(id=>(this.definitions.get(id)||[]).map(t=>({...t,server:id})));return rankTools(all,query).slice(0,limit).map(({server,name,description,inputSchema,annotations})=>({server,name,description:String(description||'').slice(0,1600),inputSchema,readOnly:annotations?.readOnlyHint===true}));}
 async discover({query,server},context={}){context.assertActive?.();const ids=server?(this.usable(server)?[server]:[]):catalog.filter(p=>this.usable(p.id)).map(p=>p.id);await Promise.all(ids.map(id=>this.connect(id,context.signal).catch(()=>{})));context.assertActive?.();const tools=this.describe(query,ids,25);return {status:'ok',roots:this.roots,tools,servers:this.status().servers.map(({id,status,description})=>({id,status,description}))};}
 async execute({steps},context={}){
  const receipts=[],results=[],recovered=new Set();
  for(let index=0;index<steps.length;index++){
   context.assertActive?.();context.signal?.throwIfAborted();const step=steps[index];let client,tool,args;
   if(!this.usable(step.server))return {...fail('This MCP needs account authorization or is disabled. Connect it in Settings.'),failed_step:index,receipts};
   try{client=await this.connect(step.server,context.signal);tool=this.definitions.get(step.server)?.find(t=>t.name===step.tool);if(!tool)throw Error('Unknown or unavailable MCP tool; discover its schema first.');args=resolveRefs(step.arguments||{},results);if(!tool.validate(args))throw Error('Arguments do not match the discovered MCP schema: '+this.ajv.errorsText(tool.validate.errors));}catch(e){return {...fail(e.message,'mcp_preflight_failed'),failed_step:index,receipts};}
   const sensitive=/\b(delete|remove|send|publish|post|invite|merge|push|release|share|transfer|purchase|buy|call)\b/i.test(step.tool.replaceAll('_',' ')+' '+(step.server==='playwright'?String(args.element||''):''));
   const terminal=step.server==='desktop'&&['start_process','interact_with_process','execute_code'].includes(step.tool)||step.server==='playwright'&&/evaluate|run_code/.test(step.tool);
   if((sensitive||terminal)&&!await this.confirm({labels:[byId(step.server).name+': '+step.tool+(terminal?' — '+String(args.command||args.code||args.input||'').slice(0,600):'')]},context))return {status:'refused',code:'confirmation_required',message:'The action was not approved. No further operations were sent.',stop_task:true,action_attempted:false,receipts};
   context.assertActive?.();context.signal?.throwIfAborted();const started=performance.now();let raw;
   try{raw=await client.call(step.tool,args,context.signal,30000);}catch(e){const uncertain=!readOnly(tool);return {status:'error',code:uncertain?'mcp_outcome_unknown':'mcp_read_failed',message:uncertain?'The MCP action may have been delivered, but its result was lost. I stopped without repeating it.':'The MCP read failed. Its connection may need to be reopened.',action_attempted:uncertain,outcome_unknown:uncertain,stop_task:uncertain,fallback_allowed:!uncertain,failed_step:index,receipts};}
   let recovery;
   if(raw.isError&&needsDevice(step.server,raw)&&!recovered.has(step.server)){
    recovered.add(step.server);
    try{recovery=await recoverDevice(client,context);}catch(e){context.signal?.throwIfAborted();recovery={attempted:true,ready:false,reason:'Could not make a playback device available.'};}
    if(recovery.ready){
     context.assertActive?.();context.signal?.throwIfAborted();
     try{raw=await client.call(step.tool,args,context.signal,30000);}catch{ return {status:'error',code:'mcp_outcome_unknown',failed_step:index,receipts,action_attempted:true,outcome_unknown:true,stop_task:true,fallback_allowed:false,message:'Spotify became available, but the playback response was lost. I stopped without repeating it.'};}
    }
   }
   const receipt={server:step.server,tool:step.tool,ms:Math.round(performance.now()-started),...compactResult(raw),...(recovery?{recovery}:{} )};receipts.push(receipt);results.push({raw});
   if(raw.isError){const notApplied=confirmedNotApplied(step.server,raw),uncertain=!readOnly(tool)&&!notApplied,detail=failureDetail(raw);return {status:'error',code:notApplied?'mcp_action_not_applied':'mcp_tool_error',receipts,failed_step:index,action_attempted:uncertain,outcome_unknown:uncertain,stop_task:uncertain||recovery?.attempted===true,fallback_allowed:!uncertain&&!recovery?.attempted,retry_requires_change:notApplied,message:byId(step.server).name+': '+(detail||'The operation failed.')+(recovery?.attempted&&!recovery.ready?' '+recovery.reason:uncertain?' Its outcome is uncertain, so I stopped without repeating it.':'')};}
  }
  return {status:'completed',source:'mcp',receipts,operations_completed:receipts.length,message:'These are the server responses for the completed operations. Determine the user-facing outcome from their contents.'};
 }
 hasAccountSession(id){
  try{const name=id==='google'?encodeURIComponent(this.secrets.google?.email||'').replace(/%40/g,'@')+'.json':'tokens.json';const value=JSON.parse(fs.readFileSync(path.join(this.directory,id,name),'utf8'));return !!value.refresh_token&&(id!=='google'||value.client_id===this.secrets.google?.clientId);}catch{return false;}
 }
 async check(id){
  this.checking||=new Map();if(this.checking.has(id))return this.checking.get(id);
  const pending=(async()=>{try{
   if(['google','spotify'].includes(id)&&!this.hasAccountSession(id))throw Error('Account authorization is needed. Click Authorize account; checking never opens sign-in.');
   const client=await this.connect(id);
   if(id==='spotify'){const r=await client.call('now_playing',{},this.controller.signal,15000);if(r.isError)throw Error('Spotify needs account authorization.');}
   if(id==='google'){const r=await client.call('list_calendars',{user_google_email:this.secrets[id].email},this.controller.signal,15000);const text=(r.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');if(r.isError||! /^(Successfully listed \d+ calendars for |No calendars (found|on this page) for )/.test(text))throw Error('Google connection could not be verified. Complete authorization or check Calendar access.');}
   if(['google','spotify'].includes(id)){this.authorized[id]=true;this.authUrls?.delete(id);this.errors.delete(id);await this.save();}return this.status();
  }catch(e){if(['google','spotify'].includes(id)){this.authorized[id]=false;this.errors.set(id,e.message);await this.save();}throw e;}finally{this.checking.delete(id);}})();
  this.checking.set(id,pending);return pending;
 }
 async authorize(id,openBrowser){
  if(!['google','spotify'].includes(id))throw Error('This connection does not use browser authorization.');
  this.authorizing||=new Map();this.authUrls||=new Map();if(this.authorizing.has(id))return this.authorizing.get(id);
  const cached=this.authUrls.get(id);if(cached&&Date.now()-cached.created<600000)return {status:'authorization_pending',message:'Sign-in is already open. Complete it, then click Check connection.'};
  const pending=(async()=>{try{const client=await this.connect(id);
   if(id==='spotify'){const r=await client.call('authenticate',{},this.controller.signal,310000);if(r.isError)throw Error('Spotify authorization failed.');return this.check(id);}
   const r=await client.call('start_google_auth',{service_name:'drive',user_google_email:this.secrets.google.email},this.controller.signal,30000);
   const text=(r.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'),url=text.match(/https:\/\/accounts\.google\.com\/[^\s<>"\)]+/)?.[0];
   if(r.isError||!url)throw Error('Google did not provide a sign-in link. Check the OAuth client and redirect URI.');
   this.authUrls.set(id,{url,created:Date.now()});await openBrowser(url);return {status:'authorization_opened',message:'Complete Google sign-in, then click Check connection.'};
  }finally{this.authorizing.delete(id);}})();this.authorizing.set(id,pending);return pending;
 }
 async close(){this.generation++;this.controller.abort();await Promise.allSettled([...this.connecting.values()]);await Promise.allSettled([...this.clients.values()].map(c=>c.close()));this.clients.clear();this.definitions.clear();this.controller=new AbortController();this.changed();}
}
module.exports={McpHub,resolveRefs,rankTools,compactResult};
