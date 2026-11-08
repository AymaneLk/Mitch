const {test}=require('node:test'),assert=require('node:assert/strict');
const {formatToolOutput,omitToolImages,pruneToolImages}=require('../tool-output');
const image={data_url:'data:image/png;base64,aGVsbG8=',detail:'high'};
test('screenshots are image blocks beside clean correlated tool metadata',()=>{
  const source={status:'observed',snapshot:'screen-1',width:1920,height:1080,_images:[image]};
  const output=formatToolOutput(source);
  assert.deepEqual(JSON.parse(output[0].text),{status:'observed',snapshot:'screen-1',width:1920,height:1080});
  assert.deepEqual(output[1],{type:'input_image',image_url:image.data_url,detail:'high'});
  assert.equal(source._images[0],image);
  assert.deepEqual(omitToolImages(source),{status:'observed',snapshot:'screen-1',width:1920,height:1080,screenshot_available:true});
  assert.equal(formatToolOutput({status:'saved'}),'{"status":"saved"}');
});
test('invalid screenshot envelopes do not become remote image requests or base64 text',()=>{
  for(const _images of [[],null,[{data_url:'https://example.test/image.png'}],[{data_url:image.data_url,detail:'bad'}]])assert.throws(()=>formatToolOutput({_images}),/Invalid computer screenshot/);
});
test('only superseded tool images are pruned, preserving call identity and metadata',()=>{
  const input=[{role:'user',content:'Use the app'},...['first','second','third'].map(id=>({type:'function_call_output',call_id:id,output:formatToolOutput({snapshot:id,_images:[image]})}))];
  pruneToolImages(input);
  assert.deepEqual(input.slice(1).map(item=>item.call_id),['first','second','third']);
  assert.deepEqual(input.slice(1).map(item=>item.output.filter(p=>p.type==='input_image').length),[0,0,1]);
  assert.deepEqual(input.slice(1).map(item=>JSON.parse(item.output[0].text).snapshot),['first','second','third']);
});
