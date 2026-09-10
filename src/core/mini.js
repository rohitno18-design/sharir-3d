import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Small standalone 3D viewer for molecules and tissue/cell models inside panels. */
export class MiniViewer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    this.camera.position.set(0, 0.6, 3);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 1.2; this.controls.enablePan = false;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2, 3, 4);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.8); fill.position.set(-3, 1, -2);
    this.scene.add(key, fill, new THREE.HemisphereLight(0xffffff, 0x333333, 0.5));
    this.content = null;
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(container);
    this.resize();
    this.alive = true;
    const loop = () => { if (!this.alive) return; requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    requestAnimationFrame(loop);
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  show(group, { fit = 1.15 } = {}) {
    if (this.content) { this.scene.remove(this.content); disposeGroup(this.content); }
    this.content = group; this.scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3()); const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    group.position.sub(c);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const d = (r * fit) / Math.sin(fov / 2);
    this.camera.position.set(d * 0.35, d * 0.3, d * 0.9); this.controls.target.set(0, 0, 0);
    this.camera.near = d / 100; this.camera.far = d * 20; this.camera.updateProjectionMatrix();
  }
  dispose() { this.alive = false; this._ro.disconnect(); if (this.content) disposeGroup(this.content); this.renderer.dispose(); this.canvas.remove(); }
}

function disposeGroup(g) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } }); }
