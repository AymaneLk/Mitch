'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),g=require('../goal-contract');
const copy=x=>structuredClone(x);
const control=(name,value,extra={})=>({id:name,name,role:'textbox',value,enabled:true,editable:true,...extra});
const frame=(window_id=10,controls=[control('Name','Alpha'),control('Save status','Saved')])=>({source:'native-accessibility',window:{pid:5,window_id},snapshot:'fresh',complete:true,controls});
const prepared=()=>({scopes:[{target:{kind:'native',app:'Workspace'},observation:frame()}]});
const predicate=(name,value,extra={})=>({scope:0,name,role:'textbox',condition:'value',value,source_scope:-1,source_name:'',source_attribute:'none',...extra});
const contract=()=>({verifiable:true,requirements:[predicate('Name','Alpha'),predicate('Save status','Saved')]});
const output=()=>({status:'completed',verified:true,observation:frame()});
test('independent final predicates require all field and save values',()=>{
 assert.equal(g.verifyContract(contract(),prepared(),output()).decision,'complete');
 for(const index of [0,1]){const o=output();o.observation.controls[index].value='wrong';assert.equal(g.verifyContract(contract(),prepared(),o),null);}
});
test('wrong scope, ambiguity, protected fields, missing state and partial observations cannot pass',()=>{
 const variants=[o=>o.observation.window.window_id++,o=>o.observation.controls.push(copy(o.observation.controls[0])),o=>o.observation.controls[0].protected=true,o=>delete o.observation.controls[0].value,o=>o.observation.complete=false,o=>o.evidence_truncated=true,o=>o.outcome_unknown=true,o=>o.observation.snapshot_superseded=true,o=>o.observation.context_truncated=true];
 for(const change of variants){const o=output();change(o);assert.equal(g.verifyContract(contract(),prepared(),o),null);}
});
test('latest complete state supersedes earlier proof; failed or invalid late reads cannot recycle it',()=>{
 for(const late of [{status:'error',outcome_unknown:true},{observation:{...frame(),complete:false}},{observation:{...frame(),snapshot:null}}]){
  const o=output();o.events=[{name:'computer_inspect_window',output:frame()},{name:'computer_inspect_window',output:late}];assert.equal(g.verifyContract(contract(),prepared(),o),null);
 }
 const o=output();o.observation.controls[0].value='changed';o.events=[{name:'computer_inspect_window',output:frame()}];assert.equal(g.verifyContract(contract(),prepared(),o),null);
});
test('dynamic copies require an actual scoped execution read, not prepared literals',()=>{
 const p=prepared();p.scopes.push({target:{kind:'native',app:'Source'},observation:frame(20,[control('Code','stale')])});
 const c={verifiable:true,requirements:[predicate('Name','',{source_scope:1,source_name:'Code',source_attribute:'value'})]},o=output();
 assert.equal(g.verifyContract(c,p,o),null);
 o.events=[{name:'computer_inspect_window',output:frame(20,[control('Code','Alpha'),control('Code',undefined,{role:'text'})])}];
 assert.ok(g.verifyContract(c,p,o));o.events[0].output.controls[0].value='different';assert.equal(g.verifyContract(c,p,o),null);
});
test('no action button or invalid model contract is a completion proof',()=>{
 for(const c of [{verifiable:true,requirements:[]},{verifiable:false,requirements:[]},{...contract(),extra:true},{verifiable:true,requirements:[predicate('Save','',{condition:'exists',role:'button'})]},{verifiable:true,requirements:[predicate('Name','',{condition:'checked'})]},{verifiable:true,requirements:[predicate('Password','secret')]}])assert.equal(g.readContract(c,prepared()),null);
 assert.equal(g.readContract('invalid',prepared()),null);assert.equal(g.readContract(contract(),null),null);
});
test('eligibility excludes consequential requests, incomplete scopes and missing browser identities',()=>{
 assert.ok(g.eligible('Update the name and save it',prepared()));
 for(const s of ['send a message','call the contact','delete the file','pay the invoice','change password'])assert.equal(g.eligible(s,prepared()),false);
 const p=prepared();p.scopes[0].observation={source:'browser_dom',browser:'opera',session_id:'session',tab_id:3,window_id:4,url:'https://example.test/',complete:true,controls:[]};assert.ok(g.eligible('Update the form',p));
 for(const key of ['browser','session_id','tab_id','window_id','url']){const q=copy(p);delete q.scopes[0].observation[key];assert.equal(g.eligible('Update the form',q),false);}
});
test('compiler input contains request and scoped evidence, never executable tools',()=>{
 const p=prepared();p.scopes[0].observation.controls[0].protected=true;const input=g.compilerInput('Update the form',p);
 assert.equal(input.length,2);assert.equal(JSON.stringify(input).includes('Alpha'),false);assert.equal(g.format.json_schema.strict,true);
});

test('browser inventory receipts are not mistaken for failed page frames',()=>{
 const f={...frame(),source:'browser_dom',browser:'opera',session_id:'profile',tab_id:4,window_id:8,url:'https://example.test/form',document_id:'doc'};
 const p={scopes:[{target:{kind:'browser',hostname:'example.test'},observation:f}]};
 const o={status:'completed',verified:true,observation:f,events:[{name:'browser_list_tabs',output:{status:'ok',snapshot:'inventory',complete:true,tabs:[]}},{name:'browser_read_page',output:f}]};
 assert.ok(g.verifyContract(contract(),p,o));o.observation={...f,session_id:'other'};o.events.pop();assert.equal(g.verifyContract(contract(),p,o),null);
});

test('hashed browser profile binding survives redaction without accepting a different profile',()=>{
 const f={...frame(),source:'browser_dom',browser:'opera',session_id:'private-session-metadata',profile_revision:'a'.repeat(64),tab_id:4,window_id:8,url:'https://example.test/form',document_id:'doc'};
 const p={scopes:[{observation:f}]},o={status:'completed',verified:true,observation:{...f}};delete o.observation.session_id;
 assert.ok(g.verifyContract(contract(),p,o));o.observation.profile_revision='b'.repeat(64);assert.equal(g.verifyContract(contract(),p,o),null);
});
test('compiler cancellation is bounded even when a provider ignores abort',async()=>{
 const c=new AbortController(),pending=g.bounded(()=>new Promise(()=>{}),c.signal);c.abort(Error('Stop'));await assert.rejects(pending,/Stop/);
});
