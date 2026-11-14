import { state } from '../core/state.js';

/**
 * How much muscle shows through the skin, as the screen draws it.
 *
 * Skin and muscle are both drawn solid, and the picture of part numbers the app uses for
 * picking (Viewer._refreshIds) is read from a few camera positions round each shoulder.
 * Every pixel whose nearest surface is a muscle is a place where the skin has torn or the
 * muscle has come out through it. Returned per view, as a share of the pixels the body
 * covers, so a closer or further camera does not change it.
 *
 * Exactly what the user sees, including anything the shader does after posing, which a
 * check on the CPU would miss.
 */
const VIEWS = [
  ['front', [0.75, 1.35, 0.75], [0.15, 1.35, 0.0]],
  ['side', [1.1, 1.2, 0.0], [0.15, 1.35, 0.0]],
  ['back', [0.8, 1.35, -0.8], [0.15, 1.35, 0.0]],
  ['below', [0.55, 0.95, 0.15], [0.17, 1.45, 0.0]],
];

export function muscleShowing(app, { views = VIEWS, both = true, byPart = null } = {}) {
  const v = app.viewer, body = app.body;
  const keepCam = { p: v.camera.position.clone(), t: v.controls.target.clone() };
  const keepOv = state.sysOverride;
  app.showOnlySystems(['integumentary', 'muscular']);
  state.sysOverride.integumentary = { visible: true, opacity: 1 };
  app.hi.applyAll();
  const out = {};
  for (const [name, p, t] of views) {
    for (const s of both ? [1, -1] : [1]) {
      v.camera.position.set(p[0] * s, p[1], p[2]); v.controls.target.set(t[0] * s, t[1], t[2]);
      v.camera.lookAt(v.controls.target); v.camera.updateMatrixWorld();
      v._idsAt = 0; v.invalidateIds(); v._refreshIds();
      const m = v._ids;
      let skin = 0, muscle = 0;
      for (let i = 0; i < m.px.length; i += 4) {
        const id = m.px[i] + m.px[i + 1] * 256 + m.px[i + 2] * 65536 - 1;
        if (id < 0) continue;
        const sys = body.parts[id]?.sys;
        if (sys === 'integumentary') skin++; else if (sys === 'muscular') { muscle++; if (byPart) { const nm = body.parts[id].n; byPart[nm] = (byPart[nm] || 0) + 1; } }
      }
      out[name] = (out[name] || 0) + muscle / Math.max(1, skin + muscle) / (both ? 2 : 1);
    }
  }
  state.sysOverride = keepOv;
  app.hi.invalidate();
  v.camera.position.copy(keepCam.p); v.controls.target.copy(keepCam.t); v.camera.lookAt(v.controls.target);
  for (const k of Object.keys(out)) out[k] = +(out[k] * 100).toFixed(2);
  out.total = +Object.values(out).reduce((a, b) => a + b, 0).toFixed(2);
  return out;
}
