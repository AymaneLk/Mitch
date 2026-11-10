(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MitchPlan = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const OPS = new Set(['click', 'fill', 'select', 'press', 'wait', 'assert']);
  const CONDITIONS = new Set(['exists', 'absent', 'value', 'checked', 'selected']);
  const KEYS = new Set(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']);
  const PASSIVE_CLICK_ROLES = new Set(['heading', 'text', 'generic', 'group']);
  const MAX_DURATION = 30000;
  const MAX_TEXT = 12000;
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  const roleAliases = {
    edit: 'textbox', textfield: 'textbox', textarea: 'textbox', textbox: 'textbox',
    pushbutton: 'button', togglebutton: 'button', hyperlink: 'link',
    radiobutton: 'radio', checkbox: 'checkbox', combobox: 'combobox',
    listitem: 'option', option: 'option', tabitem: 'tab', pane: 'group',
    header: 'heading', menuitem: 'menuitem', statictext: 'text',
  };

  function normalizeRole(value) {
    const role = normalized(value).replace(/^(?:controltype\.|uia[_ .-]?)/, '').replace(/controltype$/, '').replace(/[ _-]/g, '');
    return roleAliases[role] || role;
  }

  function fail(reason, message = reason) {
    const error = new Error(message);
    error.code = reason;
    return error;
  }

  function keysOnly(value, allowed, label) {
    if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fail('invalid_plan', `Invalid ${label} fields.`);
  }

  function selector(value, ancestor = false) {
    keysOnly(value, ancestor ? ['role', 'name', 'match'] : ['role', 'name', 'match', 'within'], 'target');
    for (const field of ['role', 'name']) {
      if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim() || value[field].length > (field === 'role' ? 100 : 1000))) {
        throw fail('invalid_plan', `Target ${field} must be a nonempty bounded string.`);
      }
    }
    if (!value.role && !value.name) throw fail('invalid_plan', 'A target requires a name or role.');
    if (value.match !== undefined && !['exact', 'contains'].includes(value.match)) throw fail('invalid_plan', 'Target match must be exact or contains.');
    return { ...(value.role ? {role: value.role} : {}), ...(value.name ? {name: value.name} : {}), match: value.match || 'exact', ...(value.within ? {within:selector(value.within,true)} : {}) };
  }

  function assertion(value, allowed = ['target', 'condition', 'value']) {
    keysOnly(value, allowed, 'assertion');
    const condition = value.condition === undefined ? 'exists' : value.condition;
    if (!CONDITIONS.has(condition)) throw fail('invalid_plan', 'Unsupported assertion condition.');
    if (value.value !== undefined && (typeof value.value !== 'string' || value.value.length > MAX_TEXT)) throw fail('invalid_plan', 'Assertion value must be a bounded string.');
    if (condition === 'value' && typeof value.value !== 'string') throw fail('invalid_plan', 'A value assertion requires the expected value.');
    if (['checked', 'selected'].includes(condition) && value.value !== undefined && !['true', 'false'].includes(value.value)) throw fail('invalid_plan', 'Boolean assertions accept true or false strings.');
    if (['exists', 'absent'].includes(condition) && value.value !== undefined) throw fail('invalid_plan', 'Existence assertions do not accept a value.');
    return { target: selector(value.target), condition, ...(value.value !== undefined ? {value: value.value} : {}) };
  }

  /** Validate the whole plan before any observation or input. No executable code or coordinates. */
  function validatePlan(plan) {
    keysOnly(plan, ['steps', 'completion'], 'plan');
    if (!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 12) throw fail('invalid_plan', 'A plan needs 1 to 12 steps.');
    if (!Array.isArray(plan.completion) || !plan.completion.length || plan.completion.length > 4) throw fail('invalid_plan', 'A plan needs 1 to 4 completion assertions.');
    const steps = plan.steps.map(step => {
      keysOnly(step, ['op', 'target', 'text', 'value', 'key', 'condition', 'timeout_ms'], 'step');
      if (!OPS.has(step.op)) throw fail('invalid_plan', 'Unsupported plan operation.');
      if (step.timeout_ms !== undefined && (!Number.isInteger(step.timeout_ms) || step.timeout_ms < 0 || step.timeout_ms > MAX_DURATION)) throw fail('invalid_plan', 'Step timeout must be between 0 and 30000 ms.');
      const result = {op: step.op, target: selector(step.target), ...(step.timeout_ms !== undefined ? {timeout_ms: step.timeout_ms} : {})};
      if (['wait', 'assert'].includes(step.op)) {
        Object.assign(result, assertion(step, ['op', 'target', 'condition', 'value', 'timeout_ms']));
      } else {
        if (step.condition !== undefined) throw fail('invalid_plan', 'Only wait and assert accept conditions.');
        if (step.op === 'fill') {
          if (typeof step.text !== 'string' || step.text.length > MAX_TEXT) throw fail('invalid_plan', 'Fill needs text of at most 12000 characters.');
          result.text = step.text;
        } else if (step.text !== undefined) throw fail('invalid_plan', 'Only fill accepts text.');
        if (step.op === 'select') {
          if (step.value !== undefined && (typeof step.value !== 'string' || step.value.length > MAX_TEXT)) throw fail('invalid_plan', 'Select value must be a bounded string.');
          if (step.value !== undefined) result.value = step.value;
        } else if (step.value !== undefined) throw fail('invalid_plan', 'This operation does not accept value.');
        if (step.op === 'press') {
          if (!KEYS.has(step.key)) throw fail('invalid_plan', 'Unsupported navigation key.');
          result.key = step.key;
        } else if (step.key !== undefined) throw fail('invalid_plan', 'Only press accepts a key.');
      }
      return result;
    });
    return {steps, completion: plan.completion.map(value => assertion(value))};
  }

  function matchControls(controls, target) {
    return (Array.isArray(controls) ? controls : []).filter(control => {
      if (target.within && !matchControls(control.ancestors || [], target.within).length) return false;
      if (target.role && normalizeRole(control.role || control.type) !== normalizeRole(target.role)) return false;
      if (!target.name) return true;
      const name = normalized(control.name), expected = normalized(target.name);
      return target.match === 'contains' ? name.includes(expected) : name === expected;
    });
  }

  function requireObservation(observation) {
    if (!plain(observation) || !Array.isArray(observation.controls)) throw fail('invalid_observation', 'The adapter returned no accessible controls.');
    if (observation.scope_error || observation.scopeError || observation.scope_errors?.length || observation.scopeErrors?.length) throw fail('scope_changed', String(observation.scope_error || observation.scopeError || observation.scope_errors || observation.scopeErrors));
    if (observation.complete !== true || observation.degraded || observation.truncated) throw fail('incomplete_observation', 'The accessible view is incomplete; the plan stopped.');
    return observation;
  }

  // Native labels often duplicate the name of their associated control. Only
  // disambiguate by an observed role when every discarded match is inert text.
  // Disabled/protected controls and two interactive matches remain ambiguous.
  function typedTarget(controls, target, operation) {
    if (target.role) return target;
    const matches=matchControls(controls,target);
    if(matches.length<2)return target;
    const inert=c=>PASSIVE_CLICK_ROLES.has(normalizeRole(c.role||c.type))&&!c.protected&&!c.editable&&!c.clickable&&c.value===undefined&&c.checked===undefined&&c.selected===undefined;
    const active=matches.filter(c=>!inert(c));
    if(active.length!==1)return target;
    const c=active[0],role=normalizeRole(c.role||c.type);
    if(!role||(['value','fill'].includes(operation)&&typeof c.value!=='string')||(['checked','selected'].includes(operation)&&typeof c[operation]!=='boolean')||!['value','fill','checked','selected','click'].includes(operation))return target;
    return {...target,role};
  }

  function testCondition(observation, expected) {
    requireObservation(observation);
    const matches = matchControls(observation.controls, typedTarget(observation.controls,expected.target,expected.condition));
    if (matches.length > 1) throw fail('ambiguous_target', 'More than one live control matches the target.');
    const condition = expected.condition || 'exists';
    if (condition === 'absent') return matches.length === 0;
    if (matches.length !== 1) return false;
    const control = matches[0];
    if (condition === 'exists') return true;
    if (control.protected) throw fail('protected_target', 'Protected control values cannot be inspected.');
    if (condition === 'value') return control.value !== undefined && String(control.value) === expected.value;
    if (condition === 'checked' || condition === 'selected') return typeof control[condition] === 'boolean' && control[condition] === (expected.value !== 'false');
    throw fail('invalid_plan', 'Unsupported assertion condition.');
  }

  function fingerprint(observation) {
    return JSON.stringify(observation.controls.map(c => [c.name, normalizeRole(c.role || c.type), c.enabled, c.editable, c.protected, c.value, c.checked, c.selected]));
  }

  function cancelError(signal) {
    return signal?.reason instanceof Error ? signal.reason : fail('cancelled', 'The plan was cancelled.');
  }

  /** One model plan, live symbolic resolution per step, and zero mutation retries. */
  async function executePlan({steps, completion, adapter, context = {}, timeoutMs = MAX_DURATION, now = Date.now}) {
    const started = now();
    const result = {status: 'interrupted', verified: false, completed: 0, attempted: 0, steps: [], delivered_steps: [], observation: null, completion: [], stats: {observations: 0, actions: 0, waits: 0, reused_observations: 0, duration_ms: 0}};
    let timer, outerAbort, inMutation = false, awaitingObservation = false, unacknowledgedInput = false, currentRecord, plan, lastUnverified;
    const controller = new AbortController();
    const duration = Number.isFinite(timeoutMs) ? Math.min(MAX_DURATION, Math.max(1, Math.floor(timeoutMs))) : MAX_DURATION;
    const deadline = started + duration;
    const check = () => {
      if (context.signal?.aborted || controller.signal.aborted) throw cancelError(context.signal?.aborted ? context.signal : controller.signal);
      context.assertActive?.();
      if (context.isCancelled?.() === true) throw fail('cancelled', 'The plan was cancelled.');
      if (now() >= deadline) throw fail('deadline_exceeded', 'The plan reached its time limit.');
    };
    const runContext = {...context, signal: controller.signal, deadline, assertActive: check};
    // A hung provider cannot extend the plan deadline. Adapters also check this
    // signal immediately before every input, including after an awaited read.
    const bounded = async operation => {
      check();
      let onAbort;
      try {
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(cancelError(controller.signal));
          controller.signal.addEventListener('abort', onAbort, {once: true});
        });
        const value = await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), aborted]);
        check();
        return value;
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
      }
    };
    const observe = async (refresh, target) => {
      // Once input has been sent, a failed read cannot authorize recovery from
      // stale state. Leave this flag set until a complete fresh view exists.
      awaitingObservation = awaitingObservation || result.attempted > 0;
      const frame = await bounded(() => adapter.snapshot({refresh, selector: target}, runContext));
      result.stats.observations++;
      result.observation = frame;
      requireObservation(frame);
      awaitingObservation = false;
      return frame;
    };
    const sleep = ms => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(id); reject(cancelError(controller.signal)); };
      const id = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
      controller.signal.addEventListener('abort', abort, {once: true});
    });
    const waitFor = async (expected, timeout) => {
      const until = Math.min(deadline, now() + timeout);
      while (!testCondition(result.observation, expected)) {
        check();
        if (now() >= until) throw fail('condition_unmet', `The ${expected.condition || 'exists'} condition did not become true.`);
        const ms = Math.max(1, Math.min(250, until - now()));
        result.stats.waits++;
        if (typeof adapter.waitForChange === 'function') {
          await bounded(() => adapter.waitForChange({timeout_ms: ms, selector: expected.target, revision: result.observation.revision}, runContext));
        } else await bounded(() => sleep(Math.min(100, ms)));
        await observe(true, expected.target);
      }
    };
    try {
      plan = validatePlan({steps, completion});
      if (!adapter || typeof adapter.snapshot !== 'function' || typeof adapter.act !== 'function') throw fail('invalid_adapter', 'The plan needs an observation and action adapter.');
      check();
      outerAbort = () => controller.abort(cancelError(context.signal));
      context.signal?.addEventListener('abort', outerAbort, {once: true});
      timer = setTimeout(() => controller.abort(fail('deadline_exceeded', 'The plan reached its time limit.')), duration);
      for (let index = 0; index < plan.steps.length; index++) {
        check();
        const step = plan.steps[index];
        currentRecord = {index, op: step.op, target: step.target, status: 'pending'};
        result.steps.push(currentRecord);
        // Adapters may return a complete view scoped to this selector. Resolve
        // every new selector against its own live view, including assertions.
        await observe(false, step.target);
        step.target=typedTarget(result.observation.controls,step.target,step.condition||step.op);
        if (['wait', 'assert'].includes(step.op)) {
          await waitFor(step, step.timeout_ms ?? (step.op === 'wait' ? 2000 : 0));
          currentRecord.status = 'passed';
          currentRecord.verified = true;
        } else {
          await waitFor({target: step.target, condition: 'exists'}, step.timeout_ms ?? 2000);
          // Count all matching controls before capability filtering: a disabled
          // duplicate is still ambiguous and never authorizes a different target.
          const matches = matchControls(result.observation.controls, step.target);
          if (matches.length !== 1) throw fail('ambiguous_target', 'The live target is not unique.');
          const control = matches[0];
          if (control.enabled === false || control.protected) throw fail('unavailable_target', 'The target is disabled or protected.');
          if (step.op === 'click' && PASSIVE_CLICK_ROLES.has(normalizeRole(control.role || control.type)) && control.clickable !== true && control.editable !== true) {
            throw fail('non_interactive_target', 'The observed target is passive text or a container. Choose its observed button, link, or another interactive control; no input was sent.');
          }
          if (step.op === 'fill' && control.editable !== true) throw fail('not_editable', 'The observed target is not editable.');
          const signature = JSON.stringify([step.op, step.target, step.text, step.value, step.key]);
          const before = fingerprint(result.observation);
          if (lastUnverified?.signature === signature && lastUnverified.state === before) throw fail('unchanged_repeat', 'The previous input had no verified change; it will not be repeated.');
          check();
          inMutation = true;
          result.attempted++;
          result.stats.actions++;
          const delivered = await bounded(() => adapter.act(step, control, runContext));
          inMutation = false;
          if (!plain(delivered)) throw Object.assign(fail('outcome_unknown', 'The adapter returned no input outcome.'), {outcome_unknown: true});
          currentRecord.delivery = String(delivered.status || (delivered.verified ? 'verified' : 'delivered')).slice(0, 100);
          if (delivered.input_delivered === true) {
            // This is acknowledgment of input delivery, not proof of the
            // requested result. Retain exact live targets so the host can
            // prevent a partial plan's delivered prefix from being replayed.
            const resolved = {name: String(control.name ?? ''), role: normalizeRole(control.role || control.type), match: 'exact', ...(control.ancestors?.length ? {ancestors:control.ancestors} : {})};
            currentRecord.known_delivery = true;
            currentRecord.resolved_target = resolved;
            result.delivered_steps.push({index, op: step.op, target: resolved,
              ...(step.text !== undefined ? {text: step.text} : {}),
              ...(step.value !== undefined ? {value: step.value} : {}),
              ...(step.key !== undefined ? {key: step.key} : {}),
            });
          }
          if (delivered.observation) {
            result.observation = delivered.observation;
            result.stats.reused_observations++;
          }
          if (delivered.outcome_unknown || delivered.uncertain || ['unknown', 'observation_failed'].includes(delivered.status)) throw Object.assign(fail('outcome_unknown', 'The last input outcome is unknown; no input will be repeated.'), {outcome_unknown: true});
          if (delivered.requires_review || delivered.scope_error || delivered.scopeError || delivered.scope_errors?.length || delivered.scopeErrors?.length || ['refused', 'failed', 'error', 'interrupted', 'cancelled', 'observation_failed'].includes(delivered.status)) {
            const error=fail(delivered.scope_error || delivered.scopeError ? 'scope_changed' : 'action_interrupted', delivered.message || 'The action requires review before continuing.');
            if(delivered.requires_review&&!(delivered.refused===true||delivered.action_attempted===false||delivered.status==='refused'))error.outcome_unknown=true;
            throw error;
          }
          awaitingObservation = true;
          if (delivered.observation) requireObservation(result.observation);
          else await observe(true, step.target);
          awaitingObservation = false;
          if (step.op === 'fill') await waitFor({target: step.target, condition: 'value', value: step.text}, step.timeout_ms ?? 2000);
          if (step.op === 'select') await waitFor({target: step.target, condition: step.value !== undefined ? 'value' : 'selected', ...(step.value !== undefined ? {value: step.value} : {})}, step.timeout_ms ?? 2000);
          currentRecord.status = 'delivered';
          currentRecord.verified = !!delivered.verified || ['fill', 'select'].includes(step.op);
          if (!currentRecord.verified && !currentRecord.known_delivery) unacknowledgedInput = true;
          lastUnverified = currentRecord.verified ? null : {signature, state: before};
        }
        result.completed++;
      }
      // Always finish with current read assertions. This verifies this bounded
      // phase only; the caller must review whether the whole user task is done.
      for (const expected of plan.completion) {
        check();
        await observe(false, expected.target);
        const passed = testCondition(result.observation, expected);
        // Keep just the controls needed to independently check this assertion.
        // A native frame can contain hundreds of controls; repeating its full
        // tree for every assertion adds no proof and inflates model input.
        const proof = {...result.observation, controls: matchControls(result.observation.controls, expected.target), selector: expected.target};
        result.completion.push({...expected, passed, observation: proof});
      }
      if (result.completion.some(item => !item.passed)) throw fail('completion_unmet', 'The requested completion assertions did not all pass.');
      result.status = 'completed';
      result.verified = true;
    } catch (error) {
      result.reason = typeof error?.code === 'string' ? error.code : ((controller.signal.aborted || context.signal?.aborted) ? 'cancelled' : 'plan_interrupted');
      result.message = String(error?.message || error).slice(0, 600);
      // Distinguish loss of input acknowledgment from an incorrect prediction
      // of the next control. A fresh view plus acknowledged deliveries allows
      // read/replan recovery, but the host MUST reserve delivered_steps before
      // allowing more input and refuse their replay. Unknown delivery, failed
      // readback and cancellation retain the task-wide stop behavior.
      const cancelledAfterInput = result.attempted > 0 && (controller.signal.aborted || context.signal?.aborted || ['cancelled', 'deadline_exceeded'].includes(error?.code));
      if ((inMutation && !error?.refused) || awaitingObservation || unacknowledgedInput || cancelledAfterInput || error?.outcome_unknown || (error?.action_attempted && !error?.refused)) result.outcome_unknown = true;
      else if (result.delivered_steps.length) result.recovery_required = true;
      if (currentRecord?.status === 'pending') currentRecord.status = 'interrupted';
    } finally {
      clearTimeout(timer);
      if (outerAbort) context.signal?.removeEventListener('abort', outerAbort);
      controller.abort(fail('plan_finished', 'The plan has ended.'));
      result.stats.duration_ms = Math.max(0, now() - started);
    }
    return result;
  }

  return {validatePlan, executePlan, matchControls, testCondition, normalizeRole, typedTarget};
});
