import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SYSTEMS } from '../data/systems.js';

const finiteVec = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

export const BODY_CENTER = new THREE.Vector3(0, 0.9, 0);

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._ratio = this.renderer.getPixelRatio();
    // Not under an automated browser: the gates photograph the body and must always get full sharpness.
    this.adaptive = !navigator.webdriver;
    // The graphics chip can be reset under the page (the laptop sleeps, the driver
    // restarts, too many tabs). Left alone the canvas stays blank until a reload: the body
    // has "disappeared". Asking to keep the page and drawing again when it returns is all
    // it takes; the renderer uploads everything afresh by itself.
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this._lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this._lost = false; this._ids = null; this._idRT?.dispose(); this._idRT = null; this._dirty = true; });
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
    this.applyTheme(document.documentElement.dataset.theme || 'light');

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
    // Scroll zooms towards whatever is under the mouse, not into the middle of the body.
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => { this._dirty = true; });
    this._bindCursorZoom();
  }

  /**
   * Zooming to the cursor moves the camera along the line under the mouse, so what is under
   * the mouse stays there. How far each notch moves is a share of the distance to the orbit
   * centre, though, and that centre sits deep in the body: zooming in on the face took steps
   * sized for the middle of the chest and went straight through the skin. So at the start of
   * each scroll the centre is moved to the depth of the surface actually under the mouse.
   * Every notch then covers a share of the real distance, the camera slows as it arrives,
   * and turning afterwards turns round what was zoomed into.
   */
  _bindCursorZoom() {
    if (this._wheelBound) return;
    this._wheelBound = true;
    let last = 0, lx = -1e9, ly = -1e9;
    // Captured on the stage, so it runs before the controls handle the same wheel event.
    this.canvas.parentElement.addEventListener('wheel', (e) => {
      if (e.target !== this.canvas || !this.controls.enabled || !this.body) return;
      this._tween = null;                         // a scroll takes over from any camera move
      const now = performance.now();
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // One look per scroll gesture, or when the mouse has moved, not one per notch.
      const fresh = now - last > 160 || Math.abs(px - lx) > 4 || Math.abs(py - ly) > 4;
      last = now;
      if (!fresh) return;
      lx = px; ly = py;
      const hit = this.surfaceAt(px, py);
      if (!hit) return;                           // empty space: zoom as before
      const fwd = this.camera.getWorldDirection(new THREE.Vector3());
      const depth = hit.clone().sub(this.camera.position).dot(fwd);
      if (!(depth > this.controls.minDistance)) return;
      this.controls.target.copy(this.camera.position).addScaledVector(fwd, depth);
    }, { capture: true, passive: true });
  }

  /**
   * The floor the body stands on follows the page. A near-black disc read as a hole in a
   * light grey stage, so on light it becomes a soft shadow, and the ring a deeper gold.
   */
  applyTheme(theme) {
    const light = theme === 'light';
    this.ground.material.color.set(light ? 0x8e97a3 : 0x0f1216);
    this.ground.material.opacity = light ? 0.35 : 0.9;
    this.ring.material.color.set(light ? 0xb08a2e : 0xe9c95c);
    this.ring.material.opacity = light ? 0.6 : 0.35;
    this._dirty = true;
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
    if (this._dirty && !this._lost) { this.renderer.render(this.scene, this.camera); this._dirty = false; drew = true; this._idsStale = true; }
    this._pace(drew);
    if (this._afterCbs) for (const cb of this._afterCbs) cb(drew, t);
  }

  /**
   * Keep movement smooth by drawing fewer pixels while things move.
   *
   * On a laptop's built-in graphics a full-sharpness frame of the whole body can take
   * longer than the screen's refresh, so turning the body or playing a lift stutters. While
   * frames are coming late the picture is drawn a step less sharp, which nobody sees on a
   * moving body, and the moment it stops it is drawn once more at full sharpness. If a
   * step down does not make frames come sooner (the time is going somewhere pixels do not
   * touch), it is taken back and left alone.
   */
  _pace(drew) {
    if (this._held != null || !this.adaptive) return;
    const now = performance.now(), full = Math.min(window.devicePixelRatio || 1, 2);
    if (!drew) {
      if (this._ratio < full && now - (this._drawnAt || 0) > 220) { this._setRatio(full); this._gap = 0; this._noGain = false; }
      return;
    }
    const since = now - (this._drawnAt || 0);
    this._drawnAt = now;
    if (since > 150) { this._gap = 0; this._run = 0; return; }       // first frame after a rest
    this._gap = this._gap ? this._gap * 0.85 + since * 0.15 : since;
    this._run = (this._run || 0) + 1;
    if (this._run < 12 || now - (this._ratioAt || 0) < 500) return;
    if (this._tried) {
      // Did the last step down buy anything?
      const t = this._tried; this._tried = null;
      if (this._gap > t.gap * 0.9) { this._noGain = true; this._setRatio(t.from); return; }
    }
    const floor = Math.max(0.7, full * 0.5);
    if (!this._noGain && this._gap > 24 && this._ratio > floor + 0.01) {
      this._tried = { gap: this._gap, from: this._ratio };
      this._setRatio(Math.max(floor, this._ratio * 0.8));
    }
  }

  _setRatio(r) {
    if (Math.abs(r - this._ratio) < 0.005) return;
    this._ratio = r; this._ratioAt = performance.now();
    this.renderer.setPixelRatio(r);
    this._dirty = true;
  }

  /** Draw at exactly this sharpness until released with null. Film mode sets the video's own. */
  holdResolution(ratio) {
    this._held = ratio;
    this._tried = null; this._noGain = false;
    this._setRatio(ratio ?? Math.min(window.devicePixelRatio || 1, 2));
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
  /**
   * Which part is under a pixel.
   *
   * The body is drawn once more into a hidden picture, half the size of the screen, with
   * each part's number in place of its colour, and that picture is copied to memory. After
   * that, asking what is under the mouse is reading one number: it costs nothing, however
   * fast the mouse moves. The picture is only drawn again when what is on screen has
   * changed (the camera moved, a part was hidden, the body was posed), and then only when
   * something actually asks.
   *
   * It goes through exactly the same shaping, posing and visibility as the picture on
   * screen, so it is right in any pose and at any body size.
   *
   * It used to be asked afresh on every movement of the mouse: the whole body drawn for
   * one pixel and the page held up until the graphics chip answered, 50 to 90 ms each
   * time, up to fifteen times a second. That was most of what made the app feel stuck. A
   * second way of picking, a ray traced through a tree built over every triangle at load,
   * only worked for an unposed, unshaped body, which is never what is on screen; it and
   * its tree are gone.
   *
   * @returns { slot, part } or null
   */
  pick(px, py) {
    const slot = this.partAt(px, py);
    return slot == null ? null : { slot, part: this.body.partAt(slot), point: null, distance: 0 };
  }

  /** The slot of the part under a pixel, or null. */
  partAt(px, py) {
    const body = this.body;
    if (!body || !(this.width > 1) || !(this.height > 1)) return null;
    this._refreshIds();
    const m = this._ids;
    if (!m) return null;
    const x = Math.min(m.w - 1, Math.max(0, Math.floor(px / this.width * m.w)));
    const y = Math.min(m.h - 1, Math.max(0, Math.floor((1 - py / this.height) * m.h)));
    const i = (y * m.w + x) * 4;
    const id = m.px[i] + m.px[i + 1] * 256 + m.px[i + 2] * 65536 - 1;
    return id < 0 || id >= body.count || !body.isVisible(id) ? null : id;
  }

  /** How much of the view the body covers, 0 to 1, and how many different parts are in it. */
  coverage() {
    this._refreshIds();
    const m = this._ids;
    if (!m) return { share: 0, parts: 0 };
    const seen = new Set();
    let n = 0;
    for (let i = 0; i < m.px.length; i += 4) {
      const id = m.px[i] + m.px[i + 1] * 256 + m.px[i + 2] * 65536;
      if (id) { n++; seen.add(id); }
    }
    return { share: n / (m.w * m.h), parts: seen.size };
  }

  /** Compile and draw everything once, so nothing is left to compile at the first interaction. */
  warm() {
    if (!this.body) return;
    this.renderer.render(this.scene, this.camera);
    this._idsStale = true; this._idsAt = 0;
    this._refreshIds();
    this._dirty = true;
  }

  /** What is on screen has changed: the picture of part numbers is out of date. */
  invalidateIds() { this._idsStale = true; }

  _refreshIds() {
    if (this._ids && !this._idsStale) return;
    // While something is moving every frame (a lift playing, the camera turning), draw it
    // again at most eight times a second: a hover that is a tenth of a second behind a
    // moving body is not noticed, and a second full draw on every frame would be.
    const now = performance.now();
    if (this._ids && now - (this._idsAt || 0) < 120) return;
    const w = Math.max(2, Math.round(this.width / 2)), h = Math.max(2, Math.round(this.height / 2));
    if (!this._idRT || this._idRT.width !== w || this._idRT.height !== h) {
      this._idRT?.dispose();
      this._idRT = new THREE.WebGLRenderTarget(w, h);
      this._ids = { w, h, px: new Uint8Array(w * h * 4) };
    }
    this._drawPick(1, this._idRT);
    this.renderer.readRenderTargetPixels(this._idRT, 0, 0, w, h, this._ids.px);
    this.renderer.setRenderTarget(null);
    this._idsStale = false;
    this._idsAt = now;
  }

  /**
   * The world point of the body surface under a pixel, or null over empty space. Asked
   * once at the start of a scroll, so it is drawn for that one pixel when wanted.
   */
  surfaceAt(px, py) {
    const body = this.body;
    if (!body || this.partAt(px, py) == null) return null;
    if (!this._pickRT) { this._pickRT = new THREE.WebGLRenderTarget(1, 1); this._pickBuf = new Uint8Array(4); }
    this.camera.setViewOffset(this.width, this.height, Math.floor(px), Math.floor(py), 1, 1);
    this._drawPick(2, this._pickRT);
    this.renderer.readRenderTargetPixels(this._pickRT, 0, 0, 1, 1, this._pickBuf);
    this.renderer.setRenderTarget(null);
    this.camera.clearViewOffset();
    const [r, g, b, a] = this._pickBuf;
    if (!a) return null;
    const z = r / 255 + g / 65025 + b / 16581375;
    return new THREE.Vector3((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1, z * 2 - 1).unproject(this.camera);
  }

  /**
   * Draw only the body into `target`, with numbers in place of colours. Mode 1 writes
   * which part is there, mode 2 how deep it is. The bar and the bench are not parts.
   */
  _drawPick(mode, target) {
    const body = this.body, r = this.renderer;
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
    body.uPick.value = mode;
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    body.uPick.value = 0;
    r.setClearColor(clear, alpha);
    body.batches.forEach((b, i) => { b.mesh.material.blending = saved[i][0]; b.mesh.material.depthWrite = saved[i][1]; });
    for (const o of hidden) o.visible = true;
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

  /**
   * The body has changed height by a factor `k`. The camera and what it looks at are moved
   * by the same factor about the floor under the body, so it keeps looking at the same
   * place on the body. Left where it was, a camera close on an adult's face was looking
   * at empty air once the body became a child's, and the body seemed to have gone.
   */
  rescale(k) {
    if (!(k > 0) || !Number.isFinite(k) || Math.abs(k - 1) < 1e-4) return;
    this.camera.position.multiplyScalar(k);
    this.controls.target.multiplyScalar(k);
    if (this._tween) for (const key of ['fromPos', 'fromTarget', 'toPos', 'toTarget']) this._tween[key].multiplyScalar(k);
    this._dirty = true;
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
