'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {McpHub,resolveRefs}=require('../mcp-hub'),{validateTool}=require('../core');
function harness(t,{call=async()=>({content:[{type:'text',text:'done'}]}),confirm=async()=>true}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mitch-mcp-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let starts=0,closes=0,saved;const calls=[];
 const hub=new McpHub({directory,runtimeFile:path.join(directory,'missing'),roots:[directory],confirm,storage:{read:async()=>null,write:async value=>{saved=value;}},connector:async()=>{starts++;return {list:async()=>[
  {name:'read',description:'read a file',annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
  {name:'write',description:'write a file',inputSchema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},
  {name:'delete_file',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path']}}
 ],call:async(name,args,signal)=>{calls.push({name,args,signal});return call(name,args,signal);},close:async()=>{closes++;}};}});
 t.after(()=>hub.close());hub.runtime={filesystem:{command:'node',args:[]}};
 return {hub,calls,get starts(){return starts;},get closes(){return closes;},get saved(){return saved;}};
}
const step=(tool,args)=>({server:'filesystem',tool,arguments:args});
test('MCP connection and discovered validators are reused; batch data references use actual results',async t=>{
 const h=harness(t,{call:async name=>name==='read'?{content:[],structuredContent:{id:'observed.txt'}}:{content:[{type:'text',text:'written'}]}});
 await Promise.all([h.hub.connect('filesystem'),h.hub.connect('filesystem')]);assert.equal(h.starts,1);
 const args={steps:[step('read',{path:'source'}),step('write',{path:{$mcp_ref:{step:0,path:['structuredContent','id']}},content:'hello'})]};validateTool('mcp_execute',args);
 const r=await h.hub.execute(args);assert.equal(r.status,'completed');assert.equal(h.starts,1);assert.equal(h.calls[1].args.path,'observed.txt');assert.equal(r.receipts.length,2);
});
test('server schema errors and invented tools are rejected before delivery',async t=>{
 const h=harness(t);for(const s of [step('write',{path:'x',content:17}),step('invented',{})]){const r=await h.hub.execute({steps:[s]});assert.equal(r.action_attempted,false);assert.equal(r.fallback_allowed,true);}assert.equal(h.calls.length,0);
});
test('uncertain write stops the batch and is never retried',async t=>{
 const h=harness(t,{call:async()=>{throw Error('lost connection');}});const r=await h.hub.execute({steps:[step('write',{path:'x',content:'x'}),step('write',{path:'y',content:'y'})]});assert.equal(h.calls.length,1);assert.equal(r.outcome_unknown,true);assert.equal(r.stop_task,true);assert.equal(r.fallback_allowed,false);
});
test('read failures permit a fallback; successful preceding writes remain recorded',async t=>{
 const h=harness(t,{call:async name=>{if(name==='read')throw Error('offline');return {content:[{type:'text',text:'written'}]};}});const r=await h.hub.execute({steps:[step('write',{path:'x',content:'x'}),step('read',{path:'x'})]});assert.equal(r.fallback_allowed,true);assert.equal(r.receipts.length,1);assert.equal(r.failed_step,1);
});
test('Stop between steps prevents the next operation',async t=>{
 const controller=new AbortController();const h=harness(t,{call:async()=>{controller.abort();return {content:[]};}});await assert.rejects(h.hub.execute({steps:[step('write',{path:'x',content:'x'}),step('read',{path:'x'})]},{signal:controller.signal}));assert.equal(h.calls.length,1);
});
test('denied consequential operation never reaches the MCP server',async t=>{
 const h=harness(t,{confirm:async()=>false});const r=await h.hub.execute({steps:[step('delete_file',{path:'x'})]});assert.equal(r.stop_task,true);assert.equal(h.calls.length,0);
});
test('credential values never appear in public state, and disabled providers are not preferred',async t=>{
 const h=harness(t);await h.hub.configure('github',{token:'private-token'});assert.ok(!JSON.stringify(h.hub.status()).includes('private-token'));assert.equal(h.saved.secrets.github.token,'private-token');assert.equal(h.hub.shouldPrefer('List GitHub repositories'),true);await h.hub.setEnabled('github',false);assert.equal(h.hub.shouldPrefer('List GitHub repositories'),false);
});
test('invalid references cannot access prototypes, future steps or fabricated values',()=>{
 for(const ref of [{step:1,path:[]},{step:0,path:['__proto__']},{step:0,path:['missing']}])assert.throws(()=>resolveRefs({$mcp_ref:ref},[{raw:{}}]));
});
test('checking Google without a local account session never starts a provider or OAuth',async t=>{
 const h=harness(t);h.hub.runtime.google={command:'unused',args:[]};h.hub.secrets.google={email:'user@example.com',clientId:'client',clientSecret:'secret'};
 for(let i=0;i<10;i++)await assert.rejects(h.hub.check('google'),/authorization is needed/);
 assert.equal(h.starts,0);assert.equal(h.calls.length,0);assert.equal(h.hub.authorized.google,false);
});
test('Google checks require positive evidence and never mistake auth/error text for success',async t=>{
 const h=harness(t);h.hub.runtime.google={command:'unused',args:[]};h.hub.secrets.google={email:'user@example.com',clientId:'client',clientSecret:'secret'};
 const dir=path.join(h.hub.directory,'google');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'user@example.com.json'),JSON.stringify({refresh_token:'test',client_id:'client'}));
 let response='Error: Calendar API is unavailable';h.hub.clients.set('google',{call:async()=>({content:[{type:'text',text:response}]}),close:async()=>{}});
 await assert.rejects(h.hub.check('google'),/could not be verified/);assert.equal(h.hub.authorized.google,false);
 response='Successfully listed 1 calendars for user@example.com:\nTest';await h.hub.check('google');assert.equal(h.hub.authorized.google,true);
 response='ACTION REQUIRED: authorize again';await assert.rejects(h.hub.check('google'));assert.equal(h.hub.authorized.google,false);
});
test('concurrent and repeated authorization requests produce only one Google sign-in handoff',async t=>{
 const h=harness(t);h.hub.runtime.google={command:'unused',args:[]};h.hub.secrets.google={email:'user@example.com',clientId:'client',clientSecret:'secret'};
 let calls=0,opens=0;h.hub.clients.set('google',{call:async()=>{calls++;await new Promise(r=>setImmediate(r));return {content:[{type:'text',text:'Authorization URL: https://accounts.google.com/o/oauth2/auth?state=test'}]};},close:async()=>{}});
 const open=async()=>{opens++;};await Promise.all([h.hub.authorize('google',open),h.hub.authorize('google',open)]);await h.hub.authorize('google',open);
 assert.equal(calls,1);assert.equal(opens,1);assert.equal(h.hub.spec('google').env.MITCH_MCP_EXPLICIT_AUTH_ONLY,'1');assert.equal(h.hub.spec('google').env.MITCH_MCP_NO_AUTO_BROWSER,'1');
});
test('a rejected playback is retried once only after the device becomes available',async t=>{
 const h=harness(t);h.hub.runtime.spotify={command:'unused',args:[]};h.hub.secrets.spotify={clientId:'a'.repeat(32)};h.hub.authorized.spotify=true;
 let plays=0,reads=0,launches=0;const notApplied={isError:true,content:[{type:'text',text:'No Spotify devices are available.'}],structuredContent:{mitchExecution:{version:1,outcome:'not_applied',writes:1,accepted:0,unknown:0,reason:'device_unavailable'}}};
 h.hub.definitions.set('spotify',[{name:'play',validate:()=>true}]);h.hub.clients.set('spotify',{close:async()=>{},call:async name=>{if(name==='devices'){reads++;return {content:[{type:'text',text:'Available devices:\nDesktop'}]};}plays++;return plays===1?notApplied:{content:[{type:'text',text:'Now playing requested track'}]};}});
 const r=await h.hub.execute({steps:[{server:'spotify',tool:'play',arguments:{query:'any requested song'}}]},{dispatchChild:async(name,args)=>{validateTool(name,args);if(name==='list_apps')return {apps:[{name:'Spotify',app_id:'id'}]};launches++;return {status:'opened'};}});
 assert.equal(r.status,'completed');assert.equal(plays,2);assert.equal(reads,1);assert.equal(launches,1);assert.equal(r.receipts[0].recovery.ready,true);
});
test('provider errors without write evidence remain uncertain and expose the actual cause',async t=>{
 const h=harness(t,{call:async()=>({isError:true,content:[{type:'text',text:'Specific provider failure'}]})});const r=await h.hub.execute({steps:[step('write',{path:'x',content:'x'})]},{dispatchChild:()=>assert.fail('No UI retry for unknown outcomes')});assert.equal(r.outcome_unknown,true);assert.match(r.message,/Specific provider failure/);assert.equal(h.calls.length,1);
});
