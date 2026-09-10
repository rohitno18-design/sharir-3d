import { el, esc, fmtName } from '../core/util.js';
import { state } from '../core/state.js';

export class Topbar {
  constructor(app) {
    this.app = app;
    this.input = document.getElementById('search');
    this.results = document.getElementById('search-results');
    this.active = -1;
    this.items = [];
    this.input.addEventListener('input', () => this.query());
    this.input.addEventListener('focus', () => { if (this.input.value) this.query(); });
    this.input.addEventListener('keydown', (e) => this.key(e));
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) this.hide(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== this.input && !e.target.closest('input,textarea')) { e.preventDefault(); this.input.focus(); this.input.select(); }
      if (e.key === 'Escape' && document.activeElement === this.input) { this.input.blur(); this.hide(); }
    });
    for (const b of document.querySelectorAll('.mode')) b.addEventListener('click', () => app.setMode(b.dataset.mode));
    for (const b of document.querySelectorAll('#sex-toggle button')) b.addEventListener('click', () => app.setSex(b.dataset.sex));
    for (const b of document.querySelectorAll('#lang-toggle button')) b.addEventListener('click', () => app.setLang(b.dataset.lang));
  }

  syncToggles() {
    for (const b of document.querySelectorAll('.mode')) b.classList.toggle('active', b.dataset.mode === state.mode);
    for (const b of document.querySelectorAll('#sex-toggle button')) b.classList.toggle('active', b.dataset.sex === state.sex);
    for (const b of document.querySelectorAll('#lang-toggle button')) b.classList.toggle('active', b.dataset.lang === state.lang);
  }

  query() {
    const q = this.input.value.trim();
    if (q.length < 2) { this.hide(); return; }
    const { registry } = this.app;
    const parts = registry.search(q, 18);
    const fx = this.app.effects ? this.app.effects.search(q, 5) : [];
    this.items = [...fx.map(e => ({ type: 'effect', e })), ...parts.map(r => ({ type: 'part', part: r.part }))];
    this.render(q);
  }

  render(q) {
    const { registry } = this.app;
    this.results.innerHTML = '';
    this.active = -1;
    if (!this.items.length) { this.results.append(el('div', { class: 'sr-empty' }, `No match for “${q}”`)); this.results.hidden = false; return; }
    const ql = q.toLowerCase();
    const hl = (s) => { const i = s.toLowerCase().indexOf(ql); return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<em>' + esc(s.slice(i, i + q.length)) + '</em>' + esc(s.slice(i + q.length)); };
    this.items.forEach((it, i) => {
      let row;
      if (it.type === 'effect') {
        row = el('div', { class: 'sr', html: `<i style="background:#e9c95c"></i><div><div class="n">${it.e.icon} ${hl(it.e.name.en)}</div><div class="m">${esc(it.e.name.hi || '')}</div></div><div class="s">what happens if…</div>` });
        row.addEventListener('click', () => { this.hide(); this.app.openEffect(it.e.id); });
      } else {
        const p = it.part; const meta = registry.systemMeta(p.sys);
        const sibs = registry.siblingsOf(p);
        const sideTxt = sibs.length > 1 ? ' · L + R' : (p.side ? (p.side === 'l' ? ' · left' : ' · right') : '');
        row = el('div', { class: 'sr', html: `<i style="background:${p.c || meta.color}"></i><div><div class="n">${hl(p.n)}${sideTxt}</div><div class="m">${p.hi ? esc(p.hi) + ' · ' : ''}${p.la ? '<i>' + esc(p.la) + '</i>' : ''}</div></div><div class="s">${esc(meta.label)}${p.k !== 'mesh' ? ' · ' + p.k : ''}</div>` });
        row.addEventListener('click', () => { this.hide(); this.app.selectPart(p.id, { focus: true, both: true }); });
        row.addEventListener('mouseenter', () => this.app.hoverPart(p.id));
        row.addEventListener('mouseleave', () => this.app.hoverPart(null));
      }
      row.dataset.i = i;
      this.results.append(row);
    });
    this.results.hidden = false;
  }

  key(e) {
    if (this.results.hidden) { if (e.key === 'Enter') this.query(); return; }
    const rows = [...this.results.querySelectorAll('.sr')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((r, i) => r.classList.toggle('active', i === this.active));
      rows[this.active]?.scrollIntoView({ block: 'nearest' });
      const it = this.items[this.active]; if (it?.type === 'part') this.app.hoverPart(it.part.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (rows[this.active >= 0 ? this.active : 0])?.click();
    }
  }

  hide() { this.results.hidden = true; this.active = -1; }
}
