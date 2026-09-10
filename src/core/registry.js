import Fuse from 'fuse.js';
import { TARGETS } from '../data/targets.js';
import { SYSTEM_BY_KEY } from '../data/systems.js';
import { state } from './state.js';

/** True when a part belongs to the body currently being shown. */
export const sexOk = p => !p.sx || p.sx === (state.sex === 'female' ? 'f' : 'm');

/** Same sanitisation three.js GLTFLoader applies to node names (PropertyBinding.sanitizeNodeName). */
export function sanitizeNodeName(name) {
  return name.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');
}

export class Registry {
  constructor(data) {
    this.parts = data.parts;
    this.bbox = data.bbox;
    this.byId = new Map();
    this.children = new Map();
    this.bySanitized = new Map(); // `${glb}/${sanitizedName}` → part
    this.byName = new Map();      // lowercase display name → [parts]
    this.hindi = {};
    this.descCache = {};
    this._targetCache = new Map();

    for (const p of this.parts) {
      this.byId.set(p.id, p);
      const [glb, name] = splitId(p.id);
      this.bySanitized.set(glb + '/' + sanitizeNodeName(name), p);
      const key = p.n.toLowerCase();
      if (!this.byName.has(key)) this.byName.set(key, []);
      this.byName.get(key).push(p);
    }
    for (const p of this.parts) {
      if (p.p) {
        if (!this.children.has(p.p)) this.children.set(p.p, []);
        this.children.get(p.p).push(p.id);
      }
    }
    // roots per system
    this.rootsBySystem = {};
    for (const p of this.parts) {
      if (!p.p || !this.byId.has(p.p)) {
        (this.rootsBySystem[p.sys] ||= []).push(p.id);
      }
    }
    this._buildSearch();
  }

  setHindi(map) {
    this.hindi = map || {};
    for (const p of this.parts) {
      const h = this.hindi[p.n];
      if (h) { p.hi = h.hi; if (h.common) p.hc = h.common; }
    }
    this._buildSearch();
  }

  _buildSearch() {
    const docs = [];
    const seen = new Set();
    for (const p of this.parts) {
      if (!['mesh', 'group', 'landmark'].includes(p.k)) continue;
      if (p.g === 'references') continue;
      // collapse left/right into one search doc
      const key = p.sys + '|' + p.n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push({ id: p.id, n: p.n, la: p.la || '', hi: p.hi || '', hc: p.hc || '', sys: p.sys, k: p.k, sub: p.sub });
    }
    this._docs = docs;
    this.fuse = new Fuse(docs, {
      keys: [
        { name: 'n', weight: 0.6 },
        { name: 'hi', weight: 0.25 },
        { name: 'hc', weight: 0.25 },
        { name: 'la', weight: 0.2 },
        { name: 'sys', weight: 0.05 },
      ],
      threshold: 0.34,
      ignoreLocation: true,
      minMatchCharLength: 2,
      includeScore: true,
      includeMatches: true,
    });
  }

  search(q, limit = 24) {
    q = q.trim();
    if (!q) return [];
    const ql = q.toLowerCase();
    const res = this.fuse.search(q, { limit: limit * 2 });
    // rank: exact/prefix matches on name first, meshes before groups, shorter names first
    const score = r => {
      const n = r.item.n.toLowerCase();
      let s = r.score;
      if (n === ql) s -= 1;
      else if (n.startsWith(ql)) s -= 0.5;
      else if (n.split(/\s+/).some(w => w.startsWith(ql))) s -= 0.25;
      if (r.item.k === 'mesh') s -= 0.05;
      if (r.item.k === 'landmark') s += 0.1;
      s += Math.min(n.length, 60) / 600;
      return s;
    };
    return res.sort((a, b) => score(a) - score(b))
      .map(r => ({ part: this.byId.get(r.item.id), matches: r.matches }))
      .filter(r => r.part && sexOk(r.part))          // never surface the other sex's organs
      .slice(0, limit);
  }

  /** all parts sharing a display name within a system (e.g. left + right) */
  siblingsOf(part) {
    return (this.byName.get(part.n.toLowerCase()) || []).filter(p => p.sys === part.sys && p.k === part.k);
  }

  childrenOf(id) { return (this.children.get(id) || []).map(c => this.byId.get(c)).filter(p => p && sexOk(p)); }

  /** all descendant ids (inclusive) */
  subtree(id, out = []) {
    out.push(id);
    const ch = this.children.get(id);
    if (ch) for (const c of ch) this.subtree(c, out);
    return out;
  }

  /** ancestors from root → parent */
  ancestors(id) {
    const chain = [];
    let p = this.byId.get(id);
    while (p && p.p) { p = this.byId.get(p.p); if (p) chain.unshift(p); }
    return chain;
  }

  displayName(part, lang = 'en') {
    if (lang === 'hi' && part.hi) return part.hi;
    return part.n;
  }

  /** Resolve a TARGET key to mesh part ids */
  resolveTarget(key) {
    if (this._targetCache.has(key)) return this._targetCache.get(key);
    const t = TARGETS[key];
    if (!t) { console.warn('unknown target', key); this._targetCache.set(key, []); return []; }
    const ids = [];
    for (const p of this.parts) {
      if (p.k !== 'mesh') continue;
      if (!t.sys.includes(p.sys)) continue;
      if (t.sub && p.sub !== t.sub) continue;
      if (t.g && p.g !== t.g) continue;
      if (!t.re.test(p.n)) continue;
      if (t.ex && t.ex.test(p.n)) continue;
      ids.push(p.id);
    }
    this._targetCache.set(key, ids);
    return ids;
  }

  async description(part) {
    const sys = part.sys;
    if (!this.descCache[sys]) {
      this.descCache[sys] = fetch(`/data/desc/${sys}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    }
    const d = await this.descCache[sys];
    const key = norm(part.n);
    return d[key] || d[norm(part.b)] || null;
  }

  systemMeta(key) { return SYSTEM_BY_KEY[key] || { label: key, color: '#ccc' }; }
}

export function splitId(id) {
  const i = id.indexOf(':');
  return [id.slice(0, i), id.slice(i + 1)];
}

function norm(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\(\)\[\]]/g, '').replace(/\s+/g, ' ');
}

export async function loadRegistry() {
  const r = await fetch('/data/registry.json');
  const data = await r.json();
  return new Registry(data);
}
