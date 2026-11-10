'use strict';
const {test,before}=require('node:test'),assert=require('node:assert/strict');
const {ChatGPTAuth,ISSUER,AUTHORIZE,TOKEN,DISCOVERY,RESOURCE,SCOPES}=require('../chatgpt-auth');
let jose,key,jwk;before(async()=>{jose=await import('jose');key=await jose.generateKeyPair('RS256');jwk={...await jose.exportJWK(key.publicKey),kid:'fixture',alg:'RS256',use:'sig'};});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture(options={}){
  let stored=options.stored||null,authorize,openedResolve;const opened=new Promise(resolve=>openedResolve=resolve),requests=[];
  const f={requests,opened,get stored(){return stored},get authorize(){return authorize},mode:'valid',subject:'subject-one',tokenCount:0};
  const storage={read:async()=>structuredClone(stored),write:async value=>{if(f.failSave)throw Error('storage unavailable');stored=structuredClone(value);}};
  const fetcher=async(url,init={})=>{
    requests.push({url,method:init.method,body:init.body?new URLSearchParams(init.body):null});
    if(url===DISCOVERY)return json({issuer:ISSUER,authorization_endpoint:AUTHORIZE,token_endpoint:TOKEN,jwks_uri:ISSUER+'/.well-known/jwks.json',revocation_endpoint:ISSUER+'/oauth/revoke'});
    if(url===ISSUER+'/.well-known/jwks.json')return json({keys:[jwk]});
    if(url===ISSUER+'/oauth/revoke'){if(f.revokeFails)throw Error('offline');return new Response(null,{status:200});}
    if(url===RESOURCE+'/models')return json({models:f.models||[{slug:'fixture-fast',display_name:'Fixture fast',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hide'},{slug:'fixture-smart',display_name:'Fixture smart',visibility:'list'}]});
    assert.equal(url,TOKEN);const fields=new URLSearchParams(init.body);f.tokenCount++;
    if(fields.get('grant_type')==='refresh_token'){
      if(f.refreshGate)await f.refreshGate;if(f.refreshError)return json({error:f.refreshError},400);
      return json({access_token:'refreshed-access',refresh_token:'rotated-refresh',token_type:'Bearer',expires_in:3600});
    }
    const claims={sub:f.subject,nonce:authorize.searchParams.get('nonce'),email:'fixture@example.invalid',...(f.claims||{})};
    const id=await new jose.SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(ISSUER).setAudience(fields.get('client_id')).setIssuedAt().setExpirationTime('5m').sign(key.privateKey);
    if(f.exchangeError)return json({error:f.exchangeError},400);
    return json({id_token:id,access_token:'fixture-access',refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600,scope:f.scope??SCOPES});
  };
  f.auth=new ChatGPTAuth({storage,fetcher,openBrowser:async url=>{authorize=new URL(url);openedResolve(authorize);},timeoutMs:2000,...options.authOptions});return f;
}
async function start(f,options){await f.auth.init();const pending=f.auth.signIn(options);pending.catch(()=>{});await f.opened;return {pending,url:f.authorize};}
async function callback(f,params={}){const url=new URL(f.authorize.searchParams.get('redirect_uri'));for(const [name,value]of Object.entries({state:f.authorize.searchParams.get('state'),code:'fixture-code',client_id:'oaiapp_fixture',...params})){if(value!==null)url.searchParams.set(name,value);}return fetch(url,{redirect:'error'});}
async function signed(f=fixture()){const {pending}=await start(f);const response=await callback(f);assert.equal(response.status,200);await pending;return f;}

test('real signed OAuth callback uses dynamic client registration, PKCE and a loopback URI',async()=>{
  const f=await signed(),a=f.authorize.searchParams;
  assert.equal(f.authorize.origin,ISSUER);assert.equal(a.get('client_id'),'dynamic_agent_client');assert.equal(a.get('agent_name_hint'),'Mitch');assert.equal(a.get('code_challenge_method'),'S256');assert.equal(a.get('resource'),RESOURCE);assert.equal(a.get('scope'),SCOPES);
  const callbackURL=new URL(a.get('redirect_uri'));assert.equal(callbackURL.hostname,'127.0.0.1');assert.equal(callbackURL.pathname,'/auth/callback');assert.ok(Number(callbackURL.port)>0);
  const exchange=f.requests.find(r=>r.url===TOKEN).body;assert.equal(exchange.get('client_id'),'oaiapp_fixture');assert.equal(exchange.get('redirect_uri'),callbackURL.href);assert.equal(exchange.get('client_secret'),null);
  assert.equal(require('node:crypto').createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),a.get('code_challenge'));
  assert.equal(f.auth.publicState().planUsage,true);assert.equal(f.stored.accounts[0].subject,'subject-one');assert.equal(await f.auth.access(),'fixture-access');
  const publicJSON=JSON.stringify(f.auth.publicState());for(const secret of ['fixture-access','fixture-refresh',f.stored.accounts[0].idToken,'oaiapp_fixture'])assert.ok(!publicJSON.includes(secret));
});
test('mismatched and duplicated callback states never exchange a code',async()=>{
  const f=fixture(),{pending}=await start(f);const bad=await callback(f,{state:'wrong'});assert.equal(bad.status,400);assert.equal(f.tokenCount,0);
  f.auth.cancelSignIn();await assert.rejects(pending,{code:'sign_in_cancelled'});
});
test('denied consent validates the callback and preserves the prior account',async()=>{
  const f=fixture(),{pending}=await start(f);const r=await callback(f,{error:'access_denied',code:null});assert.equal(r.status,400);await assert.rejects(pending,{code:'access_denied'});assert.equal(f.tokenCount,0);assert.equal(f.stored.activeId,null);
});
test('wrong nonce rejects a validly signed identity without activating its registration',async()=>{
  const f=fixture();f.claims={nonce:'wrong'};const {pending}=await start(f);await callback(f);await assert.rejects(pending,{code:'invalid_identity'});assert.equal(f.stored.activeId,null);assert.equal(f.stored.accounts[0].clientId,'oaiapp_fixture');assert.equal(f.stored.accounts[0].accessToken,undefined);
});
test('identity verification rejects invalid signature, expired JWT, issuer, audience and future issued-at',async()=>{
  const f=fixture();await f.auth.init();const other=await jose.generateKeyPair('RS256');
  for(const [claims,signer]of [[{},other.privateKey],[{exp:1},key.privateKey],[{iss:'https://evil.invalid'},key.privateKey],[{aud:'another-client'},key.privateKey],[{iat:Math.floor(Date.now()/1000)+1000},key.privateKey]]){
    const token=await new jose.SignJWT({iss:ISSUER,aud:'oaiapp_fixture',sub:'subject-one',nonce:'nonce',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+100,...claims}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(signer);
    await assert.rejects(f.auth.verifyIdentity(token,'oaiapp_fixture',{nonce:'nonce'}));
  }
});
test('identity-only permission stays signed in but cannot use inference',async()=>{
  const f=fixture();f.scope='openid profile email offline_access';await signed(f);assert.equal(f.auth.publicState().connected,true);assert.equal(f.auth.publicState().planUsage,false);await assert.rejects(f.auth.access(),{code:'plan_permission_required'});
});
test('first callback must issue a real client ID, never dynamic_agent_client',async()=>{
  for(const client of [null,'dynamic_agent_client']){const f=fixture(),{pending}=await start(f);await callback(f,{client_id:client});await assert.rejects(pending,{code:'invalid_callback'});assert.equal(f.tokenCount,0);}
});
test('returning sign-in reuses the host/client and rejects a different callback client',async()=>{
  const initial=await signed(),saved=initial.stored,id=saved.activeId,f=fixture({stored:saved});const {pending}=await start(f,{accountId:id});
  assert.equal(f.authorize.searchParams.get('client_id'),'oaiapp_fixture');assert.equal(f.authorize.searchParams.get('agent_name_hint'),null);assert.equal(f.authorize.searchParams.get('ext_agent_host_id'),saved.hostId);assert.equal(f.authorize.searchParams.get('id_token_hint'),saved.accounts[0].idToken);
  await callback(f,{client_id:'oaiapp_different'});await assert.rejects(pending,{code:'invalid_callback'});assert.equal(f.stored.activeId,id);assert.equal(f.stored.accounts[0].accessToken,'fixture-access');
});
test('returning sign-in rejects a different verified subject and accepts omitted callback client ID',async()=>{
  const first=await signed();for(const subject of ['another-subject','subject-one']){const f=fixture({stored:first.stored});f.subject=subject;const {pending}=await start(f,{accountId:first.stored.activeId});await callback(f,{client_id:null});if(subject==='another-subject')await assert.rejects(pending,{code:'invalid_identity'});else assert.equal((await pending).connected,true);}
});
test('invalid_grant retains the issued client registration for an explicit reconnect',async()=>{
  const f=fixture();f.exchangeError='invalid_grant';const {pending}=await start(f);await callback(f);await assert.rejects(pending,{code:'invalid_grant'});assert.equal(f.stored.accounts[0].clientId,'oaiapp_fixture');assert.equal(f.stored.activeId,null);
});
test('refresh is serialized, rotates credentials atomically, and keeps the original scopes',async()=>{
  const f=await signed();f.auth.active().expiresAt=Date.now()-1;const before=f.tokenCount;const result=await Promise.all([f.auth.access(),f.auth.access(),f.auth.access()]);assert.deepEqual(result,['refreshed-access','refreshed-access','refreshed-access']);assert.equal(f.tokenCount-before,1);assert.equal(f.stored.accounts[0].refreshToken,'rotated-refresh');assert.ok(f.stored.accounts[0].scopes.includes('chatgpt.tokens.use.direct'));
  const request=f.requests.filter(r=>r.url===TOKEN).at(-1).body;assert.equal(request.get('client_id'),'oaiapp_fixture');assert.equal(request.has('scope'),false);assert.equal(request.get('resource'),RESOURCE);
});
test('terminal refresh failure clears unusable tokens, while temporary failures preserve them',async()=>{
  for(const code of ['invalid_grant','temporary_failure']){const f=await signed();f.auth.active().expiresAt=0;f.refreshError=code;await assert.rejects(f.auth.access());assert.equal(!!f.auth.active().accessToken,code!=='invalid_grant');assert.equal(f.auth.active().clientId,'oaiapp_fixture');}
});
test('disconnect revokes the renewable session and retains account and host registration',async()=>{
  const f=await signed(),host=f.stored.hostId,id=f.stored.activeId;await f.auth.disconnect();const revoke=f.requests.find(r=>r.url===ISSUER+'/oauth/revoke');assert.equal(revoke.body.get('token'),'fixture-refresh');assert.equal(revoke.body.get('client_id'),'oaiapp_fixture');assert.equal(f.stored.hostId,host);assert.equal(f.stored.accounts[0].id,id);assert.equal(f.stored.accounts[0].accessToken,undefined);assert.equal(f.auth.publicState().connected,false);
});
test('disconnect reports unconfirmed revocation without retaining local tokens',async()=>{
  const f=await signed();f.revokeFails=true;const state=await f.auth.disconnect();assert.match(state.message,/not confirmed/);assert.equal(f.stored.accounts[0].refreshToken,undefined);
});
test('account catalog uses slugs/display names and selections are isolated per account',async()=>{
  const f=await signed();await f.auth.catalog();assert.deepEqual(f.auth.publicState().models.map(m=>m.id),['fixture-fast','fixture-smart']);await f.auth.select({mode:'smart',model:'fixture-smart',transport:'auto'});assert.equal(f.auth.model(),'fixture-smart');
  const first=f.auth.data.activeId,second={...structuredClone(f.auth.active()),id:'second-account',subject:'subject-two',clientId:'oaiapp_second',preferences:{fast:'fixture-fast'},mode:'fast'};f.auth.data.accounts.push(second);const lease=f.auth.lease();await f.auth.switchAccount(second.id);assert.throws(()=>f.auth.check(lease),{code:'account_changed'});assert.deepEqual(f.auth.publicState().models,[]);await f.auth.catalog();assert.equal(f.auth.model(),'fixture-fast');await f.auth.switchAccount(first);assert.equal(f.auth.model(),'fixture-smart');
});
test('a removed preferred model is not silently substituted and arbitrary models are rejected',async()=>{
  const f=await signed();await f.auth.catalog();await f.auth.select({model:'fixture-smart'});f.models=[{slug:'fixture-fast',display_name:'Fixture fast',visibility:'list'}];await f.auth.catalog();assert.equal(f.auth.model(),'fixture-smart');await assert.rejects(f.auth.select({model:'invented-model'}),{code:'model_unavailable'});
});
test('a usage pause persists across restart and is cleared only by an explicit resume',async()=>{
  const f=await signed();await f.auth.setUsagePaused(true);
  const next=new ChatGPTAuth({storage:{read:async()=>structuredClone(f.stored),write:async()=>{}},openBrowser:async()=>{}});
  await next.init();assert.equal(next.publicState().status,'usage_limit');assert.equal(next.publicState().usagePaused,true);assert.equal(next.publicState().connected,true);
  await next.setUsagePaused(false);assert.equal(next.publicState().status,'connected');assert.equal(next.publicState().usagePaused,false);
});
test('sign-in timeout closes the listener without storing credentials',async()=>{
  const f=fixture({authOptions:{timeoutMs:25}}),{pending}=await start(f);await assert.rejects(pending,{code:'sign_in_timeout'});assert.equal(f.auth.pending,null);assert.equal(f.stored.accounts.length,0);
});
test('disconnect waits for rotating refresh before revoking the latest token',async()=>{
  const f=await signed();let release;f.refreshGate=new Promise(resolve=>release=resolve);f.auth.active().expiresAt=0;const pending=f.auth.access();pending.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,5));const disconnected=f.auth.disconnect();release();await assert.rejects(pending,{code:'account_changed'});await disconnected;assert.equal(f.requests.find(r=>r.url===ISSUER+'/oauth/revoke').body.get('token'),'rotated-refresh');assert.equal(f.stored.accounts[0].refreshToken,undefined);
});
