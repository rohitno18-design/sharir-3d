import { el } from '../core/util.js';
import { state } from '../core/state.js';
import { FEATURES } from '../data/flags.js';

const SEEN_KEY = 'sharir.welcomed.v1';

const MODES = [
  { mode: 'explore', icon: '🔍', title: 'Explore the body', hi: 'शरीर देखें',
    text: 'Click any bone, muscle, nerve, vessel or organ and read what it is and what it does. Go deeper into any part.' },
  { mode: 'systems', icon: '▥', title: 'Show one system', hi: 'एक तंत्र चुनें',
    text: 'Turn body systems on and off. See only the skeleton, only the nerves or only the blood vessels, or lay them side by side.' },
  { mode: 'age', icon: '⏳', title: 'Change age & weight', hi: 'उम्र और वज़न',
    text: 'Slide from newborn to 90, and change body weight, to see how the body itself changes shape.' },
  { mode: 'effects', icon: '🧪', title: 'What happens if…', hi: 'क्या होगा अगर…',
    text: 'Pick a food, workout, supplement, medicine or habit and watch what it does inside, from 1 day to 5 years.' },
  { mode: 'move', icon: '🏋️', title: 'Watch a lift', hi: 'व्यायाम देखें', wide: true, badge: 'New',
    text: 'Play a bench press and watch each muscle light up as it works. The hands, arms and bar all move the way a real lift does.' },
];

export function shouldShowWelcome() {
  try { return !localStorage.getItem(SEEN_KEY); } catch { return true; }
}

export function openWelcome(app, { force = false } = {}) {
  if (!force && !shouldShowWelcome()) return;
  close();
  const lang = state.lang;
  const overlay = el('div', { class: 'welcome' });
  const card = el('div', { class: 'welcome-card' });

  card.append(
    el('div', { class: 'welcome-head' },
      el('div', { class: 'welcome-mark' }, 'श'),
      el('div', {},
        el('h1', {}, 'SHARIR ', el('span', {}, '3D')),
        el('p', {}, lang === 'hi'
          ? 'पूरा मानव शरीर — 7,000 से ज़्यादा नामित संरचनाएँ, हिंदी नामों के साथ।'
          : `The whole human body, with more than 7,000 named structures${FEATURES.hindi ? ', in English and Hindi' : ''}.`))),
    el('p', { class: 'welcome-lead' }, lang === 'hi'
      ? 'नीचे से कुछ भी चुनकर शुरू करें। आप जब चाहें ऊपर बाईं ओर ‹ दबाकर पीछे जा सकते हैं।'
      : 'Pick any card to start. The ‹ button at the top left takes you back one step. The ⌂ button takes you back to the whole body.'),
  );

  const grid = el('div', { class: 'welcome-grid' });
  for (const m of MODES) {
    grid.append(el('button', { class: 'welcome-tile' + (m.wide ? ' wide' : ''), onClick: () => { markSeen(); close(); app.setMode(m.mode); } },
      el('div', { class: 'wt-ico' }, m.icon),
      el('div', {},
        el('div', { class: 'wt-title' }, lang === 'hi' ? m.hi : m.title, m.badge ? el('span', { class: 'wt-badge' }, m.badge) : null),
        el('div', { class: 'wt-text' }, m.text))));
  }
  card.append(grid);

  card.append(el('div', { class: 'welcome-controls' },
    el('span', {}, el('b', {}, 'Drag'), ' rotate'),
    el('span', {}, el('b', {}, 'Scroll'), ' zoom'),
    el('span', {}, el('b', {}, 'Right-drag'), ' move'),
    el('span', {}, el('b', {}, 'Click'), ' select a part'),
    el('span', {}, el('b', {}, 'Backspace'), ' go back'),
  ));

  card.append(el('div', { class: 'welcome-foot' },
    el('button', { class: 'btn primary', onClick: () => { markSeen(); close(); } },
      lang === 'hi' ? 'शुरू करें' : 'Start exploring'),
    el('span', { class: 'muted small' }, lang === 'hi'
      ? 'शिक्षा के लिए — चिकित्सा सलाह नहीं।'
      : 'This is for learning. It is not medical advice.')));

  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { markSeen(); close(); } });
  document.getElementById('app').append(overlay);
  document.addEventListener('keydown', esc);
}

function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch {} }
function esc(e) { if (e.key === 'Escape') { markSeen(); close(); } }

export function close() {
  const o = document.querySelector('.welcome');
  if (o) o.remove();
  document.removeEventListener('keydown', esc);
}
