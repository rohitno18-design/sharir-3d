import { el } from '../core/util.js';
import { EXERCISES } from '../data/exercises.js';

/** Which moment of the rep the current phase falls in. */
function phaseName(t) {
  if (t < 0.42) return { name: 'Lowering', hint: 'Eccentric — the lats and cuff are steering the bar down' };
  if (t < 0.52) return { name: 'On the chest', hint: 'Paused — the shoulder is at its most open' };
  if (t < 0.92) return { name: 'Pressing', hint: 'Concentric — chest and front delt drive, triceps take over' };
  return { name: 'Lockout', hint: 'Elbows straight — triceps and serratus finish the rep' };
}

const VIEWS = [
  { key: 'skin', label: 'Skin', sys: ['integumentary'] },
  { key: 'muscle', label: 'Muscles', sys: ['muscular'] },
  { key: 'bone', label: 'Skeleton', sys: ['skeletal', 'joints'] },
  { key: 'nerve', label: 'Nerves', sys: ['nervous'] },
  { key: 'vessel', label: 'Vessels', sys: ['cardiovascular'] },
];

export class ExercisePanel {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.render();
    if (this.player) this.player.onSeek = () => this.liveUpdate();
  }

  dispose() {
    if (this.player) this.player.onSeek = null;
    this.app.exercise?.stop();
  }

  get player() { return this.app.exercise; }

  render() {
    const p = this.player;
    const ex = p?.ex || EXERCISES[0];
    this.root.innerHTML = '';

    this.root.append(
      el('div', { class: 'ph' }, el('h2', {}, 'Movement'), el('span', { class: 'cnt' }, ex.sub)),
      el('p', { class: 'pd' }, 'Scrub the rep and watch the load move between muscles. Colour is effort: cool is idle, amber is working, white is near its hardest.'),
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
      el('div', { class: 'btnrow' }, speed),
    );

    // ---- layer switch ----
    this.root.append(el('h3', { class: 'sec' }, 'Look through'));
    const views = el('div', { class: 'chips' });
    for (const v of VIEWS) {
      views.append(el('button', { class: 'chip', onClick: () => this.app.showOnlySystems(v.sys) }, v.label));
    }
    views.append(el('button', { class: 'chip', onClick: () => this.app.showOnlySystems(null) }, 'All'));
    this.root.append(views);

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
      'Click a muscle above to select it — while the body is posed, clicking in 3D is off, because the click test still sees the standing pose.'));
    this.root.append(el('p', { class: 'nt muted small' },
      'Effort is shaped from published EMG work on the flat barbell bench press, scaled to each muscle’s own peak in this lift. It is a teaching aid, not a measurement of you.'));

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
    set1('[data-live=press]', `${Math.round(p.press * 100)}% extended`);
    const ranked = p.ranked();
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
function effortColor(a) {
  const mix = (x, y, k) => x.map((v, i) => Math.round(v + (y[i] - v) * k));
  const cool = [40, 70, 130], warm = [242, 140, 26], hot = [255, 237, 204];
  const c = a < 0.55 ? mix(cool, warm, a / 0.55) : mix(warm, hot, (a - 0.55) / 0.45);
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
