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
    this.invalidate();
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

      let opacity = sys.opacity * (fx && fx.opacity != null ? fx.opacity : 1);
      if (xray && !isSel && !isHover && !fx) opacity *= 0.16;
      if (anyEffect && !fx && !isSel && !isHover && !covered.has(part.sys)) opacity *= 0.35;

      // Reveal keeps a thin frame of reference (own system + skeleton) and drops the rest:
      // ghosting everything does not work, because thousands of low-alpha surfaces stack
      // back up to opaque along any view ray.
      let hiddenByReveal = false;
      if (reveal && !isSel && !isHover && !fx) {
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
      const intensity = fx ? fx.intensity : 0;
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
    if (!this.glowing.size) return;
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
