'use strict';

// Bounds come from the same native observation as the image, never from the
// language model. Keep only visible, named controls with a useful hit area.
function visualTargets(elements, frame) {
  if(!frame||![frame.x,frame.y,frame.width,frame.height].every(Number.isFinite)||frame.width<=0||frame.height<=0)return [];
  return elements.flatMap((row,index)=>{
    const name=String(row.label??row.name??'').trim(),role=String(row.role??row.type??'');
    if(!name||row.enabled===false||row.is_password||row.password||row.protected||row.is_protected||row.isPassword||/password|secure/i.test(role)||!/(button|link|tab.?item|menu.?item|list.?item|tree.?item|check.?box|radio|combo.?box|edit|text.?field)/i.test(role))return [];
    const r=row.frame;if(!r||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=1||r.h<=1)return [];
    const left=Math.max(r.x,frame.x),top=Math.max(r.y,frame.y),right=Math.min(r.x+r.w,frame.x+frame.width),bottom=Math.min(r.y+r.h,frame.y+frame.height);
    if(right<=left||bottom<=top||(right-left)*(bottom-top)<r.w*r.h*.95||r.w*r.h>frame.width*frame.height*.8)return [];
    return [{target_id:`v${index}`,name:name.slice(0,180),role,box:{left:(left-frame.x)/frame.width,top:(top-frame.y)/frame.height,right:(right-frame.x)/frame.width,bottom:(bottom-frame.y)/frame.height}}];
  }).slice(0,150);
}

function namedTarget(state,args) {
  const target=state.targets?.find(t=>t.target_id===args.target_id);
  if(!target||target.name!==args.expected_name)throw new Error('Choose target_id and its exact expected_name from this screenshot\'s targets. Observe again if missing.');
  return target;
}
function matchingNamedTarget(state,label){
  if(typeof label!=='string'||!label.trim())return null;
  if(state.accessibilityPartial||state.targets?.length>=150)return null;
  const normalize=value=>value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  // The compact named-target list can omit clipped/protected/noninteractive
  // rows. A duplicate raw label keeps this path conservative as well.
  if(state.elements?.filter(row=>normalize(String(row.label??row.name??''))===normalize(label)).length>1)return null;
  const matches=(state.targets||[]).filter(target=>normalize(target.name)===normalize(label));
  return matches.length===1?matches[0]:null;
}
module.exports={visualTargets,namedTarget,matchingNamedTarget};
