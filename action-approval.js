'use strict';
// A conservative local backstop, not a semantic safety classifier. The planner
// must also stop and ask when a consequential action has an opaque UI label.
const consequential=/\b(delete|erase|destroy|wipe|format drive|empty (?:the )?(?:trash|recycle)|pay|purchase|buy|checkout|place order|transfer|withdraw|donate|subscribe|publish|post|send|share|invite|call|grant|authorize|allow access|confirm|reset password|change password|disable security|supprimer|effacer|payer|acheter|envoyer|publier|partager|autoriser|confirmer)\b/i;
function sensitiveActions(actions){
 return actions.filter(a=>['click','double_click','right_click','select','press','key','follow_link'].includes(a.op||a.kind)&&consequential.test(String(a.target?.name||a.control?.name||a.target_label||''))).map(a=>String(a.target?.name||a.control?.name||a.target_label).slice(0,200));
}
async function approveActions(actions,confirm,context={}){
 const labels=[...new Set(sensitiveActions(actions))];if(!labels.length)return true;
 context.signal?.throwIfAborted();context.assertActive?.();
 if(typeof confirm!=='function')return false;
 const accepted=await confirm({labels},context);context.signal?.throwIfAborted();context.assertActive?.();return accepted===true;
}
module.exports={sensitiveActions,approveActions};
