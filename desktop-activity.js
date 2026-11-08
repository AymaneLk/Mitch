'use strict';

/** Keeps the desktop indicator visible from the first desktop tool to task end. */
class DesktopActivity {
  constructor({show, hide}) {
    if (typeof show !== 'function' || typeof hide !== 'function') throw new TypeError('Desktop indicator show/hide callbacks are required.');
    this.show = show;
    this.hide = hide;
    this.scopes = new Map();
    this.generation = 0;
    this.visibilityEpoch = 0;
    this.visible = false;
    this.showing = null;
  }

  beginScope() {
    const token = Symbol('desktop-task');
    this.scopes.set(token, {generation: this.generation, active: false, ended: false, inFlight: 0});
    return token;
  }

  get active() { return [...this.scopes.values()].some(scope => scope.active); }

  assertScope(token, allowEnded = false) {
    const scope = this.scopes.get(token);
    if (!scope || scope.generation !== this.generation || (scope.ended && !allowEnded)) throw new Error('Desktop task stopped or expired. Start a new task to continue.');
    return scope;
  }

  async ensureVisible() {
    if (this.visible) return;
    if (this.showing) return this.showing;
    const epoch = this.visibilityEpoch;
    const pending = Promise.resolve().then(async () => {
      if (epoch !== this.visibilityEpoch || !this.active) throw new Error('Desktop task stopped before its indicator was ready.');
      const shown = await this.show();
      if (epoch !== this.visibilityEpoch || !this.active) {
        // A newer active task may own the overlay now; never hide its indicator.
        if (!this.active) this.hideSafely();
        throw new Error('Desktop task stopped before its indicator was ready.');
      }
      if (shown === false) throw new Error('The computer-use indicator could not be shown.');
      this.visible = true;
    });
    this.showing = pending;
    try { await pending; }
    finally { if (this.showing === pending) this.showing = null; }
  }

  async run(token, fn) {
    if (typeof fn !== 'function') throw new TypeError('A desktop operation callback is required.');
    const ephemeral = token == null;
    if (ephemeral) token = this.beginScope();
    const scope = this.assertScope(token);
    scope.active = true;
    let entered = false;
    try {
      await this.ensureVisible();
      this.assertScope(token);
      scope.inFlight++;
      entered = true;
      const result = await fn();
      this.assertScope(token, true);
      return result;
    } finally {
      if (entered) {
        scope.inFlight--;
        if (scope.ended && scope.inFlight === 0) this.removeScope(token);
      }
      if (ephemeral) this.endScope(token);
    }
  }

  hideSafely() {
    // Cleanup must not replace an operation's original error.
    try { this.hide(); } catch {}
  }

  endScope(token) {
    const scope = this.scopes.get(token);
    if (!scope) return;
    scope.ended = true;
    // A response may finish while a tool is still settling. Keep the indicator
    // visible until that actual operation drains; only Stop hides immediately.
    if (scope.inFlight === 0) this.removeScope(token);
  }

  removeScope(token) {
    if (!this.scopes.delete(token)) return;
    if (!this.active) {
      this.visibilityEpoch++;
      this.visible = false;
      this.showing = null;
      this.hideSafely();
    }
  }

  stop() {
    this.generation++;
    this.visibilityEpoch++;
    this.scopes.clear();
    this.visible = false;
    this.showing = null;
    this.hideSafely();
  }
}

module.exports = {DesktopActivity};
