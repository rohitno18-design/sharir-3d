import * as THREE from 'three';

/**
 * Screen-space label layer: leader lines from anatomy to stacked labels in left/right margins (textbook style),
 * plus floating "title" labels (atlas system names) and simple pins.
 */
export class Labels {
  constructor(viewer, svgEl, divEl) {
    this.viewer = viewer; this.svg = svgEl; this.div = divEl;
    this.items = [];        // { id, anchor: Vector3 (world, morphed), text, sub, color, kind: 'part'|'landmark'|'title'|'pin' }
    this.max = 44;
    this.onClick = null; this.onHover = null;
    this._els = new Map();
    this.visible = true;
    viewer.onFrame((t, dt, frame) => { if (frame % 2 === 0) this.update(); });
  }

  setItems(items) {
    this.items = items.slice(0, 200);
    // prune DOM
    const keep = new Set(this.items.map(i => i.id));
    for (const [id, el] of this._els) if (!keep.has(id)) { el.remove(); this._els.delete(id); }
  }

  clear() { this.setItems([]); this.svg.innerHTML = ''; }

  _el(item) {
    let el = this._els.get(item.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'lbl' + (item.kind === 'title' ? ' title' : ' side');
      el.dataset.id = item.id;
      el.innerHTML = `<span class="t"></span>${item.sub ? '<span class="hi"></span>' : ''}`;
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onClick && this.onClick(item); });
      el.addEventListener('mouseenter', () => this.onHover && this.onHover(item));
      el.addEventListener('mouseleave', () => this.onHover && this.onHover(null));
      this.div.appendChild(el);
      this._els.set(item.id, el);
    }
    el.querySelector('.t').textContent = item.text;
    if (item.sub) { const s = el.querySelector('.hi'); if (s) s.textContent = item.sub; }
    el.classList.toggle('hot', !!item.hot);
    return el;
  }

  update() {
    const v = this.viewer;
    if (!this.visible || !this.items.length) { this.svg.innerHTML = ''; for (const el of this._els.values()) el.style.display = 'none'; return; }
    const W = v.width, H = v.height;
    const cx = W / 2;
    const proj = [];
    const camPos = v.camera.position;
    for (const it of this.items) {
      const p = v.project(it.anchor);
      if (p.z > 1 || p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) { const el = this._els.get(it.id); if (el) el.style.display = 'none'; continue; }
      proj.push({ it, x: p.x, y: p.y, d: camPos.distanceTo(it.anchor) });
    }
    // priority: hot first, then nearest
    proj.sort((a, b) => (b.it.hot ? 1 : 0) - (a.it.hot ? 1 : 0) || a.d - b.d);
    const shown = proj.slice(0, this.max);
    const hiddenIds = new Set(proj.slice(this.max).map(p => p.it.id));
    for (const id of hiddenIds) { const el = this._els.get(id); if (el) el.style.display = 'none'; }

    const lines = [];
    const marginL = Math.min(380, W * 0.26), marginR = W - Math.min(380, W * 0.26);
    const left = shown.filter(p => p.it.kind !== 'title' && p.it.kind !== 'pin' && p.x < cx).sort((a, b) => a.y - b.y);
    const right = shown.filter(p => p.it.kind !== 'title' && p.it.kind !== 'pin' && p.x >= cx).sort((a, b) => a.y - b.y);
    const gap = 26;
    const place = (col, side) => {
      let lastY = 40;
      const n = col.length;
      // pre-compress if overflow
      const needed = n * gap;
      let start = Math.max(40, Math.min(col[0]?.y ?? 40, H - needed - 20));
      lastY = start - gap;
      for (const p of col) {
        let y = Math.max(p.y, lastY + gap);
        if (y > H - 24) y = H - 24;
        p.ly = y; lastY = y;
        p.lx = side === 'left' ? marginL : marginR;
      }
    };
    place(left, 'left'); place(right, 'right');
    for (const p of [...left, ...right]) {
      const el = this._el(p.it);
      el.style.display = '';
      el.classList.toggle('left', p.lx < cx);
      el.style.left = p.lx + 'px'; el.style.top = p.ly + 'px';
      const elbowX = p.lx < cx ? p.lx + 14 : p.lx - 14;
      const col = p.it.color || '#e9c95c';
      lines.push(`<path d="M${p.x.toFixed(1)},${p.y.toFixed(1)} L${elbowX.toFixed(1)},${p.ly.toFixed(1)} L${p.lx.toFixed(1)},${p.ly.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${p.it.hot ? 1.8 : 1}" stroke-opacity="${p.it.hot ? 1 : 0.7}"/>`);
      lines.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.it.hot ? 4 : 3}" fill="${col}" stroke="rgba(0,0,0,.6)" stroke-width="1.5"/>`);
    }
    for (const p of shown.filter(p => p.it.kind === 'title' || p.it.kind === 'pin')) {
      const el = this._el(p.it);
      el.style.display = '';
      el.style.left = p.x + 'px'; el.style.top = (p.y - (p.it.kind === 'title' ? 0 : 18)) + 'px';
      if (p.it.kind === 'pin') lines.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${p.it.color || '#e9c95c'}"/>`);
    }
    this.svg.innerHTML = lines.join('');
  }
}
