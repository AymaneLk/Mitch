const {test}=require('node:test'),assert=require('node:assert/strict');
const {RealtimeTranscription}=require('../realtime-transcription');
class Socket extends EventTarget{
  constructor(){super();this.sent=[];this.bufferedAmount=0;}
  send(value){this.sent.push(value);}
  close(){this.closed=true;}
  event(type,fields={}){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type,...fields})}));}
}
function fixture(){const updates=[];const stream=new RealtimeTranscription(text=>updates.push(text),{Socket});const ws=stream.socket;ws.event('session.created');ws.event('session.updated');return {stream,ws,updates};}
test('partials are visible but only a committed final transcript can drive a task',async()=>{
  const {stream,ws,updates}=fixture();await stream.ready;
  stream.append(Buffer.alloc(320));ws.event('conversation.item.input_audio_transcription.delta',{delta:'open'});ws.event('conversation.item.input_audio_transcription.delta',{delta:' calculator'});
  assert.deepEqual(updates,['open','open calculator']);
  const done=stream.finish();ws.event('conversation.item.input_audio_transcription.completed',{transcript:'Open Calculator.'});ws.event('input_audio_buffer.committed');
  assert.equal(await done,'Open Calculator.');assert.equal(ws.closed,true);
});
test('cancellation discards late words and cannot commit a task',async()=>{
  const {stream,ws,updates}=fixture();await stream.ready;stream.cancel();
  ws.event('conversation.item.input_audio_transcription.delta',{delta:'late'});
  await assert.rejects(stream.finish(),/cancelled/);assert.deepEqual(updates,[]);
});
test('missing final or disconnected streaming fails instead of using partial commands',async()=>{
  for(const disconnect of [false,true]){
    const {stream,ws}=fixture();await stream.ready;
    ws.event('conversation.item.input_audio_transcription.delta',{delta:'partial'});
    const done=stream.finish();if(disconnect)ws.dispatchEvent(new Event('close'));else ws.event('input_audio_buffer.committed');
    await assert.rejects(done,/disconnected|without a final/);
  }
});
