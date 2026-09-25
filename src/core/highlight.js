import * as THREE from 'three';
import { state } from './state.js';
import { effectKindIndex } from './batched.js';

/**
 * Decides what every part should look like, then writes it into the batch's two data
 * textures. Nothing here touches the scene graph — a full restyle of 4,000 structures is
 * a couple of typed-array writes and one texture upload.
 */
/**
 * Sheets and sacs of connective tissue that the atlas files under the muscular system.
 * Plain tendons are deliberately NOT here: a tendon is part of the muscle's own shape, and
 * hiding it would leave muscles ending in mid-air.
 */
const CONNECTIVE = /fascia|aponeuros|retinacul|intermuscular septum|\bsheath|\bbursa/i;

export class Highlighter {
  constructor(viewer, registry, body) {
    this.viewer = viewer; this.registry = registry; this.body = body;
    this.effects = new Map();    // partId -> { kind, intensity, scale, opacity }
    this.glowing = new Set();
    this.isolateSet = null;
    this.hover = null;
    this.selected = new Set();
    this.solo = null;
    this._dirty = true;
    this._pulse = 0;
    // Organs that grow or shrink: where each part is heading, and where it is on the way.
    this.growTarget = new Map();   // slot -> { cx, cy, cz, axis, scale }
    this.growNow = new Map();      // slot -> { cx, cy, cz, axis, scale }
    this.compare = false;          // "before": every change undone while held
    this._lastT = 0;
    viewer.onFrame((t) => this.tick(t));
  }

  invalidate() {
    this._dirty = true;
    if (this._queued) return;
    this._queued = true;
    queueMicrotask(() => { this._queued = false; if (this._dirty) this.applyAll(); });
  }

  setHover(id) { if (this.hover === id) return; this.hover = id; this.invalidate(); }
  setSelected(ids) { this.selected = new Set(ids || []); this.invalidate(); }
  setIsolate(ids) { this.isolateSet = ids ? new Set(ids) : null; this.invalidate(); }
  setSolo(sysKey) { this.solo = sysKey; this.invalidate(); }

  setEffects(map) {
    this.effects = map || new Map();
    this.glowing = new Set(this.effects.keys());
    this._planGrowth();
    this.invalidate();
  }

  /** Show the body as it was before, with every change undone, while this is on. */
  setCompare(on) {
    if (this.compare === on) return;
    this.compare = on;
    this.invalidate();
    this.viewer.requestRender();
  }

  /**
   * Work out which parts change size, and about which centre.
   *
   * An organ made of several pieces (the liver's segments, the heart's walls) scales about
   * the middle of the whole organ on its side of the body, so the pieces stay together
   * instead of each swelling on its own spot and pulling apart. A muscle thickens about its
   * own middle, across its length and not along it, so it does not come off its bones.
   * Skin is one stitched surface and is left alone; so is anything that spans a whole
   * system, which the body's overall shape already shows.
   */
  _planGrowth() {
    const body = this.body;
    this.growTarget = new Map();
    if (!body?.grow) return;
    // A change that spans a whole system (every muscle in the body) is already drawn by the
    // body's own shape. Counted per group across both sides, before splitting by side.
    const groupSize = new Map();
    for (const fx of this.effects.values()) if (fx.group) groupSize.set(fx.group, (groupSize.get(fx.group) || 0) + 1);
    const groups = new Map();
    for (const [id, fx] of this.effects) {
      if (fx.scale == null || Math.abs(fx.scale - 1) < 0.002) continue;
      if (fx.group && groupSize.get(fx.group) > 300) continue;
      const slot = body.slot(id);
      if (slot === undefined) continue;
      const part = body.parts[slot];
      if (part.sys === 'integumentary') continue;
      const key = (fx.group || id) + '|' + (part.side || '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ slot, part, scale: Math.min(1.6, Math.max(0.6, fx.scale)) });
    }
    const c = new THREE.Vector3(), size = new THREE.Vector3();
    for (const items of groups.values()) {
      const organ = new THREE.Box3();
      for (const it of items) if (it.part.sys !== 'muscular') organ.union(body.bounds[it.slot]);
      const oc = organ.isEmpty() ? null : organ.getCenter(new THREE.Vector3());
      for (const it of items) {
        const bb = body.bounds[it.slot];
        let axis = 0;
        if (it.part.sys === 'muscular') {
          bb.getCenter(c); bb.getSize(size);
          const dims = [size.x, size.y, size.z];
          const long = dims.indexOf(Math.max(...dims));
          if (dims[long] > 2 * Math.min(...dims.filter((_, i) => i !== long))) axis = long + 1;
        } else c.copy(oc);
        this.growTarget.set(it.slot, { cx: c.x, cy: c.y, cz: c.z, axis, scale: it.scale });
      }
    }
  }

  /** Ease every part towards its size. Returns true while anything is still moving. */
  _stepGrowth(dt) {
    const body = this.body;
    if (!body?.grow || (!this.growTarget.size && !this.growNow.size)) return false;
    const k = 1 - Math.exp(-dt * 3.2);            // most of the way in about a second
    let moving = false;
    for (const [slot, tgt] of this.growTarget) {
      if (!this.growNow.has(slot)) this.growNow.set(slot, { ...tgt, scale: 1 });
    }
    for (const [slot, now] of this.growNow) {
      const tgt = this.growTarget.get(slot);
      const want = this.compare || !tgt ? 1 : tgt.scale;
      if (tgt) { now.cx = tgt.cx; now.cy = tgt.cy; now.cz = tgt.cz; now.axis = tgt.axis; }
      now.scale += (want - now.scale) * k;
      if (Math.abs(want - now.scale) < 0.0004) now.scale = want; else moving = true;
      body.setGrow(slot, now.cx, now.cy, now.cz, now.axis, now.scale);
      if (!tgt && now.scale === 1) { body.setGrow(slot, 0, 0, 0, 0, 1); this.growNow.delete(slot); }
    }
    return moving;
  }
  clearEffects() { this.setEffects(new Map()); }

  /** The user's setting for a system, with any temporary override laid on top. */
  sysState(key) {
    const base = state.systems[key];
    if (!base) return null;
    const ov = state.sysOverride && state.sysOverride[key];
    return ov ? { visible: ov.visible ?? base.visible, opacity: ov.opacity ?? base.opacity } : base;
  }

  isPartVisible(part) {
    // Sex is a hard filter: a male organ must never appear in the female body.
    if (part.sx && part.sx !== (state.sex === 'female' ? 'f' : 'm')) return false;
    if (part.hide) return false;              // placed wrongly in the source file; never drawn
    // Connective tissue is filed under "muscles" in this atlas, but it is not muscle and
    // it WRAPS muscle: fascia lata sheathes the whole thigh, brachial and antebrachial
    // fascia sheathe the arm, and the clavipectoral fascia stretches across the armpit.
    // Left on, they render as smooth opaque shells and the limbs read as hollow, with a
    // membrane hanging in the axilla. Off by default; the Systems panel switches them on.
    if (!state.connective && CONNECTIVE.test(part.n)) return false;
    const sys = this.sysState(part.sys);
    if (!sys || !sys.visible) return false;
    if (this.solo && part.sys !== this.solo) return false;
    if (state.hidden.has(part.id)) return false;
    if (this.isolateSet && !this.isolateSet.has(part.id)) return false;
    return true;
  }

  applyAll() {
    this._dirty = false;
    const body = this.body;
    if (!body || !body.count) return;
    const xray = state.xray;
    const sel = this.selected;
    const hasSel = sel.size > 0;
    const reveal = state.reveal && hasSel && state.mode !== 'systems';
    let selSys = null;
    if (reveal) { const first = body.parts[body.slot(sel.values().next().value)]; selSys = first?.sys || null; }
    const anyEffect = this.effects.size > 0;
    // Which systems an effect covers almost entirely. Dimming the few parts of such a
    // system that it happens to skip does not focus anything: on the skin it only left a
    // patchwork of dark and light panels.
    const covered = new Set();
    if (anyEffect) {
      const all = new Map(), hit = new Map();
      for (let slot = 0; slot < body.count; slot++) {
        const part = body.parts[slot];
        if (!this.isPartVisible(part)) continue;
        all.set(part.sys, (all.get(part.sys) || 0) + 1);
        if (this.effects.has(part.id)) hit.set(part.sys, (hit.get(part.sys) || 0) + 1);
      }
      for (const [sys, n] of all) if ((hit.get(sys) || 0) >= n * 0.6) covered.add(sys);
    }
    // How much of each batch is showing opaque, for the depth switch below.
    const shownN = new Uint32Array(body.batches.length), opaqueN = new Uint32Array(body.batches.length);

    for (let slot = 0; slot < body.count; slot++) {
      const part = body.parts[slot];
      const vis = this.isPartVisible(part);
      const sys = this.sysState(part.sys) || { opacity: 1 };
      const fx = this.effects.get(part.id);
      const isSel = sel.has(part.id);
      const isHover = this.hover === part.id;

      let opacity = sys.opacity * (fx && fx.opacity != null && !this.compare ? fx.opacity : 1);
      if (xray && !isSel && !isHover && !fx) opacity *= 0.16;
      if (anyEffect && !fx && !isSel && !isHover && !covered.has(part.sys)) opacity *= 0.35;

      // Reveal keeps a thin frame of reference (own system + skeleton) and drops the rest:
      // ghosting everything does not work, because thousands of low-alpha surfaces stack
      // back up to opaque along any view ray.
      let hiddenByReveal = false;
      // Glowing parts follow the same rule when one organ is picked. With a steroid cycle
      // every muscle glows, and kept on screen, even faint, hundreds of them stacked into a
      // solid wall in front of the liver.
      if (reveal && !isSel && !isHover) {
        if (part.sys === selSys) opacity *= 0.22;
        else if (part.sys === 'skeletal' && selSys !== 'integumentary') opacity *= 0.14;
        else hiddenByReveal = true;
      }
      if (isSel) opacity = Math.max(opacity, 0.95);
      if (isHover) opacity = Math.max(opacity, 0.6);

      const shown = vis && !hiddenByReveal;
      body.setVisible(slot, shown);
      if (!shown) continue;

      shownN[body.batchOf[slot]]++;
      if (opacity >= 0.95) opaqueN[body.batchOf[slot]]++;
      const selectedAmt = isSel ? 1 : (isHover ? 0.45 : 0);
      const kind = fx ? effectKindIndex(fx.kind) : 0;
      const intensity = fx && !this.compare ? fx.intensity : 0;
      body.setStyle(slot, opacity, selectedAmt, kind, intensity);
    }
    body.setBatchesFromParts();
    // The skin is one mesh drawn in one call. With depth writing off, its far side lands
    // on top of its near side wherever those triangles happen to draw later, and the front
    // of the body showed through the back. Skin that is mostly opaque writes depth; skin
    // that is mostly a see-through ghost does not, so it layers evenly. A few dimmed
    // patches among opaque ones must not switch it off for the whole skin.
    body.batches.forEach((b, i) => {
      const m = b.mesh.material;
      if (m.userData.ghostable) m.depthWrite = shownN[i] > 0 && opaqueN[i] >= shownN[i] * 0.85;
    });
    body.flush();
    this.viewer.requestRender();
  }

  /** Effect glow breathes; nothing else animates, so this is the only per-frame work. */
  tick(t) {
    if (this._dirty) this.applyAll();
    const dt = Math.min(0.1, Math.max(0, t - this._lastT));
    this._lastT = t;
    if (this._stepGrowth(dt) || this.body?._dirtyGrow) { this.body.flush(); this.viewer.requestRender(); }
    if (!this.glowing.size || this.compare) return;
    const body = this.body;
    for (const id of this.glowing) {
      const fx = this.effects.get(id); if (!fx) continue;
      const slot = body.slot(id); if (slot === undefined) continue;
      if (this.selected.has(id) || this.hover === id) continue;
      const i = slot * 4;
      // Muscle activation is a measurement, not an alert: it must read as the exact value
      // the timeline is at, so it does not breathe like an effect glow does.
      if (fx.steady) { body.style[i + 3] = fx.intensity; continue; }
      const pulse = 0.5 + 0.5 * Math.sin(t * (2.2 + fx.intensity * 2.5) + (fx.phase || 0));
      const base = 0.25 + 0.75 * fx.intensity;
      body.style[i + 3] = base * (0.5 + 0.5 * pulse);
    }
    body.styleTex.needsUpdate = true;
    this.viewer.requestRender();
  }

  /**
   * World-space box for a set of parts, as they are RIGHT NOW — morphed to this body's
   * size, nudged by any atlas offset, and moved into the current pose. Framing the camera
   * on the rest pose is what sent it to where a structure sits on a standing body while the
   * body on screen was lying on a bench.
   */
  boxOf(ids, applyMorphFn) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const id of ids) {
      const bb = this.body.boundsOf(id);
      if (!bb) continue;
      const slot = this.body.slot(id);
      const ox = this.body.state[slot * 4], oy = this.body.state[slot * 4 + 1], oz = this.body.state[slot * 4 + 2];
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
        applyMorphFn(v, v, { belly: 1, breast: 1 });
        this.body.posedPoint(slot, v);
        v.x += ox; v.y += oy; v.z += oz;
        box.expandByPoint(v);
      }
    }
    return box;
  }
}
