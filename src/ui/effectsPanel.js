import { el, esc } from '../core/util.js';
import { state, set } from '../core/state.js';
import { CATEGORY_META, stepOf, effectsAtStep, combineAtStep, stackTally } from '../core/effects.js';
import { TIMELINE_STEPS, EFFECT_KINDS, TARGETS } from '../data/targets.js';
import { MiniViewer } from '../core/mini.js';
import { loadMolecules, buildMolecule, moleculeLabel } from '../core/molecules.js';
import { FEATURES } from '../data/flags.js';

const KINDS = ['positive', 'negative', 'strain', 'neutral'];
const KIND_WORD = { positive: 'good', negative: 'harmful', strain: 'under strain', neutral: 'just changing' };
const GROUP_TITLE = {
  positive: '✅ Benefits: what gets better',
  negative: '❌ Harm: what gets damaged',
  strain: '⚠️ Strain: what is under load',
  neutral: '◇ Changes: neither good nor bad',
};
// Tissue that turns less dense rather than smaller: drawn fainter on the body.
const DENSE = new Set(['bones', 'lungs', 'kidneys', 'liver']);

const stepLabel = (t) => TIMELINE_STEPS.find(s => s.t === t)?.label || t;
const targetLabel = (t) => TARGETS[t]?.label || t;

/**
 * What happens if: pick something a person does to their body, or several things at once,
 * and watch what it does inside from one day to five years.
 *
 * Three views share this panel:
 *   the list      pick items, or tick ＋ to build a combination
 *   one item      its own story, step by step
 *   together      the combination on one timeline: what each item is doing at this point,
 *                 and organ by organ where they add up or pull against each other
 */
export class EffectsPanel {
  constructor(root, app) { this.root = root; this.app = app; this.mini = null; this.render(); }

  dispose() {
    this._molToken = (this._molToken || 0) + 1;     // a molecule still loading must not open a viewer
    if (this.mini) { this.mini.dispose(); this.mini = null; this.miniKey = null; }
  }

  render() {
    const lib = this.app.effects;
    // The panel redraws on every timeline step and every change to the combination. The
    // molecule viewer is kept across those redraws instead of being built again each time.
    const mol = state.effect && lib.get(state.effect)?.molecule;
    if (!mol || mol !== this.miniKey) this.dispose();
    // Stepping along the timeline redraws the same view; keep the reader's place in it.
    // A different view starts at the top.
    const view = state.effect && lib.get(state.effect) ? 'one:' + state.effect
      : state.stack.length && !state.fxBrowse ? 'together' : 'list';
    const scroll = view === this._view ? this.root.scrollTop : 0;
    this._view = view;
    this.root.innerHTML = '';
    this.root.classList.remove('fx-detail');
    if (view === 'together') this.renderTogether();
    else if (view === 'list') this.renderList();
    else this.renderOne(lib.get(state.effect));
    this.root.scrollTop = scroll;
  }

  // ---------------------------------------------------------------- the list
  renderList() {
    const lang = state.lang;
    const lib = this.app.effects;
    this.root.append(
      el('div', { class: 'ph' }, el('h2', {}, lang === 'hi' ? 'क्या होगा अगर…' : 'What happens if…'), el('span', { class: 'cnt' }, `${lib.count}`)),
      el('p', { class: 'pd' }, 'Pick anything a person does to their body. The timeline shows what changes inside, from 1 day to 5 years, on the 3D body.'),
    );
    if (!lib.count) { this.root.append(el('div', { class: 'note warn' }, 'No intervention data files found yet.')); return; }
    this.root.append(this.comboBar());
    for (const [cat, items] of lib.byCategory()) {
      const meta = CATEGORY_META[cat] || { label: cat, icon: '•' };
      const box = el('div', { class: 'cat' }, el('h4', {}, `${meta.icon} ${lang === 'hi' ? meta.hi : meta.label} (${items.length})`));
      for (const e of items) {
        const on = state.stack.includes(e.id);
        const tick = el('button', { class: 'fx-tick' + (on ? ' on' : ''), title: on ? 'Take this out of the combination' : 'Add this to the combination' }, on ? '✓' : '+');
        tick.addEventListener('click', (ev) => { ev.stopPropagation(); this.app.toggleStack(e.id); });
        const row = el('div', { class: 'fx' + (on ? ' stacked' : ''), onClick: () => this.app.openEffect(e.id) },
          el('div', { class: 'ico' }, e.icon || meta.icon),
          el('div', { class: 'n' }, lang === 'hi' ? e.name.hi : e.name.en, FEATURES.hindi && e.name.hi ? el('small', {}, lang === 'hi' ? e.name.en : e.name.hi) : null),
          tick);
        box.append(row);
      }
      this.root.append(box);
    }
  }

  /** The combination being built, at the top of the list. */
  comboBar() {
    const app = this.app;
    const wrap = el('div', { class: 'stackbar' });
    const stack = state.stack.map(id => app.effects.get(id)).filter(Boolean);
    if (!stack.length) {
      wrap.append(el('div', { class: 'stack-hint' },
        el('b', {}, '＋ Combine several at once'),
        el('span', {}, 'Press ＋ on any item to add it. Try creatine, training and good sleep together. You will see what they do to the body as a group, on one timeline.')));
      return wrap;
    }
    wrap.append(
      el('div', { class: 'stack-head' },
        el('b', {}, `Your combination: ${stack.length}`),
        el('button', { class: 'btn sm ghost', onClick: () => app.clearStack() }, 'Clear')),
      this.chips(stack));
    if (stack.length >= 2) {
      wrap.append(el('button', { class: 'btn primary together-go', onClick: () => app.showTogether() }, `▶ See all ${stack.length} together`));
      wrap.append(el('div', { class: 'muted small' }, 'The body and the timeline below already show them together.'));
    } else {
      wrap.append(el('div', { class: 'muted small' }, 'Add one more with ＋ to combine them.'));
    }
    return wrap;
  }

  chips(list) {
    const chips = el('div', { class: 'stack-chips' });
    for (const e of list) {
      const chip = el('span', { class: 'stack-chip', title: 'Open this one on its own' }, `${e.icon || ''} ${e.name.en}`);
      chip.addEventListener('click', () => this.app.openEffect(e.id));
      const x = el('button', { class: 'ctx-x', title: 'Take this out of the combination' }, '×');
      x.addEventListener('click', (ev) => { ev.stopPropagation(); this.app.toggleStack(e.id); });
      chip.append(x);
      chips.append(chip);
    }
    return chips;
  }

  // ---------------------------------------------------------------- together
  renderTogether() {
    const app = this.app;
    const list = app.activeEffects();
    const combined = combineAtStep(list, state.effectStep);
    const at = stepLabel(state.effectStep);

    this.root.append(
      el('div', { class: 'btnrow' },
        el('button', { class: 'btn sm ghost', onClick: () => app.browseEffects() }, '‹ Add or change items'),
        el('button', { class: 'btn sm ghost', onClick: () => app.clearStack() }, 'Clear all')),
      el('div', { class: 'ph' }, el('h2', {}, 'All together'), el('span', { class: 'cnt' }, `${list.length}`)),
      el('p', { class: 'pd' }, `These ${list.length} things, done together every day. Move along the timeline below to see what they do to the body over time.`),
      this.chips(list),
      el('h3', { class: 'sec' }, `After ${at}`),
      this.bodyNow(combined),
      this.balanceChart(list),
    );

    // What each item is doing at this point: the story of each, side by side.
    this.root.append(el('h3', { class: 'sec' }, `What each one is doing after ${at}`));
    const now = el('div', { class: 'habit-now' });
    for (const e of list) {
      const row = el('div', { class: 'hn-row', title: 'Open this one on its own' },
        el('div', { class: 'hn-ico' }, e.icon || '•'),
        el('div', {}, el('b', {}, e.name.en), el('span', {}, stepOf(e, state.effectStep).headline)));
      row.addEventListener('click', () => app.openEffect(e.id));
      now.append(row);
    }
    this.root.append(now);

    // Organ by organ, including where two items meet on the same organ.
    const items = [...combined.values()];
    const fresh = items.filter(c => c.hits.some(h => h.current));
    const older = items.filter(c => !c.hits.some(h => h.current));
    this.root.append(el('h3', { class: 'sec' }, 'Organ by organ'));
    const rein = items.filter(c => c.interaction === 'reinforce').length;
    const conf = items.filter(c => c.interaction === 'conflict').length;
    if (rein || conf) {
      this.root.append(el('p', { class: 'pd small' },
        [rein ? `${rein} ${rein === 1 ? 'organ is' : 'organs are'} hit by more than one item in the same direction (⊕ add up).` : '',
         conf ? `${conf} ${conf === 1 ? 'organ gets' : 'organs get'} pulled in opposite directions (⇄ pull against each other).` : '']
          .filter(Boolean).join(' ')));
    }
    let shown = 0;
    for (const kind of KINDS) {
      const rows = fresh.filter(c => c.kind === kind).sort((a, b) => b.intensity - a.intensity);
      if (!rows.length) continue;
      this.root.append(el('h4', { class: 'fx-group ' + kind }, GROUP_TITLE[kind], el('span', { class: 'n' }, rows.length)));
      for (const c of rows) { this.root.append(this.organRow(c)); shown++; }
    }
    if (!shown) this.root.append(el('p', { class: 'muted small' }, 'Nothing new starts at this point. What began earlier is still going on, below.'));
    if (older.length) {
      const d = el('details', { class: 'fx-older' },
        el('summary', {}, `Still going on from earlier`, el('span', { class: 'n' }, older.length)));
      for (const c of older.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))) d.append(this.organRow(c));
      this.root.append(d);
    }

    this.root.append(el('p', { class: 'muted small' },
      'When two items affect the same organ, this shows whether they add up or cancel out. It does not give an exact combined number. The effect of the two together is real, but the research does not support a precise figure.'));
    this.root.append(el('p', { class: 'muted small' }, 'Education, not medical advice. Talk to a doctor before changing any medicine or dose.'));
  }

  /** One organ in the combination: what each item does to it, and whether they agree. */
  organRow(c) {
    const app = this.app;
    const badge = c.interaction === 'reinforce' ? el('span', { class: 'org-badge rein' }, '⊕ add up')
      : c.interaction === 'conflict' ? el('span', { class: 'org-badge conf' }, '⇄ pull against each other') : null;
    const n = app.registry.resolveTarget(c.target).length;
    const d = el('details', { class: `org ${c.kind}` },
      el('summary', {},
        el('span', { class: 'org-t' }, targetLabel(c.target)),
        el('span', { class: 'org-ico' }, c.hits.map(h => h.icon).join(' ')),
        badge));
    for (const h of c.hits) {
      d.append(el('div', { class: 'org-hit' },
        el('div', { class: 'org-from' }, el('b', {}, `${h.icon} ${h.fromName.en}`), el('span', { class: 'pill ' + h.kind }, EFFECT_KINDS[h.kind]?.label || h.kind),
          h.current ? null : el('span', { class: 'muted small' }, ` since ${stepLabel(h.step)}`)),
        h.metric ? el('div', { class: 'nt muted small' }, `${h.metric.label}: ${h.metric.value}`) : null,
        el('div', { class: 'nt' }, h.note)));
    }
    if (n) d.append(el('div', { class: 'efx-foot' }, el('button', { class: 'showbtn', onClick: (ev) => { ev.stopPropagation(); app.focusTarget(c.target); } }, '⌖ Show me where')));
    d.addEventListener('mouseenter', () => app.hoverTarget(c.target));
    d.addEventListener('mouseleave', () => app.hoverTarget(null));
    return d;
  }

  // ---------------------------------------------------------------- shared
  /**
   * How the body itself looks by this point: the muscle and fat change, and every organ
   * that has grown, shrunk or thinned. These are the changes drawn on the 3D body.
   */
  bodyNow(combined) {
    const app = this.app;
    const drift = app.stackBodyDrift();
    const box = el('div', { class: 'fx-body' });
    if (drift.any) {
      // In kilograms, against the same body without any of this. The weight is held where
      // the Age tab set it, so muscle gained is fat lost, and the other way round.
      const comp = app.bodyComposition(), base = app.bodyComposition({ drift: false });
      const dLean = comp.leanKg - base.leanKg, df = comp.bfPct - base.bfPct;
      const kg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)} kg`;
      box.append(el('div', { class: 'sb-rows' },
        el('div', { class: 'sb-row ' + (dLean >= 0 ? 'good' : 'bad') }, el('span', {}, 'Lean mass'), el('b', {}, kg(dLean))),
        el('div', { class: 'sb-row ' + (df <= 0 ? 'good' : 'bad') }, el('span', {}, 'Body fat'), el('b', {}, `${df >= 0 ? '+' : '−'}${Math.abs(df).toFixed(1)} pts`)),
        el('div', { class: 'sb-row' }, el('span', {}, 'Body fat now'), el('b', {}, `${comp.bfPct}%`))));
    }
    const sizes = [];
    for (const c of combined.values()) {
      const v = c.visual;
      if (!v) continue;
      const bits = [];
      if (v.scale != null && Math.abs(v.scale - 1) >= 0.005) {
        const pct = Math.round(Math.abs(v.scale - 1) * 100);
        bits.push(v.scale > 1 ? `${pct}% bigger` : `${pct}% smaller`);
      }
      if (v.opacity != null && v.opacity < 0.99) bits.push(DENSE.has(c.target) ? 'less dense, drawn fainter' : 'less of it, drawn fainter');
      if (!bits.length) continue;
      const causes = c.hits.filter(h => h.visual).map(h => h.icon).join(' ');
      sizes.push({ c, text: bits.join(', '), causes });
    }
    if (sizes.length) {
      const ul = el('div', { class: 'size-list' });
      for (const s of sizes) {
        const row = el('div', { class: 'size-row ' + s.c.kind },
          el('span', {}, targetLabel(s.c.target)), el('b', {}, s.text), el('span', { class: 'size-from' }, s.causes));
        row.addEventListener('mouseenter', () => app.hoverTarget(s.c.target));
        row.addEventListener('mouseleave', () => app.hoverTarget(null));
        row.addEventListener('click', () => app.focusTarget(s.c.target));
        ul.append(row);
      }
      box.append(ul);
    }
    if (!drift.any && !sizes.length) {
      box.append(el('div', { class: 'muted small' }, 'No change in size or shape yet. What happens at this point is inside the tissue. The colours on the body show where.'));
    } else {
      box.append(el('div', { class: 'muted small' }, 'These changes are drawn on the 3D body. Hold “Before” on the timeline to compare it with the body before any of this.'));
    }
    return box;
  }

  /** Good against harm at each of the seven points on the timeline. Click one to go there. */
  balanceChart(list) {
    const cols = TIMELINE_STEPS.map(s => {
      const t = { positive: 0, negative: 0, strain: 0, neutral: 0 };
      for (const c of combineAtStep(list, s.t).values()) t[c.kind] = (t[c.kind] || 0) + 1;
      return { s, t, total: KINDS.reduce((a, k) => a + t[k], 0) };
    });
    const max = Math.max(1, ...cols.map(c => c.total));
    const chart = el('div', { class: 'bal' });
    for (const c of cols) {
      const bar = el('div', { class: 'bal-bar' });
      for (const k of KINDS) if (c.t[k]) bar.append(el('i', { class: k, style: `height:${(c.t[k] / max) * 100}%` }));
      const col = el('button', { class: 'bal-col' + (c.s.t === state.effectStep ? ' active' : ''), title: `${c.s.label}: ${KINDS.filter(k => c.t[k]).map(k => `${c.t[k]} ${KIND_WORD[k]}`).join(', ')}` },
        bar, el('span', {}, c.s.t));
      col.addEventListener('click', () => this.app.setEffectStep(c.s.t));
      chart.append(col);
    }
    const now = cols.find(c => c.s.t === state.effectStep) || cols[0];
    const parts = KINDS.filter(k => now.t[k]).map(k => `${now.t[k]} ${KIND_WORD[k]}`);
    return el('div', { class: 'bal-wrap' },
      el('div', { class: 'bal-head' }, 'Good and harm at each point'),
      chart,
      el('div', { class: 'bal-legend' }, ...KINDS.map(k => el('span', {}, el('i', { class: k }), EFFECT_KINDS[k].label))),
      el('div', { class: 'muted small' }, parts.length
        ? `After ${now.s.label}, the body parts affected: ${parts.join(', ')}.`
        : `Nothing affected yet after ${now.s.label}.`));
  }

  // ---------------------------------------------------------------- one item
  renderOne(e) {
    const lang = state.lang;
    const app = this.app;
    const step = stepOf(e, state.effectStep);
    const cum = effectsAtStep(e, state.effectStep);
    this.root.classList.add('fx-detail');

    const back = el('div', { class: 'btnrow' }, el('button', { class: 'btn sm ghost', onClick: () => app.closeEffect() }, '‹ All interventions'));
    const inCombo = state.stack.includes(e.id);
    if (inCombo && state.stack.length >= 2) back.append(el('button', { class: 'btn sm', onClick: () => app.closeEffect(true) }, `‹ Back to all ${state.stack.length} together`));
    this.root.append(back);
    if (inCombo && state.stack.length >= 2) {
      this.root.append(el('div', { class: 'note in' }, `This is one of the ${state.stack.length} things in your combination. The body shows this one on its own.`));
    }

    this.root.append(el('div', { class: 'ph' }, el('h2', {}, `${e.icon || ''} ${lang === 'hi' ? e.name.hi : e.name.en}`)));
    if (FEATURES.hindi && lang !== 'hi' && e.name.hi) this.root.append(el('div', { class: 'insp-hi' }, e.name.hi));
    this.root.append(el('div', { class: 'tagrow' },
      el('span', { class: 'tag' }, CATEGORY_META[e.category]?.label || e.category),
      el('span', { class: `ev ${e.evidence}` }, `${e.evidence} evidence`)));
    if (!inCombo) {
      this.root.append(el('div', { class: 'btnrow' },
        el('button', { class: 'btn sm', onClick: () => app.toggleStack(e.id) }, '＋ Add to a combination')));
    }
    if (e.dose) this.root.append(el('div', { class: 'note' }, el('b', {}, 'Dose: '), e.dose));
    this.root.append(el('p', { class: 'desc' }, lang === 'hi' ? e.summary.hi : e.summary.en));
    if (e.indian_context) this.root.append(el('div', { class: 'note in' }, el('b', {}, '🇮🇳 India: '), e.indian_context));
    if (e.caution) this.root.append(el('div', { class: 'note warn' }, el('b', {}, '⚠ '), e.caution));

    // What the body looks like by now, and the balance over the five years.
    this.root.append(el('h3', { class: 'sec' }, `The body after ${stepLabel(state.effectStep)}`), this.bodyNow(combineAtStep([e], state.effectStep)), this.balanceChart([e]));

    // molecule
    if (e.molecule) {
      const wrap = el('div', { class: 'molwrap' }, el('div', { class: 'cap' }, el('b', {}, moleculeLabel(e.molecule)), ' '));
      this.root.append(el('h3', { class: 'sec' }, 'The molecule in 3D'), wrap);
      const token = this._molToken = (this._molToken || 0) + 1;
      loadMolecules().then(all => {
        // A newer redraw has taken over, or the panel has closed.
        if (token !== this._molToken || !wrap.isConnected) return;
        const mol = all[e.molecule];
        if (!mol) { wrap.remove(); return; }
        if (this.mini && this.miniKey === e.molecule) this.mini.attach(wrap);
        else {
          this.dispose();
          this._molToken = token;
          this.mini = new MiniViewer(wrap);
          this.mini.show(buildMolecule(mol));
          this.miniKey = e.molecule;
        }
        wrap.querySelector('.cap').innerHTML = `<b>${esc(moleculeLabel(e.molecule))}</b> · ${esc(mol.formula)} · ${mol.atoms.length} atoms${mol.is2d ? ' (2D layout)' : ''}`;
      });
    }

    // ---- current step, split into good vs bad instead of one mixed list
    this.root.append(
      el('h3', { class: 'sec' }, `What is happening at ${stepLabel(state.effectStep)}`),
      el('div', { class: 'note' }, el('b', {}, step.headline)));

    const cur = [...cum.values()].filter(f => f.current);
    const carried = [...cum.values()].filter(f => !f.current);
    const list = el('div');
    let shown = 0;
    for (const kind of KINDS) {
      const rows = cur.filter(f => f.kind === kind);
      if (!rows.length) continue;
      list.append(el('h4', { class: 'fx-group ' + kind }, GROUP_TITLE[kind], el('span', { class: 'n' }, rows.length)));
      for (const fx of rows) { list.append(this.fxRow(fx)); shown++; }
    }
    if (!shown) list.append(el('p', { class: 'muted small' }, 'Nothing new at this step.'));
    if (carried.length) {
      list.append(el('h4', { class: 'fx-group neutral' }, 'Still going on from earlier', el('span', { class: 'n' }, carried.length)));
      for (const fx of carried) list.append(this.fxRow(fx, true));
    }
    this.root.append(list);

    if (e.sources?.length) {
      const ul = el('ul', { class: 'src' });
      for (const s of e.sources) ul.append(el('li', {}, s));
      this.root.append(el('h3', { class: 'sec' }, 'Sources'), ul);
    }
    this.root.append(el('p', { class: 'muted small' }, 'Education, not medical advice. Talk to a doctor before changing any medicine or dose.'));
  }

  fxRow(fx, dim = false) {
    const t = TARGETS[fx.target];
    const n = this.app.registry.resolveTarget(fx.target).length;
    const row = el('div', { class: `efx ${fx.kind}`, style: dim ? 'opacity:.66' : '' },
      el('div', { class: 't' },
        el('span', {}, t?.label || fx.target),
        fx.metric ? el('span', { class: 'm' }, `${fx.metric.value}`) : null),
      fx.metric ? el('div', { class: 'nt muted small' }, fx.metric.label) : null,
      el('div', { class: 'nt' }, fx.note),
      el('div', { class: 'efx-foot' },
        dim ? el('span', { class: 'pill ' + fx.kind }, 'since ' + stepLabel(fx.step)) : null,
        n ? el('button', { class: 'showbtn', onClick: (ev) => { ev.stopPropagation(); this.app.focusTarget(fx.target); } }, '⌖ Show me where')
          : el('span', { class: 'muted small' }, '(not mapped in 3D)')));
    row.addEventListener('mouseenter', () => this.app.hoverTarget(fx.target));
    row.addEventListener('mouseleave', () => this.app.hoverTarget(null));
    row.addEventListener('click', () => this.app.focusTarget(fx.target));
    return row;
  }
}

/**
 * The timeline under the body. It runs whatever the body is showing: one item on its own,
 * or a whole combination together.
 */
export function renderEffectDock(dock, app) {
  const list = app.activeEffects();
  dock.innerHTML = '';
  if (!list.length) { dock.hidden = true; return; }
  dock.hidden = false;
  const idx = TIMELINE_STEPS.findIndex(s => s.t === state.effectStep);
  let title, sub;
  if (list.length === 1) {
    title = `${list[0].icon || ''} ${list[0].name.en}`;
    sub = stepOf(list[0], state.effectStep).headline;
  } else {
    const t = stackTally(combineAtStep(list, state.effectStep));
    title = `${list.map(e => e.icon || '').join(' ')}  ${list.length} together`;
    const parts = KINDS.filter(k => t[k]).map(k => `${t[k]} ${KIND_WORD[k]}`);
    sub = parts.length ? `After ${stepLabel(state.effectStep)}: ${parts.join(', ')}` : '';
  }
  dock.append(el('div', { class: 'tl-head' },
    el('div', { class: 'h' }, title, el('small', {}, sub)),
    el('div', { class: 'lg' }, ...Object.entries(EFFECT_KINDS).map(([k, v]) => el('span', {}, el('i', { class: 'k-' + k }), v.label)))));
  const steps = el('div', { class: 'steps' });
  TIMELINE_STEPS.forEach((s, i) => {
    const b = el('div', { class: 'st' + (i === idx ? ' active' : '') + (i < idx ? ' done' : ''), onClick: () => app.setEffectStep(s.t) },
      el('i', {}), el('span', {}, s.label));
    steps.append(b);
  });
  const play = el('button', { class: 'play', title: 'Play the timeline', onClick: () => app.togglePlay() }, state.playing ? '❚❚' : '▶');
  // Press and hold: the body before any of this. Letting go brings the changes back.
  const before = el('button', { class: 'before-btn', title: 'Hold to see the body before any of this' }, '◐ Before');
  const on = (ev) => { ev.preventDefault(); before.setPointerCapture?.(ev.pointerId); app.setCompare(true); };
  const off = () => app.setCompare(false);
  before.addEventListener('pointerdown', on);
  before.addEventListener('pointerup', off);
  before.addEventListener('pointercancel', off);
  before.addEventListener('lostpointercapture', off);
  dock.append(el('div', { class: 'tl' }, play, steps, before));
}
