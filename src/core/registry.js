import Fuse from 'fuse.js';
import { TARGETS } from '../data/targets.js';
import { SYSTEM_BY_KEY } from '../data/systems.js';
import { state } from './state.js';

/** True when a part belongs to the body currently being shown. */
export const sexOk = p => !p.sx || p.sx === (state.sex === 'female' ? 'f' : 'm');

/**
 * How far out from the trunk a bone sits: 0 for the skull, spine, ribs and sternum, 1 for
 * the shoulder and hip girdles, then out along the limb to 6 for a phalanx.
 */
function boneRank(bone) {
  const b = (bone || '').toLowerCase();
  if (/phalanx|sesamoid/.test(b)) return 6;
  if (/metacarpal|metatarsal/.test(b)) return 5;
  if (/scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate|talus|calcaneus|navicular|cuboid|cuneiform/.test(b)) return 4;
  if (/radius|ulna|tibia|fibula/.test(b)) return 3;
  if (/humerus|femur|patella/.test(b)) return 2;
  if (/clavicle|scapula|hip bone/.test(b)) return 1;
  return 0;
}

/** Same sanitisation three.js GLTFLoader applies to node names (PropertyBinding.sanitizeNodeName). */
export function sanitizeNodeName(name) {
  return name.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');
}

/**
 * Names the atlas has the wrong way round, in pairs. Its "ascending part" of the trapezius
 * is the upper part, from the back of the skull out to the collarbone, which anatomy calls
 * the descending part (it runs down to the shoulder). Its "descending part" is the lower
 * part, on the back of the ribcage, which runs up to the shoulder blade. The Latin names
 * came with them.
 */
const SWAPPED_NAMES = [
  ['Ascending part of trapezius muscle', 'Descending part of trapezius muscle'],
  ['Pars ascendens musculi trapezii', 'Pars descendens musculi trapezii'],
];

export class Registry {
  constructor(data) {
    this.parts = data.parts;
    this._fixSwappedNames();
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
    this._fixAttachmentKinds();
    this._fixSexTags();
    this._buildSearch();
  }

  /**
   * Put right the names in SWAPPED_NAMES. The ids stay as they are: they are what the
   * model's meshes are looked up by.
   *
   * The trapezius's attachments are the wrong way round too. Every part of it arises from
   * the skull or the spine and inserts on the collarbone or the shoulder blade, but the
   * atlas has the upper part "arising" from the collarbone and "inserting" on the skull,
   * and the other two "arising" from the shoulder blade.
   */
  _fixSwappedNames() {
    const swap = new Map();
    for (const [a, b] of SWAPPED_NAMES) { swap.set(a, b); swap.set(b, a); }
    for (const p of this.parts) {
      for (const f of ['n', 'b', 'muscle', 'la']) if (p[f] && swap.has(p[f])) p[f] = swap.get(p[f]);
      if ((p.k === 'origin' || p.k === 'insertion') && /trapezius/i.test(p.muscle || '')) {
        p.k = /clavicle|scapula/i.test(p.bone || '') ? 'insertion' : 'origin';
      }
    }
  }

  /**
   * Which body a part belongs to. The atlas tags most sex-specific parts, but not all:
   * the vagina, its fornix, orifice and lumen, and the labial commissures came through
   * untagged, so they showed on the male body. The testicular vessels came through the same
   * way on the female side. The anatomy tree is the reliable source, so anything filed
   * under a sex's genital system takes that sex, and the few vessels named for one sex's
   * gonads follow their names.
   *
   * "Lumen of vagina" is also dropped outright. It is an empty space, not tissue, and the
   * source file places it at knee height, where it hung between the shins.
   */
  _fixSexTags() {
    const FEMALE_TREE = /\bfemale (genital|internal genitalia|external genitalia|reproductive)/i;
    const MALE_TREE = /(^|[^e])\bmale (genital|internal genitalia|external genitalia|reproductive)/i;
    const FEMALE_NAME = /\b(ovarian|uterine) (artery|vein|venous plexus|branch)|\bvaginal (artery|vein|venous plexus|branch)/i;
    const MALE_NAME = /\b(testicular|cremasteric|deferential) (artery|vein|veins|plexus)|pampiniform/i;
    for (const p of this.parts) {
      if (p.sx) continue;
      const chain = this.ancestors(p.id).map(a => a.n).join(' | ');
      if (FEMALE_TREE.test(chain) || FEMALE_NAME.test(p.n)) p.sx = 'f';
      else if (MALE_TREE.test(chain) || MALE_NAME.test(p.n)) p.sx = 'm';
    }
    for (const p of this.parts) if (/^lumen of vagina$/i.test(p.n)) p.hide = 1;
  }

  /**
   * The atlas tags a muscle's attachments ".o" for origin and ".e" for its end, and the
   * import reads every ".e" as an insertion. That is right almost everywhere, but a few
   * muscle heads carry only ".e" tags, and then their origins read as insertions: the
   * sternocostal head of pectoralis major "inserting" on the sternum and the sixth rib,
   * which is backwards.
   *
   * A limb muscle arises nearer the trunk and inserts further out along the limb, so an
   * end on the trunk or the shoulder girdle, when this muscle or the muscle it is a head of
   * also ends out on a limb bone, is its origin. The rule only moves attachments on that
   * evidence. Trunk-to-trunk muscles, with nothing to compare, are left as the atlas has
   * them.
   */
  _fixAttachmentKinds() {
    const att = this.parts.filter(p => p.k === 'origin' || p.k === 'insertion');
    const byMuscle = new Map();
    for (const a of att) {
      const k = a.muscle + '|' + a.side;
      if (!byMuscle.has(k)) byMuscle.set(k, []);
      byMuscle.get(k).push(a);
    }
    const parentName = (name, side) => {
      const mesh = (this.byName.get(name.toLowerCase()) || []).find(p => p.k === 'mesh' && (!p.side || p.side === side));
      const g = mesh && this.byId.get(mesh.p);
      return g ? g.n.replace(/\s*\(.*?\)\s*$/, '') : null;
    };
    for (const [key, list] of byMuscle) {
      const [name, side] = key.split('|');
      const parent = parentName(name, side);
      const context = list.concat(parent ? (byMuscle.get(parent + '|' + side) || []) : []);
      const far = Math.max(...context.filter(a => a.k === 'insertion').map(a => boneRank(a.bone)));
      if (far < 2) continue;
      for (const a of list) {
        if (a.k === 'insertion' && boneRank(a.bone) <= 1 && boneRank(a.bone) < far) a.k = 'origin';
      }
    }
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
