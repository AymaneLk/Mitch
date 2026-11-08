'use strict';

const {randomUUID} = require('node:crypto');
const TTL = 20000;
const LIMIT = 1600;
const NAVIGATION = new Set(['return','tab','escape','backspace','space','delete','insert','home','end','pageup','pagedown','up','down','left','right']);
const MODIFIERS = new Set(['ctrl','shift','alt','win']);

function decode(result) {
  if (!result || typeof result !== 'object') throw new Error('Cua returned an invalid visual result.');
  let value = result.structuredContent ?? result.structured_json;
  if (typeof value === 'string') value = JSON.parse(value);
  if (!value) {
    const content = result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n');
    try { value = content ? JSON.parse(content) : result; } catch { value = {message:content}; }
  }
  if (result.isError || result.is_error || value.isError || value.is_error || value.refusal || value.effect==='refused' || ['error','refused'].includes(value.status)) {
    const error = new Error(value.error?.hint || value.error?.message || value.message || value.code || value.error?.code || 'Cua refused the visual operation.');
    error.code = value.code || value.error?.code;
    error.refused = true;
    throw error;
  }
  return value;
}
function identity(value) {
  if (!Number.isSafeInteger(value?.pid) || value.pid<=0 || !Number.isSafeInteger(value?.window_id) || value.window_id<=0) throw new Error('Choose an exact observed pid and window_id.');
  return {pid:value.pid,window_id:value.window_id};
}
function bounds(value) {
  if (!value || !['x','y','width','height'].every(key=>Number.isFinite(value[key])) || value.width<=0 || value.height<=0) throw new Error('The target window has no usable geometry. Restore it and observe again.');
  return {x:value.x,y:value.y,width:value.width,height:value.height};
}
function coordinate(value, size, name) {
  if (!Number.isFinite(value) || value<0 || value>1) throw new Error(`${name} must be a normalized coordinate between 0 and 1 from the latest screenshot.`);
  return Math.min(size-1,Math.round(value*(size-1)));
}
function keyName(value) {
  if (typeof value!=='string') throw new Error('Choose one supported keyboard key.');
  const name=({enter:'return',esc:'escape',control:'ctrl',windows:'win'})[value.toLowerCase()]||value.toLowerCase();
  if (!NAVIGATION.has(name)&&!MODIFIERS.has(name)&&!/^[a-z0-9]$|^f(?:[1-9]|1[0-2])$/.test(name)) throw new Error('Unsupported key. Use letters, digits, navigation keys or F1–F12.');
  return name;
}
function protectedElement(element) {
  return element.password===true || element.is_password===true || element.isPassword===true || element.protected===true || element.is_protected===true || /password|secure.?text/i.test(String(element.role||element.type||'')) || element.states?.some?.(state=>/^(password|protected)$/i.test(state));
}

/** Screenshot-grounded foreground input. Coordinates always remain PNG pixels. */
class ComputerVisual {
  constructor({computer,now=Date.now}) {
    if (!computer?.client || typeof computer.ensureSession!=='function') throw new Error('The visual controller needs the shared computer controller.');
    this.computer=computer;this.now=now;this.epoch=0;this.current=null;
  }
  clear() { this.epoch++;this.current=null; }
  check(context={},generation=this.computer.generation,epoch=this.epoch) {
    this.computer.assertReady(generation);
    if (!this.computer.getSettings()?.allowScreen) throw new Error('Enable screen sharing in Settings before visual computer use.');
    if (epoch!==this.epoch) throw new Error('Visual task stopped or its screenshot was replaced. Observe again.');
    context.signal?.throwIfAborted();context.assertActive?.();
  }
  async call(name,args,context,generation,epoch,expectedSnapshot) {
    this.check(context,generation,epoch);
    await this.computer.ensureSession(generation);
    this.check(context,generation,epoch);
    if(expectedSnapshot){
      if(expectedSnapshot.connectionId!==this.computer.client.connectionId)throw new Error('The native connection changed after the screenshot. Observe again.');
      if(this.now()-expectedSnapshot.created>TTL)throw new Error('The screenshot expired while preparing input. Observe again.');
    }
    const result=await this.computer.client.call(name,args);
    this.check(context,generation,epoch);
    return result;
  }
  async liveWindow(target,context,generation,epoch) {
    const result=decode(await this.call('list_windows',{pid:target.pid,on_screen_only:false},context,generation,epoch));
    const row=(result.windows||[]).find(window=>window.pid===target.pid&&window.window_id===target.window_id);
    if (!row || row.minimized===true || row.is_on_screen===false) throw new Error('The target window is closed, hidden or minimized. Restore it and observe again.');
    return {bounds:bounds(row.bounds),title:String(row.title||'')};
  }
  async observe(args={},context={}) {
    this.check(context);
    if (!['window','desktop'].includes(args.scope)) throw new Error('Choose window or desktop visual scope.');
    let target;
    if (args.scope==='window') {
      const id=identity(args);
      if (!this.computer.windows.has(`${id.pid}:${id.window_id}`)) throw new Error('List windows first and choose an exact observed window.');
      target={kind:'window',...id};
    } else {
      if (args.pid!==undefined||args.window_id!==undefined) throw new Error('Desktop observation does not take a window identity.');
      target={kind:'desktop',display_id:'primary'};
    }
    this.clear();
    const generation=this.computer.generation,epoch=this.epoch;
    return this.capture(target,context,generation,epoch,true);
  }
  async capture(target,context,generation,epoch,focus) {
    this.check(context,generation,epoch);
    let live;
    if (target.kind==='window') {
      if (focus) decode(await this.call('bring_to_front',{pid:target.pid,window_id:target.window_id,session:this.computer.session},context,generation,epoch));
      // A full native observation reindexes the window's accessibility tokens.
      const key=`${target.pid}:${target.window_id}`;
      for(const [id,snapshot]of this.computer.snapshots)if(snapshot.key===key)this.computer.snapshots.delete(id);
    }
    const name=target.kind==='window'?'get_window_state':'get_desktop_state';
    const parameters=target.kind==='window'?{pid:target.pid,window_id:target.window_id,session:this.computer.session,include_accessibility_tree:true,include_screenshot:true,tree_format:'elements',max_elements:300,timeout_ms:1000,max_image_dimension:LIMIT}:{session:this.computer.session,max_image_dimension:LIMIT};
    const result=await this.call(name,parameters,context,generation,epoch);
    const data=decode(result),image=result.content?.find(item=>item.type==='image'&&typeof item.data==='string'&&item.data.length);
    const width=data.screenshot_width,height=data.screenshot_height;
    if (!image||!['image/png','image/jpeg','image/webp'].includes(image.mimeType)||!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1||typeof data.capture_id!=='string'||!data.capture_id||data.screenshot_frame_valid===false) throw new Error('Cua did not return a usable, grounded screenshot. No visual input is allowed.');
    if(target.kind==='window'&&(data.pid!==target.pid||data.window_id!==target.window_id))throw new Error('The screenshot belongs to a different window.');
    if(target.kind==='window'){
      // get_window_state already performs an exact native HWND/PID lookup and
      // refuses minimized-window capture. Its metadata names this same frame;
      // a second desktop-wide list_windows here adds no grounding information.
      // Input still independently checks live visibility/geometry before dispatch.
      if(data.minimized===true||data.is_on_screen===false)throw new Error('The screenshot target is hidden or minimized. Restore it and observe again.');
      live={bounds:bounds(data.window_bounds),title:String(data.window_title??'')};
    }
    if(target.kind==='desktop'&&data.display&&data.display!=='primary')throw new Error('The desktop screenshot is not the expected primary display.');
    const state={id:randomUUID(),target:{...target},created:this.now(),generation,epoch,connectionId:this.computer.client.connectionId,width,height,captureId:data.capture_id,live,elements:Array.isArray(data.elements)?data.elements:[],captureBounds:data.window_bounds,screenWidth:data.screen_width||data.screenshot_original_width||width,screenHeight:data.screen_height||data.screenshot_original_height||height,scale:data.scale_factor??1};
    this.check(context,generation,epoch);
    this.current=state;
    return {status:'observed',snapshot:state.id,scope:target.kind,width,height,coordinate_system:'normalized_0_1',...(target.kind==='window'?{window:{pid:target.pid,window_id:target.window_id,title:String(data.window_title||live.title)}}:{display:'primary',screen_width:state.screenWidth,screen_height:state.screenHeight}),accessibility_partial:!!(data.degraded||data.truncated),message:target.kind==='desktop'?'Primary desktop screenshot. Use exact-window observation for apps on other monitors.':'Window screenshot. Coordinates refer to this image, not the whole desktop.',_images:[{data_url:`data:${image.mimeType};base64,${image.data}`,detail:'high'}]};
  }
  getSnapshot(id,context) {
    const state=this.current;
    if (!state||state.id!==id||this.now()-state.created>TTL) throw new Error('Visual screenshot expired, was consumed or replaced. Observe again before input.');
    this.check(context,state.generation,state.epoch);
    if(state.connectionId!==this.computer.client.connectionId)throw new Error('The native connection changed after the screenshot. Observe again.');
    if(state.target.kind==='window'&&[...this.computer.snapshots.values()].some(snapshot=>snapshot.key===`${state.target.pid}:${state.target.window_id}`))throw new Error('The window was inspected again after this image. Take a fresh visual observation.');
    return state;
  }
  parameters(args,state) {
    const kind=args.kind,base={target:state.target,session:this.computer.session,delivery_mode:'foreground'};
    if(!['click','double_click','right_click','type','key','hotkey','scroll','drag','move'].includes(kind))throw new Error('Unsupported visual input.');
    if(args.replace!==undefined&&(kind!=='type'||typeof args.replace!=='boolean'))throw new Error('replace is a boolean option for text input only.');
    const pair=(x,y)=>({x:coordinate(x,state.width,'x'),y:coordinate(y,state.height,'y')});
    const hasPoint=args.x!==undefined||args.y!==undefined;
    const point=hasPoint?pair(args.x,args.y):null;
    if(['click','double_click','right_click','drag','move'].includes(kind)&&!point)throw new Error('This action needs x and y from the latest screenshot.');
    let name,parameters;
    if(['click','double_click','right_click'].includes(kind)){
      name='click';parameters={...base,...point,capture_id:state.captureId,count:kind==='double_click'?2:1,button:kind==='right_click'?'right':'left'};
    } else if(kind==='type') {
      if(typeof args.text!=='string'||!args.text.length||args.text.length>12000)throw new Error('Type 1 to 12,000 characters.');
      name='type_text';parameters={...base,...point,text:args.text,delay_ms:0};
    } else if(kind==='key') {
      name='press_key';parameters={...base,...point,key:keyName(args.key)};
    } else if(kind==='hotkey') {
      if(!Array.isArray(args.keys)||args.keys.length<2||args.keys.length>5)throw new Error('A hotkey needs modifiers followed by one keyboard key.');
      const keys=args.keys.map(keyName);
      if(keys.slice(0,-1).some(key=>!MODIFIERS.has(key))||MODIFIERS.has(keys.at(-1))||new Set(keys).size!==keys.length)throw new Error('Use unique modifiers followed by one non-modifier key.');
      name='hotkey';parameters={...base,...point,keys};
    } else if(kind==='scroll') {
      if(!['up','down','left','right'].includes(args.direction))throw new Error('Choose a valid scroll direction.');
      const amount=args.amount??3;if(!Number.isSafeInteger(amount)||amount<1||amount>50)throw new Error('Scroll amount must be 1 to 50.');
      name='scroll';parameters={...base,...point,direction:args.direction,amount,by:'line'};
    } else if(kind==='drag') {
      const end=pair(args.x2,args.y2);name='drag';parameters={...base,from_x:point.x,from_y:point.y,to_x:end.x,to_y:end.y,duration_ms:180,steps:12,button:'left'};
    } else {
      if(state.target.kind!=='desktop')throw new Error('Real pointer hover needs a desktop observation. Window move only moves Cua’s decorative cursor.');
      name='move_cursor';parameters={target:state.target,session:this.computer.session,...point};
    }
    this.checkProtected(state,point,kind);
    if(kind==='type'&&args.replace===true){
      // Focus once, select the field's content, then type at that selection.
      // Passing x/y again to type_text would click and collapse the selection.
      const {x,y,...typing}=parameters;
      return {name,parameters,steps:[
        {name:'hotkey',parameters:{...base,...point,keys:['ctrl','a']}},
        {name:'type_text',parameters:typing},
      ]};
    }
    return {name,parameters};
  }
  checkProtected(state,point,kind) {
    const protectedRows=state.elements.filter(protectedElement);
    if(!protectedRows.length)return;
    if(['type','key','hotkey'].includes(kind)&&protectedRows.some(row=>row.focused===true||row.is_focused===true||row.has_keyboard_focus===true))throw new Error('The focused control is protected. Choose a different input.');
    if(!point||state.target.kind!=='window'||!state.captureBounds)return;
    // UIA frames are screen coordinates. This conservative overlap guard is only
    // a refusal check: native input still receives unmodified PNG coordinates.
    const frame=state.captureBounds;
    const screenX=frame.x+point.x*frame.width/state.width,screenY=frame.y+point.y*frame.height/state.height;
    if(protectedRows.some(row=>{const r=row.frame;return r&&[r.x,r.y,r.w,r.h].every(Number.isFinite)&&screenX>=r.x-4&&screenX<=r.x+r.w+4&&screenY>=r.y-4&&screenY<=r.y+r.h+4;}))throw new Error('That screenshot location overlaps a known protected field.');
  }
  async verifyGeometry(state,context) {
    if(state.target.kind==='window'){
      const live=await this.liveWindow(state.target,context,state.generation,state.epoch);
      if(live.title!==state.live.title||Object.keys(live.bounds).some(key=>live.bounds[key]!==state.live.bounds[key]))throw new Error('The window moved, resized or changed title after the screenshot. Observe again.');
    }else{
      const screen=decode(await this.call('get_screen_size',{session:this.computer.session},context,state.generation,state.epoch));
      if(screen.width!==state.screenWidth||screen.height!==state.screenHeight||(screen.scale_factor??1)!==state.scale)throw new Error('The display geometry changed after the screenshot. Observe again.');
    }
  }
  async input(args={},context={}) {
    const state=this.getSnapshot(args.snapshot,context);
    const {name,parameters,steps}=this.parameters(args,state);
    await this.verifyGeometry(state,context);
    this.check(context,state.generation,state.epoch);
    if(this.current!==state)throw new Error('Visual screenshot was replaced before input. Observe again.');
    this.getSnapshot(args.snapshot,context);
    this.current=null; // Consume before dispatch; an uncertain action is never replayable.
    let outcome,error,attempted=0,completed=0;
    const results=[];
    try {
      for(const [index,step]of (steps||[{name,parameters}]).entries()){
        // The second operation has no new pixel target. Recheck the same exact
        // window/display, session and task before typing at the selection.
        if(index>0){await this.verifyGeometry(state,context);this.check(context,state.generation,state.epoch);}
        attempted++;
        outcome=decode(await this.call(step.name,step.parameters,context,state.generation,state.epoch,state));
        results.push({action:step.name,effect:outcome.effect||'unverifiable'});
        if(steps&&(outcome.error||outcome.escalation||!['confirmed','unverifiable'].includes(outcome.effect)||outcome.delivery?.mode==='unknown'||outcome.delivery?.delivered_count===0)){
          const problem=new Error(outcome.error?.hint||outcome.summary||'Compound text input did not establish delivery. Inspect the fresh result before continuing; do not replay completed input.');
          problem.code=outcome.error?.code;throw problem;
        }
        completed++;
      }
    }
    catch(caught) { this.check(context,state.generation,state.epoch);error=caught; }
    this.check(context,state.generation,state.epoch);
    let observation,images,observationError;
    try { const fresh=await this.capture(state.target,context,state.generation,state.epoch,false);images=fresh._images;const {_images,...plain}=fresh;observation=plain; }
    catch(caught) { this.check(context,state.generation,state.epoch);observationError=caught.message; }
    const verified=!error&&outcome?.effect==='confirmed'&&!outcome.error&&(!steps||results.every(result=>result.effect==='confirmed'));
    return {...observation,status:error?(error.refused?'refused':'interrupted'):observationError?'observation_failed':verified?'verified':'unverified',verified,effect:steps&&!verified&&!error?'unverifiable':outcome?.effect||'unverifiable',...(steps?{steps_attempted:attempted,steps_completed:completed,step_results:results,...(error?{continuation:'Compound text input stopped. Read the fresh observation before continuing; never replay completed steps.'}:{})}:{}),...(error?{message:error.message,outcome_unknown:!error.refused,...(error.code?{code:error.code}:{})}:outcome?.summary||outcome?.error?.hint?{message:String(outcome.summary||outcome.error.hint).slice(0,1000)}:{}),...(outcome?.escalation?{escalation:{target:outcome.escalation.target,reason:outcome.escalation.reason}}:{}),...(observationError?{observation_error:observationError}:{}),...(images?{_images:images}:{})};
  }
}

module.exports={ComputerVisual};
