import * as THREE from 'three';
import { pressPhase } from '../data/exercises.js';

/**
 * Exercise player.
 *
 * Owns the clock, drives the rig from the exercise's pose function, and reports each
 * muscle's effort at the current instant. Two things are worth knowing:
 *
 * - The bar is not animated. It is placed at the hands every frame, so the grip can never
 *   drift off the bar however the pose is edited or the body is resized.
 * - Muscle effort is pushed through the existing effect channel with a `steady` flag, so it
 *   reuses all the visibility and reveal logic and does not pulse like an effect glow.
 */

const BENCH_TOP = 0.46;

export class ExercisePlayer {
  constructor(app) {
    this.app = app;
    this.ex = null;
    this.t = 0;                 // rep phase 0..1
    this.playing = false;
    this.speed = 1;
    this.props = null;
    this.groups = [];           // [{ def, ids:[], slots:[], effort }]
    this._fx = new Map();
    this._last = 0;
  }

  // ---------- lifecycle ----------
  start(ex) {
    this.ex = ex;
    this.t = 0;
    this.playing = false;
    this._resolveMuscles();
    this._buildProps();
    this.app.viewer.ground.visible = false;
    this.app.viewer.ring.visible = false;
    this.seek(0);
    // The panel that is about to appear changes how much canvas is free, and setMode only
    // measures that on the next frame. Framing before then fits the shot to the old
    // layout, so wait for the measurement to land.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (this.ex) this.frameCamera(); }));
  }

  stop() {
    this.ex = null;
    this.playing = false;
    const { app } = this;
    app.body.rig?.reset();
    app.hi.clearEffects();
    if (this.props) { this.app.viewer.scene.remove(this.props); disposeTree(this.props); this.props = null; }
    app.viewer.ground.visible = true;
    app.viewer.ring.visible = true;
    app.viewer.requestRender();
  }

  /** Resolve each muscle group's regex to real parts, once. */
  _resolveMuscles() {
    const { registry, body } = this.app;
    this.groups = [];
    this._fx = new Map();
    for (const def of this.ex.muscles) {
      const ids = [], slots = [];
      for (const p of registry.parts) {
        if (p.k !== 'mesh' || p.sys !== 'muscular') continue;
        if (!def.match.test(p.n)) continue;
        const slot = body.slot(p.id);
        if (slot === undefined) continue;
        ids.push(p.id); slots.push(slot);
      }
      if (!ids.length) { console.warn('[exercise] no parts matched', def.key, def.match); continue; }
      const g = { def, ids, slots, effort: 0 };
      this.groups.push(g);
      for (const id of ids) this._fx.set(id, { kind: 'activation', intensity: 0, steady: true });
    }
    this.app.hi.setEffects(this._fx);
  }

  // ---------- clock ----------
  play() { this.playing = true; this._last = performance.now(); this.app.viewer.requestRender(); }
  pause() { this.playing = false; }
  toggle() { this.playing ? this.pause() : this.play(); }

  /** Advance the clock. Called once per rendered frame. */
  tick() {
    if (!this.ex) return;
    if (this.playing) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.t = (this.t + (dt * this.speed) / this.ex.duration) % 1;
      this.seek(this.t);
      this.app.viewer.requestRender();
    }
  }

  /** Put the body, the bar and every muscle at rep phase t. */
  seek(t) {
    if (!this.ex) return;
    this.t = ((t % 1) + 1) % 1;
    const rig = this.app.body.rig;
    if (!rig || !rig.ok) return;

    const u = pressPhase(this.t);
    rig.setPose(this.ex.pose(u, { height: this.app.currentHeightCm() / 100, benchTop: BENCH_TOP, rig }));

    for (const g of this.groups) {
      g.effort = Math.max(0, Math.min(1, g.def.effort(this.t)));
      for (const id of g.ids) this._fx.get(id).intensity = g.effort;
    }
    this._placeBar();
    // Label anchors are computed from where a part is, and that has just changed, so they
    // have to be rebuilt or they stay pinned to where the body was.
    if (this.app._labelItems?.length) this.app.refreshLabels();
    // Scrubbing, stepping and playing all land here, so the readout is refreshed from one
    // place rather than from whichever caller happened to remember.
    this.onSeek?.();
    this.app.viewer.requestRender();
  }

  /** Press phase right now: 0 on the chest, 1 locked out. */
  get press() { return pressPhase(this.t); }

  /** Muscle groups sorted by how hard they are working, for the readout. */
  ranked() { return [...this.groups].sort((a, b) => b.effort - a.effort); }

  // ---------- props ----------
  _buildProps() {
    if (this.props) { this.app.viewer.scene.remove(this.props); disposeTree(this.props); }
    const g = new THREE.Group();
    g.name = 'exercise-props';

    const pad = new THREE.MeshPhysicalMaterial({ color: 0x1b1f26, roughness: 0.85, metalness: 0.0, clearcoat: 0.1 });
    const frame = new THREE.MeshPhysicalMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.6 });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, roughness: 0.32, metalness: 0.95 });
    const iron = new THREE.MeshPhysicalMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.4 });

    // Bench: the pad the body lies on, plus enough frame to read as a bench from the side.
    const padMesh = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.10, 1.22), pad);
    padMesh.position.set(0, BENCH_TOP - 0.05, -0.26);
    g.add(padMesh);
    for (const z of [-0.80, 0.26]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, BENCH_TOP - 0.10, 0.08), frame);
      post.position.set(0, (BENCH_TOP - 0.10) / 2, z);
      g.add(post);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.10), frame);
      foot.position.set(0, 0.025, z);
      g.add(foot);
    }

    // Barbell: positioned at the hands every frame by _placeBar().
    const bar = new THREE.Group();
    const R = this.ex?.bar?.radius ?? 0.0145;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.15, 18), steel);
    shaft.rotation.z = Math.PI / 2;
    bar.add(shaft);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.045, 28), iron);
        plate.rotation.z = Math.PI / 2;
        plate.position.x = s * (0.75 + i * 0.05);
        bar.add(plate);
      }
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 14), steel);
      collar.rotation.z = Math.PI / 2;
      collar.position.x = s * 0.83;
      bar.add(collar);
    }
    g.add(bar);
    this.bar = bar;

    this.app.viewer.scene.add(g);
    this.props = g;
  }

  /**
   * Put the bar in the hands, rather than animating it on its own track. The hands are
   * wherever the rig says they are, so this stays true at any body size or press phase.
   */
  _placeBar() {
    const rig = this.app.body.rig;
    if (!this.bar || !rig?.ok) return;
    // The bar lies in the channel of the palm, which is the same point the arm IK solves
    // to, so the grip can never drift off it at any phase or any body size.
    const l = rig.jointAt('grip', 'l'), r = rig.jointAt('grip', 'r');
    this.bar.position.set(0, (l.y + r.y) / 2, (l.z + r.z) / 2);
  }

  // ---------- camera ----------
  /**
   * Three-quarter view from the athlete's side, level with the bar — the angle a lifting
   * video is shot from. The body lies head-to-feet along z, so the camera has to stand out
   * along x; putting it down the z axis would look straight up the soles of the feet.
   */
  frameCamera() {
    const v = this.app.viewer;
    const target = new THREE.Vector3(0, BENCH_TOP + 0.40, -0.32);
    // Aim from the side first, then let focusBox work out the distance. Fitting a box
    // rather than hard-coding a distance is what keeps the whole rig — bench, body and
    // both ends of the bar — clear of the side panels, at whatever width they are.
    v._tween = null;
    v.controls.target.copy(target);
    v.camera.position.copy(target).add(new THREE.Vector3(2.0, 0.55, -1.05));
    v.camera.lookAt(target);
    // Frame the athlete, not the plate tips. Fitting the bar's full 2.2 m span pushes the
    // camera so far back that the body — the thing being explained — reads small, and
    // cropping the ends of a barbell is what lifting footage does anyway.
    const box = new THREE.Box3(new THREE.Vector3(-0.90, 0.25, -1.10), new THREE.Vector3(0.90, 1.30, 0.50));
    v.focusBox(box, { pad: 1.06, keepDir: true, duration: 0.7 });
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}
