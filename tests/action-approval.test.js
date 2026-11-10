'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {approveActions}=require('../action-approval');
test('ordinary local edits run without a dialog while consequential actions require explicit approval',async()=>{
 let prompts=0;const approve=async({labels})=>{prompts++;assert.deepEqual(labels,['Delete record']);return true;};
 assert.equal(await approveActions([{op:'fill',target:{name:'Title'},text:'delete draft'},{op:'click',target:{name:'Apply changes'}}],approve),true);assert.equal(prompts,0);
 assert.equal(await approveActions([{op:'click',target:{name:'Delete record'}}]),false);
 assert.equal(await approveActions([{op:'click',target:{name:'Delete record'}}],approve),true);assert.equal(prompts,1);
 assert.equal(await approveActions([{kind:'click',control:{name:'Pay now'}}],async()=>false),false);
});
test('a cancelled approval cannot authorize later input or expose entered field values',async()=>{
 const controller=new AbortController();await assert.rejects(approveActions([{op:'click',target:{name:'Authorize access'},text:'private-value'}],async request=>{assert.ok(!JSON.stringify(request).includes('private-value'));controller.abort();return true;},{signal:controller.signal}),e=>e.name==='AbortError');
});
