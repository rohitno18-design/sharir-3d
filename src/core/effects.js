import Fuse from 'fuse.js';

const modules = import.meta.glob('../data/effects/**/*.json', { eager: true });

export const CATEGORY_META = {
  food:      { label: 'Food',       hi: 'खाना',        icon: '🍛', order: 1 },
  drink:     { label: 'Drinks',     hi: 'पेय',         icon: '🥤', order: 2 },
  supplement:{ label: 'Supplements',hi: 'सप्लीमेंट',   icon: '💊', order: 3 },
  exercise:  { label: 'Exercise',   hi: 'व्यायाम',     icon: '🏋️', order: 4 },
  habit:     { label: 'Habits',     hi: 'आदतें',       icon: '🔁', order: 5 },
  sleep:     { label: 'Sleep',      hi: 'नींद',        icon: '😴', order: 6 },
  medicine:  { label: 'Medicines',  hi: 'दवाइयाँ',     icon: '⚕️', order: 7 },
  drug:      { label: 'Performance drugs', hi: 'परफ़ॉर्मेंस ड्रग्स', icon: '⚠️', order: 8 },
  substance: { label: 'Tobacco, alcohol & other', hi: 'तंबाकू, शराब आदि', icon: '🚬', order: 9 },
};

export class EffectsLibrary {
  constructor() {
    this.all = [];
    for (const [path, mod] of Object.entries(modules)) {
      const d = mod.default || mod;
      if (!d || !d.id) continue;
      d._path = path;
      this.all.push(d);
    }
    this.all.sort((a, b) => (CATEGORY_META[a.category]?.order || 99) - (CATEGORY_META[b.category]?.order || 99) || a.name.en.localeCompare(b.name.en));
    this.byId = new Map(this.all.map(e => [e.id, e]));
    this.fuse = new Fuse(this.all, {
      keys: [{ name: 'name.en', weight: 0.6 }, { name: 'name.hi', weight: 0.3 }, { name: 'summary.en', weight: 0.15 }, { name: 'dose', weight: 0.1 }, { name: 'category', weight: 0.1 }],
      threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2,
    });
  }
  get(id) { return this.byId.get(id); }
  search(q, limit = 6) { return this.fuse.search(q, { limit }).map(r => r.item); }
  byCategory() {
    const m = new Map();
    for (const e of this.all) { if (!m.has(e.category)) m.set(e.category, []); m.get(e.category).push(e); }
    return [...m.entries()].sort((a, b) => (CATEGORY_META[a[0]]?.order || 99) - (CATEGORY_META[b[0]]?.order || 99));
  }
  get count() { return this.all.length; }
}

/** Cumulative effect map up to and including `stepT`; later steps override earlier ones per target. */
export function effectsAtStep(effect, stepT) {
  const order = ['1d', '1w', '30d', '60d', '6m', '1y', '5y'];
  const upto = order.indexOf(stepT);
  const map = new Map();
  effect.timeline.forEach((s) => {
    const i = order.indexOf(s.t);
    if (i < 0 || i > upto) return;
    for (const fx of s.effects) map.set(fx.target, { ...fx, step: s.t, current: i === upto });
  });
  return map;
}

export function stepOf(effect, t) { return effect.timeline.find(s => s.t === t) || effect.timeline[0]; }

/**
 * Combine several interventions at one point on the timeline.
 *
 * Real life is never one habit at a time: creatine WITH training WITH 8 hours' sleep is a
 * different body from creatine alone. Where two habits hit the same organ this reports
 * whether they reinforce each other or pull against each other, rather than inventing a
 * precise combined number — the interaction is real, the exact arithmetic of it is not
 * something the source literature supports.
 */
export function combineAtStep(list, stepT) {
  const byTarget = new Map();
  for (const e of list) {
    const cum = effectsAtStep(e, stepT);
    for (const [target, fx] of cum) {
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push({ ...fx, fromId: e.id, fromName: e.name, icon: e.icon || '•' });
    }
  }

  const out = new Map();
  for (const [target, hits] of byTarget) {
    const good = hits.filter(h => h.kind === 'positive');
    const bad = hits.filter(h => h.kind === 'negative');
    const strain = hits.filter(h => h.kind === 'strain');
    const neutral = hits.filter(h => h.kind === 'neutral');

    const gI = good.reduce((a, h) => a + (h.intensity || 0.5), 0);
    // strain counts against, but only partly — load is not damage
    const bI = bad.reduce((a, h) => a + (h.intensity || 0.5), 0) + strain.reduce((a, h) => a + (h.intensity || 0.5) * 0.6, 0);

    let kind, interaction;
    if (good.length && (bad.length || strain.length)) {
      interaction = 'conflict';
      kind = gI >= bI ? 'positive' : (bad.length ? 'negative' : 'strain');
    } else if (hits.length > 1) {
      interaction = 'reinforce';
      kind = bad.length ? 'negative' : strain.length ? 'strain' : good.length ? 'positive' : 'neutral';
    } else {
      interaction = 'single';
      kind = hits[0].kind;
    }

    // Stacking the same direction builds up, but with diminishing returns — two good
    // habits on one organ is better than one, not twice as good.
    const raw = Math.max(gI, bI);
    const intensity = Math.min(1, 1 - Math.pow(1 - Math.min(0.95, raw / (hits.length + 0.5)), hits.length));

    // A real size/opacity change wins over none; take the strongest one on offer.
    let visual = null;
    for (const h of hits) {
      if (!h.visual) continue;
      if (!visual) { visual = { ...h.visual }; continue; }
      if (h.visual.scale != null) visual.scale = Math.abs(h.visual.scale - 1) > Math.abs((visual.scale ?? 1) - 1) ? h.visual.scale : visual.scale;
      if (h.visual.opacity != null) visual.opacity = Math.min(visual.opacity ?? 1, h.visual.opacity);
    }

    out.set(target, {
      target, kind, interaction, intensity: Math.max(0.15, intensity), visual,
      hits, good: good.length, bad: bad.length, strain: strain.length, neutral: neutral.length,
      current: hits.some(h => h.current),
    });
  }
  return out;
}

/** Headline tally across a whole stack, for the "together these do X" summary. */
export function stackTally(combined) {
  const t = { positive: 0, negative: 0, strain: 0, neutral: 0, reinforce: 0, conflict: 0 };
  for (const c of combined.values()) {
    t[c.kind] = (t[c.kind] || 0) + 1;
    if (c.interaction === 'reinforce') t.reinforce++;
    if (c.interaction === 'conflict') t.conflict++;
  }
  return t;
}
