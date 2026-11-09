'use strict';
// Thumbnail changes never prove completion. Ignore small hover/cursor changes
// when deciding whether the agent is stuck clicking on the same page.
function changedFraction(a,b){
  if(!a||!b||a.length!==b.length||!a.length)return null;
  let changed=0;
  for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>32)changed++;
  return changed/(a.length/4);
}
function compareImages(nativeImage,before,after){
  if(before===after)return {meaningful:false,changed_fraction:0};
  const sample=data=>nativeImage.createFromDataURL(data).resize({width:96,height:96,quality:'good'}).toBitmap();
  try{const fraction=changedFraction(sample(before),sample(after));return fraction===null?undefined:{meaningful:fraction>=.02,changed_fraction:Math.round(fraction*10000)/10000};}catch{return undefined;}
}
module.exports={changedFraction,compareImages};
