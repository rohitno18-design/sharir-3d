import { el } from '../core/util.js';
import { effortColor, phaseName } from './exercisePanel.js';
import { buildTake, sampleTake, fatigueAt, workShares, cameraOffset, PACES, REP_CHOICES, CAMERAS } from './filmTake.js';

/**
 * Film mode: turn the Movement view into a clean shot and record it as a video.
 *
 * Everything that is not the lift goes away, and the stage takes the shape of the video:
 * a 9:16 reel, a square post or a 16:9 clip. What is on screen is drawn onto one canvas
 * together with the captions, and that same canvas is what the recorder films, so the
 * preview and the file cannot disagree.
 *
 * A take is a whole set: one rep or twenty, each phase held long enough to read, the
 * muscles working harder and tiring as the set goes on, and the camera moving round the
 * lift if asked to. The preview plays the same take the recorder films.
 *
 * Nothing is saved on its own. When a take finishes, a Save button appears and the user
 * decides whether to keep it.
 */
const FORMATS = {
  reel:   { label: 'Reel 9:16',  w: 1080, h: 1920 },
  square: { label: 'Square 1:1', w: 1080, h: 1080 },
  wide:   { label: 'Wide 16:9',  w: 1920, h: 1080 },
};

/** Recording formats for the real-time fallback, in order of preference. */
const MIME = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

const FPS = 30;

export class Film {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.format = 'reel';
    this.captions = true;
    this.reps = 1;
    this.pace = 'teach:3';
    this.camera = 'orbit';
    this.recorder = null;
    this.rendering = null;
    this.previewing = null;
    this.result = null;
    this.sample = null;           // the moment of the take on screen, while one is playing
    this._onKey = (e) => { if (e.key === 'Escape') { if (this.busy) this.stop(); else this.exit(); } };
    this._onResize = () => { if (this.active) this.layout(); };
  }

  get player() { return this.app.exercise; }
  get busy() { return !!(this.recorder || this.rendering || this.previewing); }
  get take() { return buildTake({ reps: this.reps, pace: this.pace, repSecs: this.player?.ex?.duration || 3.4, phases: this.player?.ex?.phases }); }

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
    this.player.seek(this.player.ex?.poster ?? 0.5);
    this._offDraw = v.onAfterRender(() => this.draw());
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('resize', this._onResize);
    document.fonts?.load('800 64px Manrope').then(() => v.requestRender());
  }

  exit() {
    if (!this.active) return;
    if (this.busy) this.stop(true);
    this.active = false;
    const v = this.app.viewer;
    this._offDraw?.();
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('resize', this._onResize);
    this.discard();
    this.canvas?.remove(); this.bar?.remove();
    this.canvas = this.bar = null;
    document.getElementById('stage').style.cssText = '';
    document.body.classList.remove('film');
    this.app.labels.visible = this._labelsWere;
    v.renderer.setPixelRatio(this._saved.pixelRatio);
    this.player.speed = this._saved.speed;
    this.restoreEffort();
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
    Object.assign(document.getElementById('stage').style, {
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

  // ---------- playing a take ----------
  /**
   * Put everything at `ts` seconds into the take: the body at that moment of the rep, the
   * muscles' effort and tiredness for that point in the set, and the camera.
   */
  frameAt(take, ts, base) {
    const p = this.player, v = this.app.viewer;
    const s = sampleTake(take, ts);
    p.seek(s.t);
    this._shares ||= workShares(p.groups);
    for (const g of p.groups) {
      const f = fatigueAt(take, s, this._shares.get(g) || 0);
      g.effort = Math.max(0, Math.min(1, g.def.effort(s.t) * f.lift));
      g.tired = f.tired;
      for (const id of g.ids) { const e = p._fx.get(id); if (e) e.intensity = g.effort; }
    }
    // Say the video is slowed down only while it is: with just the first and last rep slow,
    // the reps in between run at real speed.
    this.sample = { ...s, reps: take.reps, teach: s.taught || (s.intro && take.pace.teach !== 'none') };
    if (base) {
      v.camera.position.copy(v.controls.target).add(cameraOffset(this.camera, base, ts, take.total));
      v.camera.lookAt(v.controls.target);
    }
    // Muscle colour normally reaches the GPU on the next screen frame. A rendered frame
    // does not wait for one, so push this moment's effort now.
    this.app.hi.tick(ts);
    v.requestRender();
  }

  /** Back to the plain Movement readout once a take is over. */
  restoreEffort() {
    this.sample = null;
    const p = this.player;
    if (!p?.ex) return;
    for (const g of p.groups) g.tired = 0;
    p.seek(p.t);
  }

  /** The camera as framed now, before any take moves it. */
  startCamera() {
    const v = this.app.viewer;
    settleCamera(v);
    v.controls.enabled = false;
    return v.camera.position.clone().sub(v.controls.target);
  }

  endCamera(base) {
    const v = this.app.viewer;
    if (base) { v.camera.position.copy(v.controls.target).add(base); v.camera.lookAt(v.controls.target); }
    v.controls.enabled = true;
    v.requestRender();
  }

  /** Play the take on screen in real time, without recording, to check its timing. */
  preview() {
    if (this.busy || !this.canvas) return;
    const take = this.take, base = this.startCamera();
    const start = performance.now();
    this.previewing = { take, base, raf: 0, ts: 0 };
    const step = () => {
      if (!this.previewing) return;
      const ts = (performance.now() - start) / 1000;
      if (ts >= take.total) { this.stop(); return; }
      this.frameAt(take, ts, base);
      this.previewing.ts = ts;
      if (Math.floor(ts * 4) !== this._lastBarTick) { this._lastBarTick = Math.floor(ts * 4); this.renderBar(); }
      this.previewing.raf = requestAnimationFrame(step);
    };
    this.renderBar();
    step();
  }

  // ---------- the picture ----------
  draw() {
    if (!this.canvas) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#171b21'); g.addColorStop(0.55, '#0c0e12'); g.addColorStop(1, '#07080a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.app.viewer.canvas, 0, 0, W, H);
    if (this.captions) this.drawCaptions(ctx, W, H);
  }

  drawCaptions(ctx, W, H) {
    const p = this.player;
    if (!p?.ex) return;
    const s = this.sample;
    const reps = s ? s.reps : this.reps;
    // A tall frame stacks everything down the left. A square or wide frame puts the moment
    // of the rep bottom left and the muscles bottom right, or the text would cover half
    // of a square picture.
    const cols = W >= H;
    // One unit is a pixel of a 1080-high or -wide frame. A square frame has the least room
    // around the lift, so its text runs a little smaller.
    const u = ((cols ? H : W) / 1080) * (W === H ? 0.86 : 1);
    const pad = 64 * u;
    const phase = captionFor(p.t, s, p.ex);
    const colW = cols ? W * 0.5 - pad * 1.5 : W - pad * 2;
    const hintFont = `500 ${32 * u}px Inter, sans-serif`;
    const hintLines = wrap(ctx, phase.hint, colW, hintFont);
    const top3 = p.ranked().slice(0, 3);
    const showTired = reps > 1;

    // Lay the bottom block out from the bottom edge up, then paint it.
    const hintY = H - pad - (hintLines.length - 1) * 44 * u;
    const phaseY = hintY - 58 * u;
    const barW = cols ? Math.min(560 * u, W * 0.42) : W - pad * 2;
    const barX = cols ? W - pad - barW : pad;
    const rowH = (showTired ? 108 : 92) * u;
    const tail = showTired ? 34 * u : 0;
    const firstBarY = cols ? H - pad - 30 * u - tail - (top3.length - 1) * rowH : phaseY - 96 * u - tail - (top3.length - 1) * rowH;
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
    const sub = reps > 1 ? `A set of ${reps} reps, taken close to failure.` : 'What every muscle does in one rep.';
    const subW = W - pad * 2 - (reps > 1 ? 260 * u : 0);
    wrap(ctx, sub + (s?.teach ? ' Slowed down to show each phase.' : ''), subW, ctx.font)
      .slice(0, 2).forEach((line, i) => ctx.fillText(line, pad, pad + 156 * u + i * 38 * u));

    // Rep counter, top right, for a set.
    if (reps > 1) {
      const n = `${s ? (s.intro ? 1 : s.rep + 1) : 1}`, of = ` / ${reps}`;
      ctx.font = `800 ${92 * u}px Manrope, sans-serif`;
      const nw = ctx.measureText(n).width;
      ctx.font = `700 ${40 * u}px Manrope, sans-serif`;
      const ow = ctx.measureText(of).width;
      const x = W - pad - nw - ow;
      ctx.fillStyle = '#e9c95c';
      ctx.font = `800 ${24 * u}px Manrope, sans-serif`;
      spaced(ctx, 'REP', x, pad + 24 * u, 4 * u);
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${92 * u}px Manrope, sans-serif`;
      ctx.fillText(n, x, pad + 112 * u);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `700 ${40 * u}px Manrope, sans-serif`;
      ctx.fillText(of, x + nw, pad + 112 * u);
    }

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
      // How tired this muscle is by now in the set.
      if (showTired) {
        const tired = Math.round((gr.tired || 0) * 100);
        ctx.fillStyle = tired > 3 ? '#ff8a7a' : 'rgba(255,255,255,0.35)';
        ctx.font = `600 ${24 * u}px Inter, sans-serif`;
        ctx.fillText(tired > 3 ? `Tired ${tired}%` : 'Fresh', barX, ty + th + 30 * u);
      }
      by += rowH;
    }
    // The first frame is the first time the real caption sizes are known; frame the lift
    // again between them if they differ from the estimate.
    const key = `${this.format}|${this._reserve.top.toFixed(2)}|${this._reserve.bottom.toFixed(2)}`;
    if (key !== this._reserveKey) { this._reserveKey = key; if (!this.busy) this.app.updateSafeInsets(); }
  }

  /**
   * How much of the stage the captions cover, in stage pixels, so the camera frames the
   * lifter in the clear space between the title and the bottom block.
   */
  safeInsets() {
    const stage = document.getElementById('stage').getBoundingClientRect();
    const est = this.format === 'reel' ? { top: 0.13, bottom: 0.36 } : { top: 0.24, bottom: 0.36 };
    const r = this.captions ? (this._reserve || est) : { top: 0.04, bottom: 0.04 };
    return { top: r.top * stage.height, bottom: r.bottom * stage.height, left: stage.width * 0.04, right: stage.width * 0.04 };
  }

  // ---------- recording ----------
  /**
   * Record a take. The first choice renders the video one frame at a time and encodes
   * each frame as it goes (WebCodecs H.264 into an MP4). Every frame is placed at an exact
   * moment of the set, so the file plays at a smooth 30 frames a second however fast or
   * slow this computer draws. The browser slows the encoder right down while the tab is
   * in the background, though, so the bar asks for the tab to stay in front. A browser
   * without WebCodecs films the screen in real time instead.
   */
  async record() {
    if (this.busy || !this.canvas) return;
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
    const v = this.app.viewer, take = this.take;
    const frames = Math.round(take.total * FPS);
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const source = new mb.CanvasSource(this.canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: FPS });
    await output.start();

    this.player.pause();
    const base = this.startCamera();
    this.rendering = { done: 0, frames, cancel: false, started: performance.now() };
    this.renderBar();
    try {
      for (let i = 0; i < frames && !this.rendering.cancel; i++) {
        const ts = i / FPS;
        this.frameAt(take, ts, base);
        v.renderer.render(v.scene, v.camera);
        this.draw();
        await source.add(ts, 1 / FPS);
        if (i % 4 === 0) { this.rendering.done = i; this.renderBar(); await yieldToPage(); }
      }
      if (this.rendering.cancel) { await output.cancel(); return; }
      await output.finalize();
      const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
      this.result = { blob, url: URL.createObjectURL(blob), ext: 'mp4', secs: frames / FPS };
    } catch (err) {
      console.error('[film] render failed', err);
      this._msg = 'The video could not be made on this computer. Try Chrome or Edge.';
    } finally {
      this.endCamera(base);
      this.rendering = null;
      this.restoreEffort();
      this.player.seek(this.player.ex?.poster ?? 0.5);
      this.renderBar();
    }
  }

  recordRealtime() {
    if (this.busy || !this.canvas) return;
    if (typeof MediaRecorder === 'undefined' || !this.canvas.captureStream) {
      this.message('This browser cannot record video. Chrome or Edge on a computer can.');
      return;
    }
    this.discard();
    const mime = MIME.find(m => MediaRecorder.isTypeSupported(m)) || '';
    const stream = this.canvas.captureStream(FPS);
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const take = this.take;
    rec.onstop = () => {
      stream.getTracks().forEach(tr => tr.stop());
      if (this._cancelled) { this._cancelled = false; return; }
      const type = rec.mimeType || mime || 'video/webm';
      const blob = new Blob(chunks, { type });
      this.result = { blob, url: URL.createObjectURL(blob), ext: type.includes('mp4') ? 'mp4' : 'webm', secs: take.total };
      this.renderBar();
    };
    this.player.pause();
    const base = this.startCamera();
    const start = performance.now();
    this.recorder = rec;
    this._rt = { take, base, start, raf: 0 };
    rec.start(250);
    const step = () => {
      if (this.recorder !== rec) return;
      const ts = (performance.now() - start) / 1000;
      if (ts >= take.total) { this.stop(); return; }
      this.frameAt(take, ts, base);
      if (Math.floor(ts * 4) !== this._lastBarTick) { this._lastBarTick = Math.floor(ts * 4); this.renderBar(); }
      this._rt.raf = requestAnimationFrame(step);
    };
    step();
  }

  /** Stop whatever is running. `cancel` throws a recording away instead of offering it. */
  stop(cancel = false) {
    if (this.rendering) { this.rendering.cancel = true; return; }
    if (this.previewing) {
      cancelAnimationFrame(this.previewing.raf);
      const base = this.previewing.base;
      this.previewing = null;
      this.endCamera(base);
      this.restoreEffort();
      this.renderBar();
      return;
    }
    const rec = this.recorder;
    if (!rec) return;
    cancelAnimationFrame(this._rt?.raf);
    this.recorder = null;
    this._cancelled = cancel;
    this.endCamera(this._rt?.base);
    this.restoreEffort();
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
      const r = this.rendering;
      const pct = Math.round((r.done / r.frames) * 100);
      const rate = r.done / Math.max(0.5, (performance.now() - r.started) / 1000);
      const left = r.done > 8 ? Math.max(0, (r.frames - r.done) / rate) : null;
      bar.append(...[
        el('span', { class: 'film-rec' }, el('i', { class: 'film-dot' }), `Making your video  ${pct}%`),
        left != null ? el('span', { class: 'film-note' }, `About ${fmtLeft(left)} left.`) : null,
        el('span', { class: 'film-note' }, 'Keep this tab in front. It slows right down in the background.'),
        el('button', { class: 'btn sm', onClick: () => this.stop() }, 'Cancel'),
      ].filter(Boolean));
      return;
    }
    if (this.recorder || this.previewing) {
      const take = this.previewing ? this.previewing.take : this._rt.take;
      const ts = this.previewing ? this.previewing.ts : (performance.now() - this._rt.start) / 1000;
      bar.append(
        el('span', { class: 'film-rec' }, this.recorder ? el('i', { class: 'film-dot' }) : '▶', `${this.recorder ? 'Recording' : 'Preview'}  ${fmt(ts)} / ${fmt(take.total)}`),
        el('button', { class: 'btn sm', onClick: () => this.stop() }, '■ Stop'),
      );
      return;
    }
    if (this.result) {
      const mb = (this.result.blob.size / 1048576).toFixed(1);
      const name = `sharir-${this.player.ex.id}-${this.reps}rep-${this.format}.${this.result.ext}`;
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
    const select = (items, cur, pick, title) => {
      const s = el('select', { class: 'sel', title },
        ...items.map(([k, label]) => el('option', { value: String(k), selected: String(k) === String(cur) ? '' : null }, label)));
      s.addEventListener('change', () => pick(s.value));
      return s;
    };
    const take = this.take;
    bar.append(
      seg(Object.entries(FORMATS).map(([k, f]) => [k, f.label]), this.format, (k) => { this.format = k; this.renderBar(); this.layout(); }),
      select(REP_CHOICES.map(n => [n, n === 1 ? '1 rep' : `${n} reps`]), this.reps, (v) => { this.reps = +v; this.renderBar(); }, 'How many reps'),
      select(PACES.map(p => [p.key, p.label]), this.pace, (v) => { this.pace = v; this.renderBar(); }, 'How long each phase stays on screen'),
      select(CAMERAS.map(c => [c.key, c.label]), this.camera, (v) => { this.camera = v; this.renderBar(); }, 'How the camera moves'),
      el('button', { class: 'chip' + (this.captions ? ' active' : ''), onClick: () => { this.captions = !this.captions; this.renderBar(); this.app.updateSafeInsets(); this.app.viewer.requestRender(); } }, 'Captions'),
      el('button', { class: 'btn sm', onClick: () => this.preview() }, '▶ Preview'),
      el('button', { class: 'btn sm film-go', onClick: () => this.record() }, `● Record  ${fmt(take.total)}`),
      el('button', { class: 'btn sm', onClick: () => this.exit() }, 'Done'),
    );
    if (this._msg) { bar.append(el('span', { class: 'film-note' }, this._msg)); this._msg = null; }
  }
}

// ---------- helpers ----------
/**
 * The caption for this moment. The same four moments the Movement panel names, plus two
 * that only a set has: the start, and the last rep, where the bar slows as the muscles
 * reach their limit.
 */
function captionFor(t, s, ex) {
  if (s?.intro) return { name: 'Ready', hint: ex?.ready || 'In the start position.' };
  if (s && s.reps >= 5 && s.rep === s.reps - 1 && s.work) {
    return { name: 'Last rep', hint: 'The bar slows down. The muscles are close to their limit.' };
  }
  return phaseName(t, ex);
}

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
function fmtLeft(s) { return s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.round(s / 60)} min`; }
