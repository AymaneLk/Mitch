const {test}=require('node:test'),assert=require('node:assert/strict');
const {LiveToolChannel}=require('../live-tool-channel');
class Socket extends EventTarget {
  constructor(autoOpen=true){super();this.readyState=0;this.bufferedAmount=0;this.sent=[];if(autoOpen)queueMicrotask(()=>this.open());}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  send(text){this.sent.push(JSON.parse(text));}
  close(){if(this.readyState===3)return;this.readyState=3;this.dispatchEvent(new Event('close'));}
  message(body){const event=new Event('message');event.data=JSON.stringify(body);this.dispatchEvent(event);}
}
test('Live sideband sends actual screenshot blocks then exactly one continuation, with key only in header',async()=>{
  let socket,url,options;const channel=new LiveToolChannel(async()=>'test-key',{socketFactory:(u,o)=>{url=u;options=o;return socket=new Socket();}});
  channel.setSession('session_123');
  await channel.submit([{call_id:'one',output:{snapshot:'snap',_images:[{data_url:'data:image/png;base64,aGVsbG8='}] }},{call_id:'two',output:{status:'ok'}}]);
  assert.equal(url,'wss://api.openai.com/v1/live/sessions/session_123/attach');assert.equal(options.headers.Authorization,'Bearer test-key');
  assert.deepEqual(socket.sent.map(event=>event.type),['response.item.create','response.item.create','response.create']);
  assert.equal(socket.sent[0].item.output[1].type,'input_image');assert.equal(socket.sent[0].item.call_id,'one');assert.equal(socket.sent[1].item.output,'{"status":"ok"}');
  assert.ok(!JSON.stringify(socket.sent).includes('test-key'));channel.close();
});
test('a stopped task awaiting credentials never connects or sends',async()=>{
  let resolveKey,entered,sockets=0;const started=new Promise(r=>{entered=r;});
  const channel=new LiveToolChannel(()=>{entered();return new Promise(resolve=>{resolveKey=resolve;});},{socketFactory:()=>{sockets++;return new Socket();}});
  channel.setSession('session_123');const pending=channel.submit([{call_id:'one',output:{status:'ok'}}]);await started;channel.close();resolveKey('test-key');
  await assert.rejects(pending,/stopped or session changed/);assert.equal(sockets,0);
});
test('Stop while opening the sideband cancels delivery and does not affect a replacement session',async()=>{
  let socket,entered;const started=new Promise(r=>{entered=r;});const errors=[];
  const channel=new LiveToolChannel(async()=>'test-key',{socketFactory:()=>{socket=new Socket(false);entered();return socket;},onError:error=>errors.push(error)});
  channel.setSession('old');const pending=channel.submit([{call_id:'old',output:{status:'ok'}}]);await started;channel.setSession('replacement');
  await assert.rejects(pending,/closed before opening/);assert.equal(socket.sent.length,0);assert.equal(channel.sessionId,'replacement');assert.equal(errors.length,0);channel.close();
});
test('server errors are surfaced and failed action outputs are never automatically replayed',async()=>{
  let socket,connections=0;const errors=[];const channel=new LiveToolChannel(async()=>'test-key',{socketFactory:()=>{connections++;return socket=new Socket();},onError:error=>errors.push(error.message)});
  channel.setSession('session_123');await channel.submit([{call_id:'one',output:{status:'ok'}}]);socket.message({type:'error',error:{message:'Rejected tool item'}});
  await assert.rejects(channel.submit([{call_id:'two',output:{status:'ok'}}]),/Rejected tool item/);
  assert.deepEqual(errors,['Rejected tool item']);assert.equal(socket.sent.length,2);assert.equal(connections,1);channel.close();
});
test('invalid and duplicate output identifiers never open a socket',async()=>{
  let connections=0;const channel=new LiveToolChannel(async()=>'test-key',{socketFactory:()=>{connections++;return new Socket();}});channel.setSession('session_123');
  await assert.rejects(channel.submit([{call_id:'one',output:{}},{call_id:'one',output:{}}]),/duplicate/);assert.equal(connections,0);channel.close();
});
