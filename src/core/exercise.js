import * as THREE from 'three';
import { bodyKey, phaseAt, EZ_BENDS } from './lift.js';

/**
 * Exercise player. Runs any lift written in the movement framework's format.
 *
 * Owns the clock, drives the rig from the lift's pose, builds the lift's equipment and
 * reports each muscle's effort at the current instant. Three things are worth knowing:
 *
 * - The bar is not animated. It is placed at the hands every frame, so the grip can never
 *   drift off the bar however the pose is edited or the body is resized.
 * - Muscle effort is pushed through the existing effect channel with a `steady` flag, so it
 *   reuses all the visibility and reveal logic and does not pulse like an effect glow.
 * - Poses are kept once worked out, per body. Some lifts measure the bar against the skin
 *   at every moment of the rep, and that should not be paid again on every frame.
 */
/** How finely the movement is sampled: more than one pose per frame of a 3-second rep. */
const STEPS = 360;

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
    this._poses = new Map();
    this.fault = null;          // a mistake being shown on the body, or null for correct form
  }

  // ---------- lifecycle ----------
  start(ex) {
    if (this.ex) this.stop();
    this.ex = ex;
    this.fault = null;
    this.t = 0;
    this.playing = false;
    this._poses = new Map();
    this._resolveMuscles();
    this._buildProps();
    this.seek(0);
    // The panels change how much canvas is free as Movement opens (the inspector folds
    // away, and on a phone the controls become a sheet), and that is measured a moment
    // later. So the shot keeps re-fitting to the free area whenever it changes, until the
    // user takes the camera themselves. Resizing the window re-fits it too.
    this.autoFrame = true;
    this._grab = () => { this.autoFrame = false; };
    this.app.viewer.controls.addEventListener('start', this._grab);
    this.scheduleFrame(320);
    this._warm();
  }

  /**
   * Work out every pose of the rep in the background, a few at a time between frames, so
   * the first rep plays as smoothly as the rest. Lifts that measure the bar against the
   * legs take tens of milliseconds a pose, the first time.
   */
  _warm() {
    const ex = this.ex;
    let i = 0;
    const step = (deadline) => {
      if (this.ex !== ex) return;
      const t0 = performance.now();
      while (i <= STEPS && performance.now() - t0 < 12) { this.poseAt(i / STEPS); i++; }
      if (i <= STEPS) (window.requestIdleCallback || setTimeout)(step, { timeout: 100 });
    };
    (window.requestIdleCallback || setTimeout)(step, { timeout: 200 });
  }

  /** Fit the shot again shortly, if the user has not moved the camera since Movement opened. */
  scheduleFrame(ms = 60) {
    if (!this.ex || !this.autoFrame) return;
    clearTimeout(this._frameT);
    this._frameT = setTimeout(() => { if (this.ex && this.autoFrame) this.frameCamera(); }, ms);
  }

  stop() {
    this.ex = null;
    this.playing = false;
    this.autoFrame = false;
    clearTimeout(this._frameT);
    if (this._grab) { this.app.viewer.controls.removeEventListener('start', this._grab); this._grab = null; }
    const { app } = this;
    // Back to standing: the stance that goes with this body, or no pose at all.
    if (app.applyStance) app.applyStance(); else app.body.rig?.reset();
    app.hi.clearEffects();
    // "Look through" sets a temporary system override. Leaving it behind outvotes every
    // switch in the Systems panel — the user flips a system and nothing happens, because
    // a view they left behind in Movement is still deciding what is visible.
    app.clearSysOverride();
    if (this.props) { this.app.viewer.scene.remove(this.props); disposeTree(this.props); this.props = null; }
    app.viewer.ground.visible = true;
    app.viewer.ring.visible = true;
    app.viewer.requestRender();
  }

  /**
   * Resolve each muscle group's pattern to real parts, once. Bursae, sheaths and fascia
   * carry muscle names too ("bursa of biceps femoris") and are not muscle, so they are left
   * out whatever the pattern says.
   */
  _resolveMuscles() {
    const { registry, body } = this.app;
    this.groups = [];
    this._fx = new Map();
    const NOT_MUSCLE = /bursa|sheath|fascia|trochlea/i;
    for (const def of this.ex.muscles) {
      const ids = [], slots = [];
      for (const p of registry.parts) {
        if (p.k !== 'mesh' || p.sys !== 'muscular' || NOT_MUSCLE.test(p.n)) continue;
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

  /** How far through the movement the body is: 0 at the start position, 1 at the end. */
  get u() { return this.ex ? this.ex.u(this.t) : 0; }
  /** The phase of the rep right now: its name and the form cue for it. */
  get phase() { return this.ex ? phaseAt(this.ex.phases, this.t) : null; }

  /** The pose at movement point u, for this body, worked out once. */
  poseAt(u) {
    const rig = this.app.body.rig;
    const key = `${bodyKey()}|${this.fault || ''}|${Math.round(u * STEPS)}`;
    let p = this._poses.get(key);
    if (!p) {
      if (this._poses.size > 3000) this._poses.clear();
      p = this.ex.pose(Math.round(u * STEPS) / STEPS, { height: this.app.currentHeightCm() / 100, rig, fault: this.fault });
      this._poses.set(key, p);
    }
    return p;
  }

  /** Put the body, the bar and every muscle at rep phase t. */
  seek(t) {
    if (!this.ex) return;
    this.t = ((t % 1) + 1) % 1;
    const rig = this.app.body.rig;
    if (!rig || !rig.ok) return;

    this._pose = this.poseAt(this.ex.u(this.t));
    rig.setPose(this._pose);

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

  /**
   * Show one of the lift's mistakes on the body, or pass null to go back to correct form.
   * The mistake's poses are worked out like any others, and kept apart from the correct ones.
   */
  setFault(key) {
    this.fault = key && this.ex?.faults?.some(f => f.key === key) ? key : null;
    this.seek(this.t);
  }

  /** Muscle groups sorted by how hard they are working, for the readout. */
  ranked() { return [...this.groups].sort((a, b) => b.effort - a.effort); }

  // ---------- props ----------
  /** The lift's equipment: the floor it stands on, a bench if it needs one, and the bar. */
  _buildProps() {
    if (this.props) { this.app.viewer.scene.remove(this.props); disposeTree(this.props); }
    const eq = this.ex.equipment || {};
    const g = new THREE.Group();
    g.name = 'exercise-props';
    this.app.viewer.ground.visible = false;
    this.app.viewer.ring.visible = false;

    const pad = new THREE.MeshPhysicalMaterial({ color: 0x1b1f26, roughness: 0.85, metalness: 0.0, clearcoat: 0.1 });
    const frame = new THREE.MeshPhysicalMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.6 });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, roughness: 0.32, metalness: 0.95 });
    const iron = new THREE.MeshPhysicalMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.4 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x33373e, roughness: 0.95, metalness: 0 });

    // A lifting platform: the lifter stands on something, not on thin air.
    if (eq.floor) {
      const floor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 2.2), rubber);
      floor.position.set(0, -0.01, eq.floorZ ?? 0);
      g.add(floor);
    }

    // Bench: the pad plus enough frame to read as a bench.
    if (eq.bench) {
      const b = eq.bench, along = b.along === 'x';
      const len = b.length, wid = b.width;
      const padMesh = new THREE.Mesh(new THREE.BoxGeometry(along ? len : wid, 0.10, along ? wid : len), pad);
      padMesh.position.set(b.center[0], b.top - 0.05, b.center[1]);
      g.add(padMesh);
      for (const k of [-0.42, 0.42]) {
        const off = k * len;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, b.top - 0.10, 0.08), frame);
        post.position.set(b.center[0] + (along ? off : 0), (b.top - 0.10) / 2, b.center[1] + (along ? 0 : off));
        g.add(post);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.10 : wid + 0.09, 0.05, along ? wid + 0.09 : 0.10), frame);
        foot.position.set(b.center[0] + (along ? off : 0), 0.025, b.center[1] + (along ? 0 : off));
        g.add(foot);
      }
    }

    // Barbell: positioned at the hands every frame by _placeBar(). An Olympic bar is 2.2 m
    // with 45 cm plates; a short curl bar is 1.2 m with small plates.
    if (eq.bar) {
      const bar = new THREE.Group();
      const R = this.ex.bar?.radius ?? 0.0145;
      const short = eq.bar === 'short' || eq.bar === 'ez';
      const len = short ? 1.2 : 2.15;
      if (eq.bar === 'ez') {
        // The EZ bar's bends: straight in the middle, angled inner grips, angled outer grips,
        // then the sleeves. Built as a chain of short shafts through these points.
        const pts = EZ_BENDS.map(([x, o]) => new THREE.Vector3(x, o, 0));
        const all = [...pts.slice(1).reverse().map(p => p.clone().setX(-p.x)), ...pts];
        for (let i = 0; i < all.length - 1; i++) {
          const a = all[i], b = all[i + 1], seg = b.clone().sub(a);
          const piece = new THREE.Mesh(new THREE.CylinderGeometry(R, R, seg.length() + R * 0.6, 14), steel);
          piece.position.copy(a).add(b).multiplyScalar(0.5);
          piece.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.normalize());
          bar.add(piece);
        }
      } else {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 18), steel);
        shaft.rotation.z = Math.PI / 2;
        bar.add(shaft);
      }
      const plateR = short ? 0.13 : 0.225, first = short ? 0.42 : 0.75, t = short ? 0.035 : 0.045;
      for (const s of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          const plate = new THREE.Mesh(new THREE.CylinderGeometry(plateR, plateR, t, 28), iron);
          plate.rotation.z = Math.PI / 2;
          plate.position.x = s * (first + i * (t + 0.005));
          bar.add(plate);
        }
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(R * 2.4, R * 2.4, 0.05, 14), steel);
        collar.rotation.z = Math.PI / 2;
        collar.position.x = s * (first + 2 * (t + 0.005) + 0.02);
        bar.add(collar);
      }
      g.add(bar);
      this.bar = bar;
    } else this.bar = null;

    this.app.viewer.scene.add(g);
    this.props = g;
  }

  /**
   * Put the bar in the hands, rather than animating it on its own track. The hands are
   * wherever the rig says they are, so this stays true at any body size or moment.
   */
  _placeBar() {
    const rig = this.app.body.rig;
    if (!this.bar || !rig?.ok) return;
    // The bar lies in the channel of the palm, which is the same point the arm IK solves
    // to, so the grip can never drift off it at any phase or any body size.
    const l = rig.jointAt('grip', 'l'), r = rig.jointAt('grip', 'r');
    this.bar.position.set((l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2);
    // An EZ bar is turned in the hands, so its bends lie the way the pose says, and its
    // straight middle sits a little off the line between the two grips.
    const bend = this._pose?._bar;
    if (bend) {
      const x = new THREE.Vector3(1, 0, 0), c = bend.c.clone().normalize();
      this.bar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, c, x.clone().cross(c)));
      this.bar.position.addScaledVector(c, -bend.offset);
    } else this.bar.quaternion.identity();
  }

  // ---------- camera ----------
  /** The lift's own shot: aim, then let focusBox work out the distance for the free area. */
  frameCamera() {
    const v = this.app.viewer;
    const c = this.ex.camera({ height: this.app.currentHeightCm() / 100 });
    const target = new THREE.Vector3(...c.target);
    v._tween = null;
    v.controls.target.copy(target);
    v.camera.position.copy(target).add(new THREE.Vector3(...c.offset));
    v.camera.lookAt(target);
    const box = new THREE.Box3(new THREE.Vector3(...c.box[0]), new THREE.Vector3(...c.box[1]));
    v.focusBox(box, { pad: 1.04, keepDir: true, duration: 0.7 });
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
  });
}
