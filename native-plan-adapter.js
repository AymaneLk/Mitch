'use strict';

const {matchControls, normalizeRole} = require('./action-plan');
const {createHash} = require('node:crypto');

const KEYS = {Enter: 'Return', Tab: 'Tab', Escape: 'Escape', ArrowDown: 'Down', ArrowUp: 'Up', ArrowLeft: 'Left', ArrowRight: 'Right'};
const MAX_CACHE_AGE = 1000;

function refused(code, message) {
  return Object.assign(new Error(message), {code, refused: true});
}

function booleanState(element, names, state) {
  for (const name of names) if (typeof element[name] === 'boolean') return element[name];
  if (Array.isArray(element.states)) {
    if (element.states.some(value => String(value).toLowerCase() === state)) return true;
    if (element.states.some(value => String(value).toLowerCase() === `not_${state}`)) return false;
  }
  return undefined;
}

function checkedState(element) {
  const state = booleanState(element, ['checked', 'is_checked'], 'checked');
  if (state !== undefined) return state;
  if ([true, 1, 'on', 'On', 'checked'].includes(element.toggle_state)) return true;
  if ([false, 0, 'off', 'Off', 'unchecked'].includes(element.toggle_state)) return false;
  return undefined;
}

/**
 * A plan stays inside one observed process/window. The existing native driver
 * owns element tokens and performs input validation and post-input inspection.
 * It currently supplies full trees, not UIA events or incremental subtree reads.
 */
class NativePlanAdapter {
  constructor({computer, target, context = {}, initialSnapshot} = {}) {
    if (!computer || !['inspect', 'action', 'getSnapshot'].every(name => typeof computer[name] === 'function')) throw refused('invalid_adapter', 'The native adapter requires ComputerUse.');
    if (!Number.isSafeInteger(target?.pid) || target.pid <= 0 || !Number.isSafeInteger(target.window_id) || target.window_id <= 0) throw refused('invalid_target', 'Select an exact observed process and window.');
    this.computer = computer;
    this.target = {pid: target.pid, window_id: target.window_id};
    this.context = context;
    this.generation = computer.generation;
    this.cachedId = typeof initialSnapshot === 'string' ? initialSnapshot : initialSnapshot?.id || initialSnapshot?.snapshot;
    this.check(context);
    if (computer.windows instanceof Map && !computer.windows.has(`${target.pid}:${target.window_id}`)) throw refused('unknown_window', 'List windows before selecting an exact observed window.');
    if (this.cachedId) this.scope(computer.getSnapshot(this.cachedId, this.generation));
  }

  check(context = {}) {
    for (const ctx of context === this.context ? [context] : [this.context, context]) {
      ctx.signal?.throwIfAborted();
      ctx.assertActive?.();
      if (ctx.isCancelled?.() === true) throw refused('cancelled', 'The native plan was cancelled.');
    }
    this.computer.assertReady?.(this.generation);
    if (this.computer.generation !== this.generation) throw refused('scope_changed', 'The computer-use session changed.');
  }

  scope(snapshot) {
    if (snapshot?.window?.pid !== this.target.pid || snapshot?.window?.window_id !== this.target.window_id) throw refused('scope_changed', 'The observation belongs to another window; no input was sent.');
    if (!Array.isArray(snapshot.controls) || !Array.isArray(snapshot.elements) || snapshot.controls.length !== snapshot.elements.length) throw refused('invalid_observation', 'The native control list is inconsistent.');
    return snapshot;
  }

  normalize(snapshot) {
    this.scope(snapshot);
    const controls = snapshot.controls.map(control => {
      const element = snapshot.elements[Number(control.control_id)] || {};
      const checked = checkedState(element);
      const selected = booleanState(element, ['selected', 'is_selected'], 'selected');
      const focused = booleanState(element, ['focused', 'is_focused', 'has_keyboard_focus'], 'focused');
      return {
        id: String(control.control_id), control_id: String(control.control_id),
        name: control.name, role: normalizeRole(control.type), type: control.type,
        enabled: control.enabled !== false, editable: control.editable === true,
        protected: control.protected === true,
        ...(control.protected || control.value === undefined ? {} : {value: String(control.value)}),
        ...(checked === undefined ? {} : {checked}),
        ...(selected === undefined ? {} : {selected}),
        ...(focused === undefined ? {} : {focused}),
      };
    });
    // Snapshot IDs change on every native read. Revision describes observable
    // state instead, so a renewed token alone cannot justify repeating input.
    const revision = createHash('sha256').update(JSON.stringify(controls.map(c => [c.name, c.role, c.enabled, c.editable, c.protected, c.value, c.checked, c.selected, c.focused]))).digest('hex').slice(0, 24);
    return {controls, complete: !snapshot.degraded && !snapshot.truncated, revision, snapshot: snapshot.id, window: {...snapshot.window}, source: 'native-accessibility', ...(snapshot.degraded ? {degraded: true} : {}), ...(snapshot.truncated ? {truncated: true} : {})};
  }

  async snapshot({refresh = false} = {}, context = {}) {
    this.check(context);
    if (!refresh && this.cachedId) {
      let cached;
      try { cached = this.computer.getSnapshot(this.cachedId, this.generation); }
      catch { this.check(context); }
      if (cached) {
        this.scope(cached);
        const age = (typeof this.computer.now === 'function' ? this.computer.now() : Date.now()) - cached.created;
        if (Number.isFinite(age) && age >= 0 && age <= MAX_CACHE_AGE) return this.normalize(cached);
      }
    }
    this.check(context);
    const observed = await this.computer.inspect(this.target);
    this.check(context);
    const snapshot = this.scope(this.computer.getSnapshot(observed.snapshot, this.generation));
    this.cachedId = snapshot.id;
    return this.normalize(snapshot);
  }

  async act(step, matchedControl, context = {}) {
    let args;
    // Every awaited read is followed by cancellation and session checks. Never
    // carry a stale numeric index into input after another observation.
    try {
      this.check(context);
      const frame = await this.snapshot({}, context);
      this.check(context);
      if (!frame.complete) throw refused('incomplete_observation', 'The native accessibility view is incomplete.');
      const matches = matchControls(frame.controls, step.target);
      if (matches.length !== 1) throw refused('ambiguous_target', 'The live native target is missing or ambiguous.');
      const control = matches[0];
      if (control.name !== matchedControl?.name || control.role !== normalizeRole(matchedControl?.role || matchedControl?.type)) throw refused('target_changed', 'The selected native target changed before input.');
      if (control.protected || control.enabled === false) throw refused('unavailable_target', 'The native target is protected or disabled.');
      const internal = this.scope(this.computer.getSnapshot(frame.snapshot, this.generation));
      const element = internal.elements[Number(control.control_id)];
      if (!element || typeof element.element_token !== 'string' || !element.element_token) throw refused('unavailable_target', 'The control has no live native input token.');
      args = {snapshot: frame.snapshot, control_id: control.control_id, expected_name: control.name};
      if (step.op === 'click') args.kind = 'click';
      else if (step.op === 'fill') {
        if (!control.editable || typeof step.text !== 'string' || step.text.length > 12000) throw refused('not_editable', 'The native target cannot accept this replacement text.');
        Object.assign(args, {kind: 'type', text: step.text});
      } else if (step.op === 'press') {
        if (!KEYS[step.key]) throw refused('unsupported_key', 'This navigation key is unsupported.');
        const focused = frame.controls.filter(item => item.focused === true);
        if (focused.length !== 1 || focused[0].id !== control.id) throw refused('focus_unconfirmed', 'The requested key target is not the uniquely observed focused control.');
        Object.assign(args, {kind: 'key', key: KEYS[step.key]});
      } else if (step.op === 'select') {
        if (step.value !== undefined || !['option', 'tab'].includes(control.role)) throw refused('unsupported_selection', 'Native select requires one observed option or tab; select-by-value is not supported by this driver.');
        args.kind = 'click';
      } else throw refused('unsupported_operation', 'This native plan operation is unsupported.');
      this.check(context);
      this.computer.getSnapshot(args.snapshot, this.generation);
    } catch (error) {
      // No input has been invoked yet, so this is a definite refusal.
      error.refused = true;
      throw error;
    }

    const delivered = await this.computer.action(args, {
      signal: context.signal || this.context.signal,
      assertActive: () => this.check(context),
    });
    this.check(context);
    if (!delivered?.observation) return delivered;
    const current = this.scope(this.computer.getSnapshot(delivered.observation.snapshot, this.generation));
    this.cachedId = current.id;
    const acknowledged=delivered.input_delivered===true||(delivered.effect==='confirmed'&&delivered.verified===true&&delivered.action_attempted!==false&&delivered.refused!==true&&!delivered.requires_review&&!delivered.outcome_unknown&&!['error','failed','refused','interrupted','cancelled','observation_failed'].includes(delivered.status));
    return {...delivered,...(acknowledged?{input_delivered:true}:{}),observation: this.normalize(current)};
  }
}

module.exports = {NativePlanAdapter};
