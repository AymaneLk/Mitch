const {test} = require('node:test');
const assert = require('node:assert/strict');
const {NativePlanAdapter} = require('../native-plan-adapter');
const {executePlan, matchControls} = require('../action-plan');

const target = {pid: 21, window_id: 900};
const selector = (name, role = 'button') => ({name, role});
const element = (name, role = 'Button', extra = {}) => ({name, role, enabled: true, ...extra});
function computerFixture(elements) {
  let time = 1000, serial = 0;
  const computer = {
    generation: 0, windows: new Map([['21:900', {...target, title: 'Fixture'}]]), snapshots: new Map(),
    elements, reads: 0, inputs: [], now: () => time, advance: ms => time += ms,
    assertReady(generation) {if (generation !== this.generation) throw Error('session stopped');},
    getSnapshot(id, generation) {this.assertReady(generation); const value = this.snapshots.get(id); if (!value) throw Error('expired'); return value;},
    async inspect(window) {
      assert.deepEqual(window, target);
      this.reads++;
      const id = `snapshot-${++serial}`;
      const raw = this.elements.map((row, index) => ({...row, element_token: `${id}:${index}`}));
      const controls = raw.map((row, index) => ({control_id: String(index), name: row.name, type: row.role, enabled: row.enabled !== false, protected: !!row.protected, editable: row.editable === true || row.role === 'Edit', ...(row.protected || row.value === undefined ? {} : {value: row.value})}));
      const snapshot = {id, window: this.inspectWindow || {...target, title: this.title || 'Fixture'}, created: time, generation: this.generation, controls, elements: raw, degraded: !!this.degraded, truncated: !!this.truncated};
      this.snapshots.clear(); this.snapshots.set(id, snapshot);
      return {snapshot: id, controls, window: snapshot.window};
    },
    async action(args, context) {
      context.assertActive();
      const snapshot = this.getSnapshot(args.snapshot, this.generation);
      assert.equal(snapshot.controls[Number(args.control_id)].name, args.expected_name);
      this.inputs.push({...args});
      if (this.onAction) await this.onAction(args);
      else if (args.kind === 'type') this.elements[Number(args.control_id)].value = args.text;
      const observation = await this.inspect(target);
      return {status: 'unverified', verified: false, effect: 'unverifiable', observation};
    },
  };
  return computer;
}

async function setup(elements) {
  const computer = computerFixture(elements);
  const initial = await computer.inspect(target);
  return {computer, adapter: new NativePlanAdapter({computer, target, initialSnapshot: initial.snapshot})};
}

test('native normalization preserves roles, explicit states and protected value redaction', async () => {
  const {adapter} = await setup([
    element('Name', 'ControlType.Edit', {editable: true, value: 'Alice', has_keyboard_focus: true}),
    element('Flag', 'CheckBox', {toggle_state: 0}),
    element('Item', 'ListItem', {is_selected: true}),
    element('Secret', 'Edit', {protected: true, value: 'never expose'}),
  ]);
  const observed = await adapter.snapshot();
  assert.equal(observed.complete, true);
  assert.equal(observed.controls[0].role, 'textbox');
  assert.equal(observed.controls[0].focused, true);
  assert.equal(observed.controls[1].checked, false);
  assert.equal(observed.controls[2].role, 'option');
  assert.equal(observed.controls[2].selected, true);
  assert.equal('value' in observed.controls[3], false);
  assert.match(observed.revision, /^[a-f0-9]{24}$/);
  assert.equal(observed.revision.includes('Alice'), false);
});

test('driver selected state represents checked only on checkboxes',async()=>{
 const {adapter}=await setup([element('Flag','CheckBox',{selected:true}),element('Other','CheckBox',{selected:false}),element('Page','Tab',{selected:true}),element('Unknown','CheckBox')]);
 const {controls}=await adapter.snapshot();assert.equal(controls[0].checked,true);assert.equal(controls[1].checked,false);assert.equal(controls[2].checked,undefined);assert.equal(controls[3].checked,undefined);
});

test('a current initial snapshot and post-action snapshot avoid duplicate provider reads', async () => {
  const {computer, adapter} = await setup([element('Name', 'Edit', {value: 'old'})]);
  const result = await executePlan({adapter, steps: [{op: 'fill', target: selector('Name', 'textbox'), text: 'new'}], completion: [{target: selector('Name', 'textbox'), condition: 'value', value: 'new'}]});
  assert.equal(result.status, 'completed');
  assert.equal(computer.reads, 2); // initial observation + the driver's post-input observation
  assert.equal(computer.inputs.length, 1);
  assert.equal(computer.inputs[0].kind, 'type');
  assert.equal(computer.inputs[0].text, 'new');
});

test('native state events invalidate reuse even within the one-second cache window',async()=>{
  const {NativeStateSignals}=require('../native-state-signals');
  const {computer,adapter}=await setup([element('Name','Edit',{value:'old'})]);
  computer.signals=new NativeStateSignals();computer.signals.accept({ready:true});
  computer.getSnapshot(adapter.cachedId,0).stateStamp=computer.signals.stamp(target);
  await adapter.snapshot();assert.equal(computer.reads,1);
  computer.elements[0].value='external change';computer.signals.accept({kind:'changed',window:target.window_id});
  const fresh=await adapter.snapshot();assert.equal(computer.reads,2);assert.equal(fresh.controls[0].value,'external change');
  computer.signals.stop();await adapter.snapshot();assert.equal(computer.reads,3);
});

test('only explicit confirmed native acknowledgements enter the delivered-step ledger', async () => {
  for(const acknowledgement of [
    {status:'verified',verified:true,effect:'confirmed'},
    {status:'unverified',verified:false,effect:'unverifiable'},
    {status:'verified',verified:true,effect:'confirmed',action_attempted:false},
    {status:'refused',verified:true,effect:'confirmed',refused:true},
    {status:'unverified',verified:false,effect:'unverifiable',input_delivered:true},
  ]){
    const {computer,adapter}=await setup([element('Name','Edit',{value:'old'})]),action=computer.action.bind(computer);
    computer.action=async(args,context)=>({...await action(args,context),...acknowledgement});
    const result=await executePlan({adapter,steps:[{op:'fill',target:selector('Name','textbox'),text:'new'}],completion:[{target:selector('Name','textbox'),condition:'value',value:'new'}]});
    const expected=acknowledgement.input_delivered===true||acknowledgement.effect==='confirmed'&&!acknowledgement.refused&&acknowledgement.action_attempted!==false;
    assert.equal(result.delivered_steps.length,expected?1:0,JSON.stringify(acknowledgement));
  }
});

test('failed native confirmation is never upgraded to acknowledged delivery',async()=>{
  for(const acknowledgement of [{status:'unverified',effect:'confirmed',verified:true,requires_review:true},{status:'observation_failed',effect:'confirmed',verified:true,outcome_unknown:true}]){
    const {computer,adapter}=await setup([element('Next')]),action=computer.action.bind(computer);computer.action=async(args,context)=>({...await action(args,context),...acknowledgement});
    const result=await executePlan({adapter,steps:[{op:'click',target:selector('Next')}],completion:[{target:selector('Next'),condition:'exists'}]});assert.equal(result.delivered_steps.length,0);assert.equal(result.status,'interrupted');assert.equal(result.outcome_unknown,true);
  }
});

test('old or invalidated snapshots are reread and control indices rebound live', async () => {
  const {computer, adapter} = await setup([element('Next')]);
  const observed = await adapter.snapshot();
  computer.advance(1001);
  computer.elements = [element('Other'), element('Next')];
  await adapter.act({op: 'click', target: selector('Next')}, observed.controls[0]);
  assert.equal(computer.inputs[0].control_id, '1');
  assert.equal(computer.inputs[0].snapshot, 'snapshot-2');
  assert.equal(computer.reads, 3);
  await computer.inspect(target); // invalidates the adapter's cached token
  const renewed = await adapter.snapshot();
  assert.equal(renewed.snapshot, 'snapshot-5');
});

test('future native controls can appear after navigation without original index reuse', async () => {
  const {computer, adapter} = await setup([element('Open')]);
  computer.onAction = args => {
    if (args.expected_name === 'Open') computer.elements = [element('Unrelated'), element('Name', 'Edit', {value: 'old'}), element('Save')];
    if (args.kind === 'type') computer.elements[1].value = args.text;
    if (args.expected_name === 'Save') computer.elements = [element('Saved')];
  };
  const result = await executePlan({adapter, steps: [
    {op: 'click', target: selector('Open')},
    {op: 'fill', target: selector('Name', 'textbox'), text: 'Alpha'},
    {op: 'click', target: selector('Save')},
  ], completion: [{target: selector('Saved'), condition: 'exists'}]});
  assert.equal(result.status, 'completed');
  assert.deepEqual(computer.inputs.map(args => [args.kind, args.control_id, args.snapshot]), [['click', '0', 'snapshot-1'], ['type', '1', 'snapshot-2'], ['click', '2', 'snapshot-3']]);
  assert.equal(computer.reads, 4);
});

test('native target becoming ambiguous during a refresh is refused before input', async () => {
  const {computer, adapter} = await setup([element('Next')]);
  const observed = await adapter.snapshot();
  computer.advance(1001);
  computer.elements = [element('Next'), element('Next', 'Button', {enabled: false})];
  await assert.rejects(adapter.act({op: 'click', target: selector('Next')}, observed.controls[0]), error => error.code === 'ambiguous_target' && error.refused === true);
  assert.equal(computer.inputs.length, 0);
});

test('known exact window scope is required; title changes in the same window are supported', async () => {
  const {computer, adapter} = await setup([element('Next')]);
  assert.throws(() => new NativePlanAdapter({computer, target: {pid: 22, window_id: 901}}), /List windows/);
  computer.title = 'Another view';
  assert.equal((await adapter.snapshot({refresh: true})).window.title, 'Another view');
  computer.inspectWindow = {pid: 21, window_id: 901};
  await assert.rejects(adapter.snapshot({refresh: true}), error => error.code === 'scope_changed');
  assert.equal(computer.inputs.length, 0);
});

test('native press requires exactly one observed focused control and a current token', async () => {
  for (const rows of [
    [element('Name', 'Edit', {value: 'old'})],
    [element('Name', 'Edit', {focused: false}), element('Other', 'Edit', {focused: true})],
    [element('Name', 'Edit', {focused: true}), element('Other', 'Edit', {focused: true})],
  ]) {
    const {computer, adapter} = await setup(rows);
    const result = await executePlan({adapter, steps: [{op: 'press', target: selector('Name', 'textbox'), key: 'Enter'}], completion: [{target: selector('Name', 'textbox'), condition: 'exists'}]});
    assert.equal(result.reason, 'focus_unconfirmed');
    assert.equal(result.outcome_unknown, undefined);
    assert.equal(computer.inputs.length, 0);
  }
  const {computer, adapter} = await setup([element('Name', 'Edit', {focused: true})]);
  const observed = await adapter.snapshot();
  await adapter.act({op: 'press', target: selector('Name', 'textbox'), key: 'ArrowDown'}, observed.controls[0]);
  assert.equal(computer.inputs[0].key, 'Down');
  assert.equal(computer.inputs[0].kind, 'key');
  assert.equal(computer.inputs[0].control_id, '0');
});

test('native selection uses an observed option and verifies selected state', async () => {
  const {computer, adapter} = await setup([element('Alpha', 'ListItem', {selected: false})]);
  computer.onAction = () => {computer.elements[0].selected = true;};
  const result = await executePlan({adapter, steps: [{op: 'select', target: selector('Alpha', 'option')}], completion: [{target: selector('Alpha', 'option'), condition: 'selected'}]});
  assert.equal(result.status, 'completed');
  assert.equal(computer.inputs[0].kind, 'click');
  const frame = await adapter.snapshot();
  await assert.rejects(adapter.act({op: 'select', target: selector('Alpha', 'option'), value: 'Alpha'}, frame.controls[0]), error => error.code === 'unsupported_selection');
  assert.equal(computer.inputs.length, 1);
});

test('partial native tree and cancellation after inspection never send input', async () => {
  const {computer, adapter} = await setup([element('Next')]);
  computer.degraded = true;
  await adapter.snapshot({refresh: true});
  let result = await executePlan({adapter, steps: [{op: 'click', target: selector('Next')}], completion: [{target: selector('Next'), condition: 'exists'}]});
  assert.equal(result.reason, 'incomplete_observation');
  assert.equal(computer.inputs.length, 0);
  computer.degraded = false;
  const controller = new AbortController();
  const original = computer.inspect;
  computer.inspect = async args => {const value = await original.call(computer, args); controller.abort(); return value;};
  const cancelled = new NativePlanAdapter({computer, target});
  result = await executePlan({adapter: cancelled, context: {signal: controller.signal}, steps: [{op: 'click', target: selector('Next')}], completion: [{target: selector('Next'), condition: 'exists'}]});
  assert.equal(result.status, 'interrupted');
  assert.equal(computer.inputs.length, 0);
});

test('a session generation change invalidates adapter scope immediately', async () => {
  const {computer, adapter} = await setup([element('Next')]);
  computer.generation++;
  await assert.rejects(adapter.snapshot(), /session stopped/);
  assert.equal(computer.inputs.length, 0);
});
