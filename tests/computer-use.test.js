const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ComputerUse } = require('../computer-use');

function fixture(options = {}) {
  const calls = [], confirmations = [];
  let time = 1000;
  const settings = { allowDesktop: true, allowScreen: false };
  let revision = 0;
  const client = {
    running: false,
    async call(name, args) {
      this.running = true;
      calls.push({ name, args });
      if (options.call) {
        const custom = await options.call(name, args);
        if (custom !== undefined) return custom;
      }
      if (name === 'list_windows') return { structuredContent: { windows: [{ pid: 42, window_id: 123, title: 'Editor', app_name: 'Notepad' }] } };
      if (name === 'get_window_state') {
        revision++;
        return { structuredContent: { title: 'Editor', elements: [
          { element_token: `s${revision}:0`, label: 'Save', role: 'button' },
          { element_token: `s${revision}:1`, label: 'Document', role: 'edit', value: 'Old text' },
          { element_token: `s${revision}:2`, label: 'Password', role: 'edit', is_password: true, value: 'must-not-leak' },
        ] }, content: [{ type: 'image', data: 'must-not-leak-image', mimeType: 'image/png' }] };
      }
      return { structuredContent: options.actionResult || { effect: 'unverifiable', verified: false } };
    },
    async stop() { this.running = false; calls.push({ name: 'stop' }); },
  };
  const service = new ComputerUse({ client, getSettings: () => settings, now: () => time,
    confirm: async value => { confirmations.push(value); return options.confirm ? options.confirm(value) : true; } });
  return { service, client, calls, confirmations, settings, advance: n => { time += n; } };
}
const inspect = async f => { if (!f.service.windows.size && !f.service.paused) await f.service.listWindows(); return f.service.inspect({ pid: 42, window_id: 123 }); };

test('generic provider failures after dispatch preserve uncertain delivery for the agent guard',async()=>{
  const f=fixture({call:async name=>name==='click'?{isError:true,structuredContent:{code:'tool_invocation_failed',effect:'refused'}}:undefined}),before=await inspect(f);
  await assert.rejects(f.service.action({snapshot:before.snapshot,kind:'click',control_id:'0',expected_name:'Save'}),error=>error.code==='tool_invocation_failed'&&error.action_attempted===true&&error.refused===false);
  assert.equal(f.calls.filter(c=>c.name==='click').length,1);
});
test('focusing reads controls before raising and verifies the exact foreground window without clicks',async()=>{
  const f=fixture({call:async name=>name==='bring_to_front'?{structuredContent:{now_fg_hwnd:'0x7b',landed_on_target:true}}:undefined});
  await f.service.listWindows();const focused=await f.service.focus({pid:42,window_id:123});
  assert.equal(focused.focus_verified,true);assert.equal(focused.window.window_id,123);
  assert.deepEqual(f.calls.slice(-2).map(c=>c.name),['get_window_state','bring_to_front']);assert.equal(f.calls.filter(c=>c.name==='click').length,0);
});
test('focus does not claim success when Windows reports a different foreground window',async()=>{
  const f=fixture({call:async name=>name==='bring_to_front'?{structuredContent:{now_fg_hwnd:'0x99',landed_on_target:false}}:undefined});
  await f.service.listWindows();await assert.rejects(f.service.focus({pid:42,window_id:123}),/did not confirm focus/);
});

test('fast cursor timing is scoped once per session and reapplied after reconnect or Resume', async()=>{
  const f=fixture();f.client.connectionId=1;
  await inspect(f);await inspect(f);
  let setups=f.calls.filter(call=>call.name==='start_session');
  assert.equal(setups.length,1);
  assert.deepEqual(setups[0].args,{session:f.service.session,cursor_motion:{timing:'fixed',glide_duration_ms:1,dwell_after_click_ms:0}});
  f.client.connectionId=2;await f.service.listWindows();
  assert.equal(f.calls.filter(call=>call.name==='start_session').length,2);
  await f.service.stop();f.service.resume();await inspect(f);
  setups=f.calls.filter(call=>call.name==='start_session');assert.equal(setups.length,3);
  assert.notEqual(setups[0].args.session,setups[2].args.session);
});

test('concurrent reads share setup and a rejected session never reaches the desktop',async()=>{
  const f=fixture();await Promise.all([f.service.listWindows(),f.service.listWindows()]);
  assert.equal(f.calls.filter(call=>call.name==='start_session').length,1);
  const refused=fixture({call:async name=>name==='start_session'?{isError:true,structuredContent:{message:'Session unavailable'}}:undefined});
  await assert.rejects(refused.service.listWindows(),/Session unavailable/);
  assert.deepEqual(refused.calls.map(call=>call.name),['start_session']);
});

test('Stop during session setup prevents its late result from admitting desktop calls',async()=>{
  let finish,entered;const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({call:async name=>{if(name==='start_session'){entered();return new Promise(resolve=>{finish=resolve;});}}});
  const pending=f.service.listWindows();const rejected=assert.rejects(pending,/stopped/);
  await started;await f.service.stop();finish({structuredContent:{active:true}});await rejected;
  assert.deepEqual(f.calls.map(call=>call.name),['start_session','stop']);
});

test('Cua 0.41 confirmed effect is recognized without a legacy verified field',async()=>{
  const f=fixture({actionResult:{effect:'confirmed'}}),before=await inspect(f);
  const result=await f.service.action({snapshot:before.snapshot,kind:'click',control_id:'0',expected_name:'Save'});
  assert.equal(result.verified,true);assert.equal(result.status,'verified');assert.ok(result.observation);
});

test('accessibility inspection works without screen sharing and strips images, tokens and protected values', async () => {
  const f = fixture();
  assert.equal((await f.service.listWindows({ query: 'note' })).windows.length, 1);
  const observation = await inspect(f);
  assert.equal(observation.status, 'inspected');
  assert.equal(observation.controls[1].value, 'Old text');
  assert.equal(observation.controls[2].protected, true);
  assert.ok(!JSON.stringify(observation).includes('must-not-leak'));
  assert.ok(!JSON.stringify(observation).includes('element_token'));
  assert.equal(f.calls.find(c => c.name === 'get_window_state').args.include_screenshot, false);
  assert.equal(f.calls.find(c => c.name === 'get_window_state').args.tree_format, 'elements');
});

test('click binds exact window and token, confirms, then observes without claiming unverified success', async () => {
  const f = fixture(), before = await inspect(f);
  const result = await f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' });
  assert.deepEqual(f.calls.map(c => c.name), ['start_session', 'list_windows', 'get_window_state', 'click', 'get_window_state']);
  assert.deepEqual(f.calls[3].args.target, { kind: 'window', pid: 42, window_id: 123 });
  assert.equal(f.calls[3].args.element_token, 's1:0');
  assert.equal(f.calls[3].args.delivery_mode, 'background');
  assert.equal(f.confirmations[0].control.name, 'Save');
  assert.equal(result.verified, false);
  assert.equal(result.status, 'unverified');
  assert.notEqual(result.observation.snapshot, before.snapshot);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' }), /expired or was replaced/);
});

test('type replaces through set_value without inserting a key or pasting', async () => {
  const f = fixture({ actionResult: { effect: 'confirmed', verified: true } }), before = await inspect(f);
  const result = await f.service.action({ snapshot: before.snapshot, kind: 'type', control_id: '1', expected_name: 'Document', text: 'سلام' });
  assert.equal(result.verified, true);
  assert.equal(f.calls[3].name, 'set_value');
  assert.equal(f.calls[3].args.value, 'سلام');
  assert.equal(f.calls[3].args.element_token, 's1:1');
  assert.equal(f.confirmations[0].text, 'سلام');
  assert.ok(!f.calls.some(c => ['press_key', 'type_text', 'clipboard_write'].includes(c.name)));
});

test('refuses wrong labels, password fields, invalid target and shell shortcuts before mutation', async () => {
  const f = fixture(), before = await inspect(f);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Delete' }), /label/);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'type', control_id: '2', text: 'secret' }), /protected/);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'type', control_id: '1', expected_name: 'Wrong field', text: 'new' }), /label/);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'type', control_id: '0', expected_name: 'Save', text: 'new' }), /editable/);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'key', key: 'Win+R' }), /navigation/);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'scroll', direction: 'down', amount: 50 }), /1 to 10/);
  await assert.rejects(f.service.inspect({ pid: 42, window_id: '123' }), /exact/);
  assert.equal(f.calls.length, 3);
  assert.equal(f.confirmations.length, 0);
});

test('inspection requires an exact identity from observed windows', async () => {
  const f = fixture();
  await assert.rejects(f.service.inspect({ pid: 42, window_id: 123 }), /List windows first/);
  assert.equal(f.calls.length, 0);
});

test('incomplete element list is explicitly partial even without a truncated flag', async () => {
  const f = fixture({ call: async name => name === 'get_window_state' ? { structuredContent: { elements: [], elements_complete: false } } : undefined });
  const observation = await inspect(f);
  assert.equal(observation.status, 'partial');
  assert.equal(observation.truncated, true);
});

test('expired and replaced snapshots cannot dispatch actions', async () => {
  const f = fixture(), before = await inspect(f);
  f.advance(90001);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'key', key: 'Tab' }), /expired/);
  const second = await inspect(f);
  await inspect(f);
  await assert.rejects(f.service.action({ snapshot: second.snapshot, kind: 'key', key: 'Tab' }), /replaced/);
  assert.equal(f.confirmations.length, 0);
});

test('permission revocation while confirmation waits prevents input', async () => {
  let approve;
  const f = fixture({ confirm: () => new Promise(resolve => { approve = resolve; }) }), before = await inspect(f);
  const pending = f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' });
  f.settings.allowDesktop = false;
  approve(true);
  await assert.rejects(pending, /Enable desktop/);
  assert.equal(f.calls.length, 3);
});

test('stop during confirmation invalidates work even if resumed before approval resolves', async () => {
  let approve;
  const f = fixture({ confirm: () => new Promise(resolve => { approve = resolve; }) }), before = await inspect(f);
  const pending = f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' });
  await f.service.stop();
  assert.equal(f.service.paused, true);
  await assert.rejects(f.service.listWindows(), /stopped/);
  await assert.rejects(inspect(f), /stopped/);
  f.service.resume();
  approve(true);
  await assert.rejects(pending, /stopped/);
  assert.deepEqual(f.calls.map(c => c.name), ['start_session', 'list_windows', 'get_window_state', 'stop']);
  assert.equal((await inspect(f)).status, 'inspected');
});

test('cancellation returns no success and performs no mutation', async () => {
  const f = fixture({ confirm: () => false }), before = await inspect(f);
  const result = await f.service.action({ snapshot: before.snapshot, kind: 'key', key: 'Tab' });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.verified, false);
  assert.equal(f.calls.length, 3);
});

test('dispatch cancellation while confirmation waits blocks its action without pausing all computer use', async () => {
  let approve;
  const controller = new AbortController();
  const f = fixture({ confirm: () => new Promise(resolve => { approve = resolve; }) }), before = await inspect(f);
  const pending = f.service.action({ snapshot: before.snapshot, kind: 'key', key: 'Tab' }, { signal: controller.signal });
  controller.abort();
  approve(true);
  await assert.rejects(pending, /cancelled/);
  assert.equal(f.calls.length, 3);
  assert.equal(f.service.paused, false);
});

test('timeout does not retry mutation and consumes snapshot', async () => {
  const f = fixture({ call: async name => { if (name === 'click') throw new Error('Timeout'); } }), before = await inspect(f);
  const action = { snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' };
  await assert.rejects(f.service.action(action), /outcome may be unknown/);
  await assert.rejects(f.service.action(action), /replaced/);
  assert.equal(f.calls.filter(c => c.name === 'click').length, 1);
});

test('provider refusals are surfaced with no foreground fallback', async () => {
  const f = fixture({ call: async name => name === 'click' ? { isError: true, structuredContent: { code: 'background_unavailable', effect: 'refused' } } : undefined }), before = await inspect(f);
  await assert.rejects(f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' }), /background_unavailable/);
  assert.equal(f.calls.filter(c => c.name === 'click').length, 1);
});

test('degraded and truncated accessibility results remain partial', async () => {
  const f = fixture({ call: async name => name === 'get_window_state' ? { structuredContent: { elements: [], degraded: true, truncated: true, degraded_reason: 'No accessible controls' } } : undefined });
  const observation = await inspect(f);
  assert.equal(observation.status, 'partial');
  assert.equal(observation.degraded, true);
  assert.equal(observation.truncated, true);
  assert.match(observation.message, /No accessible controls/);
});

test('fresh observation failure preserves actual provider verification without inventing completion', async () => {
  let reads = 0;
  const f = fixture({ actionResult: { effect: 'confirmed', verified: true }, call: async name => { if (name === 'get_window_state' && ++reads === 2) throw new Error('Window closed'); } }), before = await inspect(f);
  const result = await f.service.action({ snapshot: before.snapshot, kind: 'click', control_id: '0', expected_name: 'Save' });
  assert.equal(result.status, 'observation_failed');
  assert.equal(result.verified, true);
  assert.equal(result.observation, undefined);
  assert.match(result.message, /Window closed/);
});
