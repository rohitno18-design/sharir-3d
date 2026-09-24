import { el } from '../core/util.js';
import { state, set } from '../core/state.js';
import { EXERCISES } from '../data/exercises.js';

/** Which moment of the rep the current phase falls in. Film mode captions use the same words. */
export function phaseName(t) {
  if (t < 0.42) return { name: 'Lowering', hint: 'The bar comes down slowly. The lats and the rotator cuff keep it on track.' };
  if (t < 0.52) return { name: 'On the chest', hint: 'The bar touches the chest and pauses. The chest muscle is stretched the most here.' };
  if (t < 0.92) return { name: 'Pressing', hint: 'The chest and the front of the shoulder drive the bar up. The triceps take over near the top.' };
  return { name: 'Lockout', hint: 'The elbows are straight. The triceps and the serratus hold the bar steady.' };
}

/**
 * A lift is a muscle story, so Movement opens on the muscles rather than on whatever the
 * Systems panel happened to be left showing. Each of these lays a temporary view over the
 * user's own system settings; leaving Movement puts their settings back untouched.
 */
const VIEWS = [
  { key: 'muscle', label: 'Muscles', sys: ['muscular'] },
  { key: 'skin', label: 'Skin', sys: ['integumentary'] },
  { key: 'bone', label: 'Skeleton', sys: ['skeletal', 'joints'] },
  { key: 'nerve', label: 'Nerves', sys: ['nervous'] },
  { key: 'vessel', label: 'Vessels', sys: ['cardiovascular'] },
  { key: 'deep', label: 'Muscle + bone', sys: ['muscular', 'skeletal'] },
  { key: 'all', label: 'My systems', sys: null },
];
export const DEFAULT_VIEW = 'muscle';

export class ExercisePanel {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.view = DEFAULT_VIEW;
    this.render();
    this.setView(DEFAULT_VIEW);
    if (this.player) this.player.onSeek = () => this.liveUpdate();
  }

  dispose() {
    if (this.player) this.player.onSeek = null;
    this.app.exercise?.stop();
  }

  /** Lay one layer over the body, and show which one is on. */
  setView(key) {
    const v = VIEWS.find(x => x.key === key) || VIEWS[0];
    this.view = v.key;
    this.app.showOnlySystems(v.sys);
    this.markView();
  }

  markView() {
    if (!this.viewChips) return;
    for (const [k, chip] of this.viewChips) chip.classList.toggle('active', k === this.view);
  }

  get player() { return this.app.exercise; }

  render() {
    const p = this.player;
    const ex = p?.ex || EXERCISES[0];
    this.root.innerHTML = '';

    this.root.append(
      el('div', { class: 'exo-head' },
        el('div', { class: 'exo-kicker' }, 'Movement'),
        el('h2', { class: 'exo-title' }, ex.name),
        el('div', { class: 'exo-sub' }, ex.sub)),
      el('p', { class: 'pd' }, 'Press play or drag the slider. Watch the work move from one muscle to the next.'),
      // The colour key, drawn with the same ramp the body uses, so it needs no words.
      el('div', { class: 'exo-legend' },
        el('i', { class: 'exo-grad', style: `background: linear-gradient(90deg, ${[0, 0.25, 0.5, 0.65, 0.8, 1].map(a => effortColor(a)).join(', ')})` }),
        el('div', { class: 'exo-legend-labels' }, el('span', {}, 'Resting'), el('span', {}, 'Working'), el('span', {}, 'Hardest'))),
    );

    // ---- transport ----
    this.playBtn = el('button', { class: 'btn sm primary', onClick: () => { p.toggle(); this.liveUpdate(); } }, p?.playing ? '❚❚ Pause' : '▶ Play');
    const scrub = el('input', { type: 'range', min: 0, max: 1000, value: Math.round((p?.t || 0) * 1000), class: 'wide' });
    scrub.addEventListener('input', () => { p.pause(); p.seek(+scrub.value / 1000); this.liveUpdate(); });
    this.scrub = scrub;

    const speed = el('select', { class: 'sel' },
      ...[['0.25', '¼ speed'], ['0.5', '½ speed'], ['1', 'Normal'], ['1.5', '1.5×']]
        .map(([v, t]) => el('option', { value: v, selected: (p?.speed ?? 1) === +v ? '' : null }, t)));
    speed.addEventListener('change', () => { p.speed = +speed.value; });

    this.root.append(
      el('div', { class: 'btnrow' }, this.playBtn,
        el('button', { class: 'btn sm', onClick: () => { p.pause(); p.seek(0); this.liveUpdate(); } }, '⤒ Top'),
        el('button', { class: 'btn sm', onClick: () => { p.pause(); p.seek(0.47); this.liveUpdate(); } }, '⤓ Chest')),
      el('div', { class: 'exo-scrub' }, scrub),
      el('div', { class: 'exo-phase' },
        el('b', { 'data-live': 'phase' }, phaseName(p?.t || 0).name),
        el('span', { class: 'muted small', 'data-live': 'press' }, '')),
      el('p', { class: 'nt muted small', 'data-live': 'hint' }, phaseName(p?.t || 0).hint),
      el('div', { class: 'exo-lead' },
        el('span', { class: 'exo-lead-k' }, 'Doing the most work'),
        el('b', { 'data-live': 'lead' }, ''),
        el('span', { class: 'muted small', 'data-live': 'lead-note' }, '')),
      el('div', { class: 'btnrow' }, speed),
    );

    // ---- layer switch ----
    this.root.append(el('h3', { class: 'sec' }, 'Show'));
    const views = el('div', { class: 'chips' });
    this.viewChips = new Map();
    for (const v of VIEWS) {
      const chip = el('button', { class: 'chip', onClick: () => this.setView(v.key) }, v.label);
      this.viewChips.set(v.key, chip);
      views.append(chip);
    }
    this.root.append(views);
    // Same switch as in the Systems panel: the sheets of fascia that wrap every muscle are
    // hidden by default, because with them on the limbs read as smooth empty shells.
    this.root.append(el('div', { class: 'chips' },
      el('button', { class: 'chip' + (state.connective ? ' active' : ''),
        onClick: () => { set({ connective: !state.connective }); this.app.refreshVisibility(); this.render(); } },
        (state.connective ? '✓ ' : '') + 'Fascia & bursae')));
    this.markView();

    // ---- film ----
    this.root.append(el('h3', { class: 'sec' }, 'Make a video'));
    this.root.append(el('p', { class: 'nt muted small' }, 'Record this lift as a reel, a square post or a wide clip, with captions that name each muscle as it works.'));
    this.root.append(el('div', { class: 'btnrow' },
      el('button', { class: 'btn sm primary', onClick: () => this.app.film.enter() }, '🎬 Film mode')));

    // ---- muscle readout ----
    this.root.append(el('h3', { class: 'sec' }, 'Working right now'));
    this.rows = new Map();
    const list = el('div', { class: 'exo-list' });
    for (const g of (p?.groups || [])) {
      const bar = el('i', { class: 'exo-bar' });
      const val = el('span', { class: 'exo-val' }, '0%');
      const row = el('div', { class: 'exo-row' },
        el('div', { class: 'exo-top' }, el('b', {}, g.def.label), val),
        el('div', { class: 'exo-track' }, bar),
        el('div', { class: 'exo-role muted small' }, g.def.role));
      row.addEventListener('click', () => this.app.selectPart(g.ids[0], { focus: false, both: true }));
      row.addEventListener('mouseenter', () => this.app.hoverPart(g.ids[0]));
      row.addEventListener('mouseleave', () => this.app.hoverPart(null));
      row.title = g.def.note;
      this.rows.set(g.def.key, { bar, val, row, g });
      list.append(row);
    }
    this.root.append(list);
    this.root.append(el('p', { class: 'nt muted small' },
      'Tap a muscle in this list, or on the body, to see what it is.'));
    this.root.append(el('p', { class: 'nt muted small' },
      'The effort levels come from published EMG studies of the flat barbell bench press. Each muscle is shown against its own peak in this lift. This is a teaching aid. It does not measure your body.'));

    this.liveUpdate();
  }

  /** Called every frame while playing — updates numbers in place, never rebuilds. */
  liveUpdate() {
    const p = this.player;
    if (!p || !p.ex) return;
    if (this.playBtn) this.playBtn.textContent = p.playing ? '❚❚ Pause' : '▶ Play';
    if (this.scrub && document.activeElement !== this.scrub) this.scrub.value = Math.round(p.t * 1000);
    const ph = phaseName(p.t);
    const set1 = (sel, txt) => { const n = this.root.querySelector(sel); if (n) n.textContent = txt; };
    set1('[data-live=phase]', ph.name);
    set1('[data-live=hint]', ph.hint);
    set1('[data-live=press]', `Bar ${Math.round(p.press * 100)}% of the way up`);
    const ranked = p.ranked();
    if (ranked[0]) { set1('[data-live=lead]', ranked[0].def.label); set1('[data-live=lead-note]', ranked[0].def.note); }
    for (const g of p.groups) {
      const r = this.rows.get(g.def.key);
      if (!r) continue;
      r.bar.style.width = (g.effort * 100).toFixed(0) + '%';
      r.bar.style.background = effortColor(g.effort);
      r.val.textContent = Math.round(g.effort * 100) + '%';
      r.row.classList.toggle('lead', ranked[0] === g && g.effort > 0.35);
    }
  }
}

/** Same ramp the shader uses, so the bar and the body agree. */
export function effortColor(a) {
  const mix = (x, y, k) => x.map((v, i) => Math.round(v + (y[i] - v) * k));
  const cool = [41, 69, 117], warm = [245, 117, 26], gold = [255, 189, 46], hot = [255, 230, 133];
  const c = a < 0.5 ? mix(cool, warm, a / 0.5) : a < 0.8 ? mix(warm, gold, (a - 0.5) / 0.3) : mix(gold, hot, (a - 0.8) / 0.2);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
