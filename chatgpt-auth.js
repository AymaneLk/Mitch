'use strict';

// Official public-client OAuth. Credentials never cross the renderer bridge.
const http=require('node:http');
const {randomBytes,randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const DISCOVERY=ISSUER+'/.well-known/openid-configuration';
const AUTHORIZE=ISSUER+'/api/accounts/authorize',TOKEN=ISSUER+'/api/accounts/oauth/token';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const TERMINAL_REFRESH=new Set(['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']);
function authError(code,message,status){return Object.assign(new Error(message),{code,...(status?{status}:{})});}
const opaque=(value,max=32768)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x20\x7f]/.test(value);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const random=()=>randomBytes(32).toString('base64url');
const granted=value=>typeof value==='string'?value.split(/\s+/).filter(Boolean):[];
function safeEndpoint(value){const url=new URL(value);if(url.origin!==ISSUER||url.username||url.password||url.hash)throw authError('invalid_discovery','OpenAI returned an unexpected authentication endpoint.');return url.href;}
async function readJSON(response,limit=1048576){
  const text=await response.text();if(Buffer.byteLength(text)>limit)throw authError('invalid_response','The authentication response exceeded its limit.');
  try{return JSON.parse(text);}catch{throw authError('invalid_response','The service did not return a valid response.',response.status);}
}

class ChatGPTAuth{
  constructor({storage,fetcher=fetch,openBrowser,now=Date.now,onChange=()=>{},timeoutMs=300000}={}){
    if(!storage?.read||!storage?.write||typeof openBrowser!=='function')throw new TypeError('Protected storage and a system-browser opener are required.');
    Object.assign(this,{storage,fetch:fetcher,openBrowser,now,onChange,timeoutMs});
    this.data={version:1,hostId:'urn:uuid:'+randomUUID(),activeId:null,accounts:[]};this.epoch=0;this.refreshes=new Map();this.saveQueue=Promise.resolve();this.status='disconnected';this.message='';
  }
  async init(){
    const saved=await this.storage.read();
    if(saved){if(saved.version!==1||!opaque(saved.hostId,160)||!Array.isArray(saved.accounts)||saved.accounts.length>32)throw authError('invalid_storage','Saved ChatGPT connections could not be read.');this.data=saved;}
    else await this.save();
    this.status=this.active()?.accessToken?(this.active()?.usagePaused?'usage_limit':'connected'):'disconnected';
    if(this.status==='usage_limit')this.message='ChatGPT usage limit reached. Check ChatGPT Settings → Usage, then resume requests here.';
    return this.publicState();
  }
  save(){const snapshot=structuredClone(this.data);const next=this.saveQueue.catch(()=>{}).then(()=>this.storage.write(snapshot));this.saveQueue=next;return next;}
  active(){return this.data.accounts.find(account=>account.id===this.data.activeId);}
  emit(){try{this.onChange(this.publicState());}catch{}}
  publicState(){
    const active=this.active();
    return {status:this.status,message:this.message,activeId:this.data.activeId,connected:!!active?.accessToken,planUsage:!!active?.accessToken&&active.scopes?.includes('chatgpt.tokens.use.direct')===true,
      accounts:this.data.accounts.map((a,i)=>({id:a.id,label:`Connection ${i+1}${a.email?' · '+a.email:''}`,email:a.email||'',connected:!!a.accessToken,planUsage:!!a.accessToken&&a.scopes?.includes('chatgpt.tokens.use.direct')===true})),
      models:active?.models||[],selectedModel:this.model(),mode:active?.mode||'fast',preferences:active?.preferences||{},transport:active?.transport||'http',usagePaused:active?.usagePaused===true};
  }
  lease(){const a=this.active();if(!a?.accessToken)throw authError('session_expired','Continue with ChatGPT in Settings to connect your account.');return {id:a.id,epoch:this.epoch};}
  check(lease){if(!lease||lease.id!==this.data.activeId||lease.epoch!==this.epoch)throw authError('account_changed','The ChatGPT account changed. Start a new request.');}
  async discovery(){
    if(this.configuration&&this.now()-this.configurationAt<3600000)return this.configuration;
    const r=await this.fetch(DISCOVERY,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw authError('auth_unavailable','OpenAI sign-in is unavailable. Try again shortly.',r.status);
    const data=await readJSON(r);
    if(data.issuer!==ISSUER||data.authorization_endpoint!==AUTHORIZE||data.token_endpoint!==TOKEN)throw authError('invalid_discovery','OpenAI authentication metadata did not match the documented issuer.');
    safeEndpoint(data.jwks_uri);if(data.revocation_endpoint)safeEndpoint(data.revocation_endpoint);
    this.configuration=data;this.configurationAt=this.now();return data;
  }
  async verifyIdentity(token,clientId,{nonce,subject,refresh=false}={}){
    if(!opaque(token))throw authError('invalid_id_token','OpenAI did not return a valid identity token.');
    const config=await this.discovery(),{jwtVerify,createLocalJWKSet}=await import('jose');
    let identity;
    for(let attempt=0;attempt<2;attempt++){
      if(!this.jwks||this.now()-this.jwksAt>3600000||attempt){
        const r=await this.fetch(config.jwks_uri,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw authError('identity_unavailable','OpenAI identity verification is temporarily unavailable.',r.status);
        const value=await readJSON(r);if(!Array.isArray(value.keys)||value.keys.length>50)throw authError('invalid_id_token','OpenAI signing keys were invalid.');
        this.jwks=createLocalJWKSet(value);this.jwksAt=this.now();
      }
      try{identity=(await jwtVerify(token,this.jwks,{issuer:ISSUER,audience:clientId,algorithms:['RS256','PS256','ES256'],requiredClaims:['sub','exp','iat'],clockTolerance:5,currentDate:new Date(this.now())})).payload;break;}
      catch(error){if(error.code==='ERR_JWKS_NO_MATCHING_KEY'&&!attempt)continue;throw authError('invalid_id_token','OpenAI identity verification failed. Sign in again.');}
    }
    if(!identity||!opaque(identity.sub,512)||!Number.isFinite(identity.iat)||identity.iat>this.now()/1000+5||identity.azp&&identity.azp!==clientId||(!refresh&&!equal(identity.nonce,nonce))||(refresh&&identity.nonce!==undefined&&!equal(identity.nonce,nonce))||subject&&identity.sub!==subject)throw authError('invalid_identity','The signed identity did not match this sign-in attempt or selected account.');
    return identity;
  }
  tokenFields(value,previous){
    if(!opaque(value.access_token)||String(value.token_type).toLowerCase()!=='bearer'||!Number.isFinite(value.expires_in)||value.expires_in<=0||value.expires_in>604800||value.refresh_token!==undefined&&!opaque(value.refresh_token))throw authError('invalid_token_response','OpenAI returned incomplete credentials. Sign in again.');
    return {accessToken:value.access_token,refreshToken:value.refresh_token??previous?.refreshToken??'',idToken:value.id_token??previous?.idToken??'',scopes:value.scope===undefined?(previous?.scopes||[]):granted(value.scope),expiresAt:this.now()+value.expires_in*1000};
  }
  async exchange(fields,signal){
    let response;try{response=await this.fetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}catch(error){signal?.throwIfAborted();throw authError('auth_network_error','Could not reach OpenAI authentication. Your saved connection has been kept.');}
    const data=await readJSON(response);
    if(!response.ok){const code=typeof data.error==='string'?data.error:data.error?.code;throw authError(TERMINAL_REFRESH.has(code)||['invalid_client','access_denied','invalid_scope'].includes(code)?code:'auth_request_failed',code==='invalid_client'?'OpenAI rejected this client registration. Reconnect the account.':code==='access_denied'?'ChatGPT authorization was declined.':'OpenAI could not complete authorization. Reconnect in Settings.',response.status);}
    return data;
  }
  async signIn({accountId,enablePlan=false}={}){
    if(this.pending)throw authError('sign_in_pending','A ChatGPT sign-in is already open in your browser.');
    const account=accountId?this.data.accounts.find(a=>a.id===accountId):null;
    if(accountId&&!account)throw authError('unknown_account','Choose a saved ChatGPT connection.');
    if(!account&&this.data.accounts.length>=32)throw authError('account_limit','The saved connection limit was reached.');
    await this.discovery();
    const attempt={state:random(),nonce:random(),verifier:random(),account,epoch:this.epoch,controller:new AbortController()};
    let resolve,reject;const completion=new Promise((yes,no)=>{resolve=yes;reject=no;});completion.catch(()=>{});
    const finish=(error)=>{
      if(attempt.finished)return;attempt.finished=true;clearTimeout(attempt.timer);attempt.controller.abort();attempt.server?.close();attempt.server?.closeIdleConnections();if(this.pending===attempt)this.pending=null;
      this.status=error?(error.code==='sign_in_cancelled'?(this.active()?.accessToken?'connected':'disconnected'):'error'):(this.active()?.accessToken?'connected':'disconnected');this.message=error?.message||'';this.emit();error?reject(error):resolve(this.publicState());
    };
    attempt.finish=finish;this.pending=attempt;this.status='connecting';this.message='Complete sign-in in your system browser.';this.emit();
    const server=http.createServer(async(req,res)=>{
      const respond=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'"});res.end(text);};
      let url;try{url=new URL(req.url,attempt.redirectUri);}catch{return respond(400,'Invalid callback.');}
      if(req.method!=='GET'||url.pathname!=='/auth/callback')return respond(404,'Not found.');
      if(req.headers.host!==new URL(attempt.redirectUri).host)return respond(400,'Invalid callback host.');
      if(attempt.claimed||attempt.finished)return respond(409,'This sign-in callback has already been used.');
      if(['state','code','client_id','error'].some(key=>url.searchParams.getAll(key).length>1)||!equal(url.searchParams.get('state'),attempt.state))return respond(400,'This callback does not match the pending sign-in.');
      attempt.claimed=true;
      try{
        if(url.searchParams.has('error'))throw authError('access_denied','ChatGPT authorization was declined or cancelled.');
        const code=url.searchParams.get('code'),returnedClient=url.searchParams.get('client_id'),clientId=account?.clientId||returnedClient;
        if(!opaque(code,8192)||!opaque(clientId,256)||clientId==='dynamic_agent_client'||account&&returnedClient&&returnedClient!==account.clientId)throw authError('invalid_callback','OpenAI returned an incomplete or mismatched client registration.');
        // Preserve an issued registration on failed exchange, without treating
        // its unverified identity as connected or changing the active account.
        const registration=account||{id:randomUUID(),clientId,preferences:{},models:[]};
        if(!account){this.data.accounts.push(registration);await this.save();}
        const value=await this.exchange({grant_type:'authorization_code',client_id:clientId,code,code_verifier:attempt.verifier,redirect_uri:attempt.redirectUri,resource:RESOURCE},attempt.controller.signal);
        const identity=await this.verifyIdentity(value.id_token,clientId,{nonce:attempt.nonce,subject:account?.subject});
        const fields=this.tokenFields(value);
        if(attempt.finished||attempt.epoch!==this.epoch)throw authError('account_changed','The account changed during sign-in. Start again.');
        const next={...registration,...fields,subject:identity.sub,issuer:identity.iss,email:typeof identity.email==='string'?identity.email.slice(0,320):'',nonce:attempt.nonce,models:[]};
        const old=structuredClone(this.data);this.data.accounts=this.data.accounts.map(a=>a.id===next.id?next:a);this.data.activeId=next.id;
        try{await this.save();}catch{this.data=old;throw authError('secure_storage_failed','Windows could not securely save the connection. No credentials were written as plain text.');}
        if(attempt.finished||attempt.epoch!==this.epoch)throw authError('account_changed','The account changed during sign-in. Start again.');
        this.epoch++;respond(200,'Mitch is connected. You can close this browser tab and return to Mitch.');finish();
      }catch(error){respond(400,'Mitch could not complete sign-in. Return to Settings for details.');finish(error.code?error:authError('sign_in_failed','ChatGPT sign-in could not be completed. Try again.'));}
    });attempt.server=server;
    server.on('error',()=>finish(authError('callback_unavailable','Mitch could not start its local sign-in callback. Try again.')));
    try{
      await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
      attempt.redirectUri=`http://127.0.0.1:${server.address().port}/auth/callback`;
      const query=new URLSearchParams({client_id:account?.clientId||'dynamic_agent_client',ext_agent_host_id:this.data.hostId,response_type:'code',redirect_uri:attempt.redirectUri,scope:SCOPES,resource:RESOURCE,state:attempt.state,nonce:attempt.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(attempt.verifier).digest('base64url')});
      if(!account)query.set('agent_name_hint','Mitch');
      if(account?.idToken)query.set('id_token_hint',account.idToken);if(account?.email)query.set('login_hint',account.email);if(enablePlan)query.set('prompt','consent');
      attempt.timer=setTimeout(()=>finish(authError('sign_in_timeout','ChatGPT sign-in timed out. Try again.')),this.timeoutMs);
      await this.openBrowser(AUTHORIZE+'?'+query.toString());
    }catch{finish(authError('browser_unavailable','Mitch could not open the system browser for sign-in.'));}
    return completion;
  }
  cancelSignIn(){this.pending?.finish(authError('sign_in_cancelled','Sign-in cancelled.'));}
  async access(lease=this.lease(),{force=false}={}){
    this.check(lease);let account=this.active();
    if(!account.scopes?.includes('chatgpt.tokens.use.direct'))throw authError('plan_permission_required','Your account is connected, but ChatGPT plan usage is not enabled. Enable it in Settings.');
    if(force||account.expiresAt-this.now()<60000){
      if(!this.refreshes.has(account.id)){
        const pending=this.refresh(account,lease);this.refreshes.set(account.id,pending);pending.finally(()=>{if(this.refreshes.get(account.id)===pending)this.refreshes.delete(account.id);}).catch(()=>{});
      }
      await this.refreshes.get(account.id);this.check(lease);account=this.active();
    }
    if(!account?.accessToken||!account.scopes?.includes('chatgpt.tokens.use.direct'))throw authError('session_expired','Your ChatGPT session expired. Reconnect in Settings.');
    return account.accessToken;
  }
  async refresh(account,lease){
    if(!account.refreshToken)throw authError('session_expired','Reconnect your ChatGPT account in Settings.');
    try{
      const data=await this.exchange({grant_type:'refresh_token',client_id:account.clientId,refresh_token:account.refreshToken,resource:RESOURCE});
      if(data.id_token)await this.verifyIdentity(data.id_token,account.clientId,{nonce:account.nonce,subject:account.subject,refresh:true});
      // Preserve rotated tokens even if the user switched accounts while the
      // refresh was in flight. The caller's lease still gates their use.
      if(!this.data.accounts.includes(account))throw authError('account_changed','The saved connection changed during refresh.');
      const fields=this.tokenFields(data,account);Object.assign(account,fields);await this.save();this.emit();
    }catch(error){
      if(TERMINAL_REFRESH.has(error.code)){this.clearTokens(account);await this.save();if(this.data.activeId===account.id){this.status='session_expired';this.message='Your ChatGPT session expired. Reconnect in Settings.';this.epoch++;}this.emit();}
      throw error;
    }
  }
  clearTokens(account){for(const key of ['accessToken','refreshToken','idToken','expiresAt','nonce'])delete account[key];account.models=[];}
  async disconnect(accountId=this.data.activeId){
    this.cancelSignIn();const account=this.data.accounts.find(a=>a.id===accountId);if(!account)return this.publicState();
    this.epoch++;this.status='disconnecting';this.emit();await this.refreshes.get(account.id)?.catch(()=>{});let revoked=!account.refreshToken;
    if(account.refreshToken){
      try{const config=await this.discovery();if(config.revocation_endpoint){for(let attempt=0;attempt<2;attempt++){
        try{const r=await this.fetch(config.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.refreshToken,token_type_hint:'refresh_token',client_id:account.clientId}),redirect:'error',signal:AbortSignal.timeout(10000)});if(r.status===200){revoked=true;break;}if(r.status<500)break;}catch{}
        if(!attempt)await new Promise(resolve=>setTimeout(resolve,300));
      }}}catch{}
    }
    this.clearTokens(account);if(this.data.activeId===account.id)this.data.activeId=null;await this.save();this.status=this.active()?.accessToken?'connected':'disconnected';this.message=revoked?'Disconnected.':'Disconnected locally. Remote revocation was not confirmed; disconnect Mitch in ChatGPT Settings → Apps.';this.emit();return this.publicState();
  }
  async switchAccount(id){
    this.cancelSignIn();const account=this.data.accounts.find(a=>a.id===id);if(!account?.subject||!account.accessToken)throw authError('reconnect_required','Reconnect this saved ChatGPT account first.');
    this.epoch++;this.data.activeId=id;account.models=[];await this.save();this.status='connected';this.message='';this.emit();return this.publicState();
  }
  async catalog(signal){
    const lease=this.lease();let response;
    for(let attempt=0;attempt<2;attempt++){
      const token=await this.access(lease,{force:attempt===1});this.check(lease);
      response=await this.fetch(RESOURCE+'/models',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(response.status!==401||attempt)break;
    }
    this.check(lease);if(!response.ok)throw authError('models_unavailable',`ChatGPT models could not be loaded (HTTP ${response.status}). Reconnect or try again.`,response.status);
    const data=await readJSON(response);this.check(lease);if(!Array.isArray(data.models))throw authError('invalid_catalog','OpenAI returned an unexpected model catalog.');
    const seen=new Set(),models=[];
    for(const model of data.models){if(model.visibility!=='list')continue;if(!opaque(model.slug,160)||typeof model.display_name!=='string'||!model.display_name.trim()||model.display_name.length>200||seen.has(model.slug))throw authError('invalid_catalog','OpenAI returned an invalid model entry.');seen.add(model.slug);models.push({id:model.slug,name:model.display_name});}
    const account=this.active();account.models=models;account.catalogAt=this.now();account.preferences||={};
    for(const mode of ['fast','smart'])if(!account.preferences[mode]&&models[0])account.preferences[mode]=models[0].id;
    await this.save();this.emit();return this.publicState();
  }
  model(){const account=this.active();return account?.preferences?.[account.mode||'fast']||'';}
  async setUsagePaused(paused){const account=this.active();if(!account)return;account.usagePaused=paused===true;await this.save();this.status=paused?'usage_limit':'connected';this.message=paused?'ChatGPT usage limit reached. Check ChatGPT Settings → Usage, then resume requests here.':'';this.emit();}
  async select({mode='fast',model,transport}={}){
    const account=this.active();if(!account)throw authError('session_expired','Connect ChatGPT first.');
    if(!['fast','smart'].includes(mode))throw authError('invalid_mode','Choose Fast or Smart.');
    if(model!==undefined&&!account.models?.some(m=>m.id===model))throw authError('model_unavailable','Choose a model available to this account. Refresh the model list if needed.');
    if(transport!==undefined&&!['http','auto','websocket'].includes(transport))throw authError('invalid_transport','Invalid connection mode.');
    account.mode=mode;if(model!==undefined)(account.preferences||={})[mode]=model;if(transport!==undefined)account.transport=transport;await this.save();this.emit();return this.publicState();
  }
  close(){this.cancelSignIn();this.epoch++;}
}
module.exports={ChatGPTAuth,authError,ISSUER,RESOURCE,AUTHORIZE,TOKEN,DISCOVERY,SCOPES,readJSON};
