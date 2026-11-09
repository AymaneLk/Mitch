'use strict';

const Ajv=require('ajv');
const DEFAULT_MODEL='deepseek-flash';
const DEFAULT_EFFORT='high';
function deepseekURL(endpoint='chat/completions') {
  if(!['models','chat/completions'].includes(endpoint))throw new Error('Unsupported DeepSeek endpoint.');
  return 'https://api.deepseek.com/'+endpoint;
}
function deepseekHeaders(key) {
  if(typeof key!=='string'||!key||key.length>4096||/\s/.test(key))throw new Error('Enter your DeepSeek API key in Settings.');
  return {'Content-Type':'application/json',Authorization:'Bearer '+key};
}
function deepseekModel(value=DEFAULT_MODEL) {
  if(value!==DEFAULT_MODEL)throw new Error('Choose DeepSeek Flash, which supports Mitch’s screen and action tools.');
  return value;
}
function deepseekPayload(payload,body,settings) {
  const thinking=body.localThinking!==false;
  const effort=body.localReasoningEffort??DEFAULT_EFFORT;
  if(!['low','high','max'].includes(effort))throw new Error('Invalid thinking effort.');
  const messages=payload.messages.map(message=>({...message}));
  const result={model:deepseekModel(settings.deepseekChatModel||DEFAULT_MODEL),messages,max_tokens:thinking?8192:payload.max_tokens,stream:false,thinking:{type:thinking?'enabled':'disabled'},...(thinking?{reasoning_effort:effort}:{})};
  for(const message of messages){
    if(!thinking)delete message.reasoning_content;
    // Old non-thinking history has no reasoning. Current thinking responses
    // retain the full provider field, including text alongside a tool call.
    else if(message.role==='assistant'&&message.reasoning_content===undefined)message.reasoning_content='';
  }
  if(payload.tools){result.tools=payload.tools;result.tool_choice='auto';result.parallel_tool_calls=false;}
  if(body.response_format){
    result.response_format={type:'json_object'};
    const schema=body.response_format.json_schema?.schema;
    result.messages.unshift({role:'system',content:'Return only a valid JSON object.'+(schema?' Follow this JSON schema exactly: '+JSON.stringify(schema):'')});
  }
  return result;
}
function validateDeepseekJSON(text,format) {
  if(!format)return;
  let value;try{value=JSON.parse(text);}catch{throw new Error('DeepSeek returned an empty or invalid JSON response.');}
  const schema=format.json_schema?.schema;
  if(schema&&!new Ajv({strict:false}).validate(schema,value))throw new Error('DeepSeek returned JSON that does not match the requested schema.');
}
function deepseekError(status) {
  if(status===401)return new Error('DeepSeek rejected the API key. Update it in Settings.');
  if(status===402)return new Error('Your DeepSeek API balance is insufficient. Add credit on the DeepSeek platform.');
  if(status===429)return new Error('DeepSeek is rate limited. Try again shortly.');
  return new Error(`DeepSeek request failed (${status}). No action was retried.`);
}
async function checkDeepSeek(fetcher,settings,key,signal) {
  const headers=deepseekHeaders(key),model=deepseekModel(settings.deepseekChatModel||DEFAULT_MODEL);
  const response=await fetcher(deepseekURL('models'),{headers,redirect:'error',signal});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw deepseekError(response.status);
  if(!(data.data||[]).some(item=>item.id===model))throw new Error('DeepSeek Flash is not available for this API key.');
  const result=await fetcher(deepseekURL(),{method:'POST',headers,redirect:'error',signal,body:JSON.stringify({model,messages:[{role:'user',content:'Reply with exactly OK.'}],max_tokens:1024,thinking:{type:'enabled'},reasoning_effort:DEFAULT_EFFORT,stream:false})});
  const answer=await result.json().catch(()=>({}));
  if(!result.ok)throw deepseekError(result.status);
  if(answer.choices?.[0]?.finish_reason!=='stop'||answer.choices[0].message?.content?.trim()!=='OK')throw new Error('DeepSeek did not complete the connection check.');
  return {status:'connected',model};
}
module.exports={DEFAULT_MODEL,DEFAULT_EFFORT,deepseekURL,deepseekHeaders,deepseekModel,deepseekPayload,validateDeepseekJSON,deepseekError,checkDeepSeek};
