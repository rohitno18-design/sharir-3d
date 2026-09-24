import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { SYSTEMS } from '../data/systems.js';
import { applyMorph, invertMorph, isPlainScale } from './morph.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const finiteVec = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export const BODY_CENTER = new THREE.Vector3(0, 0.9, 0);

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 60);
    this.camera.position.set(0.35, 1.05, 3.9);

    this._makeControls();

    // Lighting
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    const hemi = new THREE.HemisphereLight(0xdfe6f0, 0x2a2622, 0.55);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2); key.position.set(2.5, 3.5, 4);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9); fill.position.set(-3.5, 1.2, -1.5);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2); rim.position.set(0.5, 2.5, -4.5);
    this.scene.add(key, fill, rim);

    // Ground disc
    const g = new THREE.Mesh(new THREE.CircleGeometry(1.4, 96), new THREE.MeshStandardMaterial({ color: 0x0f1216, roughness: 1, metalness: 0, transparent: true, opacity: 0.9 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.002; g.renderOrder = -10;
    this.ground = g; this.scene.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.39, 1.4, 128), new THREE.MeshBasicMaterial({ color: 0xe9c95c, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0005; this.scene.add(ring); this.ring = ring;

    // Body root + system groups
    this.bodyRoot = new THREE.Group(); this.bodyRoot.name = 'body';
    this.scene.add(this.bodyRoot);
    this.systemGroups = {};
    for (const s of SYSTEMS) {
      const grp = new THREE.Group(); grp.name = s.key; grp.userData.system = s.key;
      this.systemGroups[s.key] = grp; this.bodyRoot.add(grp);
    }

    // Clipping planes: x (left/right), y (top/bottom), z (front/back)
    this.clipPlanes = [
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), 10),
      new THREE.Plane(new THREE.Vector3(0, 0, -1), 10),
    ];
    this.renderer.clippingPlanes = [];

    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.pickables = [];
    this._frameCbs = [];
    this._tween = null;
    this.clock = new THREE.Timer();
    this.clock.connect(document);            // pauses the clock while the tab is hidden
    this.frame = 0;

    this.width = 1; this.height = 1;
    this._dirty = true;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement);
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /** OrbitControls keeps private spherical/pan state, so recovery has to rebuild it. */
  _makeControls() {
    if (this.controls) this.controls.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(BODY_CENTER);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.03;
    this.controls.maxDistance = 14;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomSpeed = 1.1;
    this.controls.rotateSpeed = 0.85;
    this.controls.addEventListener('change', () => { this._dirty = true; });
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
    this._dirty = true;
  }

  onFrame(cb) { this._frameCbs.push(cb); }

  /** Called after every loop turn, once the frame (if any) has been drawn. Returns an off switch. */
  onAfterRender(cb) {
    (this._afterCbs ||= []).push(cb);
    return () => { this._afterCbs = this._afterCbs.filter(f => f !== cb); };
  }

  /** Ask for a frame. Cheap to call from anywhere; several calls coalesce into one. */
  requestRender() { this._dirty = true; }

  _loop() {
    requestAnimationFrame(this._loop);
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.getElapsed();
    this.frame++;
    if (!finiteVec(this.camera.position) || !finiteVec(this.controls.target)) this._recoverCamera();
    if (this._tween) { this._stepTween(dt); this._dirty = true; }
    const controlsMoved = this.controls.update();
    if (controlsMoved) this._dirty = true;
    for (const cb of this._frameCbs) cb(t, dt, this.frame);
    // Rendering only when the scene actually changed is what keeps the fan quiet and the
    // interaction crisp: an idle atlas costs nothing.
    let drew = false;
    if (this._dirty) { this.renderer.render(this.scene, this.camera); this._dirty = false; drew = true; }
    if (this._afterCbs) for (const cb of this._afterCbs) cb(drew, t);
  }

  // ---------- clipping ----------
  setClip({ x = 1, y = 1, z = 1 } = {}, bbox) {
    const [mn, mx] = bbox;
    const planes = [];
    const pad = 0.02;
    if (x < 0.999) { this.clipPlanes[0].constant = mn[0] + (mx[0] - mn[0]) * x + pad; planes.push(this.clipPlanes[0]); }
    if (y < 0.999) { this.clipPlanes[1].constant = mn[1] + (mx[1] - mn[1]) * y + pad; planes.push(this.clipPlanes[1]); }
    if (z < 0.999) { this.clipPlanes[2].constant = mn[2] + (mx[2] - mn[2]) * z + pad; planes.push(this.clipPlanes[2]); }
    this.renderer.clippingPlanes = planes;
  }

  // ---------- picking ----------
  /** pointer: {x,y} in canvas pixels. Returns { mesh, point(world, morphed), distance } or null */
  /**
   * Pick against the merged batches. three.js reports which triangle was hit, and the
   * batch maps that triangle back to its part — so accurate picking needs no duplicate
   * per-part meshes at all.
   */
  pick(px, py) {
    const body = this.body;
    if (!body) return null;
    // The BVH is built on the rest pose, and skinning happens in the vertex shader, so
    // while the body is posed the geometry being raycast is not the geometry on screen.
    // Posed, the GPU is asked instead: it draws the body again, one pixel big, with every
    // part's number in place of its colour.
    // The same goes for a reshaped body: its limbs thicken round their own bones, which a
    // ray walked back through the trunk's shape cannot follow.
    if (this.rig?.enabled.value || !isPlainScale()) return this._gpuPick(px, py);
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const wo = this.raycaster.ray.origin.clone();
    const wd = this.raycaster.ray.direction.clone();

    // The batch geometry is un-morphed, so walk the ray back through the morph instead of
    // deforming four million vertices on the CPU.
    const inv = new THREE.Matrix4().copy(this.bodyRoot.matrixWorld).invert();
    const lo = new THREE.Vector3().copy(wo).applyMatrix4(inv);
    const lp = new THREE.Vector3().copy(wo).addScaledVector(wd, 1).applyMatrix4(inv);
    invertMorph(lo, lo); invertMorph(lp, lp);
    const ld = new THREE.Vector3().subVectors(lp, lo).normalize();

    const local = new THREE.Raycaster(lo, ld, 0, 100);
    local.firstHitOnly = false;               // we may have to skip hidden parts
    let best = null;
    for (const batch of body.batches) {
      if (!batch.mesh.visible) continue;
      const hits = local.intersectObject(batch.mesh, false);
      for (const h of hits) {
        if (h.faceIndex == null) continue;
        const slot = body.partForTriangle(batch, h.faceIndex);
        if (!body.isVisible(slot)) continue;  // ghosted or switched off: see through it
        const wp = applyMorph(h.point, new THREE.Vector3(), { belly: 1, breast: 1 }).applyMatrix4(this.bodyRoot.matrixWorld);
        const dist = wp.distanceTo(wo);
        if (!best || dist < best.distance) best = { slot, part: body.partAt(slot), point: wp, distance: dist };
        break;                                // hits are sorted; first visible one wins
      }
    }
    return best;
  }

  /**
   * Which part is under a pixel, read back from the GPU. It goes through exactly the same
   * morph, skinning and visibility as the picture on screen, so it is right in any pose
   * and at any body size. Only the body is drawn: the bar and the bench are not parts.
   */
  _gpuPick(px, py) {
    const body = this.body, r = this.renderer;
    if (!this._pickRT) {
      this._pickRT = new THREE.WebGLRenderTarget(1, 1);
      this._pickBuf = new Uint8Array(4);
    }
    const hidden = [];
    for (const o of this.scene.children) {
      if (o === this.bodyRoot || o.isLight || !o.visible) continue;
      o.visible = false; hidden.push(o);
    }
    // Opaque and depth-tested, so the nearest visible surface wins whatever order the
    // batches draw in. Blending would mix two part numbers into a third.
    const saved = body.batches.map(b => [b.mesh.material.blending, b.mesh.material.depthWrite]);
    for (const b of body.batches) { b.mesh.material.blending = THREE.NoBlending; b.mesh.material.depthWrite = true; }
    const clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    body.uPick.value = 1;
    this.camera.setViewOffset(this.width, this.height, Math.floor(px), Math.floor(py), 1, 1);
    r.setRenderTarget(this._pickRT);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    r.readRenderTargetPixels(this._pickRT, 0, 0, 1, 1, this._pickBuf);
    r.setRenderTarget(null);
    this.camera.clearViewOffset();
    body.uPick.value = 0;
    r.setClearColor(clear, alpha);
    body.batches.forEach((b, i) => { b.mesh.material.blending = saved[i][0]; b.mesh.material.depthWrite = saved[i][1]; });
    for (const o of hidden) o.visible = true;
    this._dirty = true;

    const [cr, cg, cb] = this._pickBuf;
    const id = cr + cg * 256 + cb * 65536 - 1;
    if (id < 0 || id >= body.count || !body.isVisible(id)) return null;
    return { slot: id, part: body.partAt(id), point: null, distance: 0 };
  }

  // ---------- camera ----------
  /** Pixels of UI chrome covering the canvas, so framing can avoid it. */
  setSafeInsets(insets) { this.safeInsets = insets; }

  /** Free (uncovered) area of the canvas, in pixels. */
  _safeRect() {
    const i = this.safeInsets || { top: 0, bottom: 0, left: 0, right: 0 };
    return {
      x0: i.left, y0: i.top,
      x1: Math.max(i.left + 40, this.width - i.right),
      y1: Math.max(i.top + 40, this.height - i.bottom),
    };
  }

  /** Shift the look-at point so the subject lands in the free area, not behind the panels. */
  _safeOffset(dist, out = new THREE.Vector3()) {
    // A canvas that has not been laid out yet reports a near-zero size, which turns
    // world-per-pixel into a huge number and throws the camera kilometres away. Treat that
    // as "no offset" rather than trusting it.
    if (!(this.width > 50) || !(this.height > 50)) return out.set(0, 0, 0);
    const r = this._safeRect();
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const worldPerPx = (2 * dist * Math.tan(fov / 2)) / this.height;
    const dxPx = cx - this.width / 2, dyPx = cy - this.height / 2;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return out.set(0, 0, 0)
      .addScaledVector(right, -dxPx * worldPerPx)
      .addScaledVector(up, dyPx * worldPerPx);
  }

  /** Smoothly frame a Box3 (in morphed world space), fitting it into the uncovered area. */
  focusBox(box, { duration = 0.8, pad = 1.25, keepDir = true } = {}) {
    if (!box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const r = this._safeRect();
    // Fit the box's real extents into the uncovered fraction of the frame,
    // vertically and horizontally, instead of its (much larger) bounding sphere.
    const halfH = Math.max(size.y / 2, 0.01);
    const halfW = Math.max(Math.max(size.x, size.z) / 2, 0.01);
    const tanV = Math.tan(fov / 2);
    const tanH = tanV * this.camera.aspect;
    // The canvas can legitimately be 0×0 (pane hidden, tab in the background, panel
    // mid-collapse). Dividing by that yields NaN — and Math.max(0.25, NaN) is NaN, not
    // 0.25 — which would poison the camera permanently and black out the scene.
    const frac = (span, total) => (total > 0 ? Math.max(0.25, span / total) : 1);
    const safeH = frac(r.y1 - r.y0, this.height);
    const safeW = frac(r.x1 - r.x0, this.width);
    const dist = Math.max((halfH * pad) / (tanV * safeH), (halfW * pad) / (tanH * safeW)) + halfW;
    if (!Number.isFinite(dist)) return;
    const dir = keepDir ? this.camera.position.clone().sub(this.controls.target).normalize() : new THREE.Vector3(0.2, 0.15, 1).normalize();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 1e-9) dir.set(0.2, 0.15, 1).normalize();
    const target = center.clone().add(this._safeOffset(dist));
    const to = target.clone().addScaledVector(dir, dist);
    this.tweenCamera(to, target, duration);
  }

  tweenCamera(toPos, toTarget, duration = 0.8) {
    if (!finiteVec(toPos) || !finiteVec(toTarget)) return;   // never tween into NaN
    if (!finiteVec(this.camera.position) || !finiteVec(this.controls.target)) this._recoverCamera();
    this._tween = { t: 0, duration, fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: toPos.clone(), toTarget: toTarget.clone() };
  }

  /** Put the camera back somewhere sane after it has been corrupted. */
  _recoverCamera() {
    this._tween = null;
    this.camera.position.set(0.35, 1.05, 3.9);
    this.camera.quaternion.identity();
    this.camera.updateProjectionMatrix();
    this._makeControls();          // drops any NaN left in the controls' internal state
  }

  _stepTween(dt) {
    const tw = this._tween;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.duration);
    const e = 1 - Math.pow(1 - k, 3);
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (k >= 1) this._tween = null;
  }

  view(name, center = null, dist = null) {
    const c = center || this.controls.target.clone();
    const d = dist || this.camera.position.distanceTo(this.controls.target);
    const dirs = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0], top: [0, 1, 0.0001], iso: [0.6, 0.25, 0.75] };
    const v = new THREE.Vector3(...(dirs[name] || dirs.front)).normalize();
    this.tweenCamera(c.clone().addScaledVector(v, d), c, 0.7);
  }

  resetView(height = 1.74) {
    const box = new THREE.Box3(new THREE.Vector3(-height * 0.19, 0, -height * 0.12),
                               new THREE.Vector3(height * 0.19, height, height * 0.12));
    this.focusBox(box, { pad: 1.06, keepDir: false, duration: 0.8 });
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** world → screen px */
  project(v, out = { x: 0, y: 0, z: 0 }) {
    const p = v.clone().project(this.camera);
    out.x = (p.x + 1) / 2 * this.width; out.y = (1 - p.y) / 2 * this.height; out.z = p.z;
    return out;
  }
}
