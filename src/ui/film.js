import * as THREE from 'three';
import { el } from '../core/util.js';
import { effortColor, phaseName } from './exercisePanel.js';

/**
 * Film mode: turn the Movement view into a clean shot and record it as a video.
 *
 * Everything that is not the lift goes away, and the stage takes the shape of the video:
 * a 9:16 reel, a square post or a 16:9 clip. What is on screen is drawn onto one canvas
 * together with the captions, and that same canvas is what the recorder films, so the
 * preview and the file cannot disagree.
 *
 * Nothing is saved on its own. When a take finishes, a Save button appears and the user
 * decides whether to keep it.
 */
const FORMATS = {
  reel:   { label: 'Reel 9:16',  w: 1080, h: 1920 },
  square: { label: 'Square 1:1', w: 1080, h: 1080 },
  wide:   { label: 'Wide 16:9',  w: 1920, h: 1080 },
};

/** Recording formats in order of preference. MP4 plays everywhere, including Instagram. */
const MIME = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** How far the camera swings across a take when "Slow turn" is on, either side of centre. */
const TURN = THREE.MathUtils.degToRad(11);

export class Film {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.format = 'reel';
    this.captions = true;
    this.turn = true;
    this.reps = 2;
    this.slow = false;
    this.recorder = null;
    this.result = null;
    this._onKey = (e) => { if (e.key === 'Escape') { if (this.recorder || this.rendering) this.stop(); else this.exit(); } };
    this._onResize = () => { if (this.active) this.layout(); };
  }

  get player() { return this.app.exercise; }

  enter() {
    if (this.active || !this.player?.ex) return;
    this.active = true;
    const v = this.app.viewer;
    this._saved = { pixelRatio: v.renderer.getPixelRatio(), speed: this.player.speed };
    document.body.classList.add('film');
    this.app.hi.setHover(null);
    this._labelsWere = this.app.labels.visible;
    this.app.labels.visible = false;
    this.canvas = el('canvas', { class: 'film-canvas' });
    this.ctx = this.canvas.getContext('2d');
    document.getElementById('stage').append(this.canvas);
    this.bar = el('div', { class: 'film-bar' });
    document.getElementById('app').append(this.bar);
    this.renderBar();
    this.layout();
    this.player.pause();
    this.player.seek(0.62);
    this._offDraw = v.onAfterRender((drew, t) => this.draw(t));
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    document.fonts?.load('800 64px Manrope').then(() => v.requestRender());
  }

  exit() {
    if (!this.active) return;
    if (this.recorder || this.rendering) this.stop(true);
    this.active = false;
    const v = this.app.viewer;
    this._offDraw?.();
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    this.discard();
    this.canvas?.remove(); this.bar?.remove();
    this.canvas = this.bar = null;
    const stage = document.getElementById('stage');
    stage.style.cssText = '';
    document.body.classList.remove('film');
    this.app.labels.visible = this._labelsWere;
    v.renderer.setPixelRatio(this._saved.pixelRatio);
    this.player.speed = this._saved.speed;
    v.resize();
    this.app.updateSafeInsets();
    this.player.autoFrame = true;
    this.player.scheduleFrame(120);
  }

  /** Shape the stage like the video, as large as the window allows, under the film bar. */
  layout() {
    const f = FORMATS[this.format];
    const aspect = f.w / f.h;
    const top = (this.bar?.offsetHeight || 52) + 24;
    // Never smaller than a usable preview, however short the window is.
    let h = Math.max(200, window.innerHeight - top - 16);
    let w = h * aspect;
    const maxW = Math.max(120, window.innerWidth - 32);
    if (w > maxW) { w = maxW; h = w / aspect; }
    w = Math.floor(w); h = Math.floor(h);
    const stage = document.getElementById('stage');
    Object.assign(stage.style, {
      inset: 'auto', left: `${Math.round((window.innerWidth - w) / 2)}px`, top: `${top}px`,
      width: `${w}px`, height: `${h}px`,
    });
    // Draw the 3D at the video's own resolution, so the file is sharp and not a
    // stretched copy of a small preview.
    const v = this.app.viewer;
    v.renderer.setPixelRatio(Math.min(4, Math.max(0.5, f.w / w)));
    v.resize();
    this.canvas.width = f.w; this.canvas.height = f.h;
    this._reserve = null; this._reserveKey = null;
    this.app.updateSafeInsets();
    this.player.autoFrame = true;
    this.player.scheduleFrame(80);
    v.requestRender();
  }

  // ---------- the picture ----------
  draw(t) {
    if (!this.canvas) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#171b21'); g.addColorStop(0.55, '#0c0e12'); g.addColorStop(1, '#07080a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.app.viewer.canvas, 0, 0, W, H);
    if (this.captions) this.drawCaptions(ctx, W, H);
    if (this.recorder) this.stepTurn();
  }

  drawCaptions(ctx, W, H) {
    const p = this.player;
    if (!p?.ex) return;
    // A tall frame stacks everything down the left. A square or wide frame puts the moment
    // of the rep bottom left and the muscles bottom right, or the text would cover half
    // of a square picture.
    const cols = W >= H;
    // One unit is a pixel of a 1080-high or -wide frame. A square frame has the least room
    // around the lift, so its text runs a little smaller.
    const u = ((cols ? H : W) / 1080) * (W === H ? 0.86 : 1);
    const pad = 64 * u;
    const phase = phaseName(p.t);
    const colW = cols ? W * 0.5 - pad * 1.5 : W - pad * 2;
    const hintFont = `500 ${32 * u}px Inter, sans-serif`;
    const hintLines = wrap(ctx, phase.hint, colW, hintFont);
    const top3 = p.ranked().slice(0, 3);

    // Lay the bottom block out from the bottom edge up, then paint it.
    const hintY = H - pad - (hintLines.length - 1) * 44 * u;
    const phaseY = hintY - 58 * u;
    const barW = cols ? Math.min(560 * u, W * 0.42) : W - pad * 2;
    const barX = cols ? W - pad - barW : pad;
    const rowH = 92 * u;
    const firstBarY = cols ? H - pad - 30 * u - (top3.length - 1) * rowH : phaseY - 96 * u - (top3.length - 1) * rowH;
    const blockTop = Math.min(phaseY - 60 * u, firstBarY - 40 * u);
    const titleBottom = pad + 180 * u;
    this._reserve = { top: titleBottom / H, bottom: (H - blockTop) / H };

    // Soft dark bands behind the text, so it reads over bright muscle and over steel.
    const band = (y0, y1, down) => {
      const gr = ctx.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(down ? 0 : 1, 'rgba(5,6,8,0.8)'); gr.addColorStop(down ? 1 : 0, 'rgba(5,6,8,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, y0, W, y1 - y0);
    };
    band(0, titleBottom + 90 * u, true);
    band(blockTop - 90 * u, H, false);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e9c95c';
    ctx.font = `800 ${26 * u}px Manrope, sans-serif`;
    spaced(ctx, 'SHARIR 3D  ·  MOVEMENT', pad, pad + 26 * u, 4 * u);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${66 * u}px Manrope, sans-serif`;
    ctx.fillText(p.ex.name, pad, pad + 108 * u);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = `500 ${30 * u}px Inter, sans-serif`;
    ctx.fillText('What every muscle does in one rep', pad, pad + 156 * u);

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${60 * u}px Manrope, sans-serif`;
    ctx.fillText(phase.name, pad, phaseY);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = hintFont;
    hintLines.forEach((line, i) => ctx.fillText(line, pad, hintY + i * 44 * u));

    let by = firstBarY;
    for (const gr of top3) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${31 * u}px Manrope, sans-serif`;
      ctx.fillText(gr.def.label, barX, by);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `600 ${27 * u}px "JetBrains Mono", monospace`;
      const pct = `${Math.round(gr.effort * 100)}%`;
      ctx.fillText(pct, barX + barW - ctx.measureText(pct).width, by);
      const ty = by + 18 * u, th = 12 * u;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      round(ctx, barX, ty, barW, th, th / 2); ctx.fill();
      ctx.fillStyle = effortColor(gr.effort);
      round(ctx, barX, ty, Math.max(th, barW * gr.effort), th, th / 2); ctx.fill();
      by += rowH;
    }
    // The first frame is the first time the real caption sizes are known; frame the lift
    // again between them if they differ from the estimate.
    const key = `${this.format}|${this._reserve.top.toFixed(2)}|${this._reserve.bottom.toFixed(2)}`;
    if (key !== this._reserveKey) { this._reserveKey = key; if (!this.recorder) this.app.updateSafeInsets(); }
  }

  /**
   * How much of the stage the captions cover, in stage pixels, so the camera frames the
   * lifter in the clear space between the title and the bottom block.
   */
  safeInsets() {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const est = this.format === 'reel' ? { top: 0.13, bottom: 0.33 } : { top: 0.24, bottom: 0.33 };
    const r = this.captions ? (this._reserve || est) : { top: 0.04, bottom: 0.04 };
    return { top: r.top * stage.height, bottom: r.bottom * stage.height, left: stage.width * 0.04, right: stage.width * 0.04 };
  }

  /** Sweep the camera slowly round the lift across the take, for a little life in the shot. */
  stepTurn() {
    if (!this.turn || !this._orbit) return;
    const v = this.app.viewer;
    const k = Math.min(1, (performance.now() - this._orbit.start) / this._orbit.ms);
    const a = (k - 0.5) * 2 * TURN;
    const off = this._orbit.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    v.camera.position.copy(v.controls.target).add(off);
    v.camera.lookAt(v.controls.target);
    v.requestRender();
  }

  // ---------- recording ----------
  /**
   * Record a take. The first choice renders the video one frame at a time and encodes
   * each frame as it goes (WebCodecs H.264 into an MP4). Every frame is placed at an exact
   * moment of the rep, so the file plays at a smooth 30 frames a second however fast or
   * slow this computer draws, and even if the tab is left in the background. A browser
   * without WebCodecs films the screen in real time instead.
   */
  async record() {
    if (this.recorder || this.rendering || !this.canvas) return;
    const f = FORMATS[this.format];
    let mb = null;
    try {
      mb = await import('mediabunny');
      if (!(await mb.canEncodeVideo('avc', { width: f.w, height: f.h }))) mb = null;
    } catch { mb = null; }
    if (mb) return this.renderFrames(mb);
    return this.recordRealtime();
  }

  async renderFrames(mb) {
    this.discard();
    const p = this.player, v = this.app.viewer;
    p.pause();
    p.speed = this.slow ? 0.5 : 1;
    const fps = 30, hold = 0.6, tail = 0.35;
    const repSecs = (p.ex.duration / p.speed) * this.reps;
    const frames = Math.round((hold + repSecs + tail) * fps);
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const source = new mb.CanvasSource(this.canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();

    this.rendering = { done: 0, frames, cancel: false };
    v.controls.enabled = false;
    settleCamera(v);
    const offset = v.camera.position.clone().sub(v.controls.target);
    const up = new THREE.Vector3(0, 1, 0);
    this.renderBar();
    try {
      for (let i = 0; i < frames && !this.rendering.cancel; i++) {
        const ts = i / fps;
        // Rep time: hold at lockout, then the reps, then hold again at the top.
        const reps = (Math.max(0, Math.min(repSecs, ts - hold)) * p.speed) / p.ex.duration;
        p.seek(reps >= this.reps ? 0 : reps % 1);
        if (this.turn) {
          const a = (i / Math.max(1, frames - 1) - 0.5) * 2 * TURN;
          v.camera.position.copy(v.controls.target).add(offset.clone().applyAxisAngle(up, a));
          v.camera.lookAt(v.controls.target);
        }
        // Muscle colour normally reaches the GPU on the next screen frame. A rendered
        // frame does not wait for one, so push this frame's effort values now.
        this.app.hi.tick(ts);
        v.renderer.render(v.scene, v.camera);
        this.draw();
        await source.add(ts, 1 / fps);
        if (i % 4 === 0) { this.rendering.done = i; this.renderBar(); await yieldToPage(); }
      }
      if (this.rendering.cancel) { await output.cancel(); return; }
      await output.finalize();
      const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
      this.result = { blob, url: URL.createObjectURL(blob), ext: 'mp4', secs: frames / fps };
    } catch (err) {
      console.error('[film] render failed', err);
      this._msg = 'The video could not be made on this computer. Try the real-time recorder in Chrome.';
    } finally {
      v.camera.position.copy(v.controls.target).add(offset);
      v.camera.lookAt(v.controls.target);
      v.controls.enabled = true;
      this.rendering = null;
      p.seek(0.62);
      this.renderBar();
    }
  }

  recordRealtime() {
    if (this.recorder || !this.canvas) return;
    if (typeof MediaRecorder === 'undefined' || !this.canvas.captureStream) {
      this.message('This browser cannot record video. Chrome or Edge on a computer can.');
      return;
    }
    this.discard();
    const mime = MIME.find(m => MediaRecorder.isTypeSupported(m)) || '';
    const stream = this.canvas.captureStream(30);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(tr => tr.stop());
      if (this._cancelled) { this._cancelled = false; return; }
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      this.result = { blob, url: URL.createObjectURL(blob), ext: type.includes('mp4') ? 'mp4' : 'webm', secs: this._takeSecs };
      this.renderBar();
    };

    const p = this.player, v = this.app.viewer;
    p.pause();
    p.speed = this.slow ? 0.5 : 1;
    p.seek(0);                                    // the bar starts locked out, at the top
    const hold = 600, tail = 350;
    const repMs = (p.ex.duration / p.speed) * 1000 * this.reps;
    this._takeSecs = (hold + repMs + tail) / 1000;
    v.controls.enabled = false;
    settleCamera(v);
    this._orbit = { start: performance.now(), ms: hold + repMs + tail, offset: v.camera.position.clone().sub(v.controls.target) };
    this.recorder = rec;
    rec.start(250);
    this._startedAt = performance.now();
    this._playT = setTimeout(() => p.play(), hold);
    this._stopT = setTimeout(() => this.stop(), hold + repMs + tail);
    this._clockT = setInterval(() => this.renderBar(), 250);
    this.renderBar();
  }

  /** Finish the take. `cancel` throws it away instead of offering it. */
  stop(cancel = false) {
    if (this.rendering) { this.rendering.cancel = true; return; }
    const rec = this.recorder;
    if (!rec) return;
    clearTimeout(this._playT); clearTimeout(this._stopT); clearInterval(this._clockT);
    this.recorder = null;
    this._cancelled = cancel;
    this.player.pause();
    if (this._orbit) {
      // Leave the camera where the take started, not wherever the sweep ended.
      const v = this.app.viewer;
      v.camera.position.copy(v.controls.target).add(this._orbit.offset);
      v.camera.lookAt(v.controls.target);
      this._orbit = null;
    }
    this.app.viewer.controls.enabled = true;
    if (rec.state !== 'inactive') rec.stop();
    this.renderBar();
  }

  discard() {
    if (this.result) URL.revokeObjectURL(this.result.url);
    this.result = null;
    if (this.bar) this.renderBar();
  }

  message(text) { this._msg = text; this.renderBar(); }

  // ---------- controls ----------
  renderBar() {
    const bar = this.bar;
    if (!bar) return;
    bar.innerHTML = '';
    if (this.rendering) {
      const pct = Math.round((this.rendering.done / this.rendering.frames) * 100);
      bar.append(
        el('span', { class: 'film-rec' }, el('i', { class: 'film-dot' }), `Making your video  ${pct}%`),
        el('button', { class: 'btn sm', onClick: () => this.stop() }, 'Cancel'),
      );
      return;
    }
    if (this.recorder) {
      const secs = (performance.now() - this._startedAt) / 1000;
      bar.append(
        el('span', { class: 'film-rec' }, el('i', { class: 'film-dot' }), `Recording  ${fmt(secs)} / ${fmt(this._takeSecs)}`),
        el('button', { class: 'btn sm', onClick: () => this.stop() }, '■ Stop'),
      );
      return;
    }
    if (this.result) {
      const mb = (this.result.blob.size / 1048576).toFixed(1);
      const name = `sharir-${this.player.ex.id}-${this.format}.${this.result.ext}`;
      bar.append(
        el('span', { class: 'film-note' }, `Your video is ready. ${fmt(this.result.secs)}, ${mb} MB.`),
        el('a', { class: 'btn sm primary', href: this.result.url, download: name }, '⤓ Save video'),
        el('button', { class: 'btn sm', onClick: () => this.record() }, '● Record again'),
        el('button', { class: 'btn sm', onClick: () => this.discard() }, 'Discard'),
      );
      return;
    }
    const seg = (items, cur, pick) => el('div', { class: 'seg' },
      ...items.map(([k, label]) => el('button', { class: k === cur ? 'active' : '', onClick: () => pick(k) }, label)));
    bar.append(
      seg(Object.entries(FORMATS).map(([k, f]) => [k, f.label]), this.format, (k) => { this.format = k; this.renderBar(); this.layout(); }),
      seg([[1, '1 rep'], [2, '2 reps'], [3, '3 reps']], this.reps, (k) => { this.reps = k; this.renderBar(); }),
      el('button', { class: 'chip' + (this.slow ? ' active' : ''), onClick: () => { this.slow = !this.slow; this.renderBar(); } }, 'Slow motion'),
      el('button', { class: 'chip' + (this.turn ? ' active' : ''), onClick: () => { this.turn = !this.turn; this.renderBar(); } }, 'Slow turn'),
      el('button', { class: 'chip' + (this.captions ? ' active' : ''), onClick: () => { this.captions = !this.captions; this.renderBar(); this.app.updateSafeInsets(); this.app.viewer.requestRender(); } }, 'Captions'),
      el('button', { class: 'btn sm film-go', onClick: () => this.record() }, '● Record'),
      el('button', { class: 'btn sm', onClick: () => this.exit() }, 'Done'),
    );
    if (this._msg) { bar.append(el('span', { class: 'film-note' }, this._msg)); this._msg = null; }
  }
}

// ---------- helpers ----------
/**
 * Let the page breathe between frames. Not setTimeout: a hidden tab slows timers to one
 * a second or even one a minute, which stalled a render the moment the user looked away.
 * A message on a channel is not held back like that.
 */
const _yield = new MessageChannel();
const _waiting = [];
_yield.port1.onmessage = () => { const r = _waiting.shift(); if (r) r(); };
function yieldToPage() { return new Promise(r => { _waiting.push(r); _yield.port2.postMessage(0); }); }

/** Finish any camera glide at once, so a take starts from the framing the user sees. */
function settleCamera(v) {
  if (!v._tween) return;
  v.camera.position.copy(v._tween.toPos);
  v.controls.target.copy(v._tween.toTarget);
  v.camera.lookAt(v.controls.target);
  v._tween = null;
}

function wrap(ctx, text, maxW, font) {
  ctx.font = font;
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Letter-spaced text, drawn a glyph at a time: canvas letterSpacing is not everywhere yet. */
function spaced(ctx, text, x, y, gap) {
  for (const ch of text) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + gap; }
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function fmt(s) { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
