import * as THREE from 'three';
import { state } from './state.js';
import { EFFECT_KINDS } from '../data/targets.js';

const ACCENT = new THREE.Color('#e9c95c');
const HOVER = new THREE.Color('#ffffff');
const tmpC = new THREE.Color();

/**
 * Owns the visual state of every part mesh: visibility, opacity, emissive glow, scale/opacity effects.
 */
export class Highlighter {
  constructor(viewer, registry, meshes) {
    this.viewer = viewer; this.registry = registry; this.meshes = meshes;
    this.effects = new Map();    // id → { color, intensity, scale, opacity }
    this.glowing = new Set();    // ids currently pulsing
    this.isolateSet = null;      // Set of ids or null
    this.hover = null;
    this.selected = new Set();
    this.solo = null;            // system key or null
    this._dirty = true;
    viewer.onFrame((t) => this.tick(t));
  }

  allMeshesOf(id) {
    const m = this.meshes.get(id);
    if (!m) return [];
    return m.userData.extra ? [m, ...m.userData.extra] : [m];
  }

  /** Mark dirty and flush on the next microtask, so correctness never waits on a frame
   *  (requestAnimationFrame is paused while the tab/pane is hidden). */
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

  /** effects: Map(id → {kind, intensity, scale, opacity}) */
  setEffects(map) {
    // reset previous scale/opacity
    for (const id of this.effects.keys()) for (const m of this.allMeshesOf(id)) { m.scale.setScalar(1); m.position.set(0, 0, 0); }
    this.effects = map || new Map();
    this.glowing = new Set(this.effects.keys());
    for (const [id, fx] of this.effects) {
      for (const m of this.allMeshesOf(id)) {
        if (fx.scale && fx.scale !== 1) {
          const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
          m.scale.setScalar(fx.scale);
          m.position.copy(c).multiplyScalar(1 - fx.scale);
        } else { m.scale.setScalar(1); m.position.set(0, 0, 0); }
      }
    }
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
    // Sex is a hard filter, not a "hidden" flag: a male organ must never appear in the
    // female body, whatever else the user has toggled.
    if (part.sx && part.sx !== (state.sex === 'female' ? 'f' : 'm')) return false;
    const sys = this.sysState(part.sys);
    if (!sys || !sys.visible) return false;
    if (this.solo && part.sys !== this.solo) return false;
    if (state.hidden.has(part.id)) return false;
    if (this.isolateSet && !this.isolateSet.has(part.id)) return false;
    if (part.k !== 'mesh') return state.showAttachments && this.selected.size && (this.selected.has(part.id));
    return true;
  }

  /** Recompute every mesh's visibility/opacity/colour. Cheap enough to run on state change only. */
  applyAll() {
    this._dirty = false;
    const xray = state.xray;
    const sel = this.selected;
    const hasSel = sel.size > 0;
    // In Systems mode the user has explicitly chosen what to show, so reveal must not
    // start hiding systems behind their back.
    const reveal = state.reveal && hasSel && state.mode !== 'systems';
    // System of the current selection, so reveal can keep a sensible frame of reference.
    let selSys = null;
    if (reveal) { const first = this.meshes.get(sel.values().next().value); selSys = first?.userData.part.sys || null; }
    const pick = [];
    for (const [id, primary] of this.meshes) {
      const part = primary.userData.part;
      const vis = this.isPartVisible(part);
      const sys = this.sysState(part.sys) || { opacity: 1 };
      const fx = this.effects.get(id);
      const isSel = sel.has(id);
      const isHover = this.hover === id;
      let opacity = sys.opacity * (fx && fx.opacity != null ? fx.opacity : 1);
      if (xray && !isSel && !isHover && !fx) opacity *= 0.16;
      if (this.effects.size && !fx && !isSel && !isHover) opacity *= 0.35;
      // Reveal: whatever is selected must actually be visible, even when it sits deep
      // inside skin/muscle/bone. Uniformly ghosting everything does NOT work — a few
      // thousand surfaces at low alpha stack back up to opaque along any view ray. So
      // keep only a thin frame of reference (own system + skeleton) and drop the rest.
      let revealHidden = false;
      if (reveal && !isSel && !isHover && !fx) {
        if (part.sys === selSys) opacity *= 0.22;
        else if (part.sys === 'skeletal' && selSys !== 'integumentary') opacity *= 0.14;
        else revealHidden = true;
      }
      if (isSel) opacity = Math.max(opacity, 0.95);
      const shown = vis && !revealHidden;
      for (const m of this.allMeshesOf(id)) {
        m.visible = shown;
        if (!shown) continue;
        const mat = m.material;
        const transparent = opacity < 0.999;
        if (mat.transparent !== transparent) { mat.transparent = transparent; mat.needsUpdate = false; }
        mat.opacity = opacity;
        mat.depthWrite = !transparent || opacity > 0.6;
        m.renderOrder = transparent ? (part.sys === 'integumentary' ? 20 : 10) : 0;
        // colour / emissive
        mat.color.copy(mat.userData.baseColor);
        if (isSel) {
          // brighten in the part's own hue (a gold wash would hide what the organ looks like)
          mat.emissive.copy(mat.userData.baseColor).lerp(ACCENT, 0.28);
          mat.emissiveIntensity = 0.34;
        }
        else if (isHover) { mat.emissive.copy(mat.userData.baseColor).lerp(HOVER, 0.5); mat.emissiveIntensity = 0.22; }
        else if (fx) { mat.emissive.set(EFFECT_KINDS[fx.kind]?.color || '#38bdf8'); mat.emissiveIntensity = 0.25 * fx.intensity; }
        else { mat.emissiveIntensity = 0; }
      }
      if (shown && part.k === 'mesh') pick.push(primary, ...(primary.userData.extra || []));
    }
    this.viewer.pickables = pick;
  }

  tick(t) {
    if (this._dirty) this.applyAll();
    if (!this.glowing.size) return;
    for (const id of this.glowing) {
      const fx = this.effects.get(id); if (!fx) continue;
      const pulse = 0.5 + 0.5 * Math.sin(t * (2.2 + fx.intensity * 2.5) + (fx.phase || 0));
      const base = 0.18 + 0.55 * fx.intensity;
      for (const m of this.allMeshesOf(id)) {
        if (this.selected.has(id) || this.hover === id) continue;
        m.material.emissiveIntensity = base * (0.55 + 0.45 * pulse);
      }
    }
  }

  /** morphed world-space bbox of a set of part ids */
  boxOf(ids, applyMorphFn) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const id of ids) {
      const m = this.meshes.get(id); if (!m) continue;
      const bb = m.geometry.boundingBox; if (!bb) continue;
      const grp = m.parent;
      for (const corner of [[bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z], [bb.min.x, bb.max.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z]]) {
        v.set(...corner); applyMorphFn(v, v); v.applyMatrix4(grp.matrixWorld); box.expandByPoint(v);
      }
    }
    return box;
  }
}
