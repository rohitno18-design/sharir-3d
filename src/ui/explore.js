import { el, fmtName } from '../core/util.js';
import { state } from '../core/state.js';
import { SYSTEMS } from '../data/systems.js';

const QUICK = [
  ['Heart', 'cardiovascular'], ['Brain', 'nervous'], ['Lungs', 'respiratory'], ['Liver', 'digestive'], ['Stomach', 'digestive'], ['Kidney', 'urinary'],
  ['Pancreas', 'digestive'], ['Spleen', 'lymphoid'], ['Thyroid gland', 'endocrine'], ['Femur', 'skeletal'], ['Skull', 'skeletal'], ['Vertebral column', 'skeletal'],
  ['Biceps brachii', 'muscular'], ['Pectoralis major', 'muscular'], ['Gluteus maximus', 'muscular'], ['Quadriceps femoris', 'muscular'],
  ['Sciatic nerve', 'nervous'], ['Vagus nerve', 'nervous'], ['Spinal cord', 'nervous'], ['Aorta', 'cardiovascular'], ['Eyeball', 'senses'],
];

/** Explore panel: quick picks + full hierarchy tree with hover glow. */
export class ExplorePanel {
  constructor(root, app) {
    this.root = root; this.app = app;
    this.open = new Set();
    this.render();
  }

  render() {
    const { registry } = this.app;
    const lang = state.lang;
    this.root.innerHTML = '';
    this.root.append(
      el('div', { class: 'ph' }, el('h2', {}, lang === 'hi' ? 'खोजें' : 'Explore'), el('span', { class: 'cnt' }, `${registry.parts.filter(p => p.k === 'mesh').length.toLocaleString()} parts`)),
      el('p', { class: 'pd' }, lang === 'hi' ? 'किसी भी अंग पर क्लिक करें। नाम पर होवर करें तो वह हिस्सा चमकेगा।' : 'Click any structure in 3D, or browse the full hierarchy below. Hover a name and that part glows.'),
    );
    // quick picks
    const chips = el('div', { class: 'chips' });
    for (const [name, sys] of QUICK) {
      const parts = (registry.byName.get(name.toLowerCase()) || []).filter(p => p.sys === sys);
      if (!parts.length) continue;
      const p = parts.find(x => x.k === 'mesh' || x.k === 'group') || parts[0];
      const meta = registry.systemMeta(sys);
      const c = el('button', { class: 'chip' }, el('i', { style: `background:${meta.color}` }), lang === 'hi' && p.hi ? p.hi : name);
      c.addEventListener('mouseenter', () => this.app.hoverPart(p.id));
      c.addEventListener('mouseleave', () => this.app.hoverPart(null));
      c.addEventListener('click', () => this.app.selectPart(p.id, { focus: true }));
      chips.append(c);
    }
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'त्वरित चयन' : 'Quick picks'), chips);
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'पूरा वर्गीकरण' : 'Full hierarchy'));
    this.tree = el('div', { class: 'tree' });
    this.root.append(this.tree);
    this.renderTree();
  }

  renderTree() {
    const { registry } = this.app;
    this.tree.innerHTML = '';
    for (const s of SYSTEMS) {
      const roots = registry.rootsBySystem[s.key];
      if (!roots || !roots.length) continue;
      const count = registry.parts.filter(p => p.sys === s.key && p.k === 'mesh').length;
      const node = this.node({ id: 'sys:' + s.key, n: state.lang === 'hi' ? s.hi : s.label, c: s.color, k: 'group' }, roots, count, true);
      this.tree.append(node);
    }
  }

  node(part, childIds, count, isSystem = false) {
    const { registry } = this.app;
    const id = part.id;
    const kids = (childIds || registry.children.get(id) || []).map(c => typeof c === 'string' ? registry.byId.get(c) : c).filter(p => p && ['mesh', 'group', 'landmark'].includes(p.k));
    kids.sort((a, b) => (a.k === 'group' ? 0 : a.k === 'mesh' ? 1 : 2) - (b.k === 'group' ? 0 : b.k === 'mesh' ? 1 : 2) || a.n.localeCompare(b.n) || (a.side || '').localeCompare(b.side || ''));
    const isLeaf = kids.length === 0;
    const wrap = el('div');
    const row = el('div', { class: 'tn' + (isLeaf ? ' leaf' : '') + (this.open.has(id) ? ' open' : '') + (state.selected === id ? ' sel' : '') + (state.hidden.has(id) ? ' hidden-part' : '') });
    const tw = el('span', { class: 'tw' }, '▶');
    const dot = el('span', { class: 'dot', style: `background:${part.c || registry.systemMeta(part.sys)?.color || '#888'}` });
    const nm = el('span', { class: 'nm' }, isSystem ? part.n : fmtName(part, state.lang));
    if (count) nm.append(el('small', {}, count));
    else if (!isLeaf) nm.append(el('small', {}, kids.length));
    if (part.k === 'landmark') nm.append(el('small', {}, '·'));
    const eye = el('button', { class: 'eye', title: 'Hide / show' }, state.hidden.has(id) ? '◌' : '●');
    row.append(tw, dot, nm, eye);
    wrap.append(row);
    let kidsEl = null;
    const toggle = () => {
      if (isLeaf) return;
      if (this.open.has(id)) { this.open.delete(id); row.classList.remove('open'); if (kidsEl) kidsEl.remove(); kidsEl = null; }
      else {
        this.open.add(id); row.classList.add('open');
        kidsEl = el('div', { class: 'tk' });
        for (const k of kids) kidsEl.append(this.node(k));
        wrap.append(kidsEl);
      }
    };
    tw.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    row.addEventListener('click', () => {
      if (isSystem) { toggle(); return; }
      this.app.selectPart(id, { focus: true });
      if (!isLeaf && !this.open.has(id)) toggle();
    });
    row.addEventListener('dblclick', (e) => { e.stopPropagation(); if (!isSystem) this.app.selectPart(id, { focus: true }); });
    row.addEventListener('mouseenter', () => { if (!isSystem) this.app.hoverPart(id); });
    row.addEventListener('mouseleave', () => this.app.hoverPart(null));
    eye.addEventListener('click', (e) => { e.stopPropagation(); if (isSystem) return; this.app.toggleHidden(id); eye.textContent = state.hidden.has(id) ? '◌' : '●'; row.classList.toggle('hidden-part', state.hidden.has(id)); });
    if (this.open.has(id) && !isLeaf) { kidsEl = el('div', { class: 'tk' }); for (const k of kids) kidsEl.append(this.node(k)); wrap.append(kidsEl); }
    return wrap;
  }

  /** expand tree to reveal a part and mark selected */
  reveal(id) {
    const { registry } = this.app;
    for (const a of registry.ancestors(id)) this.open.add(a.id);
    const p = registry.byId.get(id); if (p) this.open.add('sys:' + p.sys);
    this.renderTree();
    const row = [...this.tree.querySelectorAll('.tn.sel')][0];
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
