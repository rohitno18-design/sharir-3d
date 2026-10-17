import * as THREE from 'three';
import { Viewer } from './core/viewer.js';
import { loadRegistry } from './core/registry.js';
import { loadBody } from './core/loader.js';
import { Film } from './ui/film.js';
import { Highlighter } from './core/highlight.js';
import { Labels } from './core/labels.js';
import { EffectsLibrary, effectsAtStep, stepOf, combineAtStep, stackTally } from './core/effects.js';
import { setBody, applyMorph, proportions, uniforms as morphUniforms, MODEL_HEIGHT } from './core/morph.js';
import { SYSTEMS, SKIN_TONES } from './data/systems.js';
import { TIMELINE_STEPS, TARGETS } from './data/targets.js';
import { state, set } from './core/state.js';
import { toast, fmtName } from './core/util.js';
import { Topbar } from './ui/topbar.js';
import { ExplorePanel } from './ui/explore.js';
import { SystemsPanel } from './ui/systemsPanel.js';
import { Inspector } from './ui/inspector.js';
import { EffectsPanel, renderEffectDock } from './ui/effectsPanel.js';
import { AgePanel, renderAgeDock } from './ui/agePanel.js';
import { ExercisePanel } from './ui/exercisePanel.js';
import { ExercisePlayer } from './core/exercise.js';
import { EXERCISES, exerciseById } from './data/exercises.js';
import { openMicroModal } from './ui/microModal.js';
import { Nav } from './core/nav.js';
import { openWelcome } from './ui/welcome.js';
import { FEATURES } from './data/flags.js';

const ATLAS_OFFSETS = {
  skeletal: -2.55, muscular: -1.7, joints: -0.85, nervous: 0, cardiovascular: 0.85, lymphoid: 1.7,
  digestive: 2.55, respiratory: 2.55, urinary: 2.55, reproductive: 2.55, endocrine: 2.55, cavities: 2.55,
  integumentary: 3.4, senses: 0, references: 0,
};
const ATLAS_GROUPS = [
  { keys: ['skeletal'], x: -2.55, label: 'Skeleton' },
  { keys: ['muscular'], x: -1.7, label: 'Muscles' },
  { keys: ['joints'], x: -0.85, label: 'Joints' },
  { keys: ['nervous', 'senses'], x: 0, label: 'Nervous' },
  { keys: ['cardiovascular'], x: 0.85, label: 'Circulation' },
  { keys: ['lymphoid'], x: 1.7, label: 'Lymphatic' },
  { keys: ['digestive', 'respiratory', 'urinary', 'reproductive', 'endocrine', 'cavities'], x: 2.55, label: 'Organs' },
  { keys: ['integumentary'], x: 3.4, label: 'Skin' },
];

class App {
  constructor() {
    this.viewer = new Viewer(document.getElementById('gl'));
    this.labels = new Labels(this.viewer, document.getElementById('label-lines'), document.getElementById('labels'));
    this.labels.onClick = (it) => { if (it.target) this.focusTarget(it.target); else if (it.partId) this.selectPart(it.partId, { focus: false }); };
    this.labels.onHover = (it) => { if (it?.target) this.hoverTarget(it.target); else if (!it && this._targetHover) this.hoverTarget(null); else this.hoverPart(it?.partId || null); };
    this.effects = new EffectsLibrary();
    this.ageData = null;
    this.hoverTip = document.getElementById('hover-tip');
    this.morph = morphUniforms;
    this._targetHover = null;
    this.nav = new Nav(this);
  }

  async boot() {
    const bar = document.getElementById('loader-bar');
    const sub = document.getElementById('loader-sub');
    const prog = (p, label) => { bar.style.width = Math.round(p * 92) + '%'; if (label) sub.textContent = label; };

    prog(0.02, 'Loading anatomy index…');
    this.registry = await loadRegistry();
    prog(0.06, 'Loading Hindi names…');
    try { const h = await fetch('/data/hindi.json'); if (h.ok) this.registry.setHindi(await h.json()); } catch {}
    try { const a = await fetch('/data/age.json'); if (a.ok) this.ageData = await a.json(); } catch {}

    prog(0.08, 'Building the body…');
    this.body = await loadBody(this.viewer, this.registry, (p, l) => prog(0.08 + p * 0.9, l));
    // Everything downstream only ever asked "does this part exist?" — keep that answer
    // available without dragging 4,000 mesh objects around.
    this.meshes = { has: (id) => this.body.slot(id) !== undefined, get size() { return 0; } };
    this.hi = new Highlighter(this.viewer, this.registry, this.body);
    this.exercise = new ExercisePlayer(this);
    this.film = new Film(this);
    // The player owns the clock but not the loop: it advances on the frames the viewer is
    // already producing, and asks for more only while something is actually moving.
    this.viewer.onFrame(() => {
      if (!this.exercise.ex) return;
      this.exercise.tick();
    });

    this.applySexParts();
    this.applyBodyMorph();
    this.hi.applyAll();
    this.viewer.resetView(this.currentHeightM());

    // UI
    this.topbar = new Topbar(this);
    this.leftRoot = document.getElementById('left-content');
    this.inspRoot = document.getElementById('inspector');
    this.dock = document.getElementById('dock');
    this.inspector = new Inspector(this.inspRoot, this);
    this.setMode('explore');
    this.syncThemeButton();
    this.watchContext();
    this.bindInput();
    this.updateLegend();
    this.updateNavUI();
    this.syncNarrow();
    window.addEventListener('resize', () => this.syncNarrow());

    prog(1, 'Ready');
    // Fade the loading card out, then take it off the page. Left in place at zero opacity,
    // its pulsing logo kept the compositor busy every frame for the whole session, and it
    // showed through faintly whenever the body was drawn see-through.
    setTimeout(() => {
      const loader = document.getElementById('loader');
      loader.addEventListener('transitionend', () => loader.remove(), { once: true });
      loader.classList.add('done');
      setTimeout(() => loader.remove(), 1200);          // in case the transition never fires
    }, 260);
    setTimeout(() => { document.getElementById('stage-hint').classList.add('fade'); }, 9000);
    setTimeout(() => openWelcome(this), 700);
    window.app = this;
    console.log(`[sharir] ${this.registry.parts.length} registry entries, ${this.body.count} drawable parts in ${this.body.batches.length} batches, ${this.effects.count} interventions`);
  }

  // ---------------- body morph ----------------
  anthroAt(age, sex) {
    const d = this.ageData?.anthro?.[sex];
    if (!d || !d.length) {
      const adult = sex === 'male' ? { height_cm: 165, weight_kg: 65 } : { height_cm: 152, weight_kg: 55 };
      return { age, head_ratio: 0.13, ...adult };
    }
    const sorted = d;
    let lo = sorted[0], hi = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) { if (age >= sorted[i].age && age <= sorted[i + 1].age) { lo = sorted[i]; hi = sorted[i + 1]; break; } }
    if (age <= sorted[0].age) return { ...sorted[0] };
    if (age >= hi.age && lo === hi) return { ...hi };
    const t = hi.age === lo.age ? 0 : (age - lo.age) / (hi.age - lo.age);
    const mix = (a, b) => +(a + (b - a) * t).toFixed(1);
    return { age, height_cm: mix(lo.height_cm, hi.height_cm), weight_kg: mix(lo.weight_kg, hi.weight_kg), head_ratio: +(lo.head_ratio + (hi.head_ratio - lo.head_ratio) * t).toFixed(3) };
  }

  /** Median height for the current age + sex. */
  medianHeightCm() { return this.anthroAt(state.age, state.sex).height_cm; }

  /** Height actually shown: the user's override, clamped to a believable range. */
  currentHeightCm() {
    const med = this.medianHeightCm();
    if (state.heightCm == null) return med;
    return Math.min(med * 1.22, Math.max(med * 0.82, state.heightCm));
  }

  currentHeightM() { return this.currentHeightCm() / 100; }

  currentStage() {
    if (!this.ageData?.stages) return null;
    return this.ageData.stages.find(s => state.age >= s.from && state.age <= s.to) || this.ageData.stages[this.ageData.stages.length - 1];
  }

  /** Median weight for the current age + sex, used as the slider's default and reset point. */
  medianWeight() { return this.anthroAt(state.age, state.sex).weight_kg; }

  /** Weight actually being shown: the user's override if set, otherwise the median. */
  /** Median weight scaled to the chosen height — a taller person's median is heavier. */
  medianWeightForHeight() {
    const hRatio = this.currentHeightCm() / this.medianHeightCm();
    return this.medianWeight() * hRatio * hRatio;      // weight scales with height^2 at constant BMI
  }

  currentWeight() {
    const med = this.medianWeightForHeight();
    if (state.weightKg == null) return med;
    return Math.min(med * 2.4, Math.max(med * 0.62, state.weightKg));
  }

  currentBMI() { const h = this.currentHeightM(); return this.currentWeight() / (h * h); }

  applyBodyMorph({ live = false } = {}) {
    const a = this.anthroAt(state.age, state.sex);
    const h = this.currentHeightM();
    // Split into body scale + head scale so the head fraction AND the total height are both right.
    const { bodyScale, headF } = proportions(h, a.head_ratio);
    const scale = bodyScale;
    const female = state.sex === 'female';
    const adultness = Math.min(1, Math.max(0, (state.age - 10) / 8));

    // Drive the shape from MUSCLE and FAT separately, not from total weight. Two people
    // at the same 80 kg look completely different if one carries 10 kg more muscle and
    // 10 kg less fat — BMI cannot tell them apart, FFMI/FMI can.
    const c = this.bodyComposition();
    const muscleIdx = c.muscleIndex;   // 0 = average untrained, 1 ≈ elite natural
    const fatIdx = c.fatIndex;         // 0 = lean-healthy, 1+ = carrying excess fat
    const mUp = Math.max(0, muscleIdx), mDown = Math.max(0, -muscleIdx);
    const fUp = Math.max(0, fatIdx), fDown = Math.max(0, -fatIdx);

    setBody({
      scale,
      headF,
      // Each trunk band splits into the skeleton's frame (sex and age), muscle and fat, so
      // that bone keeps its size while the soft tissue over it changes. Limb girth, the
      // neck and the face are driven by the same four composition numbers.
      sh:     { frame: female ? -0.105 * adultness : 0.045 * adultness, muscle: mUp * 0.105 - mDown * 0.05, fat: fUp * 0.030 },
      hip:    { frame: female ? 0.165 * adultness : 0.010 * adultness, muscle: mUp * 0.020, fat: fUp * 0.080 },
      waist:  { frame: female ? -0.115 * adultness : 0, muscle: mUp * 0.030, fat: fUp * 0.170 - fDown * 0.060 },
      chestD: { frame: female ? -0.045 * adultness : 0.030 * adultness, muscle: mUp * 0.100 - mDown * 0.045, fat: fUp * 0.060 },
      glute:  (female ? 0.042 * adultness : 0.012 * adultness) + fUp * 0.020 + mUp * 0.016,
      limbW:  state.age < 3 ? 1.12 : state.age < 10 ? 1.05 : 1,
      belly:  Math.max(0, fUp * 0.062 - fDown * 0.014 - mUp * 0.006),
      breast: female ? (0.052 + fUp * 0.020) * adultness : fUp * 0.008,
      face:   fUp * 0.035,
      mUp: mUp * adultness, mDown: mDown * adultness, fUp: fUp * adultness, fDown: fDown * adultness,
    });
    this.applyStance();
    this.viewer.ring.scale.setScalar(Math.max(0.55, scale));
    this.viewer.ground.scale.setScalar(Math.max(0.55, scale));
    // Recomputing 4,066 bounding spheres costs ~48 ms — far too slow to run on every
    // slider event. They only drive frustum culling, and they carry enough padding to
    // stay correct across a single drag step, so settle them after the drag instead.
    if (live) this._deferBounds(); else this.updateBoundingSpheres();
    // age-driven visual effects (scale/opacity per system)
    // Don't wipe a running simulation: the stack can be active with no single effect open,
    // and Movement mode keeps its muscle-effort map in the same channel.
    if (state.mode === 'age') this.applyAgeEffects();
    else if (!state.effect && !state.stack.length && !this.exercise?.ex) this.hi.clearEffects();
    // A resized body has its joints in new places, so the pose has to be solved again or
    // the hands come off the bar and the back lifts off the bench.
    if (this.exercise?.ex) this.exercise.seek(this.exercise.t);
    this.labels.update();
  }

  /**
   * Stand the body the way a body of this build stands: arms and legs carried out as far
   * as its own girth pushes them. Movement poses the body itself, so it is left alone there.
   */
  applyStance() {
    const rig = this.body?.rig;
    if (!rig?.ok || this.exercise?.ex) return;
    const pose = rig.stance();
    if (pose) rig.setPose(pose); else rig.reset();
    this.viewer.requestRender();
  }

  /**
   * Batched meshes have frustumCulled off, so the shader-side morph can never push a part
   * outside stale bounds the way it did when every part was its own culled mesh. Nothing
   * to recompute — kept as a no-op so callers don't need to care.
   */
  updateBoundingSpheres() {}

  // ---------------- modes ----------------
  setMode(mode, record = true) {
    const prevMode = state.mode;
    if (record && mode !== state.mode) this.nav.push('mode');
    // A temporary view belongs to the tab that laid it (an effect, a Movement look, a
    // focused target). Carried into another tab, the body shows one set of systems while
    // the Systems switches show another, and the first switch touched makes several
    // systems appear or vanish at once. Each tab lays its own again below if it wants one.
    if (mode !== state.mode) this.clearSysOverride();
    // The atlas is a Systems view. Every other tab moves, reshapes or lights up one body,
    // and none of that means anything with the systems standing apart.
    if (state.atlas && mode !== 'systems') this.toggleAtlas();
    set({ mode });
    document.getElementById('tb-atlas').hidden = mode !== 'systems';
    this.syncViewTitles();
    document.body.classList.toggle('mode-move', mode === 'move');
    this.topbar.syncToggles();
    this.leftRoot.innerHTML = '';
    if (this.panel?.dispose) this.panel.dispose();
    this.ensurePanel('left');       // the mode's controls live here; never fill a hidden panel
    if (mode === 'explore') this.panel = new ExplorePanel(this.leftRoot, this);
    else if (mode === 'systems') this.panel = new SystemsPanel(this.leftRoot, this);
    else if (mode === 'age') this.panel = new AgePanel(this.leftRoot, this);
    else if (mode === 'effects') this.panel = new EffectsPanel(this.leftRoot, this);
    else if (mode === 'move') { this.exercise.start(exerciseById(state.exercise) || EXERCISES[0]); this.panel = new ExercisePanel(this.leftRoot, this); }
    if (mode !== 'move') { this.film?.exit(); this.exercise?.stop(); }
    // Movement is a picture of a lift, and an empty inspector beside it only takes room
    // from the lifter. It folds away on the way in unless something is already selected
    // (picking a muscle opens it again), and comes back on the way out if it was open.
    const right = document.getElementById('right');
    if (mode === 'move' && !state.selected && !right.classList.contains('collapsed')) {
      this._rightFolded = true;
      this.togglePanel('right', false);
    } else if (mode !== 'move' && this._rightFolded) {
      this._rightFolded = false;
      if (right.classList.contains('collapsed')) this.togglePanel('right', true);
    }
    if (mode !== 'effects') { set({ effect: null, playing: false }); clearTimeout(this._playT); }
    // Coming back to What happens if with a combination already picked shows it, not the list.
    if (mode === 'effects' && !state.effect) set({ fxBrowse: !state.stack.length });
    // dock
    if (mode === 'age') { renderAgeDock(this.dock, this); this.applyAgeEffects(); }
    else if (mode === 'effects' && this.activeEffects().length) { renderEffectDock(this.dock, this); this.applyEffect(); }
    // Movement mode has no dock, but its muscle-effort map lives in the same effect
    // channel — clearing it here would wipe the activation the player just set up.
    else { this.dock.hidden = true; if (mode !== 'move') this.hi.clearEffects(); }
    document.documentElement.style.setProperty('--dock-h', this.dock.hidden ? '0px' : (state.mode === 'age' ? '196px' : '112px'));
    // What a combination does to muscle and fat belongs to What happens if. Leaving the
    // tab gives the body back its own shape.
    if (prevMode === 'effects' && mode !== 'effects') { this.setCompare(false); this.applyBodyMorph(); }
    requestAnimationFrame(() => this.updateSafeInsets());
    this.refreshLabels();
    this.updateNavUI();
  }

  // ---------------- navigation ----------------
  /** Rebuild a whole view from a Nav snapshot. */
  applySnapshot(s) {
    set({ sex: s.sex, age: s.age, weightKg: s.weightKg, heightCm: s.heightCm,
          effectStep: s.effectStep, isolate: s.isolate, selected: s.selected });
    state.hidden = new Set(s.hidden);
    for (const k of Object.keys(s.systems)) state.systems[k] = { ...s.systems[k] };

    this.applyBodyMorph();
    this.hi.setIsolate(s.isolate ? this.registry.subtree(s.isolate).filter(x => this.meshes.has(x)) : null);

    // effect first (it owns the dock), then mode UI
    if (s.effect !== state.effect) set({ effect: s.effect });
    this.setMode(s.mode, false);
    // After the tab, because the atlas only opens on the Systems tab.
    if (!!state.atlas !== !!s.atlas) this.toggleAtlas();
    state.stack = [...(s.stack || [])];
    if (s.mode === 'effects' && (s.effect || state.stack.length)) {
      set({ effect: s.effect, effectStep: s.effectStep });
      this.applyEffect(); this.syncEffectDock(); this.panel?.render?.();
    }

    this.selectedIds = s.selected ? (this.registry.byId.get(s.selected)?.k === 'group'
      ? this.registry.subtree(s.selected).filter(x => this.meshes.has(x)) : [s.selected]) : [];
    this.hi.setSelected(this.selectedIds);
    this.topbar.syncToggles();
    this.inspector.render();
    if (state.mode === 'explore' && s.selected && this.panel?.reveal) this.panel.reveal(s.selected);
    this.hi.invalidate();
    this.refreshLabels();
    this.updateLegend();
  }

  goBack() {
    if (this.nav.back()) return true;
    // Nothing recorded — still give the user an escape from any "deep" state.
    if (state.isolate) { set({ isolate: null }); this.hi.setIsolate(null); this.hi.invalidate(); this.inspector.render(); return true; }
    if (state.selected) { this.clearSelection(); return true; }
    if (state.effect) { this.closeEffect(); return true; }
    if (state.mode === 'effects' && !state.fxBrowse && state.stack.length) { this.browseEffects(); return true; }
    return false;
  }

  goHome() {
    this.nav.push('home');
    this.nav.silent(() => {
      set({ isolate: null, selected: null, effect: null, playing: false, xray: false });
      state.hidden.clear();
      this.hi.setIsolate(null); this.hi.setSelected([]); this.hi.clearEffects();
      if (state.atlas) this.toggleAtlas();
      this.setMode('explore', false);
      this.viewer.resetView(this.currentHeightM());
      this.inspector.render();
      this.hi.invalidate();
      this.refreshLabels();
    });
    this.updateNavUI();
    toast('Back to the whole body');
  }


  // ---------------- display overrides ----------------
  /**
   * Effects, composition views and the atlas need to reveal systems the user has switched
   * off. Writing into state.systems for that would silently rewrite the user's own choices
   * and leave the Systems panel showing something different from the body — the exact
   * de-sync that made the menus feel unreliable. Overrides live in their own layer instead.
   */
  setSysOverride(map) {
    const next = map && Object.keys(map).length ? map : null;
    // Nothing to clear is nothing to redraw. Redrawing the Systems panel on every switch
    // click also threw away the row being clicked, halfway through the click.
    if (!next && !state.sysOverride) return;
    state.sysOverride = next;
    this.hi.invalidate();
    this.updateLegend();
    if (state.mode === 'systems') this.panel?.render?.();
  }

  clearSysOverride() { this.setSysOverride(null); }

  /** Show only these systems, without disturbing what the user has set in the Systems panel. */
  showOnlySystems(keys) {
    if (!keys) { this.clearSysOverride(); return; }
    const want = new Set(keys);
    const ov = {};
    for (const s of SYSTEMS) ov[s.key] = { visible: want.has(s.key), opacity: want.has(s.key) ? 1 : 0 };
    this.setSysOverride(ov);
  }

  /** Build an override that shows every system the given part ids belong to. */
  overrideFor(ids, extra = {}) {
    const ov = {};
    for (const id of ids) {
      const p = this.registry.byId.get(id);
      if (p && state.systems[p.sys] && !state.systems[p.sys].visible) ov[p.sys] = { visible: true };
    }
    for (const [k, v] of Object.entries(extra)) ov[k] = { ...(ov[k] || {}), ...v };
    return ov;
  }

  // ---------------- panels ----------------
  /** side: 'left' | 'right'. `show` omitted = toggle. */
  togglePanel(side, show) {
    const el = document.getElementById(side);
    const hidden = show === undefined ? !el.classList.contains('collapsed') : !show;
    el.classList.toggle('collapsed', hidden);
    document.body.classList.toggle(side + '-hidden', hidden);
    const btn = document.getElementById(side === 'left' ? 'tb-menu' : 'tb-details');
    if (btn) btn.classList.toggle('active', !hidden);
    setTimeout(() => this.updateSafeInsets(), 280);
  }

  /** Any action that puts something INTO a panel must make sure that panel is open,
   *  otherwise the click looks like it did nothing at all. */
  ensurePanel(side) {
    const el = document.getElementById(side);
    if (el.classList.contains('collapsed')) this.togglePanel(side, true);
  }

  /** Refresh the Back/Forward buttons and the "you are here" bar. */
  updateNavUI() {
    const back = document.getElementById('nav-back');
    const fwd = document.getElementById('nav-fwd');
    if (back) back.disabled = !(this.nav.canBack() || state.isolate || state.selected || state.effect);
    if (fwd) fwd.disabled = !this.nav.canForward();
    this.renderContextBar();
  }

  /** A single always-visible line: what you are looking at, and one click out of it. */
  renderContextBar() {
    const bar = document.getElementById('context-bar');
    if (!bar) return;
    const chips = [];
    const MODE_LABEL = { explore: 'Explore', systems: 'Systems', age: 'Age', effects: 'What happens if…', move: 'Movement' };
    chips.push({ text: MODE_LABEL[state.mode] || state.mode, kind: 'mode' });

    if (state.effect) {
      const e = this.effects.get(state.effect);
      if (e) chips.push({ text: `${e.icon || ''} ${e.name.en}`.trim(), kind: 'effect', onClear: () => this.closeEffect() });
    } else if (state.mode === 'effects' && state.stack.length) {
      const list = this.activeEffects();
      const text = list.length > 1 ? `${list.map(e => e.icon || '').join('')} ${list.length} together` : `${list[0]?.icon || ''} ${list[0]?.name.en || ''}`;
      chips.push({ text: text.trim(), kind: 'effect', onClear: () => this.clearStack() });
    }
    if (state.selected) {
      const p = this.registry.byId.get(state.selected);
      if (p) chips.push({ text: fmtName(p, state.lang), kind: 'part', onClear: () => this.clearSelection() });
    }
    if (state.isolate) {
      const p = this.registry.byId.get(state.isolate);
      chips.push({ text: `Inside ${p ? p.n : 'part'}`, kind: 'isolate', onClear: () => { set({ isolate: null }); this.hi.setIsolate(null); this.hi.invalidate(); this.inspector.render(); this.updateNavUI(); } });
    }
    if (state.atlas) chips.push({ text: 'Atlas view', kind: 'atlas', onClear: () => this.toggleAtlas() });
    if (state.xray) chips.push({ text: 'X-ray', kind: 'xray', onClear: () => this.toggleXray() });

    bar.innerHTML = '';
    chips.forEach((c, i) => {
      const chip = document.createElement('span');
      chip.className = 'ctx ctx-' + c.kind;
      chip.textContent = c.text;
      if (c.onClear) {
        const x = document.createElement('button');
        x.className = 'ctx-x'; x.textContent = '×'; x.title = 'Leave this';
        x.addEventListener('click', (ev) => { ev.stopPropagation(); c.onClear(); this.updateNavUI(); });
        chip.appendChild(x);
      }
      bar.appendChild(chip);
      if (i < chips.length - 1) { const s = document.createElement('span'); s.className = 'ctx-sep'; s.textContent = '›'; bar.appendChild(s); }
    });
    bar.hidden = chips.length <= 1;
  }

  /** Sex filtering lives in Highlighter.isPartVisible; this just drops any stale hides. */
  applySexParts() {
    for (const p of this.registry.parts) if (p.sx) state.hidden.delete(p.id);
    this.hi.invalidate();
  }

  setSex(sex) {
    if (state.sex === sex) return;
    const prevMed = this.medianWeightForHeight();
    const prevHMed = this.medianHeightCm();
    set({ sex });
    if (state.heightCm != null && prevHMed > 0) {
      set({ heightCm: +(this.medianHeightCm() * (state.heightCm / prevHMed)).toFixed(1) });
    }
    if (state.weightKg != null && prevMed > 0) {
      set({ weightKg: +(this.medianWeightForHeight() * (state.weightKg / prevMed)).toFixed(1) });
    }
    this.topbar.syncToggles();
    this.applySexParts();
    this.applyBodyMorph();
    this.hi.invalidate();
    // A part that belongs to the other sex must not stay selected — it is now hidden.
    if (state.selected) {
      const p = this.registry.byId.get(state.selected);
      if (p && p.sx && p.sx !== (sex === 'female' ? 'f' : 'm')) this.clearSelection();
      else this.inspector.render();
    }
    if (state.mode === 'age') { this.panel.render(); renderAgeDock(this.dock, this); }
    if (state.mode === 'explore' && this.panel?.render) this.panel.render();
    this.refreshLabels();
    toast(sex === 'female' ? 'Female body' : 'Male body');
  }

  setLang(lang) {
    set({ lang });
    this.topbar.syncToggles();
    this.panel?.render?.();
    this.inspector.render();
    if (!this.dock.hidden) { state.mode === 'age' ? renderAgeDock(this.dock, this) : renderEffectDock(this.dock, this); }
    this.refreshLabels();
  }

  setAge(age, { live = false } = {}) {
    const prevMed = this.medianWeightForHeight();
    const prevHMed = this.medianHeightCm();
    set({ age: Math.max(0, Math.min(90, Math.round(age))) });
    // Carry the user's BUILD across an age change, not their absolute numbers —
    // 70 kg and 170 cm mean something completely different on a 5-year-old.
    if (state.heightCm != null && prevHMed > 0) {
      set({ heightCm: +(this.medianHeightCm() * (state.heightCm / prevHMed)).toFixed(1) });
    }
    if (state.weightKg != null && prevMed > 0) {
      set({ weightKg: +(this.medianWeightForHeight() * (state.weightKg / prevMed)).toFixed(1) });
    }
    this.applyBodyMorph({ live });
    if (live) this.syncBodyLive(); else this.syncBodyEverywhere();
  }

  setWeight(kg, { live = false } = {}) {
    const med = this.medianWeightForHeight();
    set({ weightKg: kg == null ? null : Math.min(med * 2.4, Math.max(med * 0.62, +kg)) });
    this.applyBodyMorph({ live });
    if (live) this.syncBodyLive(); else this.syncBodyEverywhere();
  }

  setHeight(cm, { live = false } = {}) {
    const med = this.medianHeightCm();
    // Keep the BUILD, not the kilos: making someone taller shouldn't suddenly make them
    // underweight, so a set weight rides along with the height change.
    const oldMed = this.medianWeightForHeight();
    set({ heightCm: cm == null ? null : Math.min(med * 1.22, Math.max(med * 0.82, +cm)) });
    if (state.weightKg != null && oldMed > 0) {
      set({ weightKg: +(this.medianWeightForHeight() * (state.weightKg / oldMed)).toFixed(1) });
    }
    this.applyBodyMorph({ live });
    if (!live) this.viewer.resetView(this.currentHeightM());
    if (live) this.syncBodyLive(); else this.syncBodyEverywhere();
  }


  _deferBounds() {
    clearTimeout(this._boundsT);
    this._boundsT = setTimeout(() => this.updateBoundingSpheres(), 130);
  }

  /** Text-only refresh used while a slider is being dragged: no DOM is rebuilt, so the
   *  slider the user is holding is never destroyed under their finger. */
  syncBodyLive() {
    if (state.mode === 'age') this.panel?.liveUpdate?.();
    this.updateNavUI();
  }
  /**
   * One place that re-renders everything affected by a body change (age, height, weight,
   * sex), so the number in the dock, the panel text, the labels and any running effect
   * can never disagree with the body on screen.
   */
  syncBodyEverywhere() {
    if (state.mode === 'age') { this.panel?.render?.(); renderAgeDock(this.dock, this); this.applyAgeEffects(); }
    else if (state.mode === 'effects' && this.activeEffects().length) { this.applyEffect(); renderEffectDock(this.dock, this); this.panel?.render?.(); }
    this.inspector.render();
    this.updateNavUI();
    this.refreshLabels();
  }


  /**
   * How the stacked habits would actually reshape the body by the chosen point on the
   * timeline. Derived from the effect data itself: effects that improve muscle targets
   * add lean mass, effects that harm `adipose` add fat, and effects that improve it
   * take fat off. Two months of training does far less than five years of it, so the
   * timeline step scales the whole thing.
   */
  stackBodyDrift() {
    const combined = this._combined;
    if (this._compare || !combined || !combined.size || state.mode !== 'effects' || !this.activeEffects().length) return { dMuscle: 0, dFatPct: 0, any: false };
    const MUSCLE = new Set(['skeletal-muscle', 'biceps', 'triceps', 'forearm-muscles', 'deltoids',
      'pectorals', 'lats', 'trapezius', 'abs', 'erector-spinae', 'glutes', 'quadriceps',
      'hamstrings', 'calves', 'hip-flexors', 'rotator-cuff']);
    // How much of the final change has happened by each step.
    const W = { '1d': 0.01, '1w': 0.05, '30d': 0.22, '60d': 0.38, '6m': 0.68, '1y': 0.88, '5y': 1 };
    const w = W[state.effectStep] ?? 0.5;

    let mScore = 0, fScore = 0;
    for (const [target, c] of combined) {
      const dir = c.kind === 'positive' ? 1 : (c.kind === 'negative' ? -1 : 0);
      if (!dir) continue;
      if (MUSCLE.has(target)) mScore += dir * c.intensity;
      if (target === 'adipose' || target === 'whole-body') fScore += -dir * c.intensity;   // harm to adipose = fat gained
    }
    // Cap what any habit stack can plausibly do: roughly ±0.3 on the muscle scale
    // (a few years of real training) and ±10 body-fat points.
    const dMuscle = Math.max(-0.3, Math.min(0.3, mScore * 0.10)) * w;
    const dFatPct = Math.max(-10, Math.min(10, fScore * 3.2)) * w;
    return { dMuscle, dFatPct, any: Math.abs(dMuscle) > 0.005 || Math.abs(dFatPct) > 0.15 };
  }

  /** Muscle level including whatever the stacked habits would have built or lost. */
  effectiveMuscle() {
    const base = state.muscle ?? 0.5;
    return Math.max(0, Math.min(1, base + this.stackBodyDrift().dMuscle));
  }
  /**
   * Body composition, split into muscle and fat.
   *
   * Weight and BMI alone cannot tell a trained body from a heavy one: a 181 cm / 80 kg
   * lifter and a 181 cm / 80 kg sedentary person have the same BMI (24.4) and completely
   * different bodies. So this works in FFMI (fat-free mass index = lean kg / height m²),
   * the measure sports science uses precisely because it separates the two.
   *
   * Body fat is the user's own figure when they give one; otherwise it is estimated with
   * Deurenberg (1991) + a South-Asian correction, then corrected for how trained the body
   * is — Deurenberg is well known to overestimate fat in muscular people.
   */
  bodyComposition({ drift: withDrift = true } = {}) {
    const h = this.currentHeightM();
    const kg = this.currentWeight();
    const bmi = kg / (h * h);
    const male = state.sex === 'male' ? 1 : 0;
    const drift = withDrift ? this.stackBodyDrift() : { dMuscle: 0, dFatPct: 0 };
    const muscle = Math.max(0, Math.min(1, (state.muscle ?? 0.5) + drift.dMuscle));
    const trained = muscle - 0.5;                       // −0.5 frail … +0.5 elite

    let bf, estimated;
    if (state.bodyFatPct != null) {
      bf = state.bodyFatPct;
      estimated = false;
    } else {
      const age = Math.max(15, state.age);              // equation is not valid in children
      bf = 1.20 * bmi + 0.23 * age - 10.8 * male - 5.4 + 3.5;   // +3.5 South-Asian offset
      bf -= trained * 18;                               // muscular bodies read far too high otherwise
      estimated = true;
    }
    bf += drift.dFatPct;
    bf = Math.min(60, Math.max(male ? 4 : 10, bf));

    const fatKg = kg * bf / 100;
    const leanKg = kg - fatKg;
    const ffmi = leanKg / (h * h);                      // fat-free mass index
    const fmi = fatKg / (h * h);                        // fat mass index

    // Reference points for an average untrained adult, and how far above it counts as
    // "trained". ~25 FFMI is the accepted natural ceiling for men, ~21 for women.
    const refFFMI = male ? 18.5 : 15.0;
    const refFMI = male ? 3.6 : 5.6;
    const muscleIndex = Math.max(-1.2, Math.min(1.6, (ffmi - refFFMI) / 4.0));
    const fatIndex = Math.max(-1.0, Math.min(2.4, (fmi - refFMI) / 2.6));

    const healthy = male ? [10, 20] : [20, 30];
    const athletic = male ? [6, 13] : [14, 20];
    return {
      bmi: +bmi.toFixed(1), bfPct: +bf.toFixed(1), estimated,
      fatKg: +fatKg.toFixed(1), leanKg: +leanKg.toFixed(1),
      ffmi: +ffmi.toFixed(1), fmi: +fmi.toFixed(1),
      muscleIndex, fatIndex, healthy, athletic,
      inRange: bf >= healthy[0] && bf <= healthy[1],
      isAthletic: bf <= healthy[1] && ffmi >= refFFMI + 1.6,
      valid: state.age >= 15,
    };
  }

  /**
   * Plain-language verdict. Deliberately body-fat first, BMI second: BMI alone calls a
   * muscular 80 kg / 181 cm arm-wrestler "overweight", which is simply wrong.
   */
  buildLabel() {
    if (state.age < 18) return { label: 'Growing', hi: 'बढ़ रहा शरीर', color: '#38bdf8', why: 'BMI is read against child growth charts, not adult cut-offs.' };
    const c = this.bodyComposition();
    const male = state.sex === 'male';
    if (c.bfPct < (male ? 6 : 14)) return { label: 'Very lean', hi: 'बहुत दुबला', color: '#f59e0b', why: 'Body fat is below the athletic range. That is hard to hold for long.' };
    if (c.isAthletic) return { label: 'Athletic', hi: 'एथलेटिक', color: '#22c55e',
      why: `BMI ${c.bmi} looks high, but the weight is muscle: FFMI ${c.ffmi} with ${c.bfPct}% fat.` };
    if (c.bfPct <= c.healthy[1]) return { label: 'Healthy', hi: 'स्वस्थ', color: '#22c55e',
      why: `Body fat ${c.bfPct}% is inside the healthy ${c.healthy[0]}–${c.healthy[1]}% range.` };
    if (c.bfPct <= c.healthy[1] + 5) return { label: 'Above healthy fat', hi: 'चर्बी ज़्यादा', color: '#f59e0b',
      why: `Body fat ${c.bfPct}% is above the healthy ${c.healthy[0]}–${c.healthy[1]}% range.` };
    if (c.bfPct <= c.healthy[1] + 12) return { label: 'High body fat', hi: 'अधिक चर्बी', color: '#ef4444',
      why: `Body fat is ${c.bfPct}%. That is well above the healthy range, and for South Asians the health risk starts at a lower level.` };
    return { label: 'Very high body fat', hi: 'बहुत अधिक चर्बी', color: '#ef4444',
      why: `Body fat ${c.bfPct}% carries substantial metabolic risk.` };
  }

  setMuscle(v, { live = false } = {}) {
    set({ muscle: Math.max(0, Math.min(1, +v)) });
    this.applyBodyMorph({ live });
    if (live) this.syncBodyLive(); else this.syncBodyEverywhere();
  }

  setBodyFat(pct, { live = false } = {}) {
    set({ bodyFatPct: pct == null ? null : Math.max(3, Math.min(60, +pct)) });
    this.applyBodyMorph({ live });
    if (live) this.syncBodyLive(); else this.syncBodyEverywhere();
  }

  setUnits(kind, value) {
    state.units = { ...state.units, [kind]: value };
    this.syncBodyEverywhere();
  }


  /** Plain-language read-out of the current build, using Asian-Indian BMI cut-offs. */

  // ---------------- selection ----------------
  selectPart(id, { focus = false, both = false, record = true } = {}) {
    const part = this.registry.byId.get(id);
    if (!part) return;
    if (record && id !== state.selected) this.nav.push('select');
    set({ selected: id });
    let ids = [id];
    if (both) { const sibs = this.registry.siblingsOf(part); if (sibs.length > 1) ids = sibs.map(s => s.id); }
    // include descendants when a group is selected
    if (part.k === 'group') ids = this.registry.subtree(id).filter(x => this.meshes.has(x));
    this.selectedIds = ids;
    this.hi.setSelected(ids);
    this.inspector.render();
    this.ensurePanel('right');
    if (window.innerWidth <= 900) document.getElementById('right').classList.add('open');
    if (state.mode === 'explore' && this.panel?.reveal) this.panel.reveal(id);
    if (focus) this.focusSelected();
    this.refreshLabels();
    this.updateNavUI();
    // Make sure it can be seen. On the Systems tab that means switching its system on,
    // where the switch shows it. Anywhere else it is a temporary view laid over the user's
    // own switches, so picking a nerve from search no longer quietly leaves the nervous
    // system switched on for good.
    const sys = state.systems[part.sys];
    if (sys && !sys.visible) {
      if (state.mode === 'systems') {
        sys.visible = true;
        this.refreshVisibility();
        this.panel?.render?.();
        toast(`${this.registry.systemMeta(part.sys).label} turned on`);
      } else if (!this.hi.sysState(part.sys)?.visible) {
        this.setSysOverride({ ...(state.sysOverride || {}), [part.sys]: { visible: true } });
      }
    }
  }

  clearSelection() {
    set({ selected: null }); this.selectedIds = []; this.hi.setSelected([]); this.inspector.render();
    if (window.innerWidth <= 900) document.getElementById('right').classList.remove('open');
    this.refreshLabels();
    this.updateNavUI();
  }

  focusSelected() {
    const ids = (this.selectedIds || []).filter(x => this.meshes.has(x));
    if (!ids.length) {
      const p = this.registry.byId.get(state.selected);
      if (p?.pos) { const v = applyMorph(toGlVec(p.pos), new THREE.Vector3()); this.viewer.focusBox(new THREE.Box3().setFromCenterAndSize(v, new THREE.Vector3(0.06, 0.06, 0.06)), { pad: 1.6 }); }
      return;
    }
    const box = this.hi.boxOf(ids, applyMorph);
    this.viewer.focusBox(box, { pad: 1.9 });
  }

  drillDown(id) {
    this.nav.push('inside');
    const ids = this.registry.subtree(id).filter(x => this.meshes.has(x));
    this.hi.setIsolate(ids);
    set({ isolate: id, showLandmarks: true });
    this.hi.invalidate();
    this.focusSelected();
    this.refreshLabels();
    toast('Showing this part alone. Press I or Esc to go back.');
  }

  toggleIsolate(id) {
    this.nav.push('isolate');
    if (state.isolate === id) { set({ isolate: null }); this.hi.setIsolate(null); }
    else { const ids = this.registry.subtree(id).filter(x => this.meshes.has(x)); set({ isolate: id }); this.hi.setIsolate(ids); }
    this.hi.invalidate(); this.inspector.render(); this.refreshLabels(); this.updateNavUI();
  }

  toggleHidden(id) {
    const ids = this.registry.subtree(id);
    const hiding = !state.hidden.has(id);
    for (const x of ids) hiding ? state.hidden.add(x) : state.hidden.delete(x);
    this.hi.invalidate(); this.inspector.render();
  }

  hoverPart(id, isAttachment = false) {
    this.hi.setHover(id);
    if (!id) { this.hoverTip.hidden = true; this._targetHover = null; return; }
  }

  hoverLandmark(id) {
    const p = id && this.registry.byId.get(id);
    if (!p || !p.pos) { this.labels.setItems(this._labelItems || []); return; }
    const v = applyMorph(toGlVec(p.pos), new THREE.Vector3());
    this.labels.setItems([...(this._labelItems || []), { id: 'lm-hover', partId: id, anchor: v, text: p.n, sub: p.hi, color: '#fff', hot: true }]);
  }

  hoverSystem(key) {
    if (!key) { this.hi.setEffects(new Map()); this.hi.invalidate(); return; }
  }

  showAttachment(id) {
    set({ showAttachments: true });
    this.refreshAttachments();
    if (this.body.slot(id) !== undefined) {
      const box = this.hi.boxOf([id], applyMorph);
      this.viewer.focusBox(box, { pad: 2.2 });
    }
  }

  refreshAttachments() { this.hi.invalidate(); }

  openMicro(key, part) { openMicroModal(key, part); }

  // ---------------- systems / display ----------------
  refreshVisibility() { this.hi.invalidate(); this.refreshLabels(); this.updateLegend(); }

  applySkinTone() {
    const hex = (SKIN_TONES.find(t => t.key === state.skinTone) || SKIN_TONES[1]).hex;
    const col = new THREE.Color(hex);
    const body = this.body;
    for (const batch of body.batches) {
      if (batch.system !== 'integumentary') continue;
      const colors = batch.mesh.geometry.attributes.color;
      const idx = batch.mesh.geometry.attributes.aPartIndex;
      const r = Math.round(col.r * 255), g = Math.round(col.g * 255), b = Math.round(col.b * 255);
      for (let v = 0; v < colors.count; v++) {
        const part = body.partAt(idx.array[v]);
        if (!part || /hair|eyelash|eyebrow/i.test(part.n)) continue;   // hair keeps its own colour
        colors.array[v * 3] = r; colors.array[v * 3 + 1] = g; colors.array[v * 3 + 2] = b;
      }
      colors.needsUpdate = true;
    }
    this.viewer.requestRender();
  }

  /**
   * The graphics card can take the 3D view away: a driver reset, or the page opening more
   * WebGL views than the browser allows. The browser then shows the canvas as a blank white
   * sheet with the panels still on top, and nothing on the page says why. So say so, bring
   * the view back if the browser returns it, and offer a reload if it does not.
   */
  watchContext() {
    const canvas = this.viewer.renderer.domElement;
    let note = null, timer = 0;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();                          // ask the browser to give it back
      if (note) return;
      note = document.createElement('div');
      note.className = 'gl-lost';
      note.innerHTML = '<div class="gl-lost-card"><b>The 3D view stopped</b>'
        + '<p>Your graphics card reset it. Waiting a moment for it to come back.</p></div>';
      document.getElementById('stage').append(note);
      timer = setTimeout(() => {
        const card = note?.querySelector('.gl-lost-card');
        if (!card) return;
        card.querySelector('p').textContent = 'It has not come back on its own. Reload to bring it back. You will lose what is on screen now.';
        const btn = document.createElement('button');
        btn.className = 'btn primary'; btn.textContent = 'Reload the 3D view';
        btn.addEventListener('click', () => location.reload());
        card.append(btn);
      }, 2500);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      clearTimeout(timer);
      note?.remove(); note = null;
      this.hi.invalidate();
      this.viewer.requestRender();
    });
  }

  get theme() { return document.documentElement.dataset.theme || 'light'; }

  /** Light or dark. Remembered for next time. Film videos stay dark either way. */
  setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('sharir-theme', theme); } catch {}
    this.viewer.applyTheme(theme);
    this.syncThemeButton();
    this.refreshLabels();
  }

  syncThemeButton() {
    const b = document.getElementById('theme-btn');
    if (!b) return;
    const light = this.theme === 'light';
    b.textContent = light ? '☾' : '☀';
    b.title = light ? 'Switch to the dark look' : 'Switch to the light look';
  }

  /** Switch the Movement tab to another lift. */
  setExercise(id) {
    const ex = exerciseById(id);
    if (!ex) return;
    set({ exercise: id });
    this.film?.exit();
    this.panel?.dispose?.();
    this.leftRoot.innerHTML = '';
    this.exercise.start(ex);
    this.panel = new ExercisePanel(this.leftRoot, this);
    this.panel.setView?.(this.panel.view);
  }

  /** Back to the starting shot for this tab. */
  resetCamera() {
    if (this.exercise?.ex) { this.exercise.autoFrame = true; this.exercise.frameCamera(); return; }
    this.viewer.resetView(this.currentHeightM());
  }

  /**
   * The five view buttons. Standing, they are plain directions. On the bench the body lies
   * face up with its head along -z, so "front" is from above, "top" is from the head end
   * and "back" (from under the bench, where nothing shows) becomes the foot end.
   */
  cameraView(name) {
    if (!this.exercise?.ex) { this.viewer.view(name); return; }
    const DIRS = { front: [0, 1, 0.0001], top: [0, 0.35, -1], back: [0, 0.35, 1], left: [1, 0.25, 0], right: [-1, 0.25, 0] };
    const v = this.viewer, c = v.controls.target.clone();
    const d = v.camera.position.distanceTo(c);
    this.exercise.autoFrame = false;                 // the user chose this shot; keep it
    v.tweenCamera(c.clone().addScaledVector(new THREE.Vector3(...DIRS[name]).normalize(), d), c, 0.7);
  }

  /** Name the view buttons for the body on screen: standing, or lying on the bench. */
  syncViewTitles() {
    const lying = state.mode === 'move';
    const T = lying
      ? { front: 'From above, onto the chest', back: 'From the feet', left: "From the lifter's left", right: "From the lifter's right", top: 'From the head end' }
      : { front: 'Front', back: 'Back', left: 'Left side', right: 'Right side', top: 'From above' };
    for (const [k, t] of Object.entries(T)) { const b = document.getElementById('tb-' + k); if (b) b.title = t; }
  }

  toggleXray() {
    set({ xray: !state.xray });
    this.hi.invalidate();
    document.getElementById('tb-xray').classList.toggle('active', state.xray);
    document.getElementById('btn-xray')?.classList.toggle('active', state.xray);
    this.updateNavUI();
    toast(state.xray ? 'X-ray on. Everything you have not picked turns see-through.' : 'X-ray off');
  }

  toggleReveal() {
    set({ reveal: !state.reveal });
    this.hi.invalidate();
    document.getElementById('tb-reveal').classList.toggle('active', state.reveal);
    toast(state.reveal ? 'Reveal on. When you pick a part, everything around it fades.' : 'Reveal off. Every layer stays solid when you pick a part.');
  }

  syncLabelsButton() {
    document.getElementById('tb-labels').classList.toggle('active', state.labels !== 'off');
  }

  toggleAtlas() {
    if (!state.atlas && state.mode !== 'systems') { toast('The atlas is in the Systems tab.'); return; }
    set({ atlas: !state.atlas });
    document.getElementById('tb-atlas').classList.toggle('active', state.atlas);
    document.getElementById('btn-atlas')?.classList.toggle('active', state.atlas);
    const h = this.currentHeightM();
    if (state.atlas) {
      // The atlas shows every system, but that is the atlas's choice, not the user's:
      // keep their switches and give them back on the way out.
      this._atlasSaved = Object.fromEntries(SYSTEMS.map(s => [s.key, { ...state.systems[s.key] }]));
      this._atlasLabels = state.labels;
      const shift = {}; for (const g of ATLAS_GROUPS) for (const k of g.keys) shift[k] = g.x * (h / 1.7);
      for (let slot = 0; slot < this.body.count; slot++) { const p = this.body.partAt(slot); this.body.setOffset(slot, shift[p.sys] || 0, 0, 0); }
      this.body.flush();
      for (const s of SYSTEMS) if (s.key !== 'references') { state.systems[s.key].visible = true; state.systems[s.key].opacity = s.key === 'integumentary' ? 0.55 : 1; }
      this.refreshVisibility();
      const box = new THREE.Box3(new THREE.Vector3(-3.2 * (h / 1.7), 0, -0.4), new THREE.Vector3(4.1 * (h / 1.7), h, 0.4));
      this.viewer.focusBox(box, { pad: 1.05, keepDir: false });
      this.viewer.ground.visible = false; this.viewer.ring.visible = false;
      // Picking walks the un-moved geometry unless it is told the systems stand apart.
      this.body.shifted = true;
      set({ labels: 'off' });
      this.syncLabelsButton();
      this._atlasTitles();
      // The switches show what the atlas has put on screen, and get the user's own back after.
      if (state.mode === 'systems') this.panel?.render?.();
      toast('Atlas view: every system side by side');
    } else {
      for (let slot = 0; slot < this.body.count; slot++) this.body.setOffset(slot, 0, 0, 0);
      this.body.flush();
      if (this._atlasSaved) {
        for (const [k, v] of Object.entries(this._atlasSaved)) Object.assign(state.systems[k], v);
        this._atlasSaved = null;
      }
      if (state.mode === 'systems') this.panel?.render?.();
      this.viewer.ground.visible = true; this.viewer.ring.visible = true;
      this.body.shifted = false;
      set({ labels: this._atlasLabels || 'auto' });
      this.syncLabelsButton();
      this.viewer.resetView(h);
      this.refreshVisibility();
    }
    this.refreshLabels();
    this.updateNavUI();
  }

  _atlasTitles() {
    const h = this.currentHeightM();
    const items = ATLAS_GROUPS.map((g, i) => ({ id: 'atlas' + i, anchor: new THREE.Vector3(g.x * (h / 1.7), h * 1.06, 0), text: g.label, kind: 'title', color: this.registry.systemMeta(g.keys[0]).color }));
    this._labelItems = items;
    this.labels.setItems(items);
  }

  updateLegend() {
    const leg = document.getElementById('legend');
    // What the body actually shows: a tab's own view (an effect, a Movement look) overrides
    // the Systems switches, and the legend has to follow it. It used to read the switches
    // alone, and said "Nervous system" over a body of muscle.
    const shown = (k) => state.sysOverride?.[k]?.visible ?? state.systems[k].visible;
    const on = SYSTEMS.filter(s => shown(s.key) && s.key !== 'references');
    if (on.length === 0 || on.length > 7) { leg.hidden = true; return; }
    leg.hidden = false;
    leg.innerHTML = on.map(s => `<span><i style="background:${s.color}"></i>${state.lang === 'hi' ? s.hi : s.label}</span>`).join('');
  }

  // ---------------- labels ----------------
  refreshLabels() {
    if (state.atlas) { this._atlasTitles(); return; }
    if (state.labels === 'off') { this.labels.setItems([]); this._labelItems = []; return; }
    const items = [];
    const push = (part, hot = false) => {
      const bb = this.body.boundsOf(part.id);
      let v;
      if (bb) {
        v = applyMorph(bb.getCenter(new THREE.Vector3()), new THREE.Vector3(), { belly: 1, breast: 1 });
        const slot = this.body.slot(part.id);
        // A label has to point at the structure where it IS, not where it would be if this
        // body were standing up.
        this.body.posedPoint(slot, v);
        v.x += this.body.state[slot * 4]; v.y += this.body.state[slot * 4 + 1]; v.z += this.body.state[slot * 4 + 2];
        v.applyMatrix4(this.viewer.bodyRoot.matrixWorld);
      }
      else if (part.pos) v = applyMorph(toGlVec(part.pos), new THREE.Vector3());
      else return;
      items.push({ id: part.id, partId: part.id, anchor: v, text: labelText(part), sub: labelSub(part), color: part.c || this.registry.systemMeta(part.sys).color, hot });
    };
    if (state.labels === 'all') {
      const cands = [];
      for (let slot = 0; slot < this.body.count; slot++) {
        if (!this.body.isVisible(slot)) continue;
        const p = this.body.partAt(slot);
        if (p.side === 'r') continue;          // one label per pair is enough
        cands.push(p);
      }
      cands.sort((a, b) => (b.v || 0) - (a.v || 0));
      for (const p of cands.slice(0, 90)) push(p);
    }
    // selection + its landmarks
    const sel = state.selected && this.registry.byId.get(state.selected);
    if (sel) {
      push(sel, true);
      if (state.showLandmarks) {
        for (const c of this.registry.childrenOf(sel.id)) if (c.k === 'landmark' && c.pos) {
          const v = applyMorph(toGlVec(c.pos), new THREE.Vector3());
          items.push({ id: c.id, partId: c.id, anchor: v, text: labelText(c), sub: labelSub(c), color: '#e9c95c' });
        }
      }
      for (const s of this.registry.siblingsOf(sel)) if (s.id !== sel.id) push(s, true);
    }
    // effect targets
    // One label per organ the panel talks about ("Liver", "Testes"), at the middle of that
    // organ, in its colour of good or harm. Labelling the first parts found instead put
    // twenty names on brain folds and hip bursae.
    if (state.mode === 'effects' && this.hi.effects.size && this._combined && !sel) {
      const KIND_COL = { positive: '#1f9d55', negative: '#d64545', strain: '#c98a0b', neutral: '#2f7fd1' };
      const rows = [...this._combined.values()].sort((a, b) => b.intensity - a.intensity);
      let n = 0;
      for (const c of rows) {
        if (n >= 14) break;
        if (c.target === 'whole-body' || c.target === 'skin') continue;   // no single place to point at
        const ids = this.registry.resolveTarget(c.target).filter(id => this.body.slot(id) !== undefined && this.hi.isPartVisible(this.registry.byId.get(id)));
        if (!ids.length || ids.length > 300) continue;
        const box = this.hi.boxOf(ids, applyMorph);
        if (box.isEmpty()) continue;
        const v = box.getCenter(new THREE.Vector3()).applyMatrix4(this.viewer.bodyRoot.matrixWorld);
        items.push({ id: 'fx-' + c.target, target: c.target, anchor: v, text: TARGETS[c.target]?.label || c.target, color: KIND_COL[c.kind], hot: true });
        n++;
      }
    }
    this._labelItems = items;
    this.labels.setItems(items);
    this.labels.visible = !this.film?.active;   // DOM labels never belong in a filmed shot
  }

  // ---------------- effects mode ----------------
  openEffect(id) {
    this.nav.push('effect');
    // Search can open an effect from any tab. Leaving that tab properly stops a lift,
    // closes Film mode and folds the atlas away, the same as clicking the tab would.
    if (state.mode !== 'effects') this.setMode('effects', false);
    set({ mode: 'effects', effect: id, effectStep: '1d' });
    this.topbar.syncToggles();
    this.panel?.dispose?.();
    this.leftRoot.innerHTML = '';
    this.ensurePanel('left');
    this.panel = new EffectsPanel(this.leftRoot, this);
    this.applyEffect();
    this.syncEffectDock();
    this.viewer.resetView(this.currentHeightM());
    this.topbar.syncToggles();
    this.updateNavUI();
  }

  /**
   * Leave the one item that is open. With a combination picked, the body and the timeline
   * go straight back to showing the combination; `toTogether` also opens its panel instead
   * of the list.
   */
  closeEffect(toTogether = false) {
    this.nav.push('close-effect');
    clearTimeout(this._playT);
    set({ effect: null, playing: false, fxBrowse: !(toTogether && state.stack.length) });
    this._afterEffectChange();
  }

  /** The panel for the combination: every item picked, running on one timeline. */
  showTogether() {
    if (!state.stack.length) return;
    this.nav.push('together');
    set({ effect: null, fxBrowse: false });
    this._afterEffectChange();
  }

  /** Back to the list to pick more. The body keeps showing the combination meanwhile. */
  browseEffects() {
    set({ effect: null, fxBrowse: true });
    this._afterEffectChange();
  }

  _afterEffectChange() {
    if (this.activeEffects().length) this.applyEffect();
    else { this.clearSysOverride(); this.hi.clearEffects(); this._combined = null; this.applyBodyMorph(); }
    this.panel?.dispose?.();
    this.leftRoot.innerHTML = '';
    this.panel = new EffectsPanel(this.leftRoot, this);
    this.syncEffectDock();
    this.refreshLabels();
    this.updateNavUI();
  }

  /** The timeline shows whenever anything is picked: one item, or a combination. */
  syncEffectDock() {
    if (state.mode !== 'effects') return;
    if (this.activeEffects().length) renderEffectDock(this.dock, this);
    else this.dock.hidden = true;
    document.documentElement.style.setProperty('--dock-h', this.dock.hidden ? '0px' : '112px');
    requestAnimationFrame(() => this.updateSafeInsets());
  }

  /**
   * Hold to compare: the body as it was before any of this, with every organ back to its
   * size, the muscle and fat change undone and the colours off. Small changes are much
   * easier to see flicking between the two than looking at one.
   */
  setCompare(on) {
    if (!!this._compare === !!on) return;
    this._compare = !!on;
    this.hi.setCompare(!!on);
    this.applyBodyMorph();
    this.dock.classList.toggle('comparing', !!on);
  }

  setEffectStep(t) {
    set({ effectStep: t });
    this.applyEffect();
    this.panel?.render?.();
    this.syncEffectDock();
  }

  togglePlay() {
    set({ playing: !state.playing });
    renderEffectDock(this.dock, this);
    if (state.playing) {
      const run = () => {
        if (!state.playing) return;
        const i = TIMELINE_STEPS.findIndex(s => s.t === state.effectStep);
        const next = TIMELINE_STEPS[(i + 1) % TIMELINE_STEPS.length];
        this.setEffectStep(next.t);
        if (next.t === '5y') { this._playT = setTimeout(() => { set({ playing: false }); renderEffectDock(this.dock, this); }, 2600); }
        else this._playT = setTimeout(run, 2200);
      };
      this._playT = setTimeout(run, 1200);
    } else clearTimeout(this._playT);
  }

  /**
   * What the body and the timeline are showing. With one item open, that item on its own,
   * so the body matches what its page says. Otherwise the combination, if there is one.
   */
  activeEffects() {
    const ids = state.effect ? [state.effect] : state.stack;
    return ids.map(id => this.effects.get(id)).filter(Boolean);
  }

  applyEffect() {
    const list = this.activeEffects();
    if (!list.length) { this.hi.clearEffects(); this.clearSysOverride(); return; }
    const combined = combineAtStep(list, state.effectStep);
    const map = new Map();
    const unresolved = [];
    for (const [target, c] of combined) {
      const ids = this.registry.resolveTarget(target);
      if (!ids.length) { unresolved.push(target); continue; }
      let phase = 0;
      for (const id of ids) {
        map.set(id, { kind: c.kind, intensity: c.intensity, scale: c.visual?.scale,
                      opacity: c.visual?.opacity, phase: (phase += 0.37), group: target });
      }
    }
    if (unresolved.length) console.warn('[effects] unresolved targets:', unresolved);
    this._combined = combined;
    // Show the affected systems and fade the skin back, WITHOUT touching what the user
    // chose in the Systems panel — this is a temporary display override.
    const skinAffected = [...map.keys()].some(id => this.registry.byId.get(id)?.sys === 'integumentary');
    this.setSysOverride(this.overrideFor([...map.keys()], {
      integumentary: skinAffected ? {} : { visible: true, opacity: 0.05 },
    }));
    this.hi.setEffects(map);
    this.applyBodyMorph();          // stacked habits reshape the body, not just light it up
    this.hi.invalidate();
    this.refreshLabels();
    this.updateLegend();
  }

  /** Add or remove an item from the combination. */
  toggleStack(id) {
    const i = state.stack.indexOf(id);
    // A new array each time: the back button keeps snapshots of this list, and changing
    // it in place would change every saved snapshot along with it.
    if (i >= 0) state.stack = state.stack.filter(x => x !== id);
    else {
      if (state.stack.length >= 5) { toast('You can combine five at most. Remove one first.'); return; }
      state.stack = [...state.stack, id];
    }
    if (!state.effect && !state.fxBrowse && !state.stack.length) set({ fxBrowse: true });
    if (this.activeEffects().length) this.applyEffect();
    else { this.clearSysOverride(); this.hi.clearEffects(); this._combined = null; this.applyBodyMorph(); }
    this.panel?.render?.();
    this.syncEffectDock();
    this.updateNavUI();
    const e = this.effects.get(id);
    const n = state.stack.length;
    toast(i >= 0 ? `Removed ${e.name.en}.`
      : state.effect ? `Added ${e.name.en} to your combination. You now have ${n}.`
      : n > 1 ? `Added ${e.name.en}. The body now shows all ${n} together.` : `Added ${e.name.en}. Add one more to combine them.`);
  }

  clearStack() {
    state.stack = [];
    if (!state.effect) set({ fxBrowse: true });
    this._afterEffectChange();
  }


  /**
   * Light up where fat is stored, or where the muscle mass is, on the current body.
   * Intensity follows how far this body is from a healthy composition, so a heavier
   * body glows harder in the places that actually carry the extra weight.
   */
  showComposition(which) {
    const comp = this.bodyComposition();
    const over = Math.max(0, comp.bfPct - comp.healthy[1]) / 12;      // 0 at healthy, 1 when far above
    const under = Math.max(0, comp.healthy[0] - comp.bfPct) / 8;
    const female = state.sex === 'female';
    const map = new Map();
    let phase = 0;

    const add = (target, kind, intensity) => {
      for (const id of this.registry.resolveTarget(target)) {
        map.set(id, { kind, intensity: Math.min(1, Math.max(0.15, intensity)), phase: (phase += 0.31) });
      }
    };

    if (which === 'fat') {
      // South-Asian pattern: fat goes to the abdomen first (visceral), which is why
      // Indians develop diabetes at a lower BMI than Europeans.
      add('adipose', over > 0.15 ? 'negative' : 'neutral', 0.45 + over * 0.55);
      add('liver', over > 0.4 ? 'negative' : 'neutral', 0.3 + over * 0.6);      // fatty liver
      if (female) { add('glutes', 'neutral', 0.35 + over * 0.3); add('quadriceps', 'neutral', 0.3 + over * 0.25); }
      if (over > 0.3) { add('heart', 'strain', 0.3 + over * 0.4); add('pancreas', 'strain', 0.3 + over * 0.4); }
      this.ensurePanel('left');
      toast(over > 0.15
        ? `Fat stores: ${comp.fatKg} kg, above the healthy range`
        : `Fat stores: ${comp.fatKg} kg, within the healthy range`);
    } else {
      const lean = Math.max(0.3, 1 - under);
      for (const t of ['quadriceps', 'hamstrings', 'glutes', 'calves', 'pectorals', 'lats',
                       'deltoids', 'biceps', 'triceps', 'abs', 'erector-spinae', 'trapezius']) {
        add(t, under > 0.2 ? 'strain' : 'positive', lean * 0.75);
      }
      toast(`Lean mass: ${comp.leanKg} kg of muscle, bone, organs and water`);
    }
    // Skin would hide all of this; fade it back as a temporary override.
    this.setSysOverride(this.overrideFor([...map.keys()], {
      integumentary: { visible: true, opacity: which === 'fat' ? 0.30 : 0.05 },
    }));
    this.hi.setEffects(map);
    this.hi.invalidate();
    this.refreshLabels();
    this.updateLegend();
  }

  applyAgeEffects() {
    const stage = this.currentStage();
    if (!stage) { this.hi.clearEffects(); return; }
    const map = new Map();
    let phase = 0;
    for (const c of (stage.changes || [])) {
      if (c.sex && c.sex !== 'both' && c.sex !== state.sex) continue;
      const ids = this.registry.resolveTarget(c.target);
      for (const id of ids) map.set(id, { kind: c.kind, intensity: c.intensity ?? 0.4, scale: c.visual?.scale, opacity: c.visual?.opacity, phase: (phase += 0.37), group: c.target });
    }
    this.hi.setEffects(map);
    this.hi.invalidate();
  }

  hoverTarget(target) {
    if (!target) { this.hi.setHover(null); this._targetHover = null; this.hi.invalidate(); return; }
    const ids = this.registry.resolveTarget(target);
    this._targetHover = ids;
    this.hi.setSelected(ids);
    this.hi.invalidate();
  }

  focusTarget(target) {
    const ids = this.registry.resolveTarget(target).filter(x => this.meshes.has(x));
    if (!ids.length) { toast('No 3D structure mapped for this yet'); return; }
    this.setSysOverride({ ...(state.sysOverride || {}), ...this.overrideFor(ids) });
    this.hi.invalidate();
    const box = this.hi.boxOf(ids, applyMorph);
    this.viewer.focusBox(box, { pad: 1.6 });
    this.hi.setSelected(ids);
    if (ids.length === 1) this.selectPart(ids[0]);
    else { set({ selected: ids[0] }); this.selectedIds = ids; this.inspector.render(); }
    toast(`${TARGETS[target]?.label || target}: ${ids.length} structure${ids.length > 1 ? 's' : ''}`);
  }

  // ---------------- input ----------------
  bindInput() {
    const canvas = this.viewer.canvas;
    let downX = 0, downY = 0, moved = false;
    canvas.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; moved = false; });
    let lastPosedPick = 0;
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons) { if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) moved = true; this.hoverTip.hidden = true; return; }
      if (this.film?.active) return;             // a hover glow would end up in the video
      // A posed pick draws the whole body once more, so hovering asks at most about
      // fifteen times a second instead of on every pointer event.
      if (this.viewer.rig?.enabled.value) {
        const now = performance.now();
        if (now - lastPosedPick < 66) return;
        lastPosedPick = now;
      }
      const r = canvas.getBoundingClientRect();
      const hit = this.viewer.pick(e.clientX - r.left, e.clientY - r.top);
      if (hit) {
        const p = hit.part;
        this.hi.setHover(p.id);
        canvas.style.cursor = 'pointer';
        const meta = this.registry.systemMeta(p.sys);
        this.hoverTip.innerHTML = `<span class="sys">${meta.label}</span>${fmtName(p, 'en')}${p.hi ? `<span class="hi">${p.hi}</span>` : ''}`;
        this.hoverTip.style.left = (e.clientX - r.left) + 'px';
        this.hoverTip.style.top = (e.clientY - r.top) + 'px';
        this.hoverTip.hidden = false;
      } else { this.hi.setHover(null); canvas.style.cursor = ''; this.hoverTip.hidden = true; }
    });
    canvas.addEventListener('pointerleave', () => { this.hi.setHover(null); this.hoverTip.hidden = true; });
    canvas.addEventListener('click', (e) => {
      if (moved || this.film?.active) return;
      const r = canvas.getBoundingClientRect();
      const hit = this.viewer.pick(e.clientX - r.left, e.clientY - r.top);
      if (hit) this.selectPart(hit.part.id, { focus: false });
      else this.clearSelection();
    });
    canvas.addEventListener('dblclick', (e) => {
      const r = canvas.getBoundingClientRect();
      const hit = this.viewer.pick(e.clientX - r.left, e.clientY - r.top);
      if (hit) this.selectPart(hit.part.id, { focus: true });
    });

    // toolbar
    document.getElementById('nav-back').addEventListener('click', () => { this.goBack(); this.updateNavUI(); });
    document.getElementById('nav-fwd').addEventListener('click', () => { this.nav.forward(); this.updateNavUI(); });
    document.getElementById('nav-home').addEventListener('click', () => this.goHome());

    const tb = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    tb('tb-reset', () => this.resetCamera());
    for (const v of ['front', 'back', 'left', 'right', 'top']) tb('tb-' + v, () => this.cameraView(v));
    tb('tb-labels', () => {
      if (state.atlas) { toast('The atlas shows the system names only. Leave the atlas to label parts.'); return; }
      set({ labels: state.labels === 'off' ? 'auto' : state.labels === 'auto' ? 'all' : 'off' });
      this.syncLabelsButton();
      this.refreshLabels();
      toast({ auto: 'Labels on for what you pick', all: 'Labels on for everything on screen', off: 'Labels off' }[state.labels]);
    });
    tb('tb-atlas', () => this.toggleAtlas());
    tb('tb-reveal', () => this.toggleReveal());
    tb('tb-xray', () => this.toggleXray());
    tb('tb-menu', () => this.togglePanel('left'));
    tb('tb-details', () => this.togglePanel('right'));
    tb('tb-shot', () => this.saveShot());
    document.getElementById('nav-help')?.addEventListener('click', () => openWelcome(this, { force: true }));
    document.getElementById('left-collapse').addEventListener('click', () => this.togglePanel('left'));
    document.getElementById('right-collapse').addEventListener('click', () => this.togglePanel('right'));

    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input,textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'backspace' || (e.altKey && k === 'arrowleft')) { e.preventDefault(); this.goBack(); this.updateNavUI(); return; }
      if (e.altKey && k === 'arrowright') { e.preventDefault(); this.nav.forward(); this.updateNavUI(); return; }
      if (k === 'home') { e.preventDefault(); this.goHome(); return; }
      if (e.code === 'Backslash') { e.preventDefault(); this.togglePanel('left'); return; }
      if (e.code === 'BracketRight') { e.preventDefault(); this.togglePanel('right'); return; }
      if (k === 'escape') { if (state.isolate) { set({ isolate: null }); this.hi.setIsolate(null); this.hi.invalidate(); this.inspector.render(); } else this.clearSelection(); this.updateNavUI(); }
      else if (k === 'f') this.focusSelected();
      else if (k === 'i' && state.selected) this.toggleIsolate(state.selected);
      else if (k === 'h' && state.selected) this.toggleHidden(state.selected);
      else if (k === 'x') this.toggleXray();
      else if (k === 'v') this.toggleReveal();
      else if (k === 'a') this.toggleAtlas();
      else if (k === 'r') this.resetCamera();
      else if (k === 'n') document.getElementById('tb-labels').click();
      else if (k === 's' && !e.ctrlKey && !e.metaKey) this.saveShot();
      else if (k === ' ' && state.mode === 'effects' && this.activeEffects().length) { e.preventDefault(); this.togglePlay(); }
      else if ((k === 'arrowright' || k === 'arrowleft') && state.mode === 'effects' && this.activeEffects().length) {
        const i = TIMELINE_STEPS.findIndex(s => s.t === state.effectStep);
        const n = Math.max(0, Math.min(TIMELINE_STEPS.length - 1, i + (k === 'arrowright' ? 1 : -1)));
        this.setEffectStep(TIMELINE_STEPS[n].t);
      }
    });
    window.addEventListener('resize', () => this.labels.update());
  }

  /** Below 900px only one side panel can be open at a time. */
  syncNarrow() {
    const narrow = window.innerWidth <= 900;
    document.body.classList.toggle('narrow', narrow);
    this.labels.max = narrow ? 14 : window.innerWidth <= 1180 ? 26 : 44;
    if (narrow) document.getElementById('right').classList.toggle('open', !!state.selected);
    this.viewer.resize();
    this.updateSafeInsets();
  }

  /** Tell the camera how much of the canvas the panels and dock are covering. */
  updateSafeInsets() {
    // In Film mode the only thing covering the picture is its own captions.
    if (this.film?.active) { this.viewer.setSafeInsets(this.film.safeInsets()); this.exercise?.scheduleFrame(); return; }
    const rect = (el) => (el && !el.hidden && !el.classList.contains('collapsed') && getComputedStyle(el).opacity !== '0') ? el.getBoundingClientRect() : null;
    const stage = document.getElementById('stage').getBoundingClientRect();
    const L = rect(document.getElementById('left'));
    const R = rect(document.getElementById('right'));
    const D = rect(document.getElementById('dock'));
    const T = document.getElementById('topbar').getBoundingClientRect();
    const narrow = window.innerWidth <= 900;
    // On a phone, Movement's panel is a sheet across the bottom rather than a column down
    // the side, so what it covers is the bottom of the stage.
    const sheet = L && L.top > stage.top + stage.height * 0.3 ? Math.max(0, stage.bottom - L.top) + 8 : 0;
    this.viewer.setSafeInsets({
      top: Math.max(0, T.bottom - stage.top) + 8,
      bottom: Math.max((D ? Math.max(0, stage.bottom - D.top) : 0) + 56, sheet),
      left: narrow ? 0 : (L ? Math.max(0, L.right - stage.left) : 0) + 12,
      right: narrow ? 0 : (R ? Math.max(0, stage.right - R.left) : 0) + 12,
    });
    if (state.mode === 'move') this.exercise?.scheduleFrame();
  }

  saveShot() {
    const url = this.viewer.screenshot();
    const a = document.createElement('a');
    const name = state.effect ? `sharir-${state.effect}-${state.effectStep}` : state.selected ? `sharir-${this.registry.byId.get(state.selected).n.replace(/\W+/g, '-')}` : `sharir-${state.sex}-${state.age}`;
    a.href = url; a.download = name.toLowerCase() + '.png'; a.click();
    toast('Screenshot saved');
  }
}

// A 3D label carries one name, plus a second line only when there is a second language to
// put there. With Hindi switched off the second line would just repeat the first, so it goes.
function labelText(p) { return FEATURES.hindi && state.lang === 'hi' && p.hi ? p.hi : p.n; }
function labelSub(p) {
  if (!FEATURES.hindi) return null;
  return state.lang === 'hi' ? p.n : p.hi;
}

function toGlVec(a) { return new THREE.Vector3(a[0], a[2], -a[1]); }
function glBBox(bb) {
  const a = [bb[0][0], bb[0][2], -bb[1][1]], b = [bb[1][0], bb[1][2], -bb[0][1]];
  return [[Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])]];
}

new App().boot().catch(err => {
  console.error(err);
  document.getElementById('loader-sub').textContent = 'Error: ' + err.message;
});
