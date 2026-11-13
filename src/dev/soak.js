import * as THREE from 'three';
import { state } from '../core/state.js';
import { EXERCISES } from '../data/exercises.js';

/**
 * Soak test: use the app the way a restless person would, and after every single action
 * check that it is still in a sane state.
 *
 * The faults this hunts are the ones nobody can reproduce on demand: the body vanishing,
 * a system left switched on by a tab that has been closed, a lift's pose carried into
 * Explore, the camera lost in space. Each comes from one action leaving something behind
 * for the next, so the test strings random actions together (from a seed, so a failure can
 * be replayed exactly) and looks for anything left behind.
 *
 * After each action:
 *   camera     the camera and its target are real numbers, inside the room
 *   on screen  if any part is switched on, some of the body is actually drawn
 *   leftovers  nothing from another tab is still active (a lift, its bar, a glow, a
 *              temporary system view, the atlas spread, Film mode)
 *   agreement  what the app says is selected, isolated and shown is what the body shows
 *   errors     nothing was thrown or logged as an error
 *
 * Run in the app's console (or: npm run soak):
 *   (await import('/src/dev/soak.js')).run({ steps: 400, seed: 1 })
 */

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** How many of a coarse grid of screen points have the body under them. */
function coverage(app) {
  const v = app.viewer;
  v._ids && (v._idsAt = 0);
  v.invalidateIds();
  return v.coverage();
}

/** Let everything an action set going finish: the camera move, the restyle, one frame. */
function settle(app) {
  const v = app.viewer;
  // A lift frames its own shot a moment after it opens; here that moment has passed.
  if (app.exercise.ex && app.exercise.autoFrame) app.exercise.frameCamera();
  for (let i = 0; i < 4 && v._tween; i++) v._stepTween(10);
  v.controls.update();
  app.hi.applyAll();
  v.camera.updateMatrixWorld();
  v.renderer.render(v.scene, v.camera);
}

function check(app) {
  const v = app.viewer, body = app.body, rig = body.rig, bad = [];
  const mode = state.mode;
  const fin = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  if (!fin(v.camera.position) || !fin(v.controls.target)) bad.push('camera: position or target is not a number');
  else {
    const d = v.camera.position.distanceTo(v.controls.target);
    if (!(d > 0.02 && d < 20)) bad.push(`camera: ${d.toFixed(2)} m from its target`);
    if (v.controls.target.length() > 12) bad.push(`camera: target ${v.controls.target.length().toFixed(1)} m from the body`);
  }
  let shown = 0;
  for (let s = 0; s < body.count; s++) if (body.isVisible(s)) shown++;
  const batchesOn = body.batches.filter(b => b.mesh.visible).length;
  if (shown && !batchesOn) bad.push(`on screen: ${shown} parts are switched on but every batch is hidden`);
  if (!v.bodyRoot.visible) bad.push('on screen: the body root is hidden');
  // Aimed at the body: standing, the camera's target is somewhere on it.
  if (mode !== 'move' && !state.atlas && fin(v.controls.target)) {
    const h = app.currentHeightM(), p = v.controls.target;
    if (!(Math.abs(p.x) < 0.7 * h && p.y > -0.2 * h && p.y < 1.2 * h && Math.abs(p.z) < 0.6 * h)) bad.push(`camera: aimed at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}), off a body ${h.toFixed(2)} m tall`);
  }
  // X-ray turns everything not picked into a faint ghost, which the picture of solid parts
  // does not count, so there the check on what is drawn does not apply.
  if (shown > 20 && !bad.length && !state.xray) {
    const c = coverage(app);
    // Counted in solid parts: a faded body round a picked part is still a body on screen.
    if (c.parts === 0) bad.push(`on screen: ${shown} parts are switched on but nothing of the body is drawn in view`);
  }
  if (shown === 0 && !state.isolate) bad.push('on screen: no part is switched on at all');
  // In Movement the body is the subject and must be solid: every system on show hides what
  // is behind it, unless the user has asked to see through it (X-ray, or a picked part with
  // Reveal). Dimmed muscles once counted as ghosts and the whole lifter went see-through.
  if (mode === 'move' && app.exercise.ex && !state.xray && !state.selected) {
    const moveView = app.panel?.view;
    for (const b of app.body.batches) {
      if (!b.mesh.visible || b.mesh.material.depthWrite) continue;
      if (moveView === 'all' && (state.systems[b.system]?.opacity ?? 1) < 0.95) continue;   // the user's own see-through setting
      bad.push(`see-through: ${b.system} is drawn as a ghost in Movement`);
    }
  }

  if (mode !== 'move') {
    if (app.exercise.ex) bad.push(`leftover: lift "${app.exercise.ex.id}" still running on the ${mode} tab`);
    if (v.scene.getObjectByName('exercise-props')) bad.push('leftover: a bar or bench is still in the scene');
    if (rig?.ok) {
      const rest = rig.morphedJoint('l', 'grip', new THREE.Vector3()), now = rig.jointAt('grip', 'l', new THREE.Vector3());
      if (rig.enabled.value && rest.distanceTo(now) > 0.2) bad.push(`leftover: the body is still posed (left hand ${(rest.distanceTo(now) * 100).toFixed(0)} cm from where it hangs)`);
    }
    if (!state.atlas && (!v.ground.visible || !v.ring.visible)) bad.push('leftover: the floor disc is hidden outside Movement');
  } else if (!app.exercise.ex) bad.push('agreement: on the Movement tab with no lift running');
  if (mode !== 'effects' && mode !== 'age' && mode !== 'move' && app.hi.effects.size) bad.push(`leftover: ${app.hi.effects.size} parts still glowing on the ${mode} tab`);
  if (mode !== 'systems' && state.atlas) bad.push(`leftover: the atlas is open on the ${mode} tab`);
  if (!!body.shifted !== !!state.atlas) bad.push('agreement: the atlas spread and the atlas switch disagree');
  if (!state.atlas) { for (let s = 0; s < body.count; s++) if (body.state[s * 4] || body.state[s * 4 + 1] || body.state[s * 4 + 2]) { bad.push('leftover: a part is still moved aside as in the atlas'); break; } }
  if (app.film?.active) bad.push('leftover: Film mode is still on');
  if (!v.controls.enabled) bad.push('leftover: the camera controls are switched off');
  if (!!state.isolate !== !!app.hi.isolateSet) bad.push('agreement: isolate is ' + (state.isolate ? 'set in the app but not on the body' : 'on the body but not in the app'));
  if (!state.selected && app.hi.selected.size) bad.push('agreement: parts are highlighted as selected but nothing is selected');
  // A temporary system view belongs to what laid it. With no effect open, no lift, nothing
  // picked and no atlas, the body must be showing the user's own switches.
  const plain = (mode === 'explore' || mode === 'systems' || mode === 'age') && !state.selected && !state.effect && !state.stack.length && !state.atlas;
  if (plain && state.sysOverride) bad.push(`leftover: a temporary system view is still on (${Object.keys(state.sysOverride).join(', ')})`);
  // What the body shows must be what the rules say, part by part.
  let diff = 0, first = null;
  for (let s = 0; s < body.count; s++) {
    const want = app.hi.isPartVisible(body.parts[s]);
    if (!want && body.isVisible(s)) { diff++; first ||= body.parts[s].n; }
  }
  if (diff) bad.push(`agreement: ${diff} parts are drawn that should be hidden (first: ${first})`);
  return bad;
}

export function actions(app, rand) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const body = app.body;
  const visiblePart = () => { for (let i = 0; i < 40; i++) { const s = Math.floor(rand() * body.count); if (body.isVisible(s)) return body.parts[s].id; } return body.parts[0].id; };
  const anyPart = () => body.parts[Math.floor(rand() * body.count)].id;
  const group = () => pick(app.registry.parts.filter(p => p.k === 'group')).id;
  const sysKeys = Object.keys(state.systems);
  return [
    ['mode', () => { const m = pick(['explore', 'systems', 'age', 'effects', 'move']); app.setMode(m); return m; }, 5],
    ['select', () => { const id = visiblePart(); app.selectPart(id, { focus: rand() < 0.5 }); return id; }, 6],
    ['select hidden-system part', () => { const id = anyPart(); app.selectPart(id, { focus: rand() < 0.5 }); return id; }, 3],
    ['select group', () => { const id = group(); app.selectPart(id, { focus: true }); return id; }, 2],
    ['clear selection', () => app.clearSelection(), 4],
    ['isolate', () => { if (state.selected) app.toggleIsolate(state.selected); return state.selected; }, 2],
    ['drill down', () => { if (state.selected) app.drillDown(state.selected); return state.selected; }, 1],
    ['hide', () => { if (state.selected) app.toggleHidden(state.selected); return state.selected; }, 1],
    ['x-ray', () => app.toggleXray(), 2],
    ['reveal', () => app.toggleReveal(), 2],
    ['atlas', () => app.toggleAtlas(), 2],
    ['back', () => { app.goBack(); app.updateNavUI(); }, 6],
    ['forward', () => { app.nav.forward(); app.updateNavUI(); }, 3],
    ['home', () => app.goHome(), 2],
    ['reset camera', () => app.resetCamera(), 2],
    ['camera view', () => { const n = pick(['front', 'back', 'left', 'right', 'top']); app.cameraView(n); return n; }, 2],
    ['focus', () => app.focusSelected(), 2],
    ['system switch', () => { const k = pick(sysKeys); state.systems[k].visible = !state.systems[k].visible; app.refreshVisibility(); return k + '=' + state.systems[k].visible; }, 3],
    ['connective', () => { state.connective = !state.connective; app.refreshVisibility(); }, 1],
    ['lift', () => { if (state.mode !== 'move') app.setMode('move'); const e = pick(EXERCISES); app.setExercise(e.id); return e.id; }, 4],
    ['seek', () => { if (app.exercise.ex) { const t = rand(); app.exercise.seek(t); return t.toFixed(2); } }, 4],
    ['fault', () => { const ex = app.exercise.ex; if (ex?.faults?.length) { const k = rand() < 0.5 ? ex.faults[0].key : null; app.exercise.setFault(k); return k; } }, 1],
    ['movement view', () => { if (state.mode === 'move' && app.panel?.setView) { const k = pick(['muscle', 'skin', 'bone', 'nerve', 'vessel', 'deep', 'all']); app.panel.setView(k); return k; } }, 2],
    ['effect', () => { const e = pick(app.effects.all); app.openEffect(e.id); return e.id; }, 4],
    ['effect step', () => { if (state.mode !== 'effects') return; const t = pick(['1d', '1w', '30d', '60d', '6m', '1y', '5y']); app.setEffectStep(t); return t; }, 3],
    ['stack', () => { if (state.mode !== 'effects') return; const e = pick(app.effects.all); app.toggleStack(e.id); return e.id; }, 2],
    ['close effect', () => { if (state.mode === 'effects' && state.effect) app.closeEffect(rand() < 0.5); }, 2],
    ['clear stack', () => { if (state.mode === 'effects') app.clearStack(); }, 1],
    ['compare', () => { if (state.mode === 'effects') app.setCompare(!app.hi.compare); }, 1],
    ['age', () => { const a = Math.round(rand() * 90); app.setAge(a, { live: rand() < 0.5 }); return a; }, 3],
    ['weight', () => { const w = Math.round(30 + rand() * 90); app.setWeight(w, { live: rand() < 0.5 }); return w; }, 3],
    ['height', () => { const h = Math.round(120 + rand() * 80); app.setHeight(h); return h; }, 1],
    ['film', () => { if (state.mode === 'move' && app.film) { app.film.enter(); app.film.exit(); } }, 1],
    ['panel', () => app.togglePanel(pick(['left', 'right'])), 1],
  ];
}

/**
 * @returns { ok, steps, failures: [{ step, action, arg, problems, trail }] }
 */
export function run({ steps = 300, seed = 1, stopAt = 12, app = window.app } = {}) {
  const rand = rng(seed);
  const errors = [];
  const onErr = (e) => errors.push(String(e.message || e.reason?.message || e.reason || e));
  window.addEventListener('error', onErr); window.addEventListener('unhandledrejection', onErr);
  const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); origErr.apply(console, a); };
  const list = actions(app, rand);
  const bag = list.flatMap((a) => Array(a[2]).fill(a));
  const trail = [], failures = [], seen = new Map();
  settle(app);
  const pre = check(app);
  if (pre.length) failures.push({ step: 0, action: '(start)', problems: pre, trail: [] });
  for (let i = 1; i <= steps && failures.length < stopAt; i++) {
    const [name, fn] = bag[Math.floor(rand() * bag.length)];
    let arg, problems = [];
    try { arg = fn(); } catch (e) { problems.push(`threw: ${e.message} @ ${(e.stack || '').split('\n')[1]?.trim()}`); }
    try { settle(app); problems.push(...check(app)); } catch (e) { problems.push(`settle/check threw: ${e.message} @ ${(e.stack || '').split('\n')[1]?.trim()}`); }
    for (const e of errors.splice(0)) problems.push('error: ' + e);
    trail.push(`${name}${arg != null ? ' ' + arg : ''}`);
    if (trail.length > 8) trail.shift();
    // The same fault reported once, with the first way it was reached.
    const fresh = problems.filter(p => { const k = p.replace(/[\d.]+/g, '#').slice(0, 60); if (seen.has(k)) { seen.set(k, seen.get(k) + 1); return false; } seen.set(k, 1); return true; });
    if (fresh.length) {
      const v = app.viewer, f = (p) => [p.x, p.y, p.z].map(x => +x.toFixed(2));
      failures.push({ step: i, action: name, arg, problems: fresh, trail: [...trail], at: {
        mode: state.mode, selected: state.selected, isolate: state.isolate, hidden: state.hidden.size, xray: state.xray, reveal: state.reveal,
        override: state.sysOverride ? Object.entries(state.sysOverride).map(([k, o]) => k + ':' + o.visible).join(' ') : null,
        systemsOn: Object.keys(state.systems).filter(k => state.systems[k].visible).join(','), lift: app.exercise.ex?.id || null,
        cam: f(v.camera.position), target: f(v.controls.target), cover: v.coverage(),
      } });
    }
  }
  window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onErr);
  console.error = origErr;
  // Leave the app as a person would find it.
  try { app.goHome(); settle(app); } catch { /* reported above if it matters */ }
  return { ok: !failures.length, steps, seed, failures, repeats: Object.fromEntries([...seen].filter(([, n]) => n > 1)) };
}
