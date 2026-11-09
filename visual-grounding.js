'use strict';
function validBox(b){return b&&['left','top','right','bottom'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=1)&&b.left<b.right&&b.top<b.bottom;}
function cropRegion(box,width,height){
  if(!validBox(box))throw new Error('Choose a valid target box in the current screenshot.');
  const w=Math.min(width,Math.max(192,Math.ceil((box.right-box.left)*width*3))),h=Math.min(height,Math.max(192,Math.ceil((box.bottom-box.top)*height*3)));
  return {x:Math.round(Math.max(0,Math.min(width-w,(box.left+box.right)*width/2-w/2))),y:Math.round(Math.max(0,Math.min(height-h,(box.top+box.bottom)*height/2-h/2))),width:w,height:h};
}
function mapCropBox(box,crop,width,height){
  if(!validBox(box))throw new Error('The close-up did not return valid target bounds. No input was sent.');
  return {left:(crop.x+box.left*crop.width)/width,top:(crop.y+box.top*crop.height)/height,right:(crop.x+box.right*crop.width)/width,bottom:(crop.y+box.bottom*crop.height)/height};
}
async function refineBox({nativeImage,image,box,label,locate,signal}){
  if(typeof label!=='string'||!label.trim()||label.length>180)throw new Error('For a visual estimate, provide target_label describing the exact visible button or object. Prefer a measured target_id when available.');
  signal?.throwIfAborted();
  const original=nativeImage.createFromDataURL(image),{width,height}=original.getSize(),crop=cropRegion(box,width,height);
  const result=await locate(original.crop(crop).toDataURL(),label,signal);
  signal?.throwIfAborted();
  if(result?.found!==true||!result.box)throw new Error('The target could not be identified in the close-up. No input was sent. Observe again or choose a measured target.');
  return mapCropBox(result.box,crop,width,height);
}
// Label-only actions let the planner describe intent without estimating pixel
// bounds. GoClick supplies a crop proposal, never a box or presence confidence.
// The existing vision verifier must still locate the actual element before
// the shared executor can click its center.
async function refineTarget({nativeImage,image,box,label,propose,locate,signal}){
  if(box!==undefined)return refineBox({nativeImage,image,box,label,locate,signal});
  if(typeof label!=='string'||!label.trim()||label.length>180)throw Error('Provide target_label for the exact visible target. No input was sent.');
  signal?.throwIfAborted();
  const original=nativeImage.createFromDataURL(image),{width,height}=original.getSize();
  if(!width||!height)throw Error('The screenshot is empty. No input was sent.');
  let proposal;
  try{proposal=await propose?.(image,label,signal);}catch{signal?.throwIfAborted();}
  signal?.throwIfAborted();
  const point=proposal?.point;
  const usable=point&&['x','y'].every(k=>Number.isFinite(point[k])&&point[k]>=0&&point[k]<=1);
  const crop=usable?{x:Math.round(Math.max(0,Math.min(width-Math.min(512,width),point.x*width-Math.min(512,width)/2))),y:Math.round(Math.max(0,Math.min(height-Math.min(512,height),point.y*height-Math.min(512,height)/2))),width:Math.min(512,width),height:Math.min(512,height)}:{x:0,y:0,width,height};
  const result=await locate(original.crop(crop).toDataURL(),label,signal);
  signal?.throwIfAborted();
  if(result?.found!==true||!validBox(result.box))throw Error('The target could not be identified unambiguously. No input was sent. Observe again or choose a measured target.');
  // Do not mistake a clipped object for its full bounds and click off-center.
  if((crop.x>0&&result.box.left<=.01)||(crop.y>0&&result.box.top<=.01)||(crop.x+crop.width<width&&result.box.right>=.99)||(crop.y+crop.height<height&&result.box.bottom>=.99))throw Error('The target extends beyond the close-up. No input was sent. Observe again with the full target visible.');
  const mapped=mapCropBox(result.box,crop,width,height);
  // Contradictory models are a refusal, not permission to choose either guess.
  // Agreement alone still cannot establish presence; found/box verification
  // above and the final executor's fresh-state checks remain mandatory.
  if(usable&&(point.x<mapped.left||point.x>mapped.right||point.y<mapped.top||point.y>mapped.bottom))throw Error('The target proposal and verified bounds disagree. No input was sent. Observe again or choose a measured target.');
  return mapped;
}
module.exports={validBox,cropRegion,mapCropBox,refineBox,refineTarget};
