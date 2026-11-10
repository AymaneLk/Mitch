'use strict';
// A generic tool error is not evidence that Windows received no input.
const noDeliveryCodes=new Set(['session_ended','background_unavailable','stale_capture','stale_element','stale_element_token','invalid_target','target_not_found','protected_control','permission_denied']);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const message=value=>typeof value==='string'&&value.trim()?value.trim().slice(0,500):undefined;
function nativeCode(value){
  const candidates=[value?.code,value?.error?.code,value?.error_code,plain(value?.refusal)?value.refusal.code:undefined];
  // Keep actual bounded identifiers; never truncate an arbitrary provider
  // string into a different code or stringify an error object.
  return candidates.find(code=>typeof code==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(code));
}
function definitelyRefused(value){
  const code=nativeCode(value);
  if(code==='tool_invocation_failed')return false;
  return value.delivery?.delivered_count===0||noDeliveryCodes.has(code)||value.effect==='refused';
}
function nativeErrorDetails(result,value,fallback){
  let data=plain(value)?value:{},textMessage;
  // An empty structured envelope can accompany a useful MCP text error.
  // Only consult text in that case; do not append page/control metadata to an
  // otherwise usable diagnostic or dump arbitrary JSON into an error.
  if(Object.keys(data).length===0&&Array.isArray(result?.content)){
    const chunks=result.content.filter(item=>item?.type==='text'&&typeof item.text==='string');
    const text=chunks.map(item=>item.text.slice(0,16384)).join('\n').slice(0,16384).trim();
    if(text){
      if(/^[{[]/.test(text)){try{const parsed=JSON.parse(text);if(plain(parsed))data=parsed;}catch{}}
      else textMessage=message(text);
    }
  }
  const refusal=plain(data.refusal)?data.refusal:{},code=nativeCode(data);
  const detail=[data.message,data.error?.message,data.error?.hint,typeof data.refusal==='string'?data.refusal:undefined,refusal.message,refusal.hint,refusal.reason,code,textMessage,fallback].map(message).find(Boolean);
  return {message:detail||'Native operation failed.',...(code?{code}:{}),refused:definitelyRefused(data)};
}
function errorResult(error){
  return {status:'error',message:error.message,...(error.code?{code:error.code}:{}),...(error.action_attempted?{action_attempted:true,outcome_unknown:!error.refused}:{}),...(error.refused?{refused:true}:{})};
}
module.exports={definitelyRefused,errorResult,nativeErrorDetails};
