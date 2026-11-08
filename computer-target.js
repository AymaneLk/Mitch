'use strict';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const changed = detail => new Error(`Computer sequence target changed: ${detail}. Inspect the window again.`);

function checkSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.controls) || !Array.isArray(snapshot.elements) || snapshot.controls.length !== snapshot.elements.length || snapshot.controls.some(row => !row || typeof row !== 'object') || snapshot.elements.some(row => !row || typeof row !== 'object')) {
    throw changed('invalid control observation');
  }
  if (snapshot.degraded || snapshot.truncated) throw changed('the control observation is incomplete');
  const window = snapshot.window;
  if (!Number.isSafeInteger(window?.pid) || window.pid <= 0 || !Number.isSafeInteger(window.window_id) || window.window_id <= 0 || typeof window.title !== 'string') {
    throw changed('invalid window identity');
  }
  return window;
}

function findUnique(snapshot, name, type) {
  const matches = snapshot.controls.filter(control => control.name === name && control.type === type);
  // Count disabled/protected duplicates too: their later state must not silently
  // change which identically named control a planned action means.
  if (matches.length !== 1) throw changed('the exact control is missing or ambiguous');
  const control = matches[0];
  if (control.protected || control.enabled === false) throw changed('the control is protected or unavailable');
  return control;
}

function elementFor(snapshot, control) {
  const index = Number(control.control_id);
  if (!Number.isSafeInteger(index) || index < 0 || String(index) !== control.control_id || snapshot.controls[index] !== control || !snapshot.elements[index]) {
    throw changed('the control mapping is inconsistent');
  }
  return snapshot.elements[index];
}

function ancestors(snapshot, element) {
  const rows = snapshot.elements;
  const hasHierarchy = rows.some(row => own(row, 'parent_index') || own(row, 'depth'));
  if (!hasHierarchy) return null; // Legacy providers may expose genuinely flat rows.

  // parent_index addresses the provider's native element_index, never Pixie's
  // array-based control_id. Native indices can have gaps and change on re-read.
  const byIndex = new Map();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.element_index) || row.element_index < 0 || byIndex.has(row.element_index)) throw changed('the ancestor mapping is incomplete');
    byIndex.set(row.element_index, row);
  }
  const chain = [], visited = new Set();
  let boundaryDepth = null;
  let row = element;
  while (row) {
    if (visited.has(row.element_index)) throw changed('the ancestor mapping has a cycle');
    visited.add(row.element_index);
    if (own(row, 'depth') && (!Number.isSafeInteger(row.depth) || row.depth < 0)) throw changed('invalid ancestor depth');
    if (row.parent_index == null) {
      // Cua's Windows tree can omit nonactionable containers at any depth.
      // Calculator buttons, for example, have depth 5 without parent_index.
      // Record that observed boundary instead of inventing a missing parent;
      // the window identity, target depth and retained ancestor chain still
      // have to match on every subsequent observation.
      boundaryDepth = row.depth ?? null;
      break;
    }
    if (!Number.isSafeInteger(row.parent_index) || row.parent_index < 0) throw changed('invalid parent index');
    const parent = byIndex.get(row.parent_index);
    if (!parent) throw changed('an ancestor is missing');
    // UIA can omit nonactionable intermediate nodes, so a parent may be more
    // than one level above. Retain the depths to detect changed context later.
    if (own(row, 'depth') && own(parent, 'depth') && parent.depth >= row.depth) throw changed('ancestor depths disagree');
    chain.push({role: String(parent.role ?? parent.type ?? ''), label: String(parent.label ?? parent.name ?? ''), depth: parent.depth ?? null});
    row = parent;
  }
  return {depth: element.depth ?? null, chain, boundaryDepth};
}

function captureTarget(snapshot, controlId) {
  const window = checkSnapshot(snapshot);
  const control = snapshot.controls.find(item => item.control_id === controlId);
  if (!control || typeof control.name !== 'string' || typeof control.type !== 'string' || !control.type) throw changed('the original control is unavailable');
  findUnique(snapshot, control.name, control.type);
  return {
    window: {pid: window.pid, window_id: window.window_id, title: window.title},
    name: control.name, type: control.type,
    ancestors: ancestors(snapshot, elementFor(snapshot, control)),
  };
}

function resolveTarget(snapshot, descriptor) {
  const window = checkSnapshot(snapshot);
  if (!descriptor || window.pid !== descriptor.window?.pid || window.window_id !== descriptor.window.window_id || window.title !== descriptor.window.title) throw changed('the window identity or title changed');
  const control = findUnique(snapshot, descriptor.name, descriptor.type);
  const chain = ancestors(snapshot, elementFor(snapshot, control));
  if (JSON.stringify(chain) !== JSON.stringify(descriptor.ancestors)) throw changed('the control context changed');
  return control;
}

module.exports = {captureTarget, resolveTarget};
