import * as THREE from 'three';

/** Blender (x, y, z; z-up) → glTF/three (x, z, -y; y-up) */
export function toGl(a, out = new THREE.Vector3()) { return out.set(a[0], a[2], -a[1]); }

export function bboxToGl(bb) {
  const a = toGl(bb[0]), b = toGl(bb[1]);
  return new THREE.Box3(new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)), new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)));
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style') e.style.cssText = v;
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

let toastT;
export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

export function sideLabel(side) { return side === 'l' ? 'Left' : side === 'r' ? 'Right' : ''; }
export function sideLabelHi(side) { return side === 'l' ? 'बायाँ' : side === 'r' ? 'दायाँ' : ''; }

export function fmtName(part, lang = 'en') {
  const s = lang === 'hi' ? sideLabelHi(part.side) : sideLabel(part.side);
  const n = lang === 'hi' && part.hi ? part.hi : part.n;
  return s ? `${n} (${s})` : n;
}

// ---------------- units ----------------
// Indian users think in kg and cm, but gym and arm-wrestling numbers are often quoted in
// lb, and height in feet/inches. Both are first-class here; kg/cm stay the internal truth.
export const KG_PER_LB = 0.45359237;

export function kgToDisplay(kg, unit) {
  return unit === 'lb' ? kg / KG_PER_LB : kg;
}
export function displayToKg(v, unit) {
  return unit === 'lb' ? v * KG_PER_LB : v;
}
export function fmtMass(kg, unit) {
  return unit === 'lb' ? `${(kg / KG_PER_LB).toFixed(0)} lb` : `${kg.toFixed(kg < 20 ? 1 : 0)} kg`;
}

export function cmToFeetInches(cm) {
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return { ft, inch };
}
export function feetInchesToCm(ft, inch) { return (ft * 12 + inch) * 2.54; }
export function fmtLength(cm, unit) {
  if (unit !== 'ft') return `${cm.toFixed(0)} cm`;
  const { ft, inch } = cmToFeetInches(cm);
  return `${ft}′ ${inch}″`;
}
