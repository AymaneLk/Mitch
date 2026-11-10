'use strict';

const {performance}=require('node:perf_hooks');
const {createHash}=require('node:crypto');
const WebSocket=require('ws');
const Ajv=require('ajv');
const {authError,RESOURCE,readJSON}=require('./chatgpt-auth');
const ENDPOINT=RESOURCE+'/responses',SOCKET='wss://api.openai.com/v1/responses';
const MAX_EVENT=8*1024*1024;
const METRIC_CODES=new Set(['response_failed','model_not_found','model_unavailable','network_error','websocket_unavailable','stream_interrupted','invalid_stream','response_incomplete','invalid_completion','invalid_tool_call','invalid_tool_arguments','unsupported_output','invalid_structured_output','account_changed','session_expired','plan_permission_required','previous_response_not_found','subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable','subscription_sharing_user_not_eligible','subscription_sharing_user_unavailable','subscription_sharing_unsupported_capability','subscription_sharing_route_not_supported','subscription_sharing_invalid_user','chatpass_v2_scope_not_authorized','chatpass_v2_invalid_authorization_context']);
const copy=value=>JSON.parse(JSON.stringify(value,(_key,v)=>v));
const safeCode=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(value)?value:undefined;
function responseError(data,status,requestId){
  const detail=data?.error||data?.response?.error||data||{},code=safeCode(detail.code)||'response_failed';
  const messages={
    subscription_sharing_usage_limit_exceeded:'ChatGPT usage limit reached. Check ChatGPT Settings → Usage, then resume requests in Mitch Settings.',
    subscription_sharing_user_not_eligible:'ChatGPT plan usage is not available for this account, workspace, or policy.',
    subscription_sharing_usage_unavailable:'ChatGPT usage availability could not be checked. Try again shortly.',
    subscription_sharing_user_unavailable:'ChatGPT account information is temporarily unavailable. Try again shortly.',
    subscription_sharing_unsupported_capability:'This account or model does not support part of this request. Check the model and task settings.',
    subscription_sharing_route_not_supported:'ChatGPT plan usage does not support this connection route.',
    subscription_sharing_invalid_user:'ChatGPT could not validate this connection. Reconnect in Settings.',
    chatpass_v2_scope_not_authorized:'ChatGPT plan permission does not authorize this operation.',
    chatpass_v2_invalid_authorization_context:'ChatGPT plan authorization could not be validated. Reconnect in Settings.',
    model_not_found:'The selected model is no longer available. Refresh the models in Settings and select another.',
    previous_response_not_found:'The connection no longer has the previous response.',
  };
  const message=messages[code]||(status===401?'ChatGPT authorization was not accepted. Reconnect in Settings.':status===403?'ChatGPT blocked this request because of account, region, or permission restrictions.':status===429?'ChatGPT is rate limiting requests. Try again shortly.':status>=500?'ChatGPT is temporarily unavailable. Try again shortly.':'ChatGPT could not complete this response.');
  // Never include server-echoed prompts, credentials or arbitrary error text.
  return Object.assign(authError(code,message,status),{param:safeCode(detail.param),requestId:safeCode(requestId),bodyShape:data?.error?'error':typeof data?.detail==='string'?'detail':'other'});
}
function clean(value,allowScreen){
  if(Array.isArray(value))return value.filter(v=>allowScreen||v?.type!=='input_image').map(v=>clean(v,allowScreen));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith('_local')).map(([key,v])=>[key,clean(v,allowScreen)]));
}
function payload(body,model,allowScreen=true){
  if(!Array.isArray(body.input))throw authError('invalid_input','ChatGPT requires a conversation input array.');
  const input=clean(body.input,allowScreen).map(item=>item.role==='system'?{...item,role:'developer'}:item);
  // Explicit allowlist: never forward legacy API options, billing paths, or tools.
  const result={model,store:false,stream:true,input,include:['reasoning.encrypted_content']};
  if(body.instructions)result.instructions=body.instructions;
  if(body.tools?.length){
    if(body.tools.some(t=>t.type!=='function'||!t.name))throw authError('unsupported_tool','Only Mitch custom function tools are supported.');
    result.tools=[{type:'namespace',name:'mitch',description:'Mitch tools executed locally through its permission and verification engine.',tools:body.tools.map(t=>({type:'function',name:t.name,description:t.description||'',parameters:t.parameters,strict:false}))}];
    result.parallel_tool_calls=false;
  }
  if(body.response_format){const format=body.response_format;result.text={format:format.type==='json_schema'?{type:'json_schema',...format.json_schema}:format};}
  return result;
}
function completed(response,body){
  if(response?.status!=='completed'||!Array.isArray(response.output))throw authError('invalid_completion','ChatGPT returned an invalid completion. No actions were executed.');
  const offered=new Set((body.tools||[]).map(t=>t.name)),ids=new Set((body.input||[]).filter(i=>i.type==='function_call').map(i=>i.call_id));
  for(const item of response.output){
    if(item.type==='function_call'){
      if(item.namespace!=='mitch'||!offered.has(item.name)||typeof item.call_id!=='string'||!item.call_id||ids.has(item.call_id)||typeof item.arguments!=='string'||item.arguments.length>1048576||item.status&&item.status!=='completed'||item.async===true||item.caller&&item.caller.type!=='direct')throw authError('invalid_tool_call','ChatGPT returned an invalid or unoffered tool call. No actions were executed.');
      try{const args=JSON.parse(item.arguments);if(!args||typeof args!=='object'||Array.isArray(args))throw new Error();}catch{throw authError('invalid_tool_arguments','ChatGPT returned incomplete tool arguments. No actions were executed.');}ids.add(item.call_id);
    }else if(!['message','reasoning'].includes(item.type))throw authError('unsupported_output','ChatGPT returned an unsupported action. No actions were executed.');
  }
  if(body.response_format?.type==='json_schema'){
    const text=response.output.flatMap(x=>x.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('');
    try{if(!new Ajv({strict:false}).compile(body.response_format.json_schema.schema)(JSON.parse(text)))throw new Error();}catch{throw authError('invalid_structured_output','ChatGPT returned an invalid structured result. No actions were executed.');}
  }
  return response;
}

// One reader for both transports. Deltas are previews only; no tool is emitted
// to the executor until a valid response.completed has been received.
class ResponseEvents{
  constructor({signal,check,onText=()=>{},onStatus=()=>{},started=performance.now()}){Object.assign(this,{signal,check,onText,onStatus,started});this.firstEventMs=null;this.firstTextMs=null;this.responseId=null;}
  accept(event){
    this.signal?.throwIfAborted();this.check();
    if(this.firstEventMs===null)this.firstEventMs=performance.now()-this.started;
    if(event.response?.id){if(this.responseId&&event.response.id!==this.responseId)throw authError('invalid_stream','ChatGPT mixed responses in one stream.');this.responseId=event.response.id;}
    if(event.type==='response.output_text.delta'&&typeof event.delta==='string'){
      if(this.firstTextMs===null)this.firstTextMs=performance.now()-this.started;
      this.onText(event.delta);
    }
    if(event.type==='response.output_item.added'&&event.item?.type==='function_call')this.onStatus('thinking');
    if(event.type==='response.completed')return event.response;
    if(event.type==='response.failed'||event.type==='error')throw responseError(event.error?{error:event.error}:event.response?.error?{error:event.response.error}:event,event.status);
    if(event.type==='response.incomplete')throw authError('response_incomplete','ChatGPT stopped before completing its response. No proposed actions were executed.');
    return null;
  }
}
async function readEvents(response,events){
  const contentType=response.headers.get('content-type');
  // The live OAuth route can omit Content-Type while returning valid SSE.
  // Accept that omission only through the same strict event/completion parser.
  if(!response.body||(contentType&&!contentType.toLowerCase().includes('text/event-stream'))){
    // Some admission paths report a structured failure outside SSE, including
    // an HTTP 200 response. It is still a failure, never a completed inference.
    const data=await readJSON(response).catch(()=>null);
    if(data?.error||data?.type==='response.failed'||data?.type==='error')throw responseError(data,data.status||response.status,response.headers.get('x-request-id'));
    throw Object.assign(authError('invalid_stream','ChatGPT did not return the expected event stream. No proposed actions were executed.',response.status),{bodyShape:data?.type==='response.completed'?'completed_event':data?.object==='response'?'response_object':data?'json_other':'non_json'});
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',total=0;
  try{
    for(;;){
      const {value,done}=await reader.read();events.signal?.throwIfAborted();
      buffer=(buffer+decoder.decode(value||new Uint8Array(),{stream:!done})).replace(/\r\n/g,'\n');total+=value?.length||0;
      if(buffer.length>MAX_EVENT||total>32*1024*1024)throw authError('stream_too_large','ChatGPT response exceeded its limit.');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data||data==='[DONE]')continue;
        let event;try{event=JSON.parse(data);}catch{throw authError('invalid_stream','ChatGPT returned a malformed event.');}
        const result=events.accept(event);if(result)return result;
      }
      if(done){
        if(!contentType&&events.firstEventMs===null){
          let data;try{data=JSON.parse(buffer);}catch{}
          if(data?.error||data?.type==='response.failed'||data?.type==='error')throw responseError(data,response.status,response.headers.get('x-request-id'));
        }
        throw authError('stream_interrupted','ChatGPT disconnected before confirming completion. No proposed actions were executed.');
      }
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

class ChatGPTResponses{
  constructor({auth,fetcher=fetch,WebSocketClass=WebSocket,now=Date.now,onStatus=()=>{},onMetrics=()=>{}}){Object.assign(this,{auth,fetch:fetcher,WebSocket:WebSocketClass,now,onStatus,onMetrics});this.blocks=new Map();this.socket=null;this.wsBusy=false;}
  close(){const ws=this.socket;this.socket=null;this.parent=null;this.socketKey=null;if(ws){ws.terminate();}}
  async resume(){await this.auth.setUsagePaused?.(false);this.blocks.delete(this.auth.data.activeId);this.onStatus('connected');}
  async request(body,{signal,allowScreen=true,onText=()=>{}}={}){
    const lease=this.auth.lease(),started=performance.now(),block=this.blocks.get(lease.id);
    if(this.auth.active()?.usagePaused===true)throw responseError({error:{code:'subscription_sharing_usage_limit_exceeded'}},429);
    if(block&&(block.until===Infinity||block.until>this.now()))throw block.error;
    const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
    bounded.throwIfAborted();this.auth.check(lease);
    const account=this.auth.active();
    if(!account.models?.length||this.now()-(account.catalogAt||0)>300000)await this.auth.catalog(bounded);
    this.auth.check(lease);bounded.throwIfAborted();
    const model=this.auth.model();if(!this.auth.active().models?.some(m=>m.id===model))throw authError('model_unavailable','The selected ChatGPT model is unavailable. Choose an available model in Settings.');
    const permission=()=>typeof allowScreen==='function'?allowScreen():allowScreen;
    const full=payload(body,model,permission()),transport=this.auth.active().transport||'http';
    const events=new ResponseEvents({signal:bounded,check:()=>this.auth.check(lease),onText,onStatus:this.onStatus,started});
    events.beforeSend=()=>{bounded.throwIfAborted();this.auth.check(lease);if(permission()===false)full.input=clean(full.input,false);};
    let used='http',fallback=false,result,error;
    this.onStatus('thinking');
    try{
      if(transport!=='http'&&!this.wsBusy){
        try{used='websocket';result=await this.websocket(full,lease,events);}
        catch(e){if(transport==='auto'&&e.beforeSend===true&&e.fallbackAllowed===true){used='http';fallback=true;}else throw e;}
      }
      if(!result)result=await this.http(full,lease,events);
      bounded.throwIfAborted();this.auth.check(lease);
      return completed(result,body);
    }catch(e){
      error=e;
      if(used==='websocket')this.close();
      if(e.code==='subscription_sharing_usage_limit_exceeded'){this.blocks.set(lease.id,{until:Infinity,error:e});await this.auth.setUsagePaused?.(true);this.onStatus('usage_limit');}
      else if(e.status===503||['subscription_sharing_usage_unavailable','subscription_sharing_user_unavailable'].includes(e.code)){this.blocks.set(lease.id,{until:this.now()+5000,error:e});this.onStatus('error');}
      else this.onStatus(e.status===401||e.code==='session_expired'?'session_expired':bounded.aborted?'stopped':'error');
      if(e.code==='model_not_found')this.auth.active().catalogAt=0;
      if(bounded.aborted)throw bounded.reason;
      throw e;
    }finally{
      this.onMetrics({transport:used,fallback,success:!error,ms:Math.round(performance.now()-started),firstEventMs:events.firstEventMs===null?null:Math.round(events.firstEventMs),firstTextMs:events.firstTextMs===null?null:Math.round(events.firstTextMs),...(error?{code:METRIC_CODES.has(error.code)?error.code:'other',...(Number.isInteger(error.status)?{httpStatus:error.status}:{}),...(['error','detail','other','completed_event','response_object','json_other','non_json'].includes(error.bodyShape)?{bodyShape:error.bodyShape}:{})}:{})});
    }
  }
  async http(full,lease,events){
    for(let attempt=0;attempt<2;attempt++){
      const token=await this.auth.access(lease,{force:attempt===1});events.signal.throwIfAborted();this.auth.check(lease);
      events.beforeSend();
      let response;try{response=await this.fetch(ENDPOINT,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(full),redirect:'error',signal:events.signal});}catch{events.signal.throwIfAborted();throw authError('network_error','Could not reach ChatGPT. Check your connection.');}
      if(response.status===401&&!attempt){await response.body?.cancel().catch(()=>{});continue;}
      if(!response.ok){const data=await readJSON(response).catch(()=>({}));throw responseError(data,response.status,response.headers.get('x-request-id'));}
      try{return await readEvents(response,events);}catch(error){if(error.code){error.requestId||=safeCode(response.headers.get('x-request-id'));throw error;}events.signal.throwIfAborted();throw authError('stream_interrupted','ChatGPT disconnected before confirming completion. No proposed actions were executed.');}
    }
  }
  async connect(token,lease,signal){
    const key=lease.id+':'+lease.epoch+':'+createHash('sha256').update(token).digest('hex');
    if(this.socket?.readyState===1&&this.socketKey===key&&this.now()-this.socketAt<3300000)return this.socket;
    this.close();signal.throwIfAborted();this.auth.check(lease);
    const ws=new this.WebSocket(SOCKET,{headers:{Authorization:'Bearer '+token},handshakeTimeout:15000,maxPayload:MAX_EVENT,followRedirects:false});
    this.socket=ws;this.socketKey=key;this.socketAt=this.now();
    // Persistent error listener prevents idle-socket crashes. Individual requests
    // have their own listeners, removed at their terminal event.
    ws.on('error',()=>{});ws.on('close',()=>{if(this.socket===ws){this.socket=null;this.parent=null;}});
    await new Promise((resolve,reject)=>{
      const finish=(error)=>{ws.off('open',opened);ws.off('error',failed);ws.off('unexpected-response',unexpected);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const opened=()=>finish(),failed=()=>finish(Object.assign(authError('websocket_unavailable','The ChatGPT WebSocket connection could not be opened.'),{beforeSend:true,fallbackAllowed:true}));
      const unexpected=(_req,res)=>{res.resume();finish(Object.assign(responseError({},res.statusCode,res.headers['x-request-id']),{beforeSend:true,fallbackAllowed:[404,405,426,501].includes(res.statusCode)}));ws.terminate();};
      const abort=()=>{finish(signal.reason);ws.terminate();};
      ws.once('open',opened);ws.once('error',failed);ws.once('unexpected-response',unexpected);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    }).catch(error=>{this.close();throw error;});
    signal.throwIfAborted();this.auth.check(lease);return ws;
  }
  async websocket(full,lease,events){
    this.wsBusy=true;
    try{
      let ws;
      for(let attempt=0;attempt<2;attempt++){
        const token=await this.auth.access(lease,{force:attempt===1});
        try{ws=await this.connect(token,lease,events.signal);break;}catch(error){if(error.status!==401||!error.beforeSend||attempt)throw error;}
      }
      events.beforeSend();
      const signature=JSON.stringify({...full,input:undefined,stream:undefined});
      const prefix=this.parent?.input||[];
      const canContinue=this.parent?.id&&this.parent.signature===signature&&prefix.length<=full.input.length&&prefix.every((item,i)=>JSON.stringify(item)===JSON.stringify(full.input[i]));
      let request={...full,type:'response.create'};delete request.stream;
      if(canContinue){request.previous_response_id=this.parent.id;request.input=full.input.slice(prefix.length);}
      let result;
      try{result=await this.socketResponse(ws,request,events);}
      catch(error){
        this.parent=null;
        if(error.code!=='previous_response_not_found'||!canContinue||events.firstTextMs!==null)throw error;
        // A rejected parent emitted no output or actions. Replay context, never
        // tool execution. No retries after ambiguous delivery or partial output.
        events.responseId=null;request={...full,type:'response.create'};delete request.stream;result=await this.socketResponse(ws,request,events);
      }
      this.parent={id:result.id,signature,input:copy([...full.input,...result.output])};return result;
    }catch(error){this.close();throw error;}finally{this.wsBusy=false;}
  }
  socketResponse(ws,request,events){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;ws.off('message',message);ws.off('close',closed);ws.off('error',closed);events.signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      const message=raw=>{try{if(raw.length>MAX_EVENT)throw authError('stream_too_large','ChatGPT response exceeded its limit.');const result=events.accept(JSON.parse(raw.toString()));if(result)finish(null,result);}catch(error){finish(error.code?error:authError('invalid_stream','ChatGPT returned an invalid WebSocket event.'));}};
      const closed=()=>finish(authError('stream_interrupted','ChatGPT disconnected before confirming completion. No proposed actions were executed.'));
      const abort=()=>{finish(events.signal.reason);this.close();};
      ws.on('message',message);ws.once('close',closed);ws.once('error',closed);events.signal.addEventListener('abort',abort,{once:true});
      if(events.signal.aborted)return abort();
      try{events.check();ws.send(JSON.stringify(request),error=>{if(error)closed();});}catch(error){finish(error);}
    });
  }
}
module.exports={ChatGPTResponses,ResponseEvents,readEvents,payload,completed,responseError,ENDPOINT,SOCKET};
