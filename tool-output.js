'use strict';

// Private tool-image envelopes stay out of JSON text and become actual vision
// input, not base64 tokens for the model to read. No remote image URLs are used.
// https://developers.openai.com/api/docs/guides/function-calling
function formatToolOutput(result) {
  if (!result || typeof result !== 'object' || !Object.prototype.hasOwnProperty.call(result,'_images')) return JSON.stringify(result);
  const {_images,...data}=result;
  if (!Array.isArray(_images)||_images.length<1||_images.length>2) throw new Error('Invalid computer screenshot output.');
  const images=_images.map(image=>{
    if (!image || typeof image.data_url!=='string' || image.data_url.length>20*1024*1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data_url)) throw new Error('Invalid computer screenshot data.');
    const detail=image.detail||'high';
    if (!['low','high','auto','original'].includes(detail)) throw new Error('Invalid computer screenshot detail.');
    return {type:'input_image',image_url:image.data_url,detail};
  });
  return [{type:'input_text',text:JSON.stringify(data)},...images];
}

function omitToolImages(result) {
  if (!result || typeof result!=='object' || !Object.prototype.hasOwnProperty.call(result,'_images')) return result;
  const {_images,...data}=result;
  return {...data,screenshot_available:Array.isArray(_images)&&_images.length>0};
}

// Keep only the latest screenshot in the active chat loop. Historical tool
// descriptions remain; superseded pixels cannot accidentally ground a new click.
function pruneToolImages(input) {
  let latest=-1;
  for(let i=input.length-1;i>=0;i--){if(input[i].type==='function_call_output'&&Array.isArray(input[i].output)&&input[i].output.some(part=>part.type==='input_image')){latest=i;break;}}
  if(latest<0)return;
  removeToolImages(input.slice(0,latest));
}

function removeToolImages(input) {
  for(const item of input){
    if(item.type==='function_call_output'&&Array.isArray(item.output)&&item.output.some(part=>part.type==='input_image'))item.output=item.output.filter(part=>part.type!=='input_image');
  }
}

const WINDOW_OBSERVATION_TOOLS=new Set(['computer_find_window','computer_focus_window','computer_restore_window','computer_inspect_window','computer_action','computer_action_sequence','computer_execute_plan','computer_observe','computer_input','browser_read_page','browser_execute_plan','browser_follow_link','browser_open_tab','browser_site_task','computer_run_workflow']);

// The native provider replaces accessibility tokens when it reads that window
// again. Retaining each old control list makes long tasks repeatedly upload and
// process unusable controls. Keep outcome metadata and every call/output pair,
// but retain controls only for the newest observation of each exact window.
function pruneToolObservations(input) {
  const calls=new Map(input.filter(item=>item.type==='function_call').map(item=>[item.call_id,item.name]));
  const latest=new Map();
  for(let index=input.length-1;index>=0;index--){
    const item=input[index];
    if(item.type!=='function_call_output'||!WINDOW_OBSERVATION_TOOLS.has(calls.get(item.call_id)))continue;
    const part=Array.isArray(item.output)?item.output.find(value=>value.type==='input_text'):null;
    const text=part?.text??item.output;
    if(typeof text!=='string')continue;
    let data;try{data=JSON.parse(text);}catch{continue;}
    if(!data||typeof data!=='object'||Array.isArray(data))continue;
    const observation=data.observation??data;
    const window=observation?.window;
    if(typeof observation?.snapshot!=='string'||!observation.snapshot)continue;
    const native=Number.isSafeInteger(window?.pid)&&window.pid>0&&Number.isSafeInteger(window?.window_id)&&window.window_id>0;
    const page=observation.source==='browser_dom'&&typeof observation.session_id==='string'&&Number.isSafeInteger(observation.tab_id);
    if(!native&&!page)continue;
    const key=native?`native:${window.pid}:${window.window_id}`:`page:${observation.browser}:${observation.session_id}:${observation.tab_id}`,newest=latest.get(key);
    if(!newest){latest.set(key,observation.snapshot);continue;}
    if(newest===observation.snapshot||(!Array.isArray(observation.controls)&&!Array.isArray(observation.targets)))continue;
    if(Array.isArray(observation.controls))observation.controls_omitted=observation.controls.length;
    if(Array.isArray(observation.targets))observation.targets_omitted=observation.targets.length;
    observation.snapshot_superseded=true;
    delete observation.controls;
    delete observation.targets;
    // Prior assertions remain evidence of completed steps; their old element
    // lists must not be reused as current input targets.
    for(const proof of Array.isArray(data.completion)?data.completion:[]){
      const frame=proof?.observation;
      if(frame&&Array.isArray(frame.controls)){frame.controls_omitted=frame.controls.length;frame.snapshot_superseded=true;delete frame.controls;delete frame.targets;}
    }
    if(part)part.text=JSON.stringify(data);else item.output=JSON.stringify(data);
  }
}

module.exports={formatToolOutput,omitToolImages,pruneToolImages,removeToolImages,pruneToolObservations};
