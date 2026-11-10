/**
 * Anatomy audit: does every part sit where its name says it should?
 *
 * The atlas is good, but it has shipped mistakes before (the upper and lower trapezius
 * were named the wrong way round). This reads the registry the app loads, applies the same
 * load-time name fixes, and tests each part's bounding box against plain anatomical facts:
 *
 *   A  a part tagged left is on the left, one tagged right is on the right
 *   B  every left part has a right twin that mirrors it
 *   C  "superior X" is above "inferior X", "anterior" in front of "posterior", and so on
 *   D  numbered series run in order (ribs, vertebrae, fingers, toes, teeth)
 *   E  organs are on the correct side of the body (liver right, spleen left, ...)
 *   F  a muscle's body reaches the bones it is said to attach to
 *   G  the big nerves and vessels run in the correct compartment
 *
 * Source space: metres, z up, x positive on the body's LEFT, y negative at the FRONT.
 *
 * Usage:  node tools/audit_anatomy.mjs [--all]     (--all prints every finding, not a sample)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'public', 'data', 'registry.json'), 'utf8'));
const ALL = process.argv.includes('--all');

// ---- the same name repairs the app makes at load (src/core/registry.js) ----
// Attachment patches the import filed as bones (Registry._fixUntypedAttachments).
let untyped = 0;
{
  const byId = new Map(data.parts.map(p => [p.id, p]));
  for (const p of data.parts) {
    if (p.k !== 'mesh' || p.g !== 'skeletal') continue;
    const m = /\.([oe])\d+([lr])(?:\.\d+)?$/.exec(p.id);
    if (!m) continue;
    p.k = m[1] === 'o' ? 'origin' : 'insertion'; p.side = m[2];
    p.n = p.n.slice(0, m.index - (p.id.length - p.n.length)).replace(/^\((.*)\)$/, '$1'); p.muscle = p.n;
    const bone = byId.get(p.p); if (bone) p.bone = bone.n;
    untyped++;
  }
}
const SWAPPED = [
  ['Ascending part of trapezius muscle', 'Descending part of trapezius muscle'],
  ['Pars ascendens musculi trapezii', 'Pars descendens musculi trapezii'],
];
const swap = new Map();
for (const [a, b] of SWAPPED) { swap.set(a, b); swap.set(b, a); }
for (const p of data.parts) for (const f of ['n', 'b', 'muscle', 'la']) if (p[f] && swap.has(p[f])) p[f] = swap.get(p[f]);

// Side tags that disagree with where the part lies: the app corrects these at load
// (Registry._fixSides), so they are reported here as corrected, not as wrong.
const sideFixed = [];
for (const p of data.parts) {
  if (!p.side || !p.bb) continue;
  if (p.side === 'l' && p.bb[1][0] < -0.004) { sideFixed.push(p.id); p.side = 'r'; }
  else if (p.side === 'r' && p.bb[0][0] > 0.004) { sideFixed.push(p.id); p.side = 'l'; }
}

const parts = data.parts;
const meshes = parts.filter(p => p.k === 'mesh' && p.bb && p.g !== 'references');
const cen = p => [(p.bb[0][0] + p.bb[1][0]) / 2, (p.bb[0][1] + p.bb[1][1]) / 2, (p.bb[0][2] + p.bb[1][2]) / 2];
const size = p => [p.bb[1][0] - p.bb[0][0], p.bb[1][1] - p.bb[0][1], p.bb[1][2] - p.bb[0][2]];
const cm = v => (v * 100).toFixed(1) + ' cm';
const byName = new Map();
for (const p of meshes) {
  const k = p.sys + '|' + p.n.toLowerCase() + '|' + (p.side || '');
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(p);
}
/** The first mesh with this exact name (any system unless given), on this side if given. */
const find = (name, side = null, sys = null) => meshes.find(p => p.n.toLowerCase() === name.toLowerCase()
  && (side === null || (p.side || '') === side) && (!sys || p.sys === sys));
const findAll = (re, sys = null) => meshes.filter(p => re.test(p.n) && (!sys || p.sys === sys));

const findings = {};
const add = (check, sev, msg) => { (findings[check] ||= []).push({ sev, msg }); };

// ---------- A: side tags ----------
for (const p of meshes) {
  if (!p.side) continue;
  const [x] = cen(p);
  // Wholly on the wrong side of the midline (not merely crossing it).
  if (p.side === 'l' && p.bb[1][0] < -0.004) add('A side', 'high', `${p.id} is tagged LEFT but lies wholly on the right (x ${cm(x)})`);
  else if (p.side === 'r' && p.bb[0][0] > 0.004) add('A side', 'high', `${p.id} is tagged RIGHT but lies wholly on the left (x ${cm(x)})`);
  else if ((p.side === 'l' && x < -0.01) || (p.side === 'r' && x > 0.01)) add('A side', 'low', `${p.id} tagged ${p.side} has its centre ${cm(Math.abs(x))} across the midline`);
}

// ---------- B: left/right twins ----------
// Organs that really are one-sided or differ between sides.
const ASYM = /lung|bronch|lobe|liver|hepatic|spleen|splen|stomach|gastric|colon|colic|caec|append|heart|ventric|atri|coronary|cardiac|aort|azygos|brachiocephalic|vena cava|pulmonary|thoracic duct|pancrea|duoden|jejun|ile|mesenter|portal|kidney|renal|suprarenal|testicular|ovarian|gonadal|recurrent laryngeal|vagus|phrenic|oesophag|subclavian|common carotid|intercostal vein|lumbar vein|hemiazygos|segment|cystic|gallbladder|bile|sigmoid|rectal|coeliac|lymph|node|trunk|rib|cisterna/i;
for (const p of meshes) {
  if (p.side !== 'l') continue;
  const mirrorOff = (q) => { const a = cen(p), b = cen(q); return Math.hypot(a[0] + b[0], a[1] - b[1], a[2] - b[2]); };
  const twin = meshes.filter(q => q.side === 'r' && q.sys === p.sys && q.n === p.n).sort((x, y) => mirrorOff(x) - mirrorOff(y))[0];
  if (!twin || !twin.bb) { if (!ASYM.test(p.n)) add('B twin', 'low', `${p.id} has no right-side twin`); continue; }
  const a = cen(p), b = cen(twin);
  const off = Math.hypot(a[0] + b[0], a[1] - b[1], a[2] - b[2]);
  if (off > 0.02 && !ASYM.test(p.n)) add('B twin', off > 0.05 ? 'high' : 'low', `${p.n} [${p.sys}]: left and right are not mirror images, ${cm(off)} apart`);
}

// ---------- C: directional name pairs ----------
// axis: 0 x (|x| for medial/lateral), 1 y (front is negative), 2 z (up)
const DIR = [
  ['superior', 'inferior', (a, b) => a[2] - b[2], 'above'],
  ['upper', 'lower', (a, b) => a[2] - b[2], 'above'],
  ['supreme', 'inferior', (a, b) => a[2] - b[2], 'above'],
  ['anterior', 'posterior', (a, b) => b[1] - a[1], 'in front of'],
  ['ventral', 'dorsal', (a, b) => b[1] - a[1], 'in front of'],
  ['lateral', 'medial', (a, b) => Math.abs(a[0]) - Math.abs(b[0]), 'further from the midline than'],
  ['proximal', 'distal', (a, b) => a[2] - b[2], 'above'],
];
// Words that look directional but name something else for these structures.
const C_SKIP = /interphalangeal joints|branch of obturator|rotation|flexion|axillary line|median line|oblique|rectus (capitis|muscle of)|cruciate|talofibular|tibiofibular|tibiotalar|cricoarytenoid|scalene|serratus posterior|pancreaticoduodenal|ulnar recurrent|circumflex humeral|interosseous|cutaneous nerve of (arm|forearm|thigh)|tibial (artery|vein|recurrent)|communicating|spinal artery|cerebral|cerebellar|choroidal|longitudinal ligament|sacro-?iliac|sternoclavicular|ethmoidal|auricular|deep temporal|superior alveolar|labial|ampullary|semicircular|horn|commissure|root|ramus|rami|division|cord of brachial|papillary|cusp|leaflet|segment|basal|tubercle|gluteal line|iliac spine|facet|process|border|surface|angle|part of/i;
const words = n => n.toLowerCase().split(/[^a-z]+/).filter(Boolean);
const keyOf = p => p.sys + '|' + (p.side || '') + '|';
const nameIndex = new Map();
for (const p of meshes) { const k = keyOf(p) + p.n.toLowerCase(); if (!nameIndex.has(k)) nameIndex.set(k, p); }
let cPairs = 0;
for (const p of meshes) {
  const lower = p.n.toLowerCase();
  if (C_SKIP.test(lower)) continue;
  for (const [w1, w2, diff, phrase] of DIR) {
    const re = new RegExp(`\\b${w1}\\b`);
    if (!re.test(lower)) continue;
    const other = nameIndex.get(keyOf(p) + lower.replace(re, w2));
    if (!other) continue;
    cPairs++;
    const dlt = diff(cen(p), cen(other));
    if (dlt < -0.004) add('C direction', dlt < -0.015 ? 'high' : 'low',
      `"${p.n}" should be ${phrase} "${other.n}" but is ${cm(-dlt)} the other way [${p.sys}${p.side ? ' ' + p.side : ''}]`);
  }
}

// ---------- D: numbered series ----------
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
function series(label, names, axis, dir, side = '', sys = null, tol = 0.002) {
  const got = names.map(n => find(n, side, sys));
  const missing = names.filter((n, i) => !got[i]);
  if (missing.length) { add('D series', 'low', `${label}${side ? ' ' + side : ''}: not found: ${missing.join(', ')}`); }
  const have = got.filter(Boolean);
  for (let i = 0; i < have.length - 1; i++) {
    const a = cen(have[i]), b = cen(have[i + 1]);
    const va = axis === 'ax' ? Math.abs(a[0]) : a[axis], vb = axis === 'ax' ? Math.abs(b[0]) : b[axis];
    if ((vb - va) * dir < -tol) add('D series', 'high', `${label}${side ? ' ' + side : ''}: "${have[i].n}" and "${have[i + 1].n}" are out of order`);
  }
  return have.length;
}
let dCount = 0;
for (const s of ['l', 'r']) {
  dCount += series('Ribs', ORD.map(o => `${o[0].toUpperCase() + o.slice(1)} rib`), 2, -1, s, 'skeletal');
  // Anatomical position, palms forward: the thumb is outermost, the big toe innermost.
  dCount += series('Metacarpals', ORD.slice(0, 5).map(o => `${o[0].toUpperCase() + o.slice(1)} metacarpal bone`), 'ax', -1, s, 'skeletal');
  dCount += series('Metatarsals', ORD.slice(0, 5).map(o => `${o[0].toUpperCase() + o.slice(1)} metatarsal bone`), 'ax', 1, s, 'skeletal');
  for (const ph of ['Proximal', 'Distal']) {
    dCount += series(`${ph} phalanges of hand`, ORD.slice(0, 5).map(o => `${ph} phalanx of ${o} finger of hand`), 'ax', -1, s, 'skeletal');
    dCount += series(`${ph} phalanges of foot`, ORD.slice(0, 5).map(o => `${ph} phalanx of ${o} finger of foot`), 'ax', 1, s, 'skeletal');
  }
  dCount += series('Arm chain', ['Clavicle', 'Humerus', 'Radius', 'Capitate bone', 'Third metacarpal bone', 'Distal phalanx of third finger of hand'], 2, -1, s, 'skeletal');
  dCount += series('Leg chain', ['Hip bone', 'Femur', 'Patella', 'Tibia', 'Talus', 'Calcaneus'], 2, -1, s, 'skeletal');
  dCount += series('Carpal rows (proximal above distal)', ['Lunate bone', 'Capitate bone'], 2, -1, s, 'skeletal');
  dCount += series('Forearm bones (radius outside ulna, palms forward)', ['Ulna', 'Radius'], 'ax', 1, s, 'skeletal');
  dCount += series('Leg bones (fibula outside tibia)', ['Tibia', 'Fibula'], 'ax', 1, s, 'skeletal');
  dCount += series('Carpals, proximal row inside to outside', ['Triquetrum bone', 'Lunate bone', 'Scaphoid bone'], 'ax', 1, s, 'skeletal');
  dCount += series('Pisiform on the palm side of the triquetrum', ['Pisiform bone', 'Triquetrum bone'], 1, 1, s, 'skeletal', 0.004);
  dCount += series('Carpals, distal row inside to outside', ['Hamate bone', 'Capitate bone', 'Trapezoid bone', 'Trapezium bone'], 'ax', 1, s, 'skeletal');
  dCount += series('Tarsals front to back', ['Calcaneus', 'Talus', 'Navicular bone', 'Intermediate cuneiform bone'], 1, -1, s, 'skeletal');
}
const VERT = ['Atlas (C1)', 'Axis (C2)', ...[3, 4, 5, 6, 7].map(i => `Vertebra C${i}`), ...Array.from({ length: 12 }, (_, i) => `Vertebra T${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `Vertebra L${i + 1}`), 'Sacrum', 'Coccyx'];
dCount += series('Spine', VERT, 2, -1, '', 'skeletal');

// ---------- E: organs on the correct side, and trunk order ----------
function expect(label, ok, detail, sev = 'high') { if (!ok) add('E situs', sev, `${label}: ${detail}`); return ok; }
let eCount = 0;
function sideOf(re, sys, want, label) {
  const ms = findAll(re, sys);
  if (!ms.length) { add('E situs', 'low', `${label}: no part found`); return; }
  // Volume-weighted centre across all pieces.
  let sx = 0, sw = 0;
  for (const m of ms) { const s = size(m), w = s[0] * s[1] * s[2] + 1e-9; sx += cen(m)[0] * w; sw += w; }
  const x = sx / sw;
  eCount++;
  if (want === 'reach-left' || want === 'reach-right') {
    const lo = Math.min(...ms.map(m => m.bb[0][0])), hi = Math.max(...ms.map(m => m.bb[1][0]));
    const ok = want === 'reach-left' ? hi > -lo + 0.004 : -lo > hi + 0.001;
    expect(label, ok, `expected to reach further to the body's ${want.slice(6)}; spans x ${cm(lo)} to ${cm(hi)}`);
  } else if (want === 'left') expect(label, x > 0.005, `expected on the body's left, centre is at x ${cm(x)}`);
  else if (want === 'right') expect(label, x < -0.005, `expected on the body's right, centre is at x ${cm(x)}`);
  else expect(label, Math.abs(x) < 0.02, `expected on the midline, centre is at x ${cm(x)}`);
}
sideOf(/^liver$|lobe of liver/i, 'digestive', 'right', 'Liver');
sideOf(/^gallbladder/i, 'digestive', 'right', 'Gallbladder');
sideOf(/^stomach$|body of stomach|fundus of stomach/i, 'digestive', 'left', 'Stomach');
sideOf(/^spleen$/i, 'lymphoid', 'left', 'Spleen');
sideOf(/^(caecum|cecum)|vermiform appendix|^appendix/i, 'digestive', 'right', 'Caecum and appendix');
sideOf(/ascending colon/i, 'digestive', 'right', 'Ascending colon');
sideOf(/descending colon/i, 'digestive', 'left', 'Descending colon');
sideOf(/sigmoid colon/i, 'digestive', 'reach-left', 'Sigmoid colon');
sideOf(/^heart$|left ventricle/i, 'cardiovascular', 'left', 'Heart (mostly left of the midline)');
sideOf(/inferior vena cava/i, 'cardiovascular', 'right', 'Inferior vena cava');
sideOf(/superior vena cava/i, 'cardiovascular', 'right', 'Superior vena cava');
sideOf(/^(abdominal aorta|thoracic aorta|descending aorta)/i, 'cardiovascular', 'left', 'Descending aorta (left of the midline)');
sideOf(/^azygos vein/i, 'cardiovascular', 'right', 'Azygos vein');
sideOf(/^hemi-?azygos vein/i, 'cardiovascular', 'reach-left', 'Hemiazygos vein');
sideOf(/brachiocephalic trunk/i, 'cardiovascular', 'reach-right', 'Brachiocephalic trunk');
sideOf(/^trachea$/i, 'respiratory', null, 'Trachea');
sideOf(/^(urinary )?bladder$/i, 'urinary', null, 'Bladder');
{ // The pancreas lies across the midline: head in the curve of the duodenum on the right, tail at the spleen on the left.
  const pa = find('Pancreas', null, 'digestive');
  if (pa) { eCount++; expect('Pancreas', pa.bb[0][0] < -0.015 && pa.bb[1][0] > 0.04, `should span from right of the midline to the spleen; spans x ${cm(pa.bb[0][0])} to ${cm(pa.bb[1][0])}`); }
}
sideOf(/^duodenum|part of duodenum/i, 'digestive', 'right', 'Duodenum');

// Lobes: three on the right lung, two on the left.
const lobes = s => findAll(/^(superior|middle|inferior) lobe of (right|left) lung$/i, 'respiratory').filter(p => new RegExp(s, 'i').test(p.n));
const rl = lobes('right'), ll = lobes('left');
if (rl.length || ll.length) {
  eCount++;
  expect('Lung lobes', rl.length === 3 && ll.length === 2, `right lung has ${rl.length} lobes (should be 3), left has ${ll.length} (should be 2)`);
  for (const p of rl) expect(p.n, cen(p)[0] < 0, 'is on the left side of the body');
  for (const p of ll) expect(p.n, cen(p)[0] > 0, 'is on the right side of the body');
}
// Kidneys: the right sits lower, under the liver.
const kl = find('Kidney', 'l'), kr = find('Kidney', 'r');
if (kl && kr) { eCount++; expect('Kidneys', cen(kl)[2] > cen(kr)[2], `left kidney should sit higher than the right; left ${cm(cen(kl)[2])}, right ${cm(cen(kr)[2])}`, 'low'); }
// Top-to-bottom order of the trunk's contents.
const zOf = (re, sys) => { const ms = findAll(re, sys); if (!ms.length) return null; return ms.reduce((s, m) => s + cen(m)[2], 0) / ms.length; };
const ORDER = [
  ['Brain', /telencephalon|cerebell/i, 'nervous'], ['Thyroid', /^thyroid gland|lobe of thyroid/i, 'endocrine'],
  ['Heart', /^heart$|ventricle/i, 'cardiovascular'], ['Liver', /^liver$|lobe of liver/i, 'digestive'],
  ['Kidneys', /^kidney$/i, 'urinary'], ['Bladder', /bladder/i, 'urinary'],
];
let prev = null;
for (const [label, re, sys] of ORDER) {
  const z = zOf(re, sys);
  if (z === null) { add('E situs', 'low', `${label}: no part found for the height check`); continue; }
  eCount++;
  if (prev && z > prev.z) add('E situs', 'high', `${label} (${cm(z)}) is above ${prev.label} (${cm(prev.z)})`);
  prev = { label, z };
}
// The heart sits behind the sternum and in front of the spine; the kidneys behind the gut.
const yOf = (re, sys) => { const ms = findAll(re, sys); return ms.length ? ms.reduce((s, m) => s + cen(m)[1], 0) / ms.length : null; };
const front = (a, b, la, lb) => { if (a === null || b === null) return; eCount++; if (!(a < b)) add('E situs', 'high', `${la} should be in front of ${lb}`); };
front(yOf(/^(body of )?sternum$/i, 'skeletal'), yOf(/^heart$|ventricle/i, 'cardiovascular'), 'Sternum', 'heart');
front(yOf(/^heart$|ventricle/i, 'cardiovascular'), yOf(/^Vertebra T[5-8]$/i, 'skeletal'), 'Heart', 'thoracic spine');
front(yOf(/^stomach$|body of stomach/i, 'digestive'), yOf(/^kidney$/i, 'urinary'), 'Stomach', 'kidneys');
front(yOf(/^trachea$/i, 'respiratory'), yOf(/^(o)?esophagus$|thoracic part of (o)?esophagus/i, 'digestive'), 'Trachea', 'oesophagus');
front(yOf(/^patella$/i, 'skeletal'), yOf(/^femur$/i, 'skeletal'), 'Kneecap', 'femur');
front(yOf(/^(urinary )?bladder$/i, 'urinary'), yOf(/^rectum$/i, 'digestive'), 'Bladder', 'rectum');

// ---------- F: muscles reach their attachments ----------
const gap = (a, b) => Math.hypot(...[0, 1, 2].map(i => Math.max(0, a.bb[0][i] - b.bb[1][i], b.bb[0][i] - a.bb[1][i])));
const att = parts.filter(p => (p.k === 'origin' || p.k === 'insertion') && p.bb);
let fCount = 0, fNoMesh = 0;
const muscleMesh = new Map();
for (const p of meshes) if (p.sys === 'muscular') {
  const k = p.n.toLowerCase() + '|' + (p.side || '');
  if (!muscleMesh.has(k)) muscleMesh.set(k, []);
  muscleMesh.get(k).push(p);
}
const noMesh = new Set();
for (const a of att) {
  const ms = muscleMesh.get((a.muscle || '').toLowerCase() + '|' + (a.side || '')) || muscleMesh.get((a.muscle || '').toLowerCase() + ' muscle|' + (a.side || ''));
  if (!ms) { fNoMesh++; noMesh.add(a.muscle); continue; }
  fCount++;
  const tendons = meshes.filter(m => m.sys === 'muscular' && (m.side || '') === (a.side || '')
    && /^(tendon|common tendon|aponeurosis)/i.test(m.n) && m.n.toLowerCase().includes((a.muscle || '').toLowerCase().replace(/ muscle$/, '')));
  const g = Math.min(...ms.concat(tendons).map(m => gap(m, a)));
  if (g > 0.03) add('F attachment', g > 0.08 ? 'high' : 'low', `${a.muscle} (${a.side || 'mid'}): its ${a.k} on "${a.bone}" is ${cm(g)} from the muscle's body`);
}

// ---------- G: nerves and vessels in the correct compartment ----------
let gCount = 0;
function rel(label, a, b, test, detail) {
  if (!a || !b) { add('G course', 'low', `${label}: part not found (${!a ? 'first' : 'second'})`); return; }
  gCount++;
  if (!test(cen(a), cen(b), a, b)) add('G course', 'high', `${label}: ${detail}`);
}
const nv = (name, side) => find(name, side, 'nervous') || find(name, side, 'cardiovascular');
for (const s of ['l', 'r']) {
  const femur = find('Femur', s, 'skeletal'), tibia = find('Tibia', s, 'skeletal'), fibula = find('Fibula', s, 'skeletal');
  const humerus = find('Humerus', s, 'skeletal'), ulna = find('Ulna', s, 'skeletal'), radius = find('Radius', s, 'skeletal');
  rel(`Sciatic nerve ${s}`, nv('Sciatic nerve', s), femur, (a, b) => a[1] > b[1], 'should run behind the femur');
  rel(`Femoral nerve ${s}`, nv('Femoral nerve', s), find('Hip bone', s, 'skeletal'), (a, b) => a[1] < b[1], 'should run in front of the hip bone');
  rel(`Femoral artery ${s}`, nv('Femoral artery', s), femur, (a, b) => a[1] < b[1] && Math.abs(a[0]) < Math.abs(b[0]) + 0.01, 'should run in front of and inside the femur');
  rel(`Popliteal artery ${s}`, nv('Popliteal artery', s), find('Patella', s, 'skeletal'), (a, b) => a[1] > b[1], 'should lie behind the knee');
  rel(`Tibial nerve ${s}`, nv('Tibial nerve', s), tibia, (a, b) => a[1] > b[1], 'should run behind the tibia');
  rel(`Common fibular nerve ${s}`, nv('Common fibular nerve', s), tibia, (a, b) => Math.abs(a[0]) > Math.abs(b[0]), 'should be on the outer side of the knee');
  rel(`Deep fibular nerve ${s}`, nv('Deep fibular nerve', s), nv('Tibial nerve', s), (a, b) => a[1] < b[1], 'should run in front of the tibial nerve');
  rel(`Great saphenous vein ${s}`, nv('Great saphenous vein', s), femur, (a, b) => Math.abs(a[0]) < Math.abs(b[0]), 'should run up the inner side of the leg');
  rel(`Small saphenous vein ${s}`, nv('Small saphenous vein', s), tibia, (a, b) => a[1] > b[1], 'should run up the back of the calf');
  rel(`Ulnar nerve ${s}`, nv('Ulnar nerve', s), nv('Radial nerve', s), (a, b) => Math.abs(a[0]) < Math.abs(b[0]), 'should be on the inner (little-finger) side of the radial nerve');
  rel(`Ulnar artery ${s}`, nv('Ulnar artery', s), nv('Radial artery', s), (a, b) => Math.abs(a[0]) < Math.abs(b[0]), 'should be on the inner side of the radial artery');
  rel(`Radial artery ${s}`, nv('Radial artery', s), radius, (a, b) => a[1] < b[1] + 0.01, 'should lie on the front of the radius');
  rel(`Brachial artery ${s}`, nv('Brachial artery', s), humerus, (a, b) => Math.abs(a[0]) < Math.abs(b[0]), 'should run down the inner side of the humerus');
  rel(`Median nerve ${s}`, nv('Median nerve', s), humerus, (a, b, A, B) => A.bb[0][2] < B.bb[0][2], 'should carry on below the elbow into the forearm');
  rel(`Axillary nerve ${s}`, nv('Axillary nerve', s), humerus, (a, b, A, B) => a[2] > B.bb[0][2] + (B.bb[1][2] - B.bb[0][2]) * 0.6, 'should be up at the neck of the humerus');
  rel(`Cephalic vein ${s}`, nv('Cephalic vein', s), nv('Basilic vein', s), (a, b, A, B) => Math.max(Math.abs(A.bb[0][0]), Math.abs(A.bb[1][0])) > Math.max(Math.abs(B.bb[0][0]), Math.abs(B.bb[1][0])), 'should run further out on the arm than the basilic vein');
  rel(`Internal jugular vein ${s}`, nv('Internal jugular vein', s), nv(`${s === 'l' ? 'Left' : 'Right'} common carotid artery`, null), (a, b) => Math.abs(a[0]) > Math.abs(b[0]) - 0.002, 'should lie outside the common carotid artery');
  rel(`Vagus nerve ${s}`, nv('Vagus nerve (X)', s), find('Vertebra T4', '', 'skeletal'), (a, b, A) => A.bb[1][2] > 1.45 && A.bb[0][2] < b[2], 'should run from the skull down into the chest');
  rel(`Achilles tendon ${s}`, find('Calcaneal tendon', s, 'muscular'), tibia, (a, b) => a[1] > b[1], 'should be behind the tibia');
  rel(`Biceps brachii ${s}`, findAll(/^(long|short) head of biceps brachii$/i, 'muscular').find(p => p.side === s), humerus, (a, b) => a[1] < b[1], 'should be in front of the humerus');
  rel(`Triceps ${s}`, findAll(/^(long|lateral|medial) head of triceps brachii$/i, 'muscular').find(p => p.side === s), humerus, (a, b) => a[1] > b[1], 'should be behind the humerus');
  rel(`Rectus femoris ${s}`, find('Rectus femoris', s, 'muscular') || find('Rectus femoris muscle', s, 'muscular'), femur, (a, b) => a[1] < b[1], 'should be in front of the femur');
  rel(`Semitendinosus ${s}`, find('Semitendinosus', s, 'muscular') || find('Semitendinosus muscle', s, 'muscular'), femur, (a, b) => a[1] > b[1], 'should be behind the femur');
  rel(`Gastrocnemius ${s}`, findAll(/head of gastrocnemius/i, 'muscular').find(p => p.side === s), tibia, (a, b) => a[1] > b[1], 'should be behind the tibia');
  rel(`Tibialis anterior ${s}`, find('Tibialis anterior', s, 'muscular') || find('Tibialis anterior muscle', s, 'muscular'), fibula, (a, b) => a[1] < b[1], 'should be in front of the fibula');
  rel(`Gluteus maximus ${s}`, find('Gluteus maximus', s, 'muscular') || find('Gluteus maximus muscle', s, 'muscular'), find('Hip bone', s, 'skeletal'), (a, b) => a[1] > b[1], 'should be behind the hip bone');
  rel(`Pectoralis major ${s}`, findAll(/pectoralis major/i, 'muscular').find(p => p.side === s), find('Scapula', s, 'skeletal'), (a, b) => a[1] < b[1], 'should be in front of the shoulder blade');
  rel(`Latissimus dorsi ${s}`, findAll(/latissimus dorsi/i, 'muscular').find(p => p.side === s), find('Body of sternum', '', 'skeletal') || find('Sternum', '', 'skeletal'), (a, b) => a[1] > b[1], 'should be behind the sternum');
  rel(`Upper trapezius ${s}`, findAll(/^descending part of trapezius/i, 'muscular').find(p => p.side === s), findAll(/^ascending part of trapezius/i, 'muscular').find(p => p.side === s), (a, b) => a[2] > b[2], 'the descending (upper) part should be above the ascending (lower) part');
}

// ---------- H: is it there at all? ----------
const EXPECTED = {
  nervous: ['Sciatic nerve', 'Femoral nerve', 'Tibial nerve', 'Common fibular nerve', 'Median nerve', 'Ulnar nerve', 'Radial nerve', 'Axillary nerve', 'Musculocutaneous nerve', 'Vagus nerve (X)', 'Phrenic nerve', 'Obturator nerve', 'Pudendal nerve', 'Spinal cord', 'Optic nerve (II)', 'Facial nerve (VII)', 'Trigeminal nerve (V)'],
  cardiovascular: ['Heart', 'Aortic arch', 'Abdominal aorta', 'Inferior vena cava', 'Superior vena cava', 'Pulmonary trunk', 'Femoral artery', 'Brachial artery', 'Radial artery', 'Internal jugular vein', 'Great saphenous vein', 'Hepatic portal vein', 'Renal artery', 'Coeliac trunk'],
  digestive: ['Liver', 'Stomach', 'Pancreas', 'Gallbladder', 'Oesophagus', 'Duodenum', 'Jejunum', 'Ileum', 'Caecum', 'Vermiform appendix', 'Ascending colon', 'Transverse colon', 'Descending colon', 'Sigmoid colon', 'Rectum', 'Tongue'],
  respiratory: ['Trachea', 'Larynx', 'Lung'],
  urinary: ['Kidney', 'Ureter', 'Urinary bladder'],
  endocrine: ['Thyroid gland', 'Suprarenal gland', 'Hypophysis', 'Pineal gland'],
  lymphoid: ['Spleen', 'Thymus', 'Thoracic duct', 'Palatine tonsil'],
  muscular: ['Diaphragm', 'Gluteus maximus muscle', 'Rectus abdominis muscle', 'Latissimus dorsi muscle', 'Soleus muscle', 'Sternocleidomastoid muscle', 'Masseter muscle', 'Supraspinatus muscle', 'Iliacus muscle', 'Psoas major muscle', 'Sartorius muscle', 'Gracilis muscle', 'Tibialis anterior muscle', 'Brachialis muscle', 'Brachioradialis muscle'],
};
let hCount = 0;
const lc = (x) => x.toLowerCase();
const hasAnywhere = (name) => parts.some(p => (p.k === 'mesh' || p.k === 'group') && lc(p.n) === lc(name))
  || meshes.some(p => lc(p.n).includes(lc(name).replace(/ (muscle|gland)$/, '').replace(/ \(.*\)$/, '')));
for (const [sys, names] of Object.entries(EXPECTED)) for (const n of names) {
  hCount++;
  if (!hasAnywhere(n)) add('H missing', 'low', `${n} [${sys}] is not in the model`);
}

// ---------- report ----------
const order = ['A side', 'B twin', 'C direction', 'D series', 'E situs', 'F attachment', 'G course', 'H missing'];
const counts = { 'A side': meshes.filter(p => p.side).length, 'B twin': meshes.filter(p => p.side === 'l').length, 'C direction': cPairs, 'D series': dCount, 'E situs': eCount, 'F attachment': fCount, 'G course': gCount, 'H missing': hCount };
console.log(`Anatomy audit: ${parts.length} registry entries, ${meshes.length} meshes with geometry`);
console.log(`${untyped} attachment patches are filed as bones in the atlas data; the app re-files them at load`);
console.log(`${sideFixed.length} parts carry the wrong left/right tag in the atlas; the app corrects them at load${ALL ? ':\n   ' + sideFixed.join('\n   ') : ''}\n`);
let high = 0, low = 0;
for (const k of order) {
  const list = findings[k] || [];
  const h = list.filter(f => f.sev === 'high'), l = list.filter(f => f.sev === 'low');
  high += h.length; low += l.length;
  console.log(`${k.padEnd(14)} checked ${String(counts[k]).padStart(5)}   wrong ${String(h.length).padStart(3)}   to review ${String(l.length).padStart(3)}`);
  for (const f of h) console.log('   WRONG   ' + f.msg);
  for (const f of (ALL ? l : l.slice(0, 12))) console.log('   review  ' + f.msg);
  if (!ALL && l.length > 12) console.log(`   ... and ${l.length - 12} more (run with --all)`);
}
if (fNoMesh) console.log(`\nF: ${fNoMesh} attachments name a muscle with no mesh of that exact name (${noMesh.size} names)${ALL ? ': ' + [...noMesh].sort().join('; ') : ''}`);
console.log(`\n${high} wrong, ${low} to review`);
process.exit(high ? 1 : 0);
