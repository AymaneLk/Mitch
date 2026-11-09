'use strict';
const {createHash}=require('node:crypto');
function controlState(state){
  if(!state?.controls?.length)return null;
  const rows=state.controls.map(c=>JSON.stringify([c.name,c.type,c.value,c.enabled])).sort();
  return createHash('sha256').update(JSON.stringify([state.window?.title,rows])).digest('hex');
}
module.exports={controlState};
