const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {validatePlan, executePlan, normalizeRole, matchControls, testCondition} = require('../action-plan');

test('typed targets distinguish inert labels but never two interactive or disabled matches',()=>{
 const {typedTarget}=require('../action-plan'),label={name:'Name',role:'text'},input={name:'Name',role:'textbox',value:'value',editable:true};
 assert.equal(typedTarget([label,input],{name:'Name'},'fill').role,'textbox');
 assert.equal(typedTarget([label,input,{...input,enabled:false}],{name:'Name'},'fill').role,undefined);
 assert.equal(typedTarget([label,{...input,role:'text'}],{name:'Name'},'fill').role,'text');
 assert.equal(typedTarget([label,{...label,clickable:true}],{name:'Name'},'click').role,'text');
 assert.equal(typedTarget([input,{...label,editable:true}],{name:'Name'},'fill').role,undefined);
 assert.equal(typedTarget([input,{...label,protected:true}],{name:'Name'},'fill').role,undefined);
 assert.equal(typedTarget([label,input],{name:'Name',role:'text'},'fill').role,'text');
});

const target = (name, role = 'button') => ({role, name});
const control = (name, role = 'button', extra = {}) => ({id: name, name, role, enabled: true, protected: false, editable: role === 'textbox', ...extra});
const frame = controls => ({controls, complete: true});
const click = name => ({op: 'click', target: target(name), timeout_ms: 0});
const exists = name => ({target: target(name), condition: 'exists'});

test('the exact same dependency-free engine loads as a browser global', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../action-plan'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.MitchPlan.executePlan, 'function');
  assert.equal(sandbox.MitchPlan.normalizeRole('ControlType.Edit'), 'textbox');
});

test('validation rejects executable fields, missing assertions and oversized plans before reads', async () => {
  const good = {steps: [click('Next')], completion: [exists('Done')]};
  assert.equal(validatePlan(good).steps[0].target.match, 'exact');
  assert.throws(() => validatePlan({...good, script: 'click()'}), /Invalid plan/);
  for (const plan of [
    {...good, steps: [{...click('Next'), script: 'click()'}]}, {...good, completion: []}, {...good, steps: Array(13).fill(click('Next'))},
    {...good, steps: [{op: 'evaluate', target: target('Next')}]},
    {...good, steps: [{...click('Next'), x: 4}]},
    {...good, steps: [{op: 'press', target: target('Next'), key: 'Ctrl+A'}]},
    {...good, steps: [{op: 'fill', target: target('Name'), text: 'x'.repeat(12001)}]},
    {...good, completion: [{target: {}, condition: 'exists'}]},
    {...good, completion: [{target: target('Done'), condition: 'selected', value: 'yes'}]},
    {...good, completion: [{target: target('Done'), condition: null}]},
  ]) {
    assert.throws(() => validatePlan(plan), /./);
    const result = await executePlan({...plan, adapter: {snapshot() { throw Error('must not read'); }, act() { throw Error('must not act'); }}});
    assert.equal(result.reason, 'invalid_plan');
    assert.equal(result.stats.observations, 0);
  }
});

test('one plan resolves future controls live across two dynamic transitions', async () => {
  let state = [control('Search', 'textbox', {value: 'old'}), control('Search')];
  const calls = [];
  const adapter = {
    async snapshot() { return frame(state); },
    async act(step, found) {
      calls.push([step.op, found.id]);
      if (step.op === 'fill') state = state.map(c => c.id === found.id && c.role === found.role ? {...c, value: step.text} : c);
      if (step.op === 'click' && found.name === 'Search') state = [control('Edit first result')];
      if (step.op === 'click' && found.name === 'Edit first result') state = [control('Name', 'textbox', {value: 'old'}), control('Save')];
      if (step.op === 'click' && found.name === 'Save') state = [control('Saved Alpha')];
      return {status: 'unverified', observation: frame(state)};
    },
  };
  const steps = [
    {op: 'fill', target: target('Search', 'textbox'), text: 'Alpha'}, click('Search'),
    {op: 'wait', target: target('Edit first result')}, click('Edit first result'),
    {op: 'fill', target: target('Name', 'textbox'), text: 'Alpha'}, click('Save'),
  ];
  const result = await executePlan({steps, completion: [exists('Saved Alpha')], adapter});
  assert.equal(result.status, 'completed');
  assert.equal(result.verified, true);
  assert.equal(result.completed, 6);
  assert.equal(result.attempted, 5);
  assert.equal(result.stats.waits, 0);
  assert.equal(result.stats.reused_observations, 5);
  assert.deepEqual(calls.map(c => c[0]), ['fill', 'click', 'click', 'fill', 'click']);
});

test('scoped views are freshly resolved for new step targets and final assertions', async () => {
  const all = [control('A'), control('B')];
  const seen = [];
  const adapter = {
    async snapshot({selector}) { seen.push(selector.name); return frame(matchControls(all, selector)); },
    async act() { return {status: 'issued'}; },
  };
  const result = await executePlan({steps: [click('A'), {op: 'assert', target: target('B')}], completion: [exists('B'), {target: target('Missing'), condition: 'absent'}], adapter});
  assert.equal(result.status, 'completed');
  assert.deepEqual(seen, ['A', 'A', 'B', 'B', 'Missing']);
});

test('ambiguous, protected, disabled, partial and uneditable targets produce zero input', async () => {
  for (const observed of [
    frame([control('Next'), control('Next', 'button', {enabled: false})]),
    frame([control('Next', 'button', {protected: true})]),
    frame([control('Next', 'button', {enabled: false})]),
    {...frame([control('Next')]), complete: false},
  ]) {
    let actions = 0;
    const result = await executePlan({steps: [click('Next')], completion: [exists('Next')], adapter: {async snapshot() {return observed;}, async act() {actions++;}}});
    assert.equal(result.status, 'interrupted');
    assert.equal(actions, 0);
  }
  assert.throws(() => testCondition({...frame([]), complete: false}, {target: target('Missing'), condition: 'absent'}), /incomplete/);
  let actions = 0;
  const result = await executePlan({steps: [{op: 'fill', target: target('Name', 'textbox'), text: 'x'}], completion: [exists('Done')], adapter: {async snapshot() {return frame([control('Name', 'textbox', {editable: false})]);}, async act() {actions++;}}});
  assert.equal(result.reason, 'not_editable');
  assert.equal(actions, 0);
});

test('a failed exact fill readback prevents the next submit even when driver says verified', async () => {
  let actions = 0;
  const observed = frame([control('Name', 'textbox', {value: 'old'}), control('Submit')]);
  const result = await executePlan({steps: [{op: 'fill', target: target('Name', 'textbox'), text: 'new', timeout_ms: 0}, click('Submit')], completion: [exists('Submit')], adapter: {
    async snapshot() {return observed;}, async act() {actions++; return {status: 'verified', verified: true, observation: observed};},
  }});
  assert.equal(result.reason, 'condition_unmet');
  assert.equal(actions, 1);
  assert.equal(result.verified, false);
});

test('clicking a passive heading or container is refused before any adapter input attempt', async () => {
  for (const role of ['heading', 'Header', 'text', 'StaticText', 'generic', 'group']) {
    let actions = 0;
    const observed = frame([control('Alpha', role), control('Edit first result')]);
    const result = await executePlan({steps: [{op: 'click', target: target('Alpha', role), timeout_ms: 0}], completion: [exists('Edit first result')], adapter: {
      async snapshot() {return observed;}, async act() {actions++; throw Error('Passive text must never receive input.');},
    }});
    assert.equal(result.reason, 'non_interactive_target', role);
    assert.equal(result.attempted, 0, role);
    assert.equal(result.stats.actions, 0, role);
    assert.equal(result.outcome_unknown, undefined, role);
    assert.equal(actions, 0, role);
    assert.equal(result.observation.controls[1].name, 'Edit first result', 'Fresh evidence remains available for choosing the real button.');
  }
});

test('explicit click capability, editable controls and unknown native item roles remain usable', async () => {
  for (const observedControl of [control('Alpha', 'heading', {clickable: true}), control('Alpha', 'group', {editable: true}), control('Alpha', 'DataItem'), control('Alpha', 'textbox')]) {
    let actions = 0;
    const observed = frame([observedControl]);
    const result = await executePlan({steps: [{op: 'click', target: target('Alpha', observedControl.role)}], completion: [{target: target('Alpha', observedControl.role), condition: 'exists'}], adapter: {
      async snapshot() {return observed;}, async act() {actions++; return {status: 'issued', observation: observed};},
    }});
    assert.equal(result.status, 'completed', observedControl.role);
    assert.equal(actions, 1, observedControl.role);
  }
});

test('event-driven waits reread new controls, with no mutation retry', async () => {
  let ready = false, events = 0, actions = 0;
  const adapter = {
    async snapshot() {return frame(ready ? [control('Ready')] : []);},
    async waitForChange({timeout_ms, selector}, context) {assert.ok(timeout_ms <= 250); assert.equal(selector.name, 'Ready'); context.assertActive(); events++; ready = true;},
    async act() {actions++; return {status: 'issued'};},
  };
  const result = await executePlan({steps: [{op: 'wait', target: target('Ready'), timeout_ms: 500}, click('Ready')], completion: [exists('Ready')], adapter});
  assert.equal(result.status, 'completed');
  assert.equal(events, 1);
  assert.equal(actions, 1);
});

test('unknown, refused, review-required and user-cancelled deliveries stop before next input', async () => {
  for (const delivery of [{outcome_unknown: true}, {status: 'refused'}, {status: 'cancelled'}, {status: 'unverified', requires_review: true}]) {
    let actions = 0;
    const observed = frame([control('First'), control('Second')]);
    const result = await executePlan({steps: [click('First'), click('Second')], completion: [exists('Second')], adapter: {
      async snapshot() {return observed;}, async act() {actions++; return {...delivery, observation: observed};},
    }});
    assert.equal(result.status, 'interrupted');
    assert.equal(actions, 1);
    assert.equal(result.verified, false);
  }
});

test('an unchanged unverified input is never replayed, but a different verified state can continue', async () => {
  let actions = 0;
  const observed = frame([control('Next')]);
  const result = await executePlan({steps: [click('Next'), click('Next')], completion: [exists('Next')], adapter: {
    async snapshot() {return observed;}, async act() {actions++; return {status: 'issued', observation: observed};},
  }});
  assert.equal(result.reason, 'unchanged_repeat');
  assert.equal(actions, 1);
});

test('input followed by a failed observation is uncertain even when delivery returned normally', async () => {
  let reads = 0, actions = 0;
  const result = await executePlan({steps: [click('Next'), click('Next')], completion: [exists('Next')], adapter: {
    async snapshot() {if (++reads > 1) throw Error('view unavailable'); return frame([control('Next')]);},
    async act() {actions++; return {status: 'issued'};},
  }});
  assert.equal(result.status, 'interrupted');
  assert.equal(result.outcome_unknown, true);
  assert.equal(actions, 1);
});

test('a future-target failure after an unverified input prevents replay through a new plan', async () => {
  let actions = 0;
  const observed = frame([control('Open result')]);
  const result = await executePlan({steps: [click('Open result'), {op: 'wait', target: target('Edit result'), timeout_ms: 0}], completion: [exists('Edit result')], adapter: {
    async snapshot() {return observed;},
    async act() {actions++; return {status: 'issued', observation: observed};},
  }});
  assert.equal(result.status, 'interrupted');
  assert.equal(result.reason, 'condition_unmet');
  assert.equal(result.completed, 1);
  assert.equal(result.outcome_unknown, true);
  assert.equal(actions, 1);
});

test('acknowledged menu input followed by a missing predicted target yields recoverable exact delivery evidence', async () => {
  let menuOpen = false, actions = 0;
  const profile = control('Open user navigation menu');
  const result = await executePlan({
    steps: [{op: 'click', target: {name: 'user navigation', match: 'contains'}}, {op: 'click', target: target('Your repositories', 'link'), timeout_ms: 0}],
    completion: [{target: target('Repositories', 'link'), condition: 'exists'}],
    adapter: {
      async snapshot({selector}) {return frame(matchControls(menuOpen ? [profile, control('Repositories', 'link')] : [profile], selector));},
      async act() {actions++; menuOpen = true; return {status: 'issued', input_delivered: true};},
    },
  });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.reason, 'condition_unmet');
  assert.equal(result.outcome_unknown, undefined);
  assert.equal(result.recovery_required, true);
  assert.equal(result.completed, 1);
  assert.equal(actions, 1);
  assert.equal(result.steps[0].known_delivery, true);
  assert.deepEqual(result.steps[0].resolved_target, {name: 'Open user navigation menu', role: 'button', match: 'exact'});
  assert.deepEqual(result.delivered_steps, [{index: 0, op: 'click', target: {name: 'Open user navigation menu', role: 'button', match: 'exact'}}]);
});

test('acknowledged inputs remain uncertain after observation loss or cancellation', async () => {
  for (const mode of ['post-input-read', 'later-read', 'cancel']) {
    let reads = 0, actions = 0;
    const controller = new AbortController();
    const result = await executePlan({steps: [click('Next'), {op: 'assert', target: target('Done')}], completion: [exists('Done')], context: {signal: controller.signal}, adapter: {
      async snapshot() {
        reads++;
        if (mode === 'post-input-read' && reads === 2 || mode === 'later-read' && reads === 3) throw Error('view unavailable');
        if (mode === 'cancel' && reads === 3) controller.abort();
        return frame([control('Next'), control('Done')]);
      },
      async act() {actions++; return {status: 'issued', input_delivered: true};},
    }});
    assert.equal(result.status, 'interrupted', mode);
    assert.equal(result.outcome_unknown, true, mode);
    assert.equal(result.recovery_required, undefined, mode);
    assert.equal(result.delivered_steps.length, 1, mode);
    assert.equal(actions, 1, mode);
  }
});

test('unacknowledged earlier input cannot be hidden by a later verified fill', async () => {
  let controls = [control('Next'), control('Name', 'textbox', {value: 'old'})];
  const result = await executePlan({steps: [click('Next'), {op: 'fill', target: target('Name', 'textbox'), text: 'new'}, {op: 'assert', target: target('Missing'), timeout_ms: 0}], completion: [exists('Missing')], adapter: {
    async snapshot() {return frame(controls);},
    async act(step) {
      if (step.op === 'fill') controls = controls.map(item => item.name === 'Name' ? {...item, value: step.text} : item);
      return {status: 'issued', ...(step.op === 'fill' ? {input_delivered: true, verified: true} : {}), observation: frame(controls)};
    },
  }});
  assert.equal(result.reason, 'condition_unmet');
  assert.equal(result.outcome_unknown, true);
  assert.equal(result.recovery_required, undefined);
});

test('completion mismatch after acknowledged fill retains exact bounded text for host replay protection', async () => {
  let state = frame([control('Name', 'textbox', {value: 'old'})]);
  const result = await executePlan({steps: [{op: 'fill', target: target('Name', 'textbox'), text: 'new'}], completion: [exists('Saved')], adapter: {
    async snapshot() {return state;},
    async act() {state = frame([control('Name', 'textbox', {value: 'new'})]); return {status: 'issued', input_delivered: true, observation: state};},
  }});
  assert.equal(result.reason, 'completion_unmet');
  assert.equal(result.outcome_unknown, undefined);
  assert.equal(result.recovery_required, true);
  assert.deepEqual(result.delivered_steps, [{index: 0, op: 'fill', target: {name: 'Name', role: 'textbox', match: 'exact'}, text: 'new'}]);
});

test('completion proofs retain only assertion matches while the final observation stays complete', async () => {
  const observed = {...frame([control('Save'), control('Done'), control('Unrelated')]), document_id: 'owned-document', url: 'https://example.test/view', snapshot: 'fresh'};
  const result = await executePlan({steps: [click('Save')], completion: [exists('Done'), {target: target('Missing'), condition: 'absent'}], adapter: {
    async snapshot() {return observed;}, async act() {return {status: 'verified', verified: true, observation: observed};},
  }});
  assert.equal(result.status, 'completed');
  assert.equal(result.observation.controls.length, 3);
  assert.deepEqual(result.completion.map(proof => proof.observation.controls.map(c => c.name)), [['Done'], []]);
  for (const proof of result.completion) {
    assert.equal(proof.observation.complete, true);
    assert.equal(proof.observation.document_id, 'owned-document');
    assert.equal(proof.observation.url, 'https://example.test/view');
    assert.equal(proof.observation.snapshot, 'fresh');
    assert.equal(testCondition(proof.observation, proof), true);
  }
});

test('final local assertions must all pass; delivery alone never completes a plan', async () => {
  const observed = frame([control('Save')]);
  const result = await executePlan({steps: [click('Save')], completion: [exists('Save'), exists('Saved')], adapter: {
    async snapshot() {return observed;}, async act() {return {status: 'verified', verified: true, observation: observed};},
  }});
  assert.equal(result.reason, 'completion_unmet');
  assert.equal(result.verified, false);
  assert.deepEqual(result.completion.map(c => c.passed), [true, false]);
  assert.deepEqual(result.completion.map(c => testCondition(c.observation, c)), [true, false]);
});

test('pre-cancelled context never observes or acts, and cancellation after a read prevents input', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const adapter = {async snapshot() {calls++; return frame([control('Next')]);}, async act() {calls++;}};
  const first = await executePlan({steps: [click('Next')], completion: [exists('Next')], adapter, context: {signal: controller.signal}});
  assert.equal(first.status, 'interrupted'); assert.equal(calls, 0);
  let cancelled = false;
  const second = await executePlan({steps: [click('Next')], completion: [exists('Next')], context: {isCancelled: () => cancelled}, adapter: {
    async snapshot() {cancelled = true; return frame([control('Next')]);}, async act() {calls++;},
  }});
  assert.equal(second.reason, 'cancelled'); assert.equal(calls, 0);
});

test('a hung provider is bounded by deadline; in-flight input is uncertain and never replayed', async () => {
  let actions = 0;
  const result = await executePlan({steps: [click('Next'), click('Next')], completion: [exists('Next')], timeoutMs: 20, adapter: {
    async snapshot() {return frame([control('Next')]);},
    async act(step, control, context) {actions++; await new Promise(resolve => context.signal.addEventListener('abort', resolve, {once: true})); context.assertActive();},
  }});
  assert.equal(result.status, 'interrupted');
  assert.equal(result.reason, 'deadline_exceeded');
  assert.equal(result.outcome_unknown, true);
  assert.equal(actions, 1);
});

test('checked/selected predicates use observed booleans and never infer missing false state', () => {
  assert.equal(normalizeRole('ControlType.RadioButton'), 'radio');
  assert.equal(normalizeRole('UIA_ListItemControlType'), 'option');
  assert.equal(testCondition(frame([control('Flag', 'checkbox', {checked: false})]), {target: target('Flag', 'checkbox'), condition: 'checked', value: 'false'}), true);
  assert.equal(testCondition(frame([control('Flag', 'checkbox')]), {target: target('Flag', 'checkbox'), condition: 'checked', value: 'false'}), false);
});

test('ancestor selectors disambiguate repeated labels and never fall back when a group is missing',async()=>{
 const controls=['Harbor','Iris'].map(name=>control('Edit','button',{id:name,ancestors:[{name:'Record '+name,role:'group'}]}));
 const scoped={name:'Edit',role:'button',within:{name:'Record Iris',role:'group'}};
 assert.equal(matchControls(controls,scoped)[0].id,'Iris');assert.equal(matchControls(controls,{...scoped,within:{name:'Missing'}}).length,0);
 let actions=0;const out=await executePlan({steps:[{op:'click',target:scoped}],completion:[{target:scoped,condition:'exists'}],adapter:{snapshot:async()=>frame(controls),act:async()=>{actions++;return {input_delivered:true,status:'issued'};}}});
 assert.equal(actions,1);assert.equal(out.verified,true);assert.equal(out.delivered_steps[0].target.ancestors[0].name,'Record Iris');
 assert.throws(()=>validatePlan({steps:[{op:'click',target:{...scoped,within:{name:'Iris',within:{name:'Nested'}}}}],completion:[exists('Done')]}));
});
