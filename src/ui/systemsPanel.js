import { el, toast } from '../core/util.js';
import { state, set, emit } from '../core/state.js';
import { SYSTEMS, PRESETS, SKIN_TONES } from '../data/systems.js';
import { FEATURES } from '../data/flags.js';

export class SystemsPanel {
  constructor(root, app) { this.root = root; this.app = app; this.render(); }

  render() {
    const lang = state.lang;
    this.root.innerHTML = '';
    this.root.append(
      el('div', { class: 'ph' }, el('h2', {}, lang === 'hi' ? 'शरीर के तंत्र' : 'Body systems'), el('span', { class: 'cnt' }, `${SYSTEMS.length}`)),
      el('p', { class: 'pd' }, lang === 'hi'
        ? 'नीचे किसी भी बटन पर क्लिक करें — शरीर तुरंत बदल जाएगा। एक तंत्र अकेले देखें, या "Atlas" में सब अलग-अलग खड़े देखें।'
        : 'Click any button below and the body changes straight away. Show one system on its own, or open the Atlas to see all of them standing side by side.'),
    );
    // presets — the fastest visible payoff, so they go first and look like the main action
    const chips = el('div', { class: 'chips big-chips' });
    this.presetChips = [];
    for (const p of PRESETS) {
      const chip = el('button', { class: 'chip', onClick: () => this.applyPreset(p) }, lang === 'hi' ? p.hi : p.label);
      this.presetChips.push([p, chip]);
      chips.append(chip);
    }
    this.markPresets();
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'एक क्लिक में देखें' : 'See it in one click'), chips);

    // atlas + xray
    const row = el('div', { class: 'btnrow' },
      el('button', { class: 'btn' + (state.atlas ? ' active' : ''), id: 'btn-atlas', onClick: () => this.app.toggleAtlas() }, '▥ ', lang === 'hi' ? 'एटलस: सब एक फ़्रेम में' : 'Atlas: all systems in one frame'),
      el('button', { class: 'btn' + (state.xray ? ' active' : ''), id: 'btn-xray', onClick: () => this.app.toggleXray() }, '◐ ', lang === 'hi' ? 'एक्स-रे' : 'X-ray'),
    );
    this.root.append(row);

    // system rows
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'तंत्र' : 'Systems'));
    const list = el('div');
    for (const s of SYSTEMS) {
      const st = state.systems[s.key];
      const r = el('div', { class: 'sysrow' + (st.visible ? '' : ' off') });
      const sw = el('button', { class: 'sw', style: `background:${st.visible ? s.color : 'transparent'}`, title: 'Toggle' });
      const nm = el('div', { class: 'nm' }, lang === 'hi' ? s.hi : s.label, FEATURES.hindi ? el('small', {}, lang === 'hi' ? s.label : s.hi) : null);
      const range = el('input', { type: 'range', min: 0, max: 100, value: Math.round(st.opacity * 100), title: 'Opacity' });
      const solo = el('button', { class: 'solo', title: 'Solo this system' }, 'SOLO');
      // Touching a switch here means the user is taking direct control of what is on, so
      // any temporary view laid over the top (from Movement, or an effect) gives way —
      // otherwise the switch moves and nothing on screen changes.
      // Change the setting FIRST. Clearing a temporary view redraws this panel from the
      // settings, and when that ran before the flip, the redrawn panel showed every switch
      // the user touched the wrong way round.
      const toggle = () => {
        st.visible = !st.visible;
        this.syncRow(r, sw, s, st);
        this.app.clearSysOverride();
        this.app.refreshVisibility();
        this.markPresets();
      };
      sw.addEventListener('click', toggle);
      nm.addEventListener('click', toggle);
      range.addEventListener('input', () => {
        st.opacity = range.value / 100;
        if (!st.visible && st.opacity > 0) st.visible = true;
        this.syncRow(r, sw, s, st);
        this.app.clearSysOverride();
        this.app.refreshVisibility();
        this.markPresets();
      });
      solo.addEventListener('click', () => this.applyPreset({ on: [s.key] }));
      nm.addEventListener('mouseenter', () => this.app.hoverSystem(s.key));
      nm.addEventListener('mouseleave', () => this.app.hoverSystem(null));
      r.append(sw, nm, range, solo);
      list.append(r);
    }
    this.root.append(list);

    // Fascia, bursae and retinacula are filed with the muscles but sheathe them, so they
    // are off by default. Offered here rather than removed, because they are real anatomy.
    const ct = el('div', { class: 'chips' },
      el('button', { class: 'chip' + (state.connective ? ' active' : ''),
        onClick: () => { set({ connective: !state.connective }); this.app.refreshVisibility(); this.render(); } },
        (state.connective ? '✓ ' : '') + (lang === 'hi' ? 'प्रावरणी और बर्सा' : 'Fascia, bursae & sheaths')));
    this.root.append(ct);

    // skin tone
    const tones = el('div', { class: 'chips' });
    for (const t of SKIN_TONES) tones.append(el('button', { class: 'chip' + (state.skinTone === t.key ? ' active' : ''), onClick: () => { set({ skinTone: t.key }); this.app.applySkinTone(); this.render(); } }, el('i', { style: `background:${t.hex}` }), t.label));
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'त्वचा का रंग' : 'Skin tone'), tones);

    // cross-section
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'काट-छाँट (क्रॉस-सेक्शन)' : 'Cross-section cut'));
    for (const [axis, label] of [['x', lang === 'hi' ? 'बाएँ ↔ दाएँ' : 'Left ↔ Right'], ['y', lang === 'hi' ? 'ऊपर ↔ नीचे' : 'Top ↔ Bottom'], ['z', lang === 'hi' ? 'आगे ↔ पीछे' : 'Front ↔ Back']]) {
      const rng = el('input', { type: 'range', min: 0, max: 100, value: Math.round(state.clip[axis] * 100) });
      const val = el('span', { class: 'val' }, state.clip[axis] >= 0.999 ? 'off' : Math.round(state.clip[axis] * 100) + '%');
      rng.addEventListener('input', () => { state.clip[axis] = rng.value / 100; val.textContent = state.clip[axis] >= 0.999 ? 'off' : rng.value + '%'; this.app.applyClip(); });
      this.root.append(el('div', { class: 'row' }, el('label', {}, label), rng, val));
    }
    this.root.append(el('div', { class: 'btnrow' }, el('button', { class: 'btn sm ghost', onClick: () => { state.clip = { x: 1, y: 1, z: 1 }; this.app.applyClip(); this.render(); } }, lang === 'hi' ? 'कट हटाएँ' : 'Clear cuts')));

    // labels
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'नाम शरीर पर दिखाएँ' : 'Show names on the body'));
    this.root.append(el('p', { class: 'pd small' }, lang === 'hi'
      ? 'नाम वाली रेखाएँ 3D शरीर पर दिखेंगी।'
      : 'These are the leader lines drawn onto the 3D body.'));
    const lb = el('div', { class: 'btnrow' });
    for (const [k, l, lh] of [
      ['auto', 'Only what I select', 'सिर्फ़ चुना हुआ'],
      ['all', 'Name everything shown', 'सब पर नाम'],
      ['off', 'No names', 'कोई नाम नहीं'],
    ]) {
      lb.append(el('button', { class: 'btn sm' + (state.labels === k ? ' active' : ''), onClick: () => { set({ labels: k }); this.app.refreshLabels(); this.render(); } }, lang === 'hi' ? lh : l));
    }
    this.root.append(lb);
    const lm = el('label', { class: 'row' }, el('input', { type: 'checkbox', ...(state.showLandmarks ? { checked: '' } : {}) }), el('span', {}, lang === 'hi' ? 'चुने हुए हिस्से के सूक्ष्म-स्थल (landmarks) दिखाएँ' : 'Show landmarks of selected part'));
    lm.querySelector('input').addEventListener('change', (e) => { set({ showLandmarks: e.target.checked }); this.app.refreshLabels(); });
    this.root.append(lm);
    const at = el('label', { class: 'row' }, el('input', { type: 'checkbox', ...(state.showAttachments ? { checked: '' } : {}) }), el('span', {}, lang === 'hi' ? 'पेशी के उद्गम/निवेशन (origin/insertion) दिखाएँ' : 'Show muscle origin / insertion on bones'));
    at.querySelector('input').addEventListener('change', (e) => { set({ showAttachments: e.target.checked }); this.app.refreshAttachments(); });
    this.root.append(at);
  }

  /** One row's look from its setting. */
  syncRow(r, sw, s, st) {
    r.classList.toggle('off', !st.visible);
    sw.style.background = st.visible ? s.color : 'transparent';
  }

  /**
   * Light the one-click view that matches what is switched on, if any. Worked out afresh
   * after every switch, so a chip never stays lit for a view that is no longer showing.
   */
  markPresets() {
    for (const [p, chip] of this.presetChips || []) {
      chip.classList.toggle('active', SYSTEMS.every(s => p.on.includes(s.key) === state.systems[s.key].visible));
    }
  }

  applyPreset(p) {
    this.app.clearSysOverride();
    for (const s of SYSTEMS) { state.systems[s.key].visible = p.on.includes(s.key); if (state.systems[s.key].visible && state.systems[s.key].opacity < 0.05) state.systems[s.key].opacity = 1; }
    if (p.key === 'all') { state.systems.integumentary.opacity = 0.16; state.systems.cavities.visible = false; state.systems.joints.visible = false; state.systems.lymphoid.visible = false; }
    if (p.key === 'skin') state.systems.integumentary.opacity = 1;
    this.app.refreshVisibility();
    this.app.ensurePanel('left');
    this.render();
    emit('preset', p);
    if (p.label) toast(state.lang === 'hi' ? p.hi + ' दिखाया जा रहा है' : 'Now showing: ' + p.label);
  }
}
