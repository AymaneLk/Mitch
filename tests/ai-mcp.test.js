'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {AI}=require('../ai'),{validateTool}=require('../core');
const call=(name,args)=>({output:[{type:'function_call',name,call_id:Math.random().toString(),arguments:JSON.stringify(args)}]});
const answer=text=>({output:[{type:'message',content:[{type:'output_text',text}]}]});
function setup(responses,dispatch){
 const requests=[],calls=[],ai=new AI(()=>({chatProvider:'chatgpt',chatModel:'test',allowDesktop:true,workflowEngine:true,fastExecution:true}),async()=>'',async(name,args,context)=>{validateTool(name,args);calls.push({name,args});return dispatch(name,args,context);});
 ai.mcp={prepare:async()=>({prefer:true,ui:false,tools:[],servers:[]}),shouldPrefer:()=>true};
 ai.prepareContext=async()=>assert.fail('MCP must precede DOM/UIA preparation');ai.request=async(_endpoint,body)=>{requests.push(body);assert.ok(responses.length);return responses.shift();};
 return {ai,calls,requests};
}
test('connected MCP preempts hardcoded fast paths and native/DOM preparation',async()=>{
 const h=setup([call('mcp_execute',{steps:[{server:'filesystem',tool:'create_directory',arguments:{path:'test'}}]}),answer('Created it.')],async()=>({status:'completed',receipts:[{text:'Created directory'}]}));
 assert.equal(await h.ai.chat('Create a folder named test'),'Created it.');assert.deepEqual(h.calls.map(x=>x.name),['mcp_execute']);assert.ok(h.requests[0].tools.every(t=>t.name.startsWith('mcp_')));assert.match(h.requests[0].instructions,/MCP priority/);assert.equal(h.ai.lastTaskTiming.route,'mcp');
});
test('UI fallback requires an explicit capability explanation and retains MCP tools',async()=>{
 const h=setup([call('mcp_use_ui',{reason:'existing_browser_session',explanation:'The requested existing tab is in Opera, outside the Playwright profile.'}),call('list_apps',{query:'Opera'}),answer('Found it.')],async name=>name==='mcp_use_ui'?{status:'fallback_allowed'}:{status:'ok',apps:[]});
 await h.ai.chat('Use the open browser');assert.ok(h.requests[1].tools.some(t=>t.name==='list_apps'));assert.ok(h.requests[1].tools.some(t=>t.name==='mcp_execute'));assert.equal(h.ai.lastTaskTiming.route,'mcp+ui');
});
test('unoffered UI call cannot bypass MCP priority',async()=>{
 const h=setup([call('open_website',{url:'https://example.com'}),answer('Cannot bypass the MCP.')],async()=>assert.fail('UI action must not run'));await h.ai.chat('Open example.com');assert.equal(h.calls.length,0);
});
test('uncertain MCP writes end the task without UI replay or another AI request',async()=>{
 const h=setup([call('mcp_execute',{steps:[{server:'filesystem',tool:'write_file',arguments:{path:'x',content:'x'}}]})],async()=>({status:'error',outcome_unknown:true,stop_task:true,message:'Outcome unknown; stopped.'}));assert.equal(await h.ai.chat('Write a file'),'Outcome unknown; stopped.');assert.equal(h.requests.length,1);assert.equal(h.calls.length,1);
});
