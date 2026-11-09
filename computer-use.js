const { randomUUID } = require('node:crypto');
const { captureTarget, resolveTarget } = require('./computer-target');
const {nativeErrorDetails}=require('./native-failure');
const {controlState}=require('./desktop-state');

const NAVIGATION_KEYS = new Set(['Return', 'Tab', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete']);
const SNAPSHOT_TTL = 90000;
const MAX_CONTROLS = 300;
const NON_EDITABLE_MESSAGE = 'This control is read-only or not an editable text field. Use a control marked editable, or click observed input buttons. In Calculator, click the digit/operator buttons instead of typing into the display.';

function decode(result) {
  if (!result || typeof result !== 'object') throw new Error('Cua returned an invalid result.');
  let data = result.structuredContent ?? result.structured_json ?? result;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw new Error('Cua returned invalid structured data.'); }
  }
  if (data === result && Array.isArray(result.content)) {
    const text = result.content.filter(x => x.type === 'text').map(x => x.text).join('\n');
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }
  if (result.isError || result.is_error || data.isError || data.is_error || data.effect === 'refused' || ['error', 'refused'].includes(data.status) || data.refusal) {
    const details=nativeErrorDetails(result,data,'Cua refused this operation.');
    const error = new Error(details.message);
    error.code = details.code;
    error.refused = details.refused;
    throw error;
  }
  return data;
}

function windowIdentity(value) {
  if (!Number.isSafeInteger(value?.pid) || value.pid <= 0 || !Number.isSafeInteger(value.window_id) || value.window_id <= 0) {
    throw new Error('Select an exact pid and window_id from computer_list_windows.');
  }
  return { pid: value.pid, window_id: value.window_id };
}

function protectedControl(element) {
  return element.password === true || element.is_password === true || element.isPassword === true || element.protected === true || element.is_protected === true || /password|secure.?text/i.test(String(element.role || element.type || '')) || (Array.isArray(element.states) && element.states.some(state => /^(?:protected|password)$/i.test(state)));
}

function textControl(element) {
  const role = String(element.role ?? element.type ?? '');
  // Explicit capability flags take precedence over a text-like accessibility
  // role. A read-only Document/Edit is still not a writable input field.
  if (['read_only','readOnly','is_read_only','isReadOnly'].some(key=>element[key]===true) || ['editable','is_editable','isEditable','writable','is_writable','isWritable'].some(key=>element[key]===false)) return false;
  return ['editable','is_editable','isEditable','writable','is_writable','isWritable'].some(key=>element[key]===true) || /edit|text.?field|text.?box|text.?area|document/i.test(role);
}

function publicControl(element, index) {
  const protectedValue = protectedControl(element);
  return {
    control_id: String(index),
    name: String(element.label ?? element.name ?? '').slice(0, 1000),
    type: String(element.role ?? element.type ?? '').slice(0, 100),
    enabled: element.enabled !== false,
    protected: protectedValue,
    editable: !protectedValue && element.enabled !== false && textControl(element),
    ...(protectedValue || element.value === undefined ? {} : { value: String(element.value).slice(0, 4000) }),
  };
}

/** App-owned accessibility controller. No model-provided scripts or raw tool forwarding. */
class ComputerUse {
  constructor({ client, getSettings, confirm, restoreWindow, now = Date.now }) {
    if (!client || typeof client.call !== 'function' || typeof client.stop !== 'function') throw new Error('A Cua client is required.');
    if (typeof getSettings !== 'function' || typeof confirm !== 'function') throw new Error('Settings and confirmation callbacks are required.');
    this.client = client;
    this.getSettings = getSettings;
    this.confirm = confirm;
    this.restoreWindow = restoreWindow;
    this.now = now;
    this.paused = false;
    this.generation = 0;
    this.session = 'pixie-' + randomUUID();
    this.snapshots = new Map();
    this.windows = new Map();
  }

  get running() { return !!this.client.running; }

  assertReady(generation = this.generation) {
    if (this.paused || generation !== this.generation) throw new Error('Computer use is stopped. Resume it before starting a new task.');
    if (!this.getSettings()?.allowDesktop) throw new Error('Enable desktop actions in Settings first.');
  }

  async invoke(name, args, generation) {
    this.assertReady(generation);
    await this.ensureSession(generation);
    this.assertReady(generation);
    const result = await this.client.call(name, args);
    this.assertReady(generation);
    return decode(result);
  }

  async ensureSession(generation) {
    await this.client.connect?.();
    this.assertReady(generation);
    const session = this.session, connectionId = this.client.connectionId;
    const matches = value => value?.session === session && value.connectionId === connectionId;
    if (matches(this.configuredSession)) return;
    if (matches(this.sessionSetup)) return this.sessionSetup.promise;
    const setup = {session,connectionId};
    setup.promise = (async()=>{
      // Configure only Pixie's session. Keep native effect verification and the
      // fresh observation; remove the driver's decorative cursor glide/dwell.
      decode(await this.client.call('start_session',{session,cursor_motion:{timing:'fixed',glide_duration_ms:1,dwell_after_click_ms:0}}));
      this.assertReady(generation);
      this.configuredSession = {session,connectionId};
    })();
    this.sessionSetup = setup;
    try { await setup.promise; }
    finally { if (this.sessionSetup === setup) this.sessionSetup = null; }
  }

  async listWindows({ query = '' } = {}) {
    this.assertReady();
    if (typeof query !== 'string' || query.length > 120) throw new Error('Window search must be under 120 characters.');
    const generation = this.generation;
    const result = await this.invoke('list_windows', { on_screen_only: false }, generation);
    const rows = Array.isArray(result) ? result : result.windows;
    if (!Array.isArray(rows)) throw new Error('Cua did not return a window list.');
    const windows = [];
    for (const row of rows) {
      if (row.is_on_screen === false && row.minimized !== true && !String(row.title??'').trim()) continue;
      let identity;
      try { identity = windowIdentity(row); } catch { continue; }
      const window = { ...identity, title: String(row.title ?? '').slice(0, 1000), app: String(row.app_name ?? row.owner_name ?? row.name ?? '').slice(0, 150), minimized:row.minimized===true, on_screen:row.is_on_screen!==false };
      if(Number.isSafeInteger(row.owner_window_id)&&row.owner_window_id>0)window.owner_window_id=row.owner_window_id;
      this.windows.set(`${identity.pid}:${identity.window_id}`, window);
      if ((window.title + ' ' + window.app).toLowerCase().includes(query.toLowerCase())) windows.push(window);
    }
    return { status: result.degraded || result.truncated ? 'partial' : 'ok', windows: windows.slice(0, 100), degraded: !!result.degraded, truncated: !!result.truncated || windows.length > 100 };
  }

  async inspect(args) {
    this.assertReady();
    const generation = this.generation;
    const identity = windowIdentity(args);
    const key = `${identity.pid}:${identity.window_id}`;
    if (!this.windows.has(key)) throw new Error('List windows first and select an exact observed pid and window_id.');
    // A provider snapshot invalidates its earlier element tokens, including on failed reads.
    for (const [id, snapshot] of this.snapshots) if (snapshot.key === key) this.snapshots.delete(id);
    const result = await this.invoke('get_window_state', {
      ...identity, session: this.session, include_accessibility_tree: true,
      include_screenshot: false, tree_format: 'elements', max_elements: MAX_CONTROLS, timeout_ms: 5000,
    }, generation);
    if (!Array.isArray(result.elements)) throw new Error('Cua returned no accessible element list. This window may not expose accessibility controls.');
    const window = { ...identity, title: String(result.window_title ?? result.title ?? result.window?.title ?? this.windows.get(key)?.title ?? '').slice(0, 1000) };
    const elements = result.elements.slice(0, MAX_CONTROLS);
    const controls = elements.map(publicControl);
    const snapshot = {
      id: randomUUID(), key, window, created: this.now(), generation,
      controls, elements,
      degraded: !!result.degraded, truncated: !!result.truncated || result.elements_complete === false || result.elements.length > MAX_CONTROLS,
      reason: String(result.degraded_reason ?? '').slice(0, 500),
    };
    while (this.snapshots.size >= 8) this.snapshots.delete(this.snapshots.keys().next().value);
    this.snapshots.set(snapshot.id, snapshot);
    return this.observation(snapshot);
  }

  async findWindow({ query } = {}, { signal, assertActive } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 120) throw new Error('Provide a running app name or window title under 120 characters.');
    const check = () => { signal?.throwIfAborted(); assertActive?.(); };
    check();
    const listed = await this.listWindows({query:query.trim()});
    check();
    if (listed.degraded || listed.truncated) return {...listed,status:'partial',message:'Window discovery was incomplete. Choose an exact window from the returned list.'};
    if (listed.windows.length !== 1) return {...listed,status:listed.windows.length?'ambiguous':'not_found',message:listed.windows.length?'Choose one exact window; more than one matches. Restore an intended minimized main window before inspection; Windows may expose empty child windows while it is minimized.':'No open window matches. Titles may be localized: list windows with an empty query, or open the requested app first.'};
    if(listed.windows[0].minimized)return {...listed,status:'minimized',message:'Restore this exact window with computer_restore_window before inspecting or entering input.'};
    const observed = await this.inspect(listed.windows[0]);
    check();
    return observed;
  }

  async restore(args, {signal,assertActive} = {}) {
    const generation=this.generation;
    const check=()=>{this.assertReady(generation);signal?.throwIfAborted();assertActive?.();};
    check();
    const identity=windowIdentity(args),window=this.windows.get(`${identity.pid}:${identity.window_id}`);
    if(!window)throw new Error('List windows first and restore one exact observed window.');
    if(typeof this.restoreWindow!=='function')throw new Error('Window restoration is unavailable. Restore the app from its taskbar button.');
    await this.restoreWindow({...identity,expected_title:window.title});
    check();
    let observed;
    for(let attempt=0;attempt<4;attempt++){
      check();
      observed=await this.inspect(identity);
      check();
      if(observed.controls.length&&!observed.degraded&&!observed.truncated)return observed;
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {...observed,message:'The window was restored, but its controls are still unavailable. '+(observed.message||'')};
  }

  async focus(args,context={}) {
    const generation=this.generation,check=()=>{this.assertReady(generation);context.signal?.throwIfAborted();context.assertActive?.();};
    check();const identity=windowIdentity(args),window=this.windows.get(`${identity.pid}:${identity.window_id}`);
    if(!window)throw new Error('List windows first and choose one exact observed window to focus.');
    let observation;
    if(window.minimized){observation=await this.restore({...identity},context);check();}
    if(!observation)try{observation=await this.inspect(identity);}catch(error){check();observation={status:'partial',window:{...identity,title:window.title},controls:[],message:'Window controls could not be read: '+error.message};}
    check();
    // Raise last: accessibility providers can change focus while being read.
    const focused=await this.invoke('bring_to_front',{...identity,session:this.session},generation);check();
    if(focused.landed_on_target===false||Number(focused.now_fg_hwnd)!==identity.window_id)throw new Error('Windows did not confirm focus on the requested window. Inspect the open windows before continuing.');
    return {...observation,focused:true,focus_verified:true};
  }

  async sequence({snapshot: snapshotId, actions} = {}, context = {}) {
    const generation = this.generation;
    const check = () => { this.assertReady(generation); context.signal?.throwIfAborted(); context.assertActive?.(); };
    check();
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 20) throw new Error('A computer sequence needs 1 to 20 observed actions.');
    const initial = this.getSnapshot(snapshotId, generation);
    if (initial.degraded || initial.truncated) throw new Error('Use a complete accessibility observation before a sequence.');
    // Validate the whole plan before the first input. New/future UI controls are
    // deliberately not allowed: each step starts from a known observed target.
    const plan = actions.map(step => {
      if (!step || !['click','type'].includes(step.kind) || Object.keys(step).some(key=>!['kind','control_id','expected_name','text'].includes(key))) throw new Error('Sequences accept only observed clicks and text replacements.');
      const target = captureTarget(initial, step.control_id);
      if (!step.expected_name || step.expected_name !== target.name) throw new Error('Every sequence label must match its exact inspected control.');
      if (step.kind === 'type') {
        const element = initial.elements[Number(step.control_id)];
        if (!textControl(element)) throw new Error(NON_EDITABLE_MESSAGE);
        if (typeof step.text !== 'string' || step.text.length > 12000) throw new Error('Text must be at most 12,000 characters.');
      }
      return {step:{...step},target};
    });
    const started = performance.now(), results = [];
    let observation = this.observation(initial), completed = 0, attempted = 0;
    const summary = (status, message) => ({status,completed,attempted,action_attempted:attempted>0,outcome_unknown:results.some(result=>result.outcome_unknown===true),total:plan.length,verified:status==='completed',confirmed:results.filter(result=>result.verified).length,duration_ms:Math.round(performance.now()-started),results,...(observation?{observation}:{}),...(message?{message}:{})});
    for (const {step,target} of plan) {
      check();
      let control;
      try { control = resolveTarget(this.getSnapshot(observation.snapshot,generation),target); }
      catch (error) { check(); return summary('interrupted',error.message+' No remaining steps were run. Do not replay completed steps.'); }
      try {
        const currentId = observation.snapshot,previousControls=controlState(observation);
        observation = undefined;
        attempted++;
        const result = await this.action({...step,snapshot:currentId,control_id:control.control_id},context);
        check();
        results.push({step:attempted,status:result.status,verified:result.verified,effect:result.effect,...(result.verification?{verification:result.verification}:{}),...(result.message?{message:result.message}:{})});
        if (['verified','unverified','observation_failed'].includes(result.status)) completed++;
        observation = result.observation;
        const next=plan[attempted];
        const keypadDigit=/calculat(?:or|rice)/i.test(initial.window.title)&&/^(?:[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|zéro|un|deux|trois|quatre|cinq|sept|huit|neuf)$/i.test(target.name);
        if(!keypadDigit&&!result.verified&&step.kind==='click'&&next?.step.kind==='click'&&next.target.name===target.name&&observation?.controls&&controlState(observation)===previousControls)return summary('interrupted','The click produced no observable change. Its duplicate was not sent. Check open windows or the fresh observation before continuing.');
        // Windows may report accepted clicks as unverifiable. These are known,
        // unconditional input steps, not conditional navigation or task success.
        // Text MUST be confirmed before any later click can submit a stale field.
        if (!['verified','unverified'].includes(result.status) || result.requires_review || (!result.verified&&result.effect!=='unverifiable') || (step.kind==='type'&&!result.verified) || !observation || observation.degraded || observation.truncated) return summary('interrupted','The last step or its resulting state could not be confirmed completely. No remaining steps were run. Do not replay completed steps.');
      } catch (error) {
        check();
        results.push({step:attempted,status:'error',verified:false,outcome_unknown:!error.refused,message:error.message});
        return summary('interrupted','The sequence stopped: '+error.message+' No remaining steps were run. Do not replay completed steps.');
      }
    }
    return results.every(result=>result.verified)?summary('completed'):summary('unverified','Sequence inputs were delivered. Read the final observation to determine the task outcome; delivery alone is not proof of success.');
  }

  observation(snapshot) {
    return {
      status: snapshot.degraded || snapshot.truncated ? 'partial' : 'inspected',
      snapshot: snapshot.id, window: { ...snapshot.window },
      controls: snapshot.controls.map(control => ({ ...control })),
      degraded: snapshot.degraded, truncated: snapshot.truncated,
      ...(snapshot.reason ? { message: snapshot.reason } : {}),
      source: 'Cua accessibility tree; no screenshot captured',
    };
  }

  getSnapshot(id, generation) {
    this.assertReady(generation);
    const snapshot = this.snapshots.get(id);
    if (!snapshot || snapshot.generation !== generation || this.now() - snapshot.created > SNAPSHOT_TTL) {
      throw new Error('Computer snapshot expired or was replaced. Inspect the window again.');
    }
    return snapshot;
  }

  async action(args, { signal, assertActive } = {}) {
    const checkCaller = () => {
      if (signal?.aborted) throw new Error('Computer action cancelled. Start a new task to continue.');
      assertActive?.();
    };
    checkCaller();
    const generation = this.generation;
    this.assertReady(generation);
    if (!args || !['click', 'type', 'key', 'scroll'].includes(args.kind)) throw new Error('Unsupported computer action.');
    const snapshot = this.getSnapshot(args.snapshot, generation);
    const target = { kind: 'window', ...windowIdentity(snapshot.window) };
    let control, element;
    if (args.control_id !== undefined && args.control_id !== '') {
      control = snapshot.controls.find(item => item.control_id === args.control_id);
      element = control && snapshot.elements[Number(control.control_id)];
      if (!control || !element || typeof element.element_token !== 'string' || !element.element_token || control.protected || !control.enabled) {
        throw new Error('This control is unavailable, disabled or protected. Inspect again.');
      }
    }
    const base = { target, session: this.session, delivery_mode: 'background' };
    let name, parameters;
    if (args.kind === 'click') {
      if (!control || typeof args.expected_name !== 'string' || args.expected_name !== control.name) throw new Error('The requested label must match one exact inspected control.');
      name = 'click'; parameters = { ...base, element_token: element.element_token };
    } else if (args.kind === 'type') {
      if (!control) throw new Error('Choose an inspected text control before replacing text.');
      if (typeof args.expected_name !== 'string' || args.expected_name !== control.name) throw new Error('The requested label must match one exact inspected control.');
      if (!textControl(element)) throw new Error(NON_EDITABLE_MESSAGE);
      if (typeof args.text !== 'string' || args.text.length > 12000) throw new Error('Text must be at most 12,000 characters.');
      name = 'set_value';
      // set_value replaces a control value; it never presses Return or uses clipboard paste.
      parameters = { pid: target.pid, window_id: target.window_id, session: this.session, delivery_mode: 'background', element_token: element.element_token, value: args.text };
    } else if (args.kind === 'key') {
      if (!NAVIGATION_KEYS.has(args.key)) throw new Error('Only the documented navigation keys are allowed.');
      name = 'press_key'; parameters = { ...base, key: args.key.toLowerCase(), ...(element ? { element_token: element.element_token } : {}) };
    } else {
      if (!['up', 'down', 'left', 'right'].includes(args.direction)) throw new Error('Invalid scroll direction.');
      const amount = args.amount ?? 3;
      if (!Number.isInteger(amount) || amount < 1 || amount > 10) throw new Error('Scroll amount must be 1 to 10.');
      // On Windows scroll targets the window's focused region; its element_token parameter is ignored.
      if (control) throw new Error('Scroll applies to the window, not an individual control. Omit control_id.');
      name = 'scroll'; parameters = { ...base, direction: args.direction, amount };
    }
    if (!control && ['key', 'scroll'].includes(args.kind) && snapshot.elements.some(item => protectedControl(item) && (item.focused === true || item.is_focused === true || item.has_keyboard_focus === true))) {
      throw new Error('The focused control is protected. Select a different control.');
    }
    const allowed = await this.confirm({ kind: args.kind, window: { ...snapshot.window }, control: control && { ...control }, text: args.text, key: args.key, direction: args.direction, amount: args.amount }, {signal});
    checkCaller();
    this.getSnapshot(args.snapshot, generation);
    if (allowed !== true) return { status: 'cancelled', verified: false, message: 'The user cancelled the action. Do not retry without a new request.' };
    let result;
    try {
      result = await this.invoke(name, parameters, generation);
      checkCaller();
    } catch (error) {
      this.snapshots.delete(snapshot.id);
      error.action_attempted=true;
      if (!error.refused && !this.paused) error.message = 'Computer action interrupted; its outcome may be unknown. Inspect the result and open windows; do not repeat the action. ' + error.message;
      throw error;
    }
    this.snapshots.delete(snapshot.id);
    // 0.41 reports confirmation via effect; older responses may include verified.
    // This confirms the individual input effect, never completion of the user's task.
    const requiresReview = !!((!['confirmed','unverifiable'].includes(result.effect)&&result.verified!==true) || result.error || result.escalation || result.escalation_reason || result.escalation_required || result.requires_escalation || result.refusal || result.degraded || result.truncated || result.partial || result.suspected_noop || ['partial','suspected_noop','refused'].includes(result.effect) || ['partial','error','refused','suspected_noop'].includes(result.status));
    let verified = !requiresReview && (result.effect === 'confirmed' || result.verified === true);
    let verification = verified?'driver':undefined;
    let observation;
    try { observation = await this.inspect(snapshot.window); }
    catch (error) {
      this.assertReady(generation);
      return { status: 'observation_failed', verified, effect: result.effect || 'unverifiable', message: 'The action returned, but the fresh observation failed: ' + error.message };
    }
    this.assertReady(generation);
    checkCaller();
    if (!verified && !requiresReview && args.kind==='type') {
      try {
        const actual = resolveTarget(this.getSnapshot(observation.snapshot,generation),captureTarget(snapshot,control.control_id));
        if (actual.value === args.text) { verified=true; verification='text_readback'; }
      } catch { /* An incomplete, ambiguous or changed target is never proof. */ }
    }
    return { status: verified ? 'verified' : 'unverified', verified, ...(requiresReview?{requires_review:true}:{}), ...(verification?{verification}:{}), effect: result.effect || 'unverifiable', ...(result.summary || result.error?.hint ? { message: String(result.summary || result.error.hint).slice(0, 1000) } : {}), observation };
  }

  async stop() {
    this.paused = true;
    this.generation++;
    this.snapshots.clear();
    this.windows.clear();
    this.configuredSession = null;
    await this.client.stop();
    return { status: 'stopped' };
  }

  resume() {
    if (!this.getSettings()?.allowDesktop) throw new Error('Enable desktop actions in Settings first.');
    this.generation++;
    this.session = 'pixie-' + randomUUID();
    this.configuredSession = null;
    this.snapshots.clear();
    this.paused = false;
    return { status: 'ready' };
  }
}

module.exports = { ComputerUse, NAVIGATION_KEYS };
