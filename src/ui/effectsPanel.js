import { el, esc } from '../core/util.js';
import { state, set } from '../core/state.js';
import { CATEGORY_META, stepOf, effectsAtStep, combineAtStep, stackTally } from '../core/effects.js';
import { TIMELINE_STEPS, EFFECT_KINDS, TARGETS } from '../data/targets.js';
import { MiniViewer } from '../core/mini.js';
import { loadMolecules, buildMolecule, moleculeLabel } from '../core/molecules.js';

export class EffectsPanel {
  constructor(root, app) { this.root = root; this.app = app; this.mini = null; this.render(); }

  dispose() { if (this.mini) { this.mini.dispose(); this.mini = null; } }

  render() {
    this.dispose();
    const lang = state.lang;
    const lib = this.app.effects;
    this.root.innerHTML = '';
    if (!state.effect) {
      this.root.append(
        el('div', { class: 'ph' }, el('h2', {}, lang === 'hi' ? 'क्या होगा अगर…' : 'What happens if…'), el('span', { class: 'cnt' }, `${lib.count}`)),
        el('p', { class: 'pd' }, lang === 'hi' ? 'कोई भी चीज़ चुनें — 1 दिन से 5 साल तक शरीर के अंदर क्या बदलता है, वह 3D में चमक कर दिखेगा।' : 'Pick anything a person does to their body. The timeline shows what changes inside, from 1 day to 5 years, glowing on the 3D body.'),
      );
      if (!lib.count) { this.root.append(el('div', { class: 'note warn' }, 'No intervention data files found yet.')); return; }
      this.root.append(this.stackBar(lang));
      for (const [cat, items] of lib.byCategory()) {
        const meta = CATEGORY_META[cat] || { label: cat, icon: '•' };
        const box = el('div', { class: 'cat' }, el('h4', {}, `${meta.icon} ${lang === 'hi' ? meta.hi : meta.label} (${items.length})`));
        for (const e of items) {
          const on = state.stack.includes(e.id);
          const tick = el('button', { class: 'fx-tick' + (on ? ' on' : ''), title: on ? 'Remove from the combination' : 'Combine this with the others' }, on ? '✓' : '+');
          tick.addEventListener('click', (ev) => { ev.stopPropagation(); this.app.toggleStack(e.id); });
          const row = el('div', { class: 'fx' + (on ? ' stacked' : ''), onClick: () => this.app.openEffect(e.id) },
            el('div', { class: 'ico' }, e.icon || meta.icon),
            el('div', { class: 'n' }, lang === 'hi' ? e.name.hi : e.name.en, el('small', {}, lang === 'hi' ? e.name.en : (e.name.hi || e.dose || ''))),
            tick);
          box.append(row);
        }
        this.root.append(box);
      }
      return;
    }
    // detail
    const e = lib.get(state.effect);
    if (!e) { set({ effect: null }); return this.render(); }
    const step = stepOf(e, state.effectStep);
    const cum = effectsAtStep(e, state.effectStep);
    this.root.classList.add('fx-detail');
    this.root.append(this.stackBar(lang));
    this.root.append(
      el('div', { class: 'btnrow' }, el('button', { class: 'btn sm ghost', onClick: () => this.app.closeEffect() }, '‹ ', lang === 'hi' ? 'सूची' : 'All interventions')),
      el('div', { class: 'ph' }, el('h2', {}, `${e.icon || ''} ${lang === 'hi' ? e.name.hi : e.name.en}`)),
    );
    if (lang !== 'hi' && e.name.hi) this.root.append(el('div', { class: 'insp-hi' }, e.name.hi));
    this.root.append(el('div', { class: 'tagrow' },
      el('span', { class: 'tag' }, CATEGORY_META[e.category]?.label || e.category),
      el('span', { class: `ev ${e.evidence}` }, `${e.evidence} evidence`)));
    if (e.dose) this.root.append(el('div', { class: 'note' }, el('b', {}, lang === 'hi' ? 'मात्रा: ' : 'Dose: '), e.dose));
    this.root.append(el('p', { class: 'desc' }, lang === 'hi' ? e.summary.hi : e.summary.en));
    if (e.indian_context) this.root.append(el('div', { class: 'note in' }, el('b', {}, '🇮🇳 India: '), e.indian_context));
    if (e.caution) this.root.append(el('div', { class: 'note warn' }, el('b', {}, '⚠ '), e.caution));

    // molecule
    if (e.molecule) {
      const wrap = el('div', { class: 'molwrap' }, el('div', { class: 'cap' }, el('b', {}, moleculeLabel(e.molecule)), ' '));
      this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'अणु (3D)' : 'The molecule in 3D'), wrap);
      loadMolecules().then(all => {
        const mol = all[e.molecule];
        if (!mol) { wrap.remove(); return; }
        this.mini = new MiniViewer(wrap);
        this.mini.show(buildMolecule(mol));
        wrap.querySelector('.cap').innerHTML = `<b>${esc(moleculeLabel(e.molecule))}</b> · ${esc(mol.formula)} · ${mol.atoms.length} atoms${mol.is2d ? ' (2D layout)' : ''}`;
      });
    }

    // ---- at a glance: the whole timeline summed up, so the verdict is visible instantly
    const all = new Map();
    for (const s of e.timeline) for (const fx of s.effects) all.set(fx.target + s.t, fx);
    const tally = { positive: 0, negative: 0, strain: 0, neutral: 0 };
    for (const fx of all.values()) tally[fx.kind] = (tally[fx.kind] || 0) + 1;
    const verdict = el('div', { class: 'glance' });
    for (const [k, label, hi] of [['positive', 'Good for you', 'फ़ायदे'], ['negative', 'Harmful', 'नुक़सान'],
                                  ['strain', 'Puts strain', 'दबाव'], ['neutral', 'Just changes', 'बदलाव']]) {
      if (!tally[k]) continue;
      verdict.append(el('div', { class: 'glance-cell ' + k },
        el('b', {}, String(tally[k])), el('span', {}, lang === 'hi' ? hi : label)));
    }
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'कुल मिलाकर (5 साल तक)' : 'Over the whole 5 years'), verdict);

    // ---- current step, split into good vs bad instead of one mixed list
    this.root.append(
      el('h3', { class: 'sec' }, `${lang === 'hi' ? 'इस समय पर' : 'What is happening at'} ${TIMELINE_STEPS.find(s => s.t === state.effectStep)?.[lang === 'hi' ? 'hi' : 'label']}`),
      el('div', { class: 'note' }, el('b', {}, step.headline)));

    const cur = [...cum.values()].filter(f => f.current);
    const carried = [...cum.values()].filter(f => !f.current);
    const GROUPS = [
      ['positive', lang === 'hi' ? '✅ फ़ायदा — शरीर में क्या अच्छा होता है' : '✅ Benefits — what improves'],
      ['negative', lang === 'hi' ? '❌ नुक़सान — क्या बिगड़ता है' : '❌ Harm — what gets damaged'],
      ['strain',   lang === 'hi' ? '⚠️ दबाव — किस पर ज़ोर पड़ता है' : '⚠️ Strain — what is under load'],
      ['neutral',  lang === 'hi' ? '◇ बदलाव — न अच्छा न बुरा' : '◇ Changes — neither good nor bad'],
    ];
    const list = el('div');
    let shown = 0;
    for (const [kind, title] of GROUPS) {
      const rows = cur.filter(f => f.kind === kind);
      if (!rows.length) continue;
      list.append(el('h4', { class: 'fx-group ' + kind }, title, el('span', { class: 'n' }, rows.length)));
      for (const fx of rows) { list.append(this.fxRow(fx, lang)); shown++; }
    }
    if (!shown) list.append(el('p', { class: 'muted small' }, lang === 'hi' ? 'इस चरण पर कोई नया बदलाव नहीं।' : 'Nothing new at this step.'));
    if (carried.length) {
      list.append(el('h4', { class: 'fx-group neutral' }, lang === 'hi' ? 'पहले से चल रहा' : 'Still going on from earlier', el('span', { class: 'n' }, carried.length)));
      for (const fx of carried) list.append(this.fxRow(fx, lang, true));
    }
    this.root.append(list);

    if (e.sources?.length) {
      const ul = el('ul', { class: 'src' });
      for (const s of e.sources) ul.append(el('li', {}, s));
      this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'स्रोत' : 'Sources'), ul);
    }
    this.root.append(el('p', { class: 'muted small' }, lang === 'hi' ? 'यह शिक्षा के लिए है, चिकित्सा सलाह नहीं। दवा या खुराक बदलने से पहले डॉक्टर से पूछें।' : 'Education, not medical advice. Talk to a doctor before changing any medicine or dose.'));
  }

  /**
   * The combined view. Tick several habits and this is what they do TOGETHER — including
   * where they reinforce each other and where they pull in opposite directions, which is
   * the part a single-habit view can never show.
   */
  stackBar(lang) {
    const app = this.app;
    const active = app.activeEffects();
    const wrap = el('div', { class: 'stackbar' });

    if (active.length <= 1) {
      wrap.append(el('div', { class: 'stack-hint' },
        el('b', {}, lang === 'hi' ? '＋ कई चीज़ें एक साथ जोड़ें' : '＋ Combine several at once'),
        el('span', {}, lang === 'hi'
          ? 'किसी भी चीज़ के आगे ＋ दबाएँ — जैसे क्रिएटिन + जिम + अच्छी नींद — और देखें कि सब मिलकर शरीर पर क्या असर डालते हैं।'
          : 'Press ＋ on any item — creatine + training + good sleep, say — and see what they do to the body together, not one at a time.')));
      return wrap;
    }

    // chips for everything in the combination
    const chips = el('div', { class: 'stack-chips' });
    for (const e of active) {
      const isOpen = e.id === state.effect;
      const chip = el('span', { class: 'stack-chip' + (isOpen ? ' open' : '') },
        `${e.icon || ''} ${lang === 'hi' ? e.name.hi : e.name.en}`);
      if (!isOpen) {
        const x = el('button', { class: 'ctx-x', title: 'Remove from the combination' }, '×');
        x.addEventListener('click', (ev) => { ev.stopPropagation(); app.toggleStack(e.id); });
        chip.append(x);
      }
      chips.append(chip);
    }

    const combined = combineAtStep(active, state.effectStep);
    const t = stackTally(combined);
    const drift = app.stackBodyDrift();
    const comp = app.bodyComposition();
    const stepLabel = TIMELINE_STEPS.find(s => s.t === state.effectStep)?.[lang === 'hi' ? 'hi' : 'label'];

    wrap.append(
      el('div', { class: 'stack-head' },
        el('b', {}, `${lang === 'hi' ? 'सब मिलाकर' : 'All together'} — ${active.length} ${lang === 'hi' ? 'चीज़ें' : 'habits'}`),
        el('button', { class: 'btn sm ghost', onClick: () => app.clearStack() }, lang === 'hi' ? 'सब हटाएँ' : 'Clear')),
      chips);

    // What the body itself would look like by this point on the timeline.
    if (drift.any) {
      const dm = drift.dMuscle, df = drift.dFatPct;
      wrap.append(el('div', { class: 'stack-body' },
        el('div', { class: 'sb-title' }, `${lang === 'hi' ? 'इतने समय बाद शरीर' : 'The body after'} ${stepLabel}`),
        el('div', { class: 'sb-rows' },
          el('div', { class: 'sb-row ' + (dm >= 0 ? 'good' : 'bad') },
            el('span', {}, lang === 'hi' ? 'मांसपेशी' : 'Muscle'),
            el('b', {}, `${dm >= 0 ? '+' : ''}${(dm * 100).toFixed(0)}%`)),
          el('div', { class: 'sb-row ' + (df <= 0 ? 'good' : 'bad') },
            el('span', {}, lang === 'hi' ? 'शरीर की चर्बी' : 'Body fat'),
            el('b', {}, `${df >= 0 ? '+' : ''}${df.toFixed(1)} pts`)),
          el('div', { class: 'sb-row' },
            el('span', {}, lang === 'hi' ? 'अब चर्बी' : 'Now at'),
            el('b', {}, `${comp.bfPct}%`)))));
    }

    // Reinforcing vs conflicting — the genuinely new information in a combination.
    const rein = [...combined.values()].filter(c => c.interaction === 'reinforce');
    const conf = [...combined.values()].filter(c => c.interaction === 'conflict');
    const line = (cls, icon, label, items) => {
      if (!items.length) return null;
      const box = el('div', { class: 'stack-inter ' + cls },
        el('div', { class: 'si-head' }, `${icon} ${label}`, el('span', { class: 'n' }, items.length)));
      for (const c of items.slice(0, 6)) {
        const names = c.hits.map(h => h.icon).join(' ');
        const row = el('div', { class: 'si-row' },
          el('span', { class: 'si-t' }, TARGETS[c.target]?.label || c.target),
          el('span', { class: 'si-from' }, names));
        row.addEventListener('mouseenter', () => app.hoverTarget(c.target));
        row.addEventListener('mouseleave', () => app.hoverTarget(null));
        row.addEventListener('click', () => app.focusTarget(c.target));
        box.append(row);
      }
      return box;
    };
    const rl = line('rein', '⊕', lang === 'hi' ? 'एक-दूसरे को बढ़ाते हैं' : 'These reinforce each other', rein);
    const cl = line('conf', '⇄', lang === 'hi' ? 'एक-दूसरे के ख़िलाफ़ जाते हैं' : 'These pull against each other', conf);
    if (rl) wrap.append(rl);
    if (cl) wrap.append(cl);

    wrap.append(el('div', { class: 'glance' }, ...[
      ['positive', lang === 'hi' ? 'फ़ायदे' : 'Good'], ['negative', lang === 'hi' ? 'नुक़सान' : 'Harm'],
      ['strain', lang === 'hi' ? 'दबाव' : 'Strain'], ['neutral', lang === 'hi' ? 'बदलाव' : 'Changes'],
    ].filter(([k]) => t[k]).map(([k, label]) =>
      el('div', { class: 'glance-cell ' + k }, el('b', {}, String(t[k])), el('span', {}, label)))));

    wrap.append(el('div', { class: 'muted small' }, lang === 'hi'
      ? 'जहाँ दो आदतें एक ही अंग पर असर डालती हैं, यह बताता है कि वे साथ काम कर रही हैं या एक-दूसरे को काट रही हैं। सटीक संयुक्त संख्या नहीं दी गई — उसके लिए भरोसेमंद शोध नहीं है।'
      : 'Where two habits hit the same organ, this shows whether they add up or cancel out. It deliberately does not invent a precise combined number — the interaction is real, the exact arithmetic is not something the evidence supports.'));
    return wrap;
  }

  fxRow(fx, lang, dim = false) {
    const t = TARGETS[fx.target];
    const n = this.app.registry.resolveTarget(fx.target).length;
    const row = el('div', { class: `efx ${fx.kind}`, style: dim ? 'opacity:.66' : '' },
      el('div', { class: 't' },
        el('span', {}, t?.label || fx.target),
        fx.metric ? el('span', { class: 'm' }, `${fx.metric.value}`) : null),
      fx.metric ? el('div', { class: 'nt muted small' }, fx.metric.label) : null,
      el('div', { class: 'nt' }, fx.note),
      el('div', { class: 'efx-foot' },
        dim ? el('span', { class: 'pill ' + fx.kind }, 'since ' + fx.step) : null,
        n ? el('button', { class: 'showbtn', onClick: (ev) => { ev.stopPropagation(); this.app.focusTarget(fx.target); } },
          `⌖ ${lang === 'hi' ? 'शरीर में दिखाएँ' : 'Show me where'}`) : el('span', { class: 'muted small' }, lang === 'hi' ? '(3D में उपलब्ध नहीं)' : '(not mapped in 3D)')));
    row.addEventListener('mouseenter', () => this.app.hoverTarget(fx.target));
    row.addEventListener('mouseleave', () => this.app.hoverTarget(null));
    row.addEventListener('click', () => this.app.focusTarget(fx.target));
    return row;
  }
}

/** Bottom dock timeline for the effects mode */
export function renderEffectDock(dock, app) {
  const lang = state.lang;
  const e = app.effects.get(state.effect);
  dock.innerHTML = '';
  if (!e) { dock.hidden = true; return; }
  dock.hidden = false;
  const step = stepOf(e, state.effectStep);
  const idx = TIMELINE_STEPS.findIndex(s => s.t === state.effectStep);
  dock.append(el('div', { class: 'tl-head' },
    el('div', { class: 'h' }, `${e.icon || ''} ${lang === 'hi' ? e.name.hi : e.name.en}`, el('small', {}, step.headline)),
    el('div', { class: 'lg' }, ...Object.entries(EFFECT_KINDS).map(([k, v]) => el('span', {}, el('i', { style: `background:${v.color}` }), v.label)))));
  const steps = el('div', { class: 'steps' });
  TIMELINE_STEPS.forEach((s, i) => {
    const has = e.timeline.some(x => x.t === s.t);
    const b = el('div', { class: 'st' + (i === idx ? ' active' : '') + (i < idx ? ' done' : '') + (has ? '' : ' muted'), onClick: () => app.setEffectStep(s.t) },
      el('i', {}), el('span', {}, lang === 'hi' ? s.hi : s.label));
    steps.append(b);
  });
  const play = el('button', { class: 'play', title: 'Play timeline', onClick: () => app.togglePlay() }, state.playing ? '❚❚' : '▶');
  dock.append(el('div', { class: 'tl' }, play, steps));
}
