const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateTool,webURL,isoDate,SnapshotCache,Store,createDispatcher}=require('../core');
test('rejects arbitrary commands, unsafe URLs, invalid geometry and unexpected fields',()=>{
 assert.throws(()=>validateTool('run_shell',{command:'anything'}));
 for(const url of ['file:///C:/Windows','javascript:alert(1)','https://name:password@example.com'])assert.throws(()=>webURL(url));
 assert.equal(webURL('https://example.com'),'https://example.com/');
 assert.throws(()=>validateTool('schedule_alert',{title:'Hi',seconds:-5}));
 assert.throws(()=>validateTool('create_note',{title:'a',text:'b',shell:'x'}));
 assert.throws(()=>validateTool('draw_screen_path',{snapshot:'a',shape:'polyline',color:'auto',points:[{x:0,y:0},{x:2,y:0}]}));
});
test('snapshots expire and cannot be reused after replacement',()=>{let now=0;const cache=new SnapshotCache(90,()=>now);const a=cache.set({window:'test'});assert.equal(cache.get(a.id).window,'test');now=91;assert.throws(()=>cache.get(a.id));const b=cache.set({});assert.throws(()=>cache.get(a.id));assert.equal(cache.get(b.id).id,b.id);});
test('dates require timezones, store persists, notifications occur once, corrupt library is not overwritten',()=>{
 assert.throws(()=>isoDate('tomorrow'));assert.throws(()=>isoDate('2026-11-07T09:00'));assert.equal(isoDate('2026-11-07T10:00:00+01:00'),'2026-11-07T09:00:00.000Z');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'companion-test-'));try{let store=new Store(dir);store.add('notes',{title:'Darija',text:'سلام'});const reminder=store.add('reminders',{title:'Check',due_at:'2026-11-07T09:00:00Z'});store=new Store(dir);assert.equal(store.data.notes[0].text,'سلام');assert.equal(store.due(Date.parse('2026-11-07T10:00:00Z')).length,1);assert.equal(store.due(Date.parse('2026-11-07T10:00:01Z')).length,0);store.complete(reminder.id);assert.equal(new Store(dir).data.reminders[0].completed,true);fs.writeFileSync(store.file,'broken');assert.throws(()=>new Store(dir));assert.equal(fs.readFileSync(store.file,'utf8'),'broken');}finally{fs.rmSync(dir,{recursive:true});}
});
test('desktop actions execute serially and handler errors become honest failure results',async()=>{const order=[];const run=createDispatcher({create_note:async a=>{order.push(a.title);await new Promise(r=>setTimeout(r,8));order.push(a.text);return{status:'saved'};},read_notes:()=>{throw new Error('Unavailable');}});const results=await Promise.all([run('create_note',{title:'1',text:'2'}),run('create_note',{title:'3',text:'4'})]);assert.deepEqual(order,['1','2','3','4']);assert.equal(results[1].status,'saved');assert.deepEqual(await run('read_notes',{query:''}),{status:'error',message:'Unavailable'});});
