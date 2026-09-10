import { el, fmtMass, fmtLength, kgToDisplay, displayToKg, cmToFeetInches, feetInchesToCm } from '../core/util.js';
import { state, set } from '../core/state.js';
import { TARGETS, EFFECT_KINDS } from '../data/targets.js';

/** Plain words for the muscle slider — "0.72" means nothing to a reader. */
export function muscleWord(v, lang = 'en') {
  const en = v < 0.18 ? 'Frail' : v < 0.36 ? 'Sedentary' : v < 0.58 ? 'Average' :
             v < 0.74 ? 'Trains regularly' : v < 0.88 ? 'Well trained' : 'Athlete';
  const hi = v < 0.18 ? 'कमज़ोर' : v < 0.36 ? 'निष्क्रिय' : v < 0.58 ? 'औसत' :
             v < 0.74 ? 'नियमित कसरत' : v < 0.88 ? 'अच्छा ट्रेन्ड' : 'एथलीट';
  return lang === 'hi' ? hi : en;
}

export class AgePanel {
  constructor(root, app) { this.root = root; this.app = app; this.render(); }

  /** Called while a dock slider is held: rewrite the numbers, rebuild nothing. */
  liveUpdate() {
    const app = this.app, lang = state.lang;
    const c = app.bodyComposition(), b = app.buildLabel(), U = state.units;
    const set1 = (sel, txt) => { const e = this.root.querySelector(sel); if (e) e.textContent = txt; };
    set1('[data-live=height]', fmtLength(app.currentHeightCm(), U.length));
    set1('[data-live=weight]', fmtMass(app.currentWeight(), U.mass));
    set1('[data-live=bmi]', c.bmi.toFixed(1));
    set1('[data-live=bmilabel]', `BMI · ${lang === 'hi' ? b.hi : b.label}`);
    set1('[data-live=bf]', `${c.bfPct}%`);
    set1('[data-live=lean]', `${lang === 'hi' ? 'दुबला भार' : 'Lean mass'} ${fmtMass(c.leanKg, U.mass)}`);
    set1('[data-live=fatkg]', `${lang === 'hi' ? 'चर्बी' : 'Fat'} ${fmtMass(c.fatKg, U.mass)}`);
    set1('[data-live=why]', b.why || '');
    const bmiEl = this.root.querySelector('[data-live=bmi]');
    if (bmiEl) bmiEl.style.color = b.color;
    const pct = Math.min(100, Math.max(0, c.bfPct));
    const lb = this.root.querySelector('.compbar i.lean'), fb = this.root.querySelector('.compbar i.fat');
    if (lb) lb.style.width = (100 - pct) + '%';
    if (fb) fb.style.width = pct + '%';
    // the dock keeps its own in-place refresher
    const dock = document.getElementById('dock');
    if (dock && dock._liveRefresh) dock._liveRefresh();
  }

  render() {
    const lang = state.lang;
    const data = this.app.ageData;
    const app = this.app;
    const U = state.units;
    this.root.innerHTML = '';
    this.root.append(
      el('div', { class: 'ph' }, el('h2', {}, lang === 'hi' ? 'उम्र के साथ शरीर' : 'The body across a lifetime'), el('span', { class: 'cnt' }, `0–90 yr`)),
      el('p', { class: 'pd' }, lang === 'hi'
        ? 'नीचे उम्र, ऊँचाई, वज़न और मांसपेशी बदलें — शरीर उसी के अनुसार बदलेगा। भारतीय औसत आँकड़ों पर आधारित।'
        : 'Change age, height, weight and muscle below — the body reshapes to match. Built on Indian reference medians (IAP growth charts, ICMR-NIN, NFHS-5).'));
    if (!data) { this.root.append(el('div', { class: 'note warn' }, 'Age data file not loaded.')); return; }
    const stage = this.app.currentStage();
    if (!stage) return;

    // ---- this body, right now
    const comp = app.bodyComposition(), build = app.buildLabel();
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'यह शरीर' : 'This body right now'));
    this.root.append(el('div', { class: 'grid2' },
      el('div', { class: 'stat' }, el('b', { 'data-live': 'height' }, fmtLength(app.currentHeightCm(), U.length)), el('span', {}, lang === 'hi' ? 'ऊँचाई' : 'Height')),
      el('div', { class: 'stat' }, el('b', { 'data-live': 'weight' }, fmtMass(app.currentWeight(), U.mass)), el('span', {}, lang === 'hi' ? 'वज़न' : 'Weight')),
      el('div', { class: 'stat' }, el('b', { 'data-live': 'bmi', style: `color:${build.color}` }, comp.bmi.toFixed(1)), el('span', { 'data-live': 'bmilabel' }, `BMI · ${lang === 'hi' ? build.hi : build.label}`)),
      el('div', { class: 'stat' }, el('b', { 'data-live': 'bf' }, `${comp.bfPct}%`), el('span', {}, lang === 'hi' ? 'शरीर की चर्बी' : 'Body fat'))));

    // Why the verdict is what it is — this is the line that explains why a muscular
    // 80 kg body is not "overweight" even though BMI says otherwise.
    this.root.append(el('div', { class: 'note' + (build.color === '#22c55e' ? '' : ' warn'), 'data-live': 'why' }, build.why || ''));

    if (comp.valid) {
      const pct = Math.min(100, Math.max(0, comp.bfPct));
      this.root.append(el('div', { class: 'complabel' },
        el('span', { class: 'lean', 'data-live': 'lean' }, `${lang === 'hi' ? 'दुबला भार' : 'Lean mass'} ${fmtMass(comp.leanKg, U.mass)}`),
        el('span', { class: 'fat', 'data-live': 'fatkg' }, `${lang === 'hi' ? 'चर्बी' : 'Fat'} ${fmtMass(comp.fatKg, U.mass)}`)));
      this.root.append(el('div', { class: 'compbar' },
        el('i', { class: 'lean', style: `width:${100 - pct}%` }),
        el('i', { class: 'fat', style: `width:${pct}%` })));
      this.root.append(el('div', { class: 'kv' },
        el('span', {}, lang === 'hi' ? 'स्वस्थ चर्बी दायरा' : 'Healthy body fat'), el('b', {}, `${comp.healthy[0]}–${comp.healthy[1]}%`),
        el('span', {}, lang === 'hi' ? 'एथलेटिक दायरा' : 'Athletic range'), el('b', {}, `${comp.athletic[0]}–${comp.athletic[1]}%`),
        el('span', {}, 'FFMI (muscle index)'), el('b', {}, `${comp.ffmi}`)));

      const btns = el('div', { class: 'btnrow' },
        el('button', { class: 'btn sm', onClick: () => app.showComposition('fat') }, '⌖ ', lang === 'hi' ? 'चर्बी कहाँ जमती है' : 'Where the fat sits'),
        el('button', { class: 'btn sm', onClick: () => app.showComposition('muscle') }, '⌖ ', lang === 'hi' ? 'मांसपेशियाँ कहाँ' : 'Where the muscle is'),
        el('button', { class: 'btn sm ghost', onClick: () => { app.clearSysOverride(); app.hi.clearEffects(); app.applyAgeEffects(); } }, lang === 'hi' ? 'हटाएँ' : 'Clear'));
      this.root.append(btns);
      this.root.append(el('div', { class: 'muted small' }, comp.estimated
        ? (lang === 'hi'
          ? 'चर्बी % Deurenberg समीकरण से अनुमानित (दक्षिण-एशियाई सुधार + ट्रेनिंग सुधार सहित)। असली आँकड़ा पता हो तो नीचे भरें।'
          : 'Body fat estimated with Deurenberg + a South-Asian correction + a training correction. If you know your real figure, type it in below — the estimate always loses to a real number.')
        : (lang === 'hi' ? 'आपका दिया हुआ चर्बी % इस्तेमाल हो रहा है।' : 'Using the body fat figure you entered.')));
    }

    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'यह अवस्था' : 'This life stage'));
    this.root.append(el('div', { class: 'stage-name' }, lang === 'hi' ? stage.name.hi : stage.name.en, el('span', { class: 'muted small' }, `  ${stage.from}–${stage.to} yr`)));
    this.root.append(el('p', { class: 'desc' }, lang === 'hi' ? stage.summary.hi : stage.summary.en));
    if (stage.indian_context) this.root.append(el('div', { class: 'note in' }, el('b', {}, '🇮🇳 India: '), stage.indian_context));

    const changes = (stage.changes || []).filter(c => !c.sex || c.sex === 'both' || c.sex === state.sex);
    this.root.append(el('h3', { class: 'sec' }, `${lang === 'hi' ? 'क्या बदल रहा है' : "What's changing"} (${changes.length})`));
    for (const c of changes) {
      const t = TARGETS[c.target];
      const row = el('div', { class: `efx ${c.kind}` },
        el('div', { class: 't' }, el('span', {}, t?.label || c.target), c.metric ? el('span', { class: 'm' }, c.metric.value) : null),
        c.metric ? el('div', { class: 'nt muted small' }, c.metric.label) : null,
        el('div', { class: 'nt' }, c.note),
        c.sex && c.sex !== 'both' ? el('span', { class: 'pill' }, c.sex === 'male' ? '♂ male' : '♀ female') : null);
      row.addEventListener('mouseenter', () => this.app.hoverTarget(c.target));
      row.addEventListener('mouseleave', () => this.app.hoverTarget(null));
      row.addEventListener('click', () => this.app.focusTarget(c.target));
      this.root.append(row);
    }
    const chips = el('div', { class: 'chips' });
    for (const s of this.app.ageData.stages) chips.append(el('button', { class: 'chip' + (s === stage ? ' active' : ''), onClick: () => this.app.setAge(Math.round((s.from + s.to) / 2)) }, `${s.from}–${s.to}`));
    this.root.append(el('h3', { class: 'sec' }, lang === 'hi' ? 'सीधे जाएँ' : 'Jump to a stage'), chips);
  }
}

/**
 * Bottom dock for Age mode.
 *
 * Every control is a slider AND a type-in box, because dragging to 181 cm is slow and
 * imprecise when you already know your own numbers. Sliders fire `live` updates that only
 * move the body and rewrite the numbers in place — the DOM is never rebuilt mid-drag,
 * which is what made the old dock stutter and drop the handle you were holding.
 */
export function renderAgeDock(dock, app) {
  const lang = state.lang;
  dock.innerHTML = '';
  dock.hidden = false;
  const stage = app.currentStage();
  const U = state.units;

  const num = (value, opts = {}) => {
    const i = el('input', { class: 'numbox', type: 'number', value, ...opts });
    i.addEventListener('focus', () => i.select());
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); e.stopPropagation(); });
    return i;
  };
  const unitBtn = (kind, value, label) => {
    const b = el('button', { class: 'unitbtn' + (U[kind] === value ? ' active' : '') }, label);
    b.addEventListener('click', () => { app.setUnits(kind, value); renderAgeDock(dock, app); });
    return b;
  };
  const rebuild = () => renderAgeDock(dock, app);

  // ---- age
  const ageR = el('input', { type: 'range', min: 0, max: 90, step: 1, value: state.age });
  const ageN = num(state.age, { min: 0, max: 90, step: 1, style: 'width:52px' });
  ageR.addEventListener('input', () => { app.setAge(+ageR.value, { live: true }); ageN.value = state.age; refresh(); });
  ageR.addEventListener('change', rebuild);
  ageN.addEventListener('change', () => { app.setAge(+ageN.value); rebuild(); });

  // ---- height
  const medH = app.medianHeightCm();
  const hMin = Math.round(medH * 0.82), hMax = Math.round(medH * 1.22);
  const hR = el('input', { type: 'range', min: hMin, max: hMax, step: 0.5, value: app.currentHeightCm() });
  const heightInputs = el('span', { class: 'inputs' });
  if (U.length === 'ft') {
    const { ft, inch } = cmToFeetInches(app.currentHeightCm());
    const hFt = num(ft, { min: 2, max: 8, step: 1, style: 'width:44px' });
    const hIn = num(inch, { min: 0, max: 11, step: 1, style: 'width:44px' });
    const push = () => { app.setHeight(feetInchesToCm(+hFt.value, +hIn.value)); rebuild(); };
    hFt.addEventListener('change', push); hIn.addEventListener('change', push);
    heightInputs.append(hFt, el('span', { class: 'uu' }, 'ft'), hIn, el('span', { class: 'uu' }, 'in'));
  } else {
    const hN = num(app.currentHeightCm().toFixed(0), { min: hMin, max: hMax, step: 1, style: 'width:56px' });
    hN.addEventListener('change', () => { app.setHeight(+hN.value); rebuild(); });
    heightInputs.append(hN, el('span', { class: 'uu' }, 'cm'));
  }
  hR.addEventListener('input', () => { app.setHeight(+hR.value, { live: true }); refresh(); });
  hR.addEventListener('change', rebuild);

  // ---- weight
  const medW = app.medianWeightForHeight();
  const wR = el('input', { type: 'range', min: (medW * 0.62).toFixed(1), max: (medW * 2.4).toFixed(1), step: 0.5, value: app.currentWeight() });
  const wN = num(kgToDisplay(app.currentWeight(), U.mass).toFixed(0), { step: 1, style: 'width:56px' });
  wN.addEventListener('change', () => { app.setWeight(displayToKg(+wN.value, U.mass)); rebuild(); });
  wR.addEventListener('input', () => { app.setWeight(+wR.value, { live: true }); refresh(); });
  wR.addEventListener('change', rebuild);

  // ---- muscle
  const mR = el('input', { type: 'range', min: 0, max: 100, step: 1, value: Math.round((state.muscle ?? 0.5) * 100) });
  mR.addEventListener('input', () => { app.setMuscle(+mR.value / 100, { live: true }); refresh(); });
  mR.addEventListener('change', rebuild);

  // ---- body fat (a real number always beats the estimate)
  const c0 = app.bodyComposition();
  const fN = num(c0.bfPct, { min: 3, max: 60, step: 0.5, style: 'width:56px' });
  fN.addEventListener('change', () => { app.setBodyFat(+fN.value); rebuild(); });
  const fAuto = el('button', { class: 'unitbtn' + (state.bodyFatPct == null ? ' active' : ''),
    title: 'Estimate body fat from height, weight, age and how trained the body is' },
    lang === 'hi' ? 'अनुमान' : 'Auto');
  fAuto.addEventListener('click', () => { app.setBodyFat(null); rebuild(); });

  // ---- live read-outs
  const bigAge = el('div', { class: 'big' }, el('span', { class: 'agenum' }, String(state.age)), el('small', {}, lang === 'hi' ? 'साल' : 'YEARS'));
  const hVal = el('span', { class: 'wval' }, fmtLength(app.currentHeightCm(), U.length));
  const wVal = el('span', { class: 'wval' }, fmtMass(app.currentWeight(), U.mass));
  const mVal = el('span', { class: 'wval wide' }, muscleWord(state.muscle ?? 0.5, lang));
  const verdict = el('span', { class: 'wbuild' });
  const stats = el('span', { class: 'muted small stats' });

  function refresh() {
    const c = app.bodyComposition(), b = app.buildLabel();
    bigAge.querySelector('.agenum').textContent = String(state.age);
    hVal.textContent = fmtLength(app.currentHeightCm(), U.length);
    wVal.textContent = fmtMass(app.currentWeight(), U.mass);
    mVal.textContent = muscleWord(state.muscle ?? 0.5, lang);
    verdict.textContent = lang === 'hi' ? b.hi : b.label;
    verdict.style.color = b.color;
    stats.textContent = `BMI ${c.bmi} · ${c.bfPct}% fat · ${fmtMass(c.leanKg, U.mass)} lean · FFMI ${c.ffmi}`;
  }
  dock._liveRefresh = refresh;

  const reset = el('button', { class: 'btn sm ghost', title: 'Back to the Indian median for this age',
    onClick: () => { app.setHeight(null); app.setWeight(null); app.setMuscle(0.5); app.setBodyFat(null); rebuild(); } },
    lang === 'hi' ? 'रीसेट' : 'Reset');

  const row = (label, ...kids) => el('div', { class: 'ctlrow' }, el('label', {}, label), ...kids);

  dock.append(el('div', { class: 'agedock2' },
    bigAge,
    el('div', { class: 'ctls' },
      row(lang === 'hi' ? 'उम्र' : 'Age', ageR, ageN, el('span', { class: 'uu' }, 'yr'),
        el('span', { class: 'anth-inline' }, stage ? (lang === 'hi' ? stage.name.hi : stage.name.en) : '')),
      row(lang === 'hi' ? 'ऊँचाई' : 'Height', hR, heightInputs, hVal,
        el('span', { class: 'units' }, unitBtn('length', 'cm', 'cm'), unitBtn('length', 'ft', 'ft/in'))),
      row(lang === 'hi' ? 'वज़न' : 'Weight', wR, wN, el('span', { class: 'uu' }, U.mass), wVal,
        el('span', { class: 'units' }, unitBtn('mass', 'kg', 'kg'), unitBtn('mass', 'lb', 'lb'))),
      row(lang === 'hi' ? 'मांसपेशी' : 'Muscle', mR, mVal,
        el('span', { class: 'ctl-note' }, lang === 'hi' ? 'कितना ट्रेन्ड शरीर' : 'how trained this body is')),
      row(lang === 'hi' ? 'चर्बी' : 'Body fat', fN, el('span', { class: 'uu' }, '%'), fAuto, verdict, stats, reset),
    )));
  refresh();
}
