'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {cropRegion,mapCropBox,refineBox}=require('../visual-grounding');
test('a close-up includes nearby localization errors and maps back without screen-origin assumptions',()=>{
  const crop=cropRegion({left:.02,top:.8,right:.05,bottom:.84},1500,850);
  assert.deepEqual(crop,{x:0,y:601,width:192,height:192});
  assert.deepEqual(mapCropBox({left:.125,top:.5,right:.375,bottom:.75},crop,1500,850),{left:24/1500,top:697/850,right:72/1500,bottom:745/850});
  assert.throws(()=>cropRegion({left:.4,top:0,right:.2,bottom:1},100,100));
  assert.throws(()=>mapCropBox({left:0,top:0,right:2,bottom:1},crop,1500,850));
});
test('missing/ambiguous close-up targets and cancellation refuse instead of reusing the original guess',async()=>{
  const nativeImage={createFromDataURL:()=>({getSize:()=>({width:500,height:300}),crop:()=>({toDataURL:()=> 'crop'})})};
  const args={nativeImage,image:'image',box:{left:.1,top:.1,right:.2,bottom:.2},label:'Profile'};
  await assert.rejects(refineBox({...args,locate:async()=>({found:false,box:null})}),/No input was sent/);
  await assert.rejects(refineBox({...args,label:'',locate:async()=>assert.fail('No API request for missing target label')}),/target_label/);
  const controller=new AbortController();
  await assert.rejects(refineBox({...args,signal:controller.signal,locate:async()=>{controller.abort();return{found:true,box:args.box};}}),/abort/i);
});
