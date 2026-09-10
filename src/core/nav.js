import { state, set } from './state.js';

/**
 * Navigation history.
 *
 * Every view in this app is fully described by a small snapshot (mode, selection,
 * isolate, effect, atlas…). Recording a snapshot before each navigation lets one Back
 * button undo *any* step — going deeper into a part, opening an effect, isolating,
 * switching mode — instead of the user having to reload the page to escape.
 */
const KEYS = ['mode', 'selected', 'isolate', 'effect', 'effectStep', 'stack', 'atlas', 'sex', 'age', 'weightKg', 'heightCm'];

export class Nav {
  constructor(app) {
    this.app = app;
    this.stack = [];
    this.future = [];
    this.max = 60;
    this._muted = false;
  }

  snapshot() {
    const s = {};
    for (const k of KEYS) s[k] = Array.isArray(state[k]) ? state[k].slice() : state[k];
    s.hidden = new Set(state.hidden);
    s.systems = JSON.parse(JSON.stringify(state.systems));
    return s;
  }

  same(a, b) {
    if (!a || !b) return false;
    return KEYS.every(k => Array.isArray(a[k]) || Array.isArray(b[k])
      ? String(a[k]) === String(b[k])
      : a[k] === b[k]);
  }

  /** Record the CURRENT view before changing to a new one. */
  push(label = '') {
    if (this._muted) return;
    const snap = this.snapshot();
    snap.label = label;
    const top = this.stack[this.stack.length - 1];
    if (this.same(top, snap)) return;          // don't stack duplicates
    this.stack.push(snap);
    if (this.stack.length > this.max) this.stack.shift();
    this.future.length = 0;
    this.app.updateNavUI?.();
  }

  canBack() { return this.stack.length > 0; }
  canForward() { return this.future.length > 0; }

  back() {
    if (!this.stack.length) return false;
    const here = this.snapshot();
    const prev = this.stack.pop();
    this.future.push(here);
    this.restore(prev);
    return true;
  }

  forward() {
    if (!this.future.length) return false;
    const here = this.snapshot();
    const next = this.future.pop();
    this.stack.push(here);
    this.restore(next);
    return true;
  }

  /** Apply a snapshot without recording it as a new step. */
  restore(s) {
    this._muted = true;
    try {
      this.app.applySnapshot(s);
    } finally {
      this._muted = false;
    }
    this.app.updateNavUI?.();
  }

  /** Run a navigation without recording it (used while restoring). */
  silent(fn) {
    const was = this._muted;
    this._muted = true;
    try { fn(); } finally { this._muted = was; }
  }

  reset() { this.stack.length = 0; this.future.length = 0; this.app.updateNavUI?.(); }
}
