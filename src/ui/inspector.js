import { el, esc, fmtName, sideLabel } from '../core/util.js';
import { state, set } from '../core/state.js';
import { MICRO_MODELS } from '../core/micro.js';
import { FEATURES } from '../data/flags.js';

export class Inspector {
  constructor(root, app) { this.root = root; this.app = app; this.render(); }

  async render() {
    const { registry } = this.app;
    const lang = state.lang;
    this.root.innerHTML = '';
    const id = state.selected;
    if (!id) {
      this.root.append(
        el('div', { class: 'ph' }, el('h2', {}, lang === 'hi' ? 'विवरण' : 'Inspector')),
        el('div', { class: 'insp-empty' }, lang === 'hi'
          ? el('div', { html: '<b>किसी भी हिस्से पर क्लिक करें</b> — उसका नाम (हिंदी + लैटिन), विवरण, वह किस तंत्र का है, और उसके अंदर क्या है, यहाँ दिखेगा।<br><br><b>डबल-क्लिक</b> — ज़ूम करें।<br><b>I</b> — सिर्फ़ वही हिस्सा दिखाएँ।<br><b>H</b> — हिस्सा छिपाएँ।<br><b>Esc</b> — चयन हटाएँ।' })
          : el('div', { html: `<b>Click any structure</b> to see its name (English${FEATURES.hindi ? ' · Hindi' : ''} · Latin), what it does, which system it belongs to, and what is inside it.<br><br><b>Double-click</b> to zoom in.<br><b>I</b> isolate · <b>H</b> hide · <b>F</b> focus · <b>Esc</b> clear.<br><b>/</b> jump to search.` })),
      );
      return;
    }
    const part = registry.byId.get(id);
    if (!part) return;
    const meta = registry.systemMeta(part.sys);
    const anc = registry.ancestors(id);
    const crumb = el('div', { class: 'crumb' }, el('span', { onClick: () => this.app.clearSelection() }, lang === 'hi' ? meta.hi : meta.label));
    for (const a of anc) if (a.k !== 'landmark') crumb.append(el('span', { onClick: () => this.app.selectPart(a.id, { focus: true }) }, a.n));
    this.root.append(crumb);
    this.root.append(el('h1', { class: 'insp-title' }, fmtName(part, 'en')));
    if (FEATURES.hindi && part.hi) this.root.append(el('div', { class: 'insp-hi' }, part.hi + (part.hc ? ` · ${part.hc}` : '') + (part.side ? ` (${part.side === 'l' ? 'बायाँ' : 'दायाँ'})` : '')));
    if (part.la) this.root.append(el('div', { class: 'insp-la' }, part.la));
    const tags = el('div', { class: 'tagrow' }, el('span', { class: 'tag sys', style: `background:${meta.color}` }, meta.label));
    if (part.sub && part.sub !== meta.label.toLowerCase()) tags.append(el('span', { class: 'tag' }, part.sub));
    tags.append(el('span', { class: 'tag' }, part.k === 'mesh' ? 'structure' : part.k === 'group' ? 'group' : part.k === 'landmark' ? 'landmark' : part.k));
    if (part.side) tags.append(el('span', { class: 'tag' }, sideLabel(part.side)));
    this.root.append(tags);

    // actions
    const sibs = registry.siblingsOf(part).filter(p => p.id !== id);
    const kids = registry.childrenOf(id).filter(p => ['mesh', 'group'].includes(p.k));
    const lms = registry.childrenOf(id).filter(p => p.k === 'landmark');
    const actions = el('div', { class: 'btnrow' },
      el('button', { class: 'btn sm primary', onClick: () => this.app.focusSelected() }, '⌖ ', lang === 'hi' ? 'फ़ोकस' : 'Focus'),
      el('button', { class: 'btn sm' + (state.isolate === id ? ' active' : ''), onClick: () => this.app.toggleIsolate(id) }, '◎ ', lang === 'hi' ? 'सिर्फ़ यही' : 'Isolate'),
      el('button', { class: 'btn sm', onClick: () => this.app.toggleHidden(id) }, state.hidden.has(id) ? '◌ ' : '⊘ ', state.hidden.has(id) ? (lang === 'hi' ? 'दिखाएँ' : 'Show') : (lang === 'hi' ? 'छिपाएँ' : 'Hide')),
    );
    if (sibs.length) actions.append(el('button', { class: 'btn sm', onClick: () => this.app.selectPart(sibs[0].id, { focus: true }) }, '⇄ ', lang === 'hi' ? 'दूसरी तरफ़' : 'Other side'));
    if (kids.length || lms.length) actions.append(el('button', { class: 'btn sm', onClick: () => this.app.drillDown(id) }, '⤵ ', lang === 'hi' ? 'अंदर देखें' : 'See inside'));
    this.root.append(actions);

    // micro (tissue / cell level)
    const micro = pickMicro(part);
    if (micro.length) {
      const g = el('div', { class: 'micro-grid' });
      for (const m of micro) g.append(el('button', { class: 'btn sm', onClick: () => this.app.openMicro(m.key, part) }, m.icon + ' ', lang === 'hi' ? m.hi : m.label));
      this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'ऊतक और कोशिका स्तर' : 'Tissue & cell level'), g);
    }

    // origin / insertion for muscles
    if (part.sys === 'muscular' || part.sys === 'skeletal') {
      const isAtt = p => p.k === 'origin' || p.k === 'insertion';
      const att = registry.parts.filter(p => isAtt(p) && (part.sys === 'muscular' ? p.muscle === part.n && (!part.side || p.side === part.side) : p.p === id));
      // A head of a larger muscle often has only its own origins recorded, because all the
      // heads share one tendon. Show that shared insertion too, or the head looks as if it
      // attached to nothing at its far end.
      if (part.sys === 'muscular' && att.length && !att.some(a => a.k === 'insertion') && part.p) {
        const whole = registry.byId.get(part.p)?.n.replace(/\s*\(.*?\)\s*$/, '');
        if (whole) for (const p of registry.parts) if (p.k === 'insertion' && p.muscle === whole && (!part.side || p.side === part.side)) att.push({ ...p, shared: whole });
      }
      if (att.length) {
        const list = el('div', { class: 'list' });
        for (const a of att.slice(0, 40)) list.append(el('div', { class: 'li', onMouseenter: () => this.app.hoverPart(a.id, true), onMouseleave: () => this.app.hoverPart(null), onClick: () => this.app.showAttachment(a.id) }, el('i', { style: `background:${a.k === 'origin' ? '#ef4444' : '#38bdf8'}` }), part.sys === 'muscular' ? `${a.k === 'origin' ? 'Origin' : 'Insertion'} → ${a.bone}${a.shared ? ' (shared tendon)' : ''}` : `${a.muscle} (${a.k})`, el('span', { class: 'k' }, a.side || '')));
        this.root.append(el('h3', { class: 'sec' }, part.sys === 'muscular' ? (lang === 'hi' ? 'उद्गम और निवेशन' : 'Origin & insertion') : (lang === 'hi' ? 'इस हड्डी पर पेशियाँ' : 'Muscles attaching here')), list);
      }
    }

    // description
    const descWrap = el('div', { class: 'desc' }, el('p', { class: 'muted small' }, lang === 'hi' ? 'विवरण लोड हो रहा है…' : 'Loading description…'));
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'विवरण' : 'About'), descWrap);
    registry.description(part).then(d => {
      if (state.selected !== id) return;
      descWrap.innerHTML = '';
      if (!d) { descWrap.append(el('p', { class: 'muted' }, lang === 'hi' ? 'इस हिस्से का विस्तृत विवरण उपलब्ध नहीं है।' : 'No detailed description available for this structure yet.')); return; }
      for (const para of d.s.split(/\n\n+/).slice(0, 4)) if (para.trim()) descWrap.append(el('p', {}, para.trim()));
      for (const sec of d.x.slice(0, 8)) {
        const det = el('details', {}, el('summary', {}, sec.h), el('div', { html: sec.t.split(/\n\n+/).map(p => `<p>${esc(p.trim())}</p>`).join('') }));
        descWrap.append(det);
      }
      descWrap.append(el('p', { class: 'muted small' }, 'Text: Z-Anatomy (Wikipedia-derived, CC BY-SA 4.0)'));
    });

    // contains
    if (kids.length) {
      const list = el('div', { class: 'list' });
      for (const k of kids.sort((a, b) => a.n.localeCompare(b.n))) list.append(el('div', { class: 'li', onMouseenter: () => this.app.hoverPart(k.id), onMouseleave: () => this.app.hoverPart(null), onClick: () => this.app.selectPart(k.id, { focus: true }) }, el('i', { style: `background:${k.c || meta.color}` }), fmtName(k, lang), el('span', { class: 'k' }, k.k === 'group' ? 'group' : '')));
      this.root.append(el('h3', { class: 'sec' }, `${lang === 'hi' ? 'इसके अंदर' : 'Contains'} (${kids.length})`), list);
    }
    if (lms.length) {
      const list = el('div', { class: 'list' });
      for (const k of lms.sort((a, b) => a.n.localeCompare(b.n))) list.append(el('div', { class: 'li', onMouseenter: () => this.app.hoverLandmark(k.id), onMouseleave: () => this.app.hoverLandmark(null), onClick: () => this.app.selectPart(k.id, { focus: true }) }, el('i', { style: 'background:#e9c95c' }), fmtName(k, lang)));
      this.root.append(el('h3', { class: 'sec' }, `${lang === 'hi' ? 'सूक्ष्म-स्थल' : 'Landmarks'} (${lms.length})`), list);
    }
    // parent
    const parent = part.p ? registry.byId.get(part.p) : null;
    if (parent) this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'इसका हिस्सा है' : 'Part of'), el('div', { class: 'li', onClick: () => this.app.selectPart(parent.id, { focus: true }) }, el('i', { style: `background:${parent.c || meta.color}` }), fmtName(parent, lang)));
  }
}

function pickMicro(part) {
  const n = part.n.toLowerCase();
  const out = [];
  const add = k => { const m = MICRO_MODELS[k]; if (m && !out.includes(m)) out.push(m); };
  if (part.sys === 'skeletal') { add('bone'); add('osteocyte'); }
  if (part.sys === 'muscular') { add('muscle'); add('sarcomere'); }
  if (part.sys === 'cardiovascular') { if (part.sub === 'heart' || /heart|ventric|atri|myocard/.test(n)) add('cardiomyocyte'); else add('artery'); add('blood'); }
  if (part.sys === 'nervous' || part.sys === 'senses') { add('neuron'); if (/brain|cortex|gyrus|lobe/.test(n)) add('synapse'); }
  if (part.sys === 'respiratory') add('alveolus');
  if (part.sys === 'urinary') add('nephron');
  if (part.sys === 'digestive') { if (/liver|hepat/.test(n)) add('hepatocyte'); else add('villus'); }
  if (part.sys === 'integumentary') add('skin');
  if (part.sys === 'lymphoid') add('blood');
  if (part.sys === 'joints') add('cartilage');
  if (part.sys === 'endocrine' || part.sys === 'reproductive') add('cell');
  add('cell');
  return out.slice(0, 4);
}
