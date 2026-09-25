import { el } from '../core/util.js';
import { state } from '../core/state.js';
import { MICRO_MODELS } from '../core/micro.js';
import { MiniViewer } from '../core/mini.js';

let overlay = null, mini = null;

export function openMicroModal(key, part) {
  closeMicroModal();
  const m = MICRO_MODELS[key];
  if (!m) return;
  const lang = state.lang;
  const built = m.build();
  overlay = el('div', { style: 'position:absolute;inset:0;z-index:60;background:var(--scrim);backdrop-filter:blur(6px);display:grid;place-items:center;' });
  const card = el('div', { style: 'width:min(900px,92vw);max-height:88vh;overflow:auto;background:var(--panel-solid);border:1px solid var(--line-2);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6);' });
  const head = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line);' },
    el('div', {}, el('div', { style: 'font:800 18px/1.2 Manrope,sans-serif' }, `${m.icon} ${lang === 'hi' ? m.hi : m.label}`),
      part ? el('div', { class: 'muted small', style: 'margin-top:3px' }, `${lang === 'hi' ? 'से' : 'from'} ${part.n}`) : null),
    el('button', { class: 'btn sm', onClick: closeMicroModal }, '✕ Close'));
  const view = el('div', { style: 'height:min(52vh,440px);background:var(--mol-bg);position:relative;' });
  const body = el('div', { style: 'padding:16px 20px 20px;' },
    el('p', { class: 'desc' }, m.desc),
    el('h3', { class: 'sec' }, lang === 'hi' ? 'रंग-संकेत' : 'Legend'));
  const leg = el('div', { class: 'list' });
  for (const l of built.legend) leg.append(el('div', { class: 'li' }, el('i', { style: `background:${l.color}` }), lang === 'hi' && l.hi ? `${l.hi} — ${l.label}` : l.label));
  body.append(leg);
  card.append(head, view, body);
  overlay.append(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMicroModal(); });
  document.getElementById('app').append(overlay);
  mini = new MiniViewer(view);
  mini.controls.autoRotateSpeed = 0.9;
  mini.show(built.group, { fit: 1.05 });
  document.addEventListener('keydown', escHandler);
}

function escHandler(e) { if (e.key === 'Escape') closeMicroModal(); }

export function closeMicroModal() {
  if (mini) { mini.dispose(); mini = null; }
  if (overlay) { overlay.remove(); overlay = null; }
  document.removeEventListener('keydown', escHandler);
}
