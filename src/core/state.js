import { SYSTEMS } from '../data/systems.js';

const bus = new EventTarget();

export const state = {
  mode: 'explore',           // explore | systems | age | effects
  sex: 'male',
  age: 30,
  weightKg: null,          // null = use the median for this age+sex
  heightCm: null,          // null = use the median for this age+sex
  muscle: 0.5,             // 0 = untrained/frail, 0.5 = average, 1 = highly trained athlete
  bodyFatPct: null,        // null = estimate it; a number = the user told us their real figure
  units: { mass: 'kg', length: 'cm' },
  lang: 'en',
  skinTone: 'medium',
  selected: null,            // part id
  hovered: null,
  isolate: null,             // part id (or array) whose subtree is isolated
  hidden: new Set(),         // part ids hidden by user
  // What the USER asked for. Only the Systems panel and its presets write here.
  systems: Object.fromEntries(SYSTEMS.map(s => [s.key, { visible: s.vis, opacity: s.op }])),
  // Temporary display override from an effect / composition view / atlas. Never written
  // by the user, always removed when that view closes — so the Systems panel switches
  // can never end up disagreeing with what is actually on screen.
  sysOverride: null,   // null | { [systemKey]: { visible?, opacity? } }
  atlas: false,
  xray: false,
  reveal: true,              // ghost everything except the selection, so deep parts stay visible
  labels: 'auto',            // auto | off | all
  clip: { x: 1, y: 1, z: 1 },// 0..1 fraction kept (1 = no cut)
  effect: null,              // effect id (the one whose detail is open)
  stack: [],                 // effect ids combined together — 'what if I do all of these'
  effectStep: '1d',
  playing: false,
  showLandmarks: true,
  showAttachments: false,
};

export function set(patch) {
  const changed = [];
  for (const k of Object.keys(patch)) {
    if (state[k] !== patch[k]) { state[k] = patch[k]; changed.push(k); }
  }
  if (changed.length) emit('change', { keys: changed });
  return changed;
}

export function emit(name, detail = {}) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) { const h = e => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); }
