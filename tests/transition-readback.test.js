const {test}=require('node:test'),assert=require('node:assert/strict'),{refreshTransition}=require('../transition-readback');
const frame={source:'browser_dom',browser:'opera',session_id:'profile',tab_id:4,window_id:9,url:'https://example.test/form'};
const list=(extra={})=>({status:'ok',complete:true,snapshot:'inventory',browser:'opera',session_id:'profile',tabs:[{tab_id:4,window_id:9,url:'https://example.test/received',pinned:false,navigating:false}],...extra});
test('refreshes an exact committed tab with read-only calls and never replays input',async()=>{
 const calls=[];const r=await refreshTransition(frame,async(n,a)=>{calls.push([n,a]);return n==='browser_list_tabs'?list():{status:'observed'};});assert.equal(r.status,'observed');assert.deepEqual(calls.map(c=>c[0]),['browser_list_tabs','browser_read_page']);assert.equal(calls[1][1].tab_id,4);
});
test('navigation waits are bounded and cancellation cannot issue a page read',async()=>{
 let time=0,calls=0;await refreshTransition(frame,async()=>{calls++;return list({tabs:[{...list().tabs[0],navigating:true}]});},undefined,{now:()=>time,sleep:async ms=>{time+=ms;}});assert.ok(calls<=21);
 const c=new AbortController();await assert.rejects(refreshTransition(frame,async()=>{c.abort(Error('Stop'));return list();},c.signal),/Stop/);
});
test('wrong profile, tab, window, private scope, origin or partial inventory prevents further reads',async()=>{
 for(const inventory of [list({session_id:'other'}),list({complete:false}),list({tabs:[]}),list({tabs:[{...list().tabs[0],window_id:10}]}),list({tabs:[{...list().tabs[0],pinned:true}]}),list({tabs:[{...list().tabs[0],url:'https://other.test/'}]})]){let calls=0;assert.equal(await refreshTransition(frame,async()=>{calls++;return inventory;}),null);assert.equal(calls,1);}
});
