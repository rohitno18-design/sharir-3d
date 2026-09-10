import * as THREE from 'three';

/**
 * Procedural tissue- and cell-level models (schematic, anatomically proportioned).
 * Each builder returns { group, legend: [{color, label, hi, note}] }.
 */
const M = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), roughness: o.roughness ?? 0.45, metalness: 0, clearcoat: o.clearcoat ?? 0.35, clearcoatRoughness: 0.4, transparent: o.opacity != null, opacity: o.opacity ?? 1, side: o.side || THREE.FrontSide, depthWrite: o.opacity == null || o.opacity > 0.5 });
const rnd = (seed => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; })(42);
const R = (a, b) => a + rnd() * (b - a);

function tube(curvePts, radius, color, segs = 64, closed = false) {
  const curve = new THREE.CatmullRomCurve3(curvePts, closed);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 12, closed), M(color));
}

function biconcave(r = 0.5, color = '#c62828') {
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; const x = t * r; const y = (0.10 + 0.22 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 1.2)) * r * (t < 0.06 ? 0.9 : 1); pts.push(new THREE.Vector2(x, y)); }
  const geo = new THREE.LatheGeometry(pts, 40);
  const top = new THREE.Mesh(geo, M(color, { clearcoat: 0.5 }));
  const bot = top.clone(); bot.scale.y = -1;
  const g = new THREE.Group(); g.add(top, bot); return g;
}

export const MICRO_MODELS = {
  bone: { key: 'bone', label: 'Compact bone (osteon)', hi: 'सघन अस्थि (ऑस्टियोन)', icon: '🦴', desc: 'Compact bone is built from osteons: concentric rings (lamellae) of mineralised collagen around a central Haversian canal carrying a blood vessel and nerve. Osteocytes live in tiny lacunae between the rings. Bone is remodelled all life long — ~10% of the skeleton is replaced every year.',
    build() {
      const g = new THREE.Group(); const legend = [];
      const cols = ['#e9dfc9', '#dccfb4', '#e9dfc9', '#d4c5a8'];
      const centers = [[0, 0], [1.9, 0.2], [-1.8, 0.4], [0.9, 1.8], [-0.9, -1.8], [1.2, -1.7], [-1.1, 1.9]];
      centers.forEach(([x, z], k) => {
        const rmax = 0.85;
        for (let i = 4; i >= 1; i--) {
          const ro = rmax * i / 4, ri = ro - 0.16;
          const shape = new THREE.Shape(); shape.absarc(0, 0, ro, 0, Math.PI * 2, false);
          const hole = new THREE.Path(); hole.absarc(0, 0, Math.max(0.12, ri), 0, Math.PI * 2, true); shape.holes.push(hole);
          const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2 - k * 0.05, bevelEnabled: false, curveSegments: 40 });
          const m = new THREE.Mesh(geo, M(cols[i % 4])); m.rotation.x = -Math.PI / 2; m.position.set(x, -1.1, z); g.add(m);
        }
        const canal = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 16), M('#c7332f')); canal.position.set(x, 0, z); g.add(canal);
        for (let j = 0; j < 14; j++) { const a = rnd() * Math.PI * 2, rr = R(0.25, 0.8); const lac = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M('#5a4a3a')); lac.scale.set(1.6, 0.6, 1); lac.position.set(x + Math.cos(a) * rr, R(-1, 1), z + Math.sin(a) * rr); g.add(lac); }
      });
      const peri = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 6), M('#efe6d3')); peri.position.y = 1.16; g.add(peri);
      legend.push({ color: '#e9dfc9', label: 'Lamellae (concentric bone rings)', hi: 'लैमिली' }, { color: '#c7332f', label: 'Haversian canal — blood vessel & nerve', hi: 'हैवर्सियन नलिका' }, { color: '#5a4a3a', label: 'Lacunae with osteocytes', hi: 'लैक्यूना (अस्थि कोशिका)' }, { color: '#efe6d3', label: 'Periosteum (outer membrane)', hi: 'पेरिओस्टियम' });
      return { group: g, legend };
    } },
  osteocyte: { key: 'osteocyte', label: 'Osteocyte (bone cell)', hi: 'अस्थि कोशिका', icon: '🔬', desc: 'A mature bone cell sits inside a lacuna and reaches out through ~50 tiny canaliculi to touch its neighbours. It senses mechanical load — this is how exercise tells bone to get denser and inactivity tells it to thin.',
    build() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 24), M('#c9a27a')); body.scale.set(1.5, 0.7, 1); g.add(body);
      const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), M('#6a4b7a')); nuc.scale.set(1.3, 0.7, 1); g.add(nuc);
      for (let i = 0; i < 26; i++) { const dir = new THREE.Vector3(R(-1, 1), R(-0.5, 0.5), R(-1, 1)).normalize(); const pts = [dir.clone().multiplyScalar(0.55), dir.clone().multiplyScalar(1.4).add(new THREE.Vector3(R(-.2, .2), R(-.2, .2), R(-.2, .2))), dir.clone().multiplyScalar(2.3).add(new THREE.Vector3(R(-.3, .3), R(-.3, .3), R(-.3, .3)))]; g.add(tube(pts, 0.035, '#d8b48e', 24)); }
      const matrix = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), M('#e9dfc9', { opacity: 0.18, side: THREE.BackSide })); g.add(matrix);
      return { group: g, legend: [{ color: '#c9a27a', label: 'Osteocyte body', hi: 'कोशिका काय' }, { color: '#d8b48e', label: 'Canaliculi (processes touching neighbours)', hi: 'कैनालिकुली' }, { color: '#6a4b7a', label: 'Nucleus', hi: 'केंद्रक' }] };
    } },
  muscle: { key: 'muscle', label: 'Skeletal muscle — fascicle & fibres', hi: 'कंकाल पेशी — फ़ैसिकल और तंतु', icon: '💪', desc: 'A muscle is bundles inside bundles: the whole muscle → fascicles (wrapped in perimysium) → muscle fibres (single giant cells, up to 30 cm long) → myofibrils → sarcomeres. Training adds myofibrils to each fibre (hypertrophy); it does not add many new fibres.',
    build() {
      const g = new THREE.Group();
      const peri = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 40, 1, true), M('#efe6d3', { opacity: 0.25, side: THREE.DoubleSide })); peri.rotation.z = Math.PI / 2; g.add(peri);
      const n = 19;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 * 2.6; const rr = 0.25 + Math.sqrt(i / n) * 1.1;
        const y = Math.cos(a) * rr, z = Math.sin(a) * rr;
        const fib = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 6.2, 18), M(i % 3 === 0 ? '#9c3a33' : '#a6403a')); fib.rotation.z = Math.PI / 2; fib.position.set(0, y, z); g.add(fib);
        for (let s = -2.8; s < 3; s += 0.32) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 24), M('#6e2823')); ring.rotation.y = Math.PI / 2; ring.position.set(s, y, z); g.add(ring); }
        if (i % 4 === 0) { const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), M('#4a2f6f')); nuc.scale.set(2.2, 1, 1); nuc.position.set(R(-2.5, 2.5), y + 0.17, z); g.add(nuc); }
      }
      const cap = tube([new THREE.Vector3(-3, 1.55, 0.3), new THREE.Vector3(-1, 1.6, -0.6), new THREE.Vector3(1, 1.55, 0.6), new THREE.Vector3(3, 1.6, -0.2)], 0.05, '#c7332f', 48); g.add(cap);
      return { group: g, legend: [{ color: '#a6403a', label: 'Muscle fibres (single cells) with striations', hi: 'पेशी तंतु' }, { color: '#4a2f6f', label: 'Nuclei (hundreds per fibre, at the edge)', hi: 'केंद्रक' }, { color: '#efe6d3', label: 'Perimysium wrapping the fascicle', hi: 'पेरिमाइसियम' }, { color: '#c7332f', label: 'Capillary', hi: 'केशिका' }] };
    } },
  sarcomere: { key: 'sarcomere', label: 'Sarcomere — actin & myosin', hi: 'सार्कोमियर', icon: '⚙️', desc: 'The contractile unit (~2.5 µm). Myosin heads on thick filaments grab thin actin filaments and pull them toward the centre, using one ATP per stroke. Calcium released by a nerve impulse uncovers the binding sites; that is the whole basis of movement — and creatine buys the ATP time.',
    build() {
      const g = new THREE.Group();
      const zd = (x) => { const d = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 2.2), M('#2f3440')); d.position.x = x; return d; };
      g.add(zd(-2.4), zd(2.4));
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
        const y = (i - 2) * 0.55, z = (j - 1.5) * 0.5;
        const thick = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 3.0, 12), M('#3b5ba9')); thick.rotation.z = Math.PI / 2; thick.position.set(0, y, z); g.add(thick);
        for (let h = -1.3; h <= 1.3; h += 0.26) { if (Math.abs(h) < 0.2) continue; const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M('#7f9ce0')); head.position.set(h, y + (h > 0 ? 0.14 : -0.14) * ((j % 2) ? 1 : -1), z + 0.1 * Math.sign(h)); g.add(head); }
      }
      for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
        const y = (i - 2.5) * 0.55, z = (j - 2) * 0.5;
        for (const side of [-1, 1]) { const thin = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 8), M('#e05d5d')); thin.rotation.z = Math.PI / 2; thin.position.set(side * 1.45, y, z); g.add(thin); }
      }
      return { group: g, legend: [{ color: '#3b5ba9', label: 'Thick filament (myosin) with heads', hi: 'मायोसिन' }, { color: '#e05d5d', label: 'Thin filament (actin)', hi: 'ऐक्टिन' }, { color: '#2f3440', label: 'Z-discs (sarcomere borders)', hi: 'Z-डिस्क' }] };
    } },
  cardiomyocyte: { key: 'cardiomyocyte', label: 'Heart muscle cells', hi: 'हृदय पेशी कोशिकाएँ', icon: '❤️', desc: 'Cardiac muscle cells are short, branched and joined end-to-end by intercalated discs so an electrical impulse spreads cell to cell — the heart beats as one. ~35% of their volume is mitochondria; they never rest, and they almost never divide, which is why a heart attack leaves a scar.',
    build() {
      const g = new THREE.Group();
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const cell = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.2, 6, 14), M(r % 2 ? '#a0332f' : '#b03b36')); cell.rotation.z = Math.PI / 2; cell.position.set((c - 1.5) * 1.75 + (r % 2) * 0.85, (r - 1) * 0.65, 0); g.add(cell);
        const disc = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.62), M('#2f3440')); disc.position.set(cell.position.x + 0.9, cell.position.y, 0); disc.rotation.y = 0.35; g.add(disc);
        const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), M('#4a2f6f')); nuc.scale.set(2, 1, 1); nuc.position.copy(cell.position); g.add(nuc);
        for (let k = 0; k < 6; k++) { const mito = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.1, 4, 8), M('#e9a23b')); mito.rotation.z = Math.PI / 2; mito.position.set(cell.position.x + R(-0.6, 0.6), cell.position.y + R(-0.18, 0.18), R(-0.18, 0.18)); g.add(mito); }
        if (c < 3 && r === 1) { const branch = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 6, 12), M('#a0332f')); branch.position.set(cell.position.x + 0.7, cell.position.y + 0.42, 0); branch.rotation.z = Math.PI / 4; g.add(branch); }
      }
      return { group: g, legend: [{ color: '#a0332f', label: 'Cardiomyocytes (branched)', hi: 'हृदय पेशी कोशिका' }, { color: '#2f3440', label: 'Intercalated discs', hi: 'इंटरकैलेटेड डिस्क' }, { color: '#e9a23b', label: 'Mitochondria (~35% of the cell)', hi: 'माइटोकॉन्ड्रिया' }, { color: '#4a2f6f', label: 'Nucleus', hi: 'केंद्रक' }] };
    } },
  artery: { key: 'artery', label: 'Artery wall — three layers', hi: 'धमनी की दीवार', icon: '🩸', desc: 'Tunica intima (a single layer of endothelial cells), tunica media (smooth muscle + elastic fibres — this is what tightens in high blood pressure), and tunica adventitia (connective tissue). Plaque (atherosclerosis) forms under the intima. Nitric-oxide from healthy endothelium keeps the vessel relaxed; smoking and sugar damage it first.',
    build() {
      const g = new THREE.Group();
      const layers = [[1.0, 1.08, '#f4d9c8', 'Tunica intima (endothelium)'], [1.08, 1.5, '#b0463c', 'Tunica media (smooth muscle + elastin)'], [1.5, 1.72, '#e8dccb', 'Tunica adventitia (connective tissue)']];
      for (const [ri, ro, col] of layers) {
        const shape = new THREE.Shape(); shape.absarc(0, 0, ro, 0, Math.PI * 1.35, false); shape.lineTo(Math.cos(Math.PI * 1.35) * ri, Math.sin(Math.PI * 1.35) * ri); shape.absarc(0, 0, ri, Math.PI * 1.35, 0, true); shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false, curveSegments: 60 });
        const m = new THREE.Mesh(geo, M(col)); m.rotation.y = Math.PI / 2; m.position.x = -2.5; g.add(m);
      }
      for (let i = 0; i < 14; i++) { const rbc = biconcave(0.28, '#c62828'); rbc.position.set(R(-2.3, 2.3), R(-0.6, 0.6), R(-0.6, 0.6)); rbc.rotation.set(R(0, 3), R(0, 3), R(0, 3)); g.add(rbc); }
      const wbc = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), M('#f5f0e6')); wbc.position.set(1.2, 0.2, -0.3); g.add(wbc);
      const plaque = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14), M('#e8c46a')); plaque.scale.set(1.6, 0.5, 1); plaque.position.set(-1, -0.95, 0.2); g.add(plaque);
      return { group: g, legend: [{ color: '#f4d9c8', label: 'Tunica intima (endothelium)', hi: 'ट्यूनिका इंटिमा' }, { color: '#b0463c', label: 'Tunica media (smooth muscle + elastin)', hi: 'ट्यूनिका मीडिया' }, { color: '#e8dccb', label: 'Tunica adventitia', hi: 'ट्यूनिका एडवेंटिशिया' }, { color: '#c62828', label: 'Red blood cells', hi: 'लाल रक्त कोशिका' }, { color: '#e8c46a', label: 'Cholesterol plaque (atheroma)', hi: 'प्लाक' }] };
    } },
  blood: { key: 'blood', label: 'Blood cells', hi: 'रक्त कोशिकाएँ', icon: '🩸', desc: 'One drop of blood: ~5 million red cells (no nucleus, packed with haemoglobin — 120-day life), ~7,000 white cells (neutrophils, lymphocytes, monocytes…), ~250,000 platelets. Iron deficiency (very common in Indian women) makes red cells small and pale.',
    build() {
      const g = new THREE.Group();
      for (let i = 0; i < 40; i++) { const rbc = biconcave(0.42, '#c62828'); rbc.position.set(R(-3, 3), R(-1.5, 1.5), R(-2, 2)); rbc.rotation.set(R(0, 3), R(0, 3), R(0, 3)); g.add(rbc); }
      for (let i = 0; i < 3; i++) { const w = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), M('#f2ede2', { opacity: 0.85 })); w.position.set(R(-2, 2), R(-1, 1), R(-1, 1)); g.add(w); for (let l = 0; l < 3; l++) { const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), M('#5b3f86')); lobe.position.copy(w.position).add(new THREE.Vector3(R(-.2, .2), R(-.2, .2), R(-.2, .2))); g.add(lobe); } }
      for (let i = 0; i < 18; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 10), M('#f3d59b')); p.position.set(R(-3, 3), R(-1.5, 1.5), R(-2, 2)); p.rotation.set(R(0, 3), R(0, 3), 0); g.add(p); }
      return { group: g, legend: [{ color: '#c62828', label: 'Red blood cells (erythrocytes)', hi: 'लाल रक्त कोशिका' }, { color: '#f2ede2', label: 'White blood cells (leukocytes)', hi: 'श्वेत रक्त कोशिका' }, { color: '#f3d59b', label: 'Platelets', hi: 'प्लेटलेट' }] };
    } },
  neuron: { key: 'neuron', label: 'Neuron & myelin', hi: 'न्यूरॉन और मायलिन', icon: '⚡', desc: 'A neuron receives signals on its dendrites, sums them at the cell body, and fires an impulse down the axon. Myelin sheaths (from oligodendrocytes/Schwann cells) let the signal jump between nodes of Ranvier at up to 120 m/s. B12 deficiency strips myelin — a real problem in vegetarian Indian diets.',
    build() {
      const g = new THREE.Group();
      const soma = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 24), M('#e9c95c')); soma.position.x = -3; g.add(soma);
      const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), M('#6a4b7a')); nuc.position.x = -3; g.add(nuc);
      for (let i = 0; i < 9; i++) { const d = new THREE.Vector3(R(-1, -0.2), R(-1, 1), R(-1, 1)).normalize(); const p0 = soma.position.clone().addScaledVector(d, 0.5); const p1 = p0.clone().addScaledVector(d, 0.9).add(new THREE.Vector3(R(-.3, .3), R(-.3, .3), R(-.3, .3))); const p2 = p1.clone().addScaledVector(d, 0.9).add(new THREE.Vector3(R(-.4, .4), R(-.4, .4), R(-.4, .4))); g.add(tube([p0, p1, p2], 0.06, '#e9c95c', 20)); g.add(tube([p1, p1.clone().add(new THREE.Vector3(R(-.6, .2), R(-.6, .6), R(-.6, .6)))], 0.035, '#e9c95c', 10)); }
      const axon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6, 12), M('#e9c95c')); axon.rotation.z = Math.PI / 2; axon.position.x = 0.4; g.add(axon);
      for (let x = -2.1; x < 3.0; x += 0.95) { const my = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.55, 6, 14), M('#f4f1ea', { clearcoat: 0.6 })); my.rotation.z = Math.PI / 2; my.position.x = x; g.add(my); }
      for (let i = 0; i < 5; i++) { const d = new THREE.Vector3(1, R(-1, 1), R(-1, 1)).normalize(); const p0 = new THREE.Vector3(3.3, 0, 0); const p1 = p0.clone().addScaledVector(d, 0.8); g.add(tube([p0, p1], 0.05, '#e9c95c', 10)); const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), M('#d9a441')); b.position.copy(p1); g.add(b); }
      return { group: g, legend: [{ color: '#e9c95c', label: 'Cell body, dendrites, axon', hi: 'कोशिका काय, डेंड्राइट, ऐक्सॉन' }, { color: '#f4f1ea', label: 'Myelin sheath (nodes of Ranvier between)', hi: 'मायलिन आवरण' }, { color: '#d9a441', label: 'Axon terminals (synapses)', hi: 'ऐक्सॉन टर्मिनल' }] };
    } },
  synapse: { key: 'synapse', label: 'Synapse', hi: 'सिनैप्स', icon: '✨', desc: 'The 20-nanometre gap where one neuron talks to the next. An impulse triggers vesicles to release neurotransmitter (dopamine, serotonin, glutamate…) that binds receptors on the other side. Caffeine, nicotine, alcohol, antidepressants and sleep all act here. Learning = synapses strengthening.',
    build() {
      const g = new THREE.Group();
      const pre = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 24), M('#e9c95c', { opacity: 0.9 })); pre.scale.set(1, 0.85, 1); pre.position.y = 1.05; g.add(pre);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.9, 40), M('#d9a441')); post.position.y = -0.85; g.add(post);
      for (let i = 0; i < 24; i++) { const v = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), M('#f4f1ea', { opacity: 0.95 })); v.position.set(R(-0.7, 0.7), R(0.35, 1.5), R(-0.7, 0.7)); g.add(v); for (let k = 0; k < 4; k++) { const nt = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), M('#22c55e')); nt.position.copy(v.position).add(new THREE.Vector3(R(-.06, .06), R(-.06, .06), R(-.06, .06))); g.add(nt); } }
      for (let i = 0; i < 30; i++) { const nt = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), M('#22c55e')); nt.position.set(R(-0.9, 0.9), R(-0.35, 0.2), R(-0.9, 0.9)); g.add(nt); }
      for (let i = 0; i < 14; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.28, 8), M('#38bdf8')); r.position.set(R(-1.1, 1.1), -0.35, R(-1.1, 1.1)); g.add(r); }
      return { group: g, legend: [{ color: '#e9c95c', label: 'Presynaptic terminal', hi: 'प्री-सिनैप्टिक टर्मिनल' }, { color: '#f4f1ea', label: 'Vesicles holding neurotransmitter', hi: 'वेसिकल' }, { color: '#22c55e', label: 'Neurotransmitter molecules', hi: 'न्यूरोट्रांसमीटर' }, { color: '#38bdf8', label: 'Receptors on the next neuron', hi: 'रिसेप्टर' }] };
    } },
  alveolus: { key: 'alveolus', label: 'Alveoli & capillaries', hi: 'वायुकोष्ठ और केशिकाएँ', icon: '🫁', desc: 'Each lung holds ~300 million alveoli — tiny sacs with a wall one cell thick, wrapped in capillaries. Oxygen crosses into blood, CO₂ crosses out, across a total surface the size of a tennis court. Smoke and PM2.5 pollution inflame this wall; emphysema destroys the sacs.',
    build() {
      const g = new THREE.Group();
      const centers = [];
      for (let i = 0; i < 12; i++) { const a = i * 0.9, r = i < 1 ? 0 : 1.15 + (i % 2) * 0.35; centers.push(new THREE.Vector3(Math.cos(a) * r, R(-0.8, 0.8), Math.sin(a) * r)); }
      for (const c of centers) { const s = new THREE.Mesh(new THREE.SphereGeometry(R(0.55, 0.75), 24, 18), M('#f0c3c8', { opacity: 0.75 })); s.position.copy(c); g.add(s); }
      for (let i = 0; i < 18; i++) { const c = centers[i % centers.length]; const pts = []; for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI * 2 + i; pts.push(c.clone().add(new THREE.Vector3(Math.cos(a) * 0.72, Math.sin(a * 2) * 0.25 + (i % 3 - 1) * 0.3, Math.sin(a) * 0.72))); } g.add(tube(pts, 0.035, i % 2 ? '#c7332f' : '#3b5ba9', 48, true)); }
      const bronch = tube([new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0.1, 0.9, 0)], 0.22, '#dadce1', 20); g.add(bronch);
      return { group: g, legend: [{ color: '#f0c3c8', label: 'Alveoli (air sacs)', hi: 'वायुकोष्ठ' }, { color: '#c7332f', label: 'Capillary — oxygenated', hi: 'ऑक्सीजन-युक्त केशिका' }, { color: '#3b5ba9', label: 'Capillary — deoxygenated', hi: 'ऑक्सीजन-रहित केशिका' }, { color: '#dadce1', label: 'Bronchiole', hi: 'श्वसनिका' }] };
    } },
  nephron: { key: 'nephron', label: 'Nephron', hi: 'नेफ़्रॉन', icon: '🫘', desc: 'Each kidney has ~1 million nephrons. Blood is filtered in the glomerulus (~180 litres/day), then the tubule reclaims 99% of the water, salt and glucose — what is left is urine. High blood pressure and high sugar destroy glomeruli silently; drinking far too much water mostly just makes them work harder.',
    build() {
      const g = new THREE.Group();
      const glomPts = []; for (let i = 0; i < 60; i++) { const t = i / 60 * Math.PI * 8; const r = 0.55 * Math.sin(i / 60 * Math.PI); glomPts.push(new THREE.Vector3(Math.cos(t) * r, (i / 60 - 0.5) * 1.1 + 2, Math.sin(t) * r)); }
      g.add(tube(glomPts, 0.05, '#c7332f', 200));
      const caps = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), M('#e6d5b8', { opacity: 0.35, side: THREE.DoubleSide })); caps.position.y = 2; g.add(caps);
      const tub = [new THREE.Vector3(0.7, 1.6, 0), new THREE.Vector3(1.6, 1.4, 0.4), new THREE.Vector3(2.0, 0.6, -0.3), new THREE.Vector3(1.5, 0.0, 0.3), new THREE.Vector3(1.2, -1.8, 0), new THREE.Vector3(1.0, -2.6, 0), new THREE.Vector3(0.6, -1.8, 0.1), new THREE.Vector3(0.3, -0.2, 0.2), new THREE.Vector3(-0.3, 0.8, -0.4), new THREE.Vector3(-1.2, 0.6, 0.3), new THREE.Vector3(-1.6, -0.3, 0), new THREE.Vector3(-1.6, -2.8, 0)];
      g.add(tube(tub, 0.13, '#e2c58b', 220));
      const collect = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4.2, 16), M('#d9c5a2')); collect.position.set(-1.6, -1.5, 0); g.add(collect);
      const aff = tube([new THREE.Vector3(-1.2, 2.8, 0.2), new THREE.Vector3(-0.5, 2.5, 0)], 0.08, '#c7332f', 12); g.add(aff);
      return { group: g, legend: [{ color: '#c7332f', label: 'Glomerulus (capillary ball — filters blood)', hi: 'ग्लोमेरुलस' }, { color: '#e6d5b8', label: "Bowman's capsule", hi: 'बोमैन संपुट' }, { color: '#e2c58b', label: 'Tubule + loop of Henle (reabsorbs 99%)', hi: 'नलिका' }, { color: '#d9c5a2', label: 'Collecting duct → urine', hi: 'संग्रह नलिका' }] };
    } },
  hepatocyte: { key: 'hepatocyte', label: 'Liver lobule', hi: 'यकृत लोब्यूल', icon: '🟤', desc: 'The liver is built of hexagonal lobules: plates of hepatocytes radiating from a central vein, with blood sinusoids between them. Every drop of gut blood passes here — alcohol, paracetamol, fructose, medicines are all processed by hepatocytes. Fat inside them = fatty liver (now ~1 in 3 urban Indians); scarring = cirrhosis.',
    build() {
      const g = new THREE.Group();
      const hexShape = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const x = Math.cos(a) * 2.4, y = Math.sin(a) * 2.4; i ? hexShape.lineTo(x, y) : hexShape.moveTo(x, y); } hexShape.closePath();
      const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(hexShape, { depth: 1.2, bevelEnabled: false }), M('#8b3b2f', { opacity: 0.35 })); slab.rotation.x = -Math.PI / 2; slab.position.y = -0.6; g.add(slab);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; for (let r = 0.5; r < 2.2; r += 0.36) { const cell = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), M('#a8483a')); cell.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); cell.rotation.y = -a; g.add(cell); const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M('#4a2f6f')); nuc.position.copy(cell.position); nuc.position.y += 0.1; g.add(nuc); } if (i % 2) g.add(tube([new THREE.Vector3(Math.cos(a + 0.13) * 0.45, 0.05, Math.sin(a + 0.13) * 0.45), new THREE.Vector3(Math.cos(a + 0.13) * 2.2, 0.05, Math.sin(a + 0.13) * 2.2)], 0.07, '#c7332f', 8)); }
      const cv = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 20), M('#3b5ba9')); g.add(cv);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; const pt = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 12), M('#4d8b4c')); pt.position.set(Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3); g.add(pt); }
      return { group: g, legend: [{ color: '#a8483a', label: 'Hepatocyte plates', hi: 'यकृत कोशिकाएँ' }, { color: '#c7332f', label: 'Sinusoids (blood flowing inward)', hi: 'साइनसॉइड' }, { color: '#3b5ba9', label: 'Central vein', hi: 'केंद्रीय शिरा' }, { color: '#4d8b4c', label: 'Portal triads (bile duct, artery, portal vein)', hi: 'पोर्टल त्रिक' }] };
    } },
  villus: { key: 'villus', label: 'Intestinal villi', hi: 'आँत के विलाई', icon: '🌿', desc: 'The small intestine lining is folded into millions of finger-like villi (each with micro-villi), giving ~30 m² of absorptive surface. Sugar, amino acids and fats enter here; a capillary net and a lacteal (lymph vessel) carry them away. The gut lining renews itself every 3–5 days.',
    build() {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 4), M('#d8a291')); base.position.y = -0.25; g.add(base);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const x = (i - 1.5) * 1.4, z = (j - 1) * 1.3; const h = R(1.8, 2.6); const v = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, h, 8, 20), M('#e2ad9b', { opacity: 0.85 })); v.position.set(x, h / 2 + 0.2, z); g.add(v); const cap = []; for (let k = 0; k <= 10; k++) cap.push(new THREE.Vector3(x + Math.cos(k * 1.3) * 0.3, 0.2 + k / 10 * h, z + Math.sin(k * 1.3) * 0.3)); g.add(tube(cap, 0.04, k => '#c7332f', 40)); const lac = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h * 0.9, 10), M('#79b06a')); lac.position.set(x, h / 2 + 0.2, z); g.add(lac); }
      return { group: g, legend: [{ color: '#e2ad9b', label: 'Villus (epithelium with microvilli)', hi: 'विलस' }, { color: '#c7332f', label: 'Capillary network (sugars, amino acids)', hi: 'केशिका जाल' }, { color: '#79b06a', label: 'Lacteal — lymph vessel (fats)', hi: 'लैक्टियल' }] };
    } },
  skin: { key: 'skin', label: 'Skin layers', hi: 'त्वचा की परतें', icon: '🧴', desc: 'Epidermis (renews every ~4 weeks; melanocytes give Indian skin its melanin, which protects from UV but slows vitamin-D synthesis), dermis (collagen, elastin, blood vessels, nerves, sweat and sebaceous glands, hair follicles) and hypodermis (fat). Sugar cross-links collagen (glycation) → early ageing.',
    build() {
      const g = new THREE.Group();
      const layers = [[0.35, '#b9784e', 'Epidermis'], [1.6, '#e7c2a5', 'Dermis'], [1.3, '#f3d98b', 'Hypodermis (fat)']];
      let y = 0;
      for (const [h, col] of layers) { const m = new THREE.Mesh(new THREE.BoxGeometry(6, h, 4), M(col)); m.position.y = -y - h / 2; g.add(m); y += h; }
      const melan = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 4), M('#5a331f')); melan.position.y = -0.33; g.add(melan);
      const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 8), M('#1c1613')); hair.position.set(-1.5, 0.2, 0); hair.rotation.z = 0.25; g.add(hair);
      const foll = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 6, 12), M('#d9a98d')); foll.position.set(-1.8, -1.3, 0); foll.rotation.z = 0.25; g.add(foll);
      const seb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), M('#f1e3a8')); seb.position.set(-1.35, -0.75, 0.3); g.add(seb);
      const sweatPts = []; for (let k = 0; k < 40; k++) sweatPts.push(new THREE.Vector3(1.6 + Math.cos(k * 0.9) * 0.28, -1.5 - (k / 40) * 0.6, Math.sin(k * 0.9) * 0.28)); sweatPts.unshift(new THREE.Vector3(1.4, 0.02, 0), new THREE.Vector3(1.55, -0.8, 0)); g.add(tube(sweatPts, 0.05, '#cfe3ea', 160));
      g.add(tube([new THREE.Vector3(-2.9, -1.4, 1.2), new THREE.Vector3(-1, -1.0, 0.9), new THREE.Vector3(1, -1.3, 1.2), new THREE.Vector3(2.9, -1.0, 1.0)], 0.07, '#c7332f', 40));
      g.add(tube([new THREE.Vector3(-2.9, -1.7, -1.2), new THREE.Vector3(-0.5, -1.3, -1.0), new THREE.Vector3(2.9, -1.6, -1.2)], 0.06, '#3b5ba9', 40));
      g.add(tube([new THREE.Vector3(-2.9, -0.9, -0.2), new THREE.Vector3(0, -0.7, 0), new THREE.Vector3(0.8, -0.45, 0.1)], 0.035, '#e9c95c', 30));
      for (let i = 0; i < 9; i++) { const fat = new THREE.Mesh(new THREE.SphereGeometry(R(0.25, 0.4), 12, 8), M('#f6e3a1')); fat.position.set(R(-2.7, 2.7), -2.6 + R(-0.4, 0.4), R(-1.6, 1.6)); g.add(fat); }
      return { group: g, legend: [{ color: '#b9784e', label: 'Epidermis (melanin layer at base)', hi: 'बाह्यत्वचा' }, { color: '#e7c2a5', label: 'Dermis — collagen, vessels, nerves, glands', hi: 'चर्म' }, { color: '#f3d98b', label: 'Hypodermis — subcutaneous fat', hi: 'अधस्त्वचा (वसा)' }, { color: '#1c1613', label: 'Hair + follicle + sebaceous gland', hi: 'बाल और रोमकूप' }, { color: '#cfe3ea', label: 'Sweat gland', hi: 'स्वेद ग्रंथि' }] };
    } },
  cartilage: { key: 'cartilage', label: 'Hyaline cartilage', hi: 'हायलिन उपास्थि', icon: '🔵', desc: 'Joint cartilage has no blood supply and almost no nerves — it feeds by being squeezed (movement pumps fluid in and out). Chondrocytes sit in lacunae in a collagen-II/proteoglycan gel that holds water. It wears with age and overload (osteoarthritis) and repairs very poorly.',
    build() {
      const g = new THREE.Group();
      const block = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 4), M('#d5e3e8', { opacity: 0.55 })); g.add(block);
      for (let i = 0; i < 14; i++) { const c = new THREE.Vector3(R(-2.6, 2.6), R(-0.9, 0.9), R(-1.6, 1.6)); const n = 1 + Math.floor(rnd() * 3); for (let k = 0; k < n; k++) { const lac = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), M('#eaf3f6', { opacity: 0.6 })); lac.position.copy(c).add(new THREE.Vector3(k * 0.42, 0, 0)); g.add(lac); const cell = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), M('#7aa6b8')); cell.position.copy(lac.position); g.add(cell); const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), M('#4a2f6f')); nuc.position.copy(lac.position); g.add(nuc); } }
      const bone = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 4), M('#e9dfc9')); bone.position.y = -1.45; g.add(bone);
      return { group: g, legend: [{ color: '#d5e3e8', label: 'Matrix (collagen II + proteoglycans + water)', hi: 'मैट्रिक्स' }, { color: '#7aa6b8', label: 'Chondrocytes in lacunae (isogenous groups)', hi: 'उपास्थि कोशिकाएँ' }, { color: '#e9dfc9', label: 'Subchondral bone', hi: 'अस्थि' }] };
    } },
  cell: { key: 'cell', label: 'Human cell', hi: 'मानव कोशिका', icon: '🧫', desc: 'A typical cell (~20 µm): the nucleus holds 2 m of DNA in 46 chromosomes; mitochondria burn glucose/fat into ATP (creatine helps recycle it); the endoplasmic reticulum and Golgi build and ship proteins; lysosomes recycle waste (autophagy — boosted by fasting and exercise).',
    build() {
      const g = new THREE.Group();
      const membrane = new THREE.Mesh(new THREE.SphereGeometry(2.4, 48, 32), M('#f4d3b8', { opacity: 0.22, side: THREE.DoubleSide })); membrane.scale.set(1.15, 0.9, 1); g.add(membrane);
      const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.85, 32, 24), M('#6a4b7a', { opacity: 0.85 })); nuc.position.set(-0.3, 0.1, 0); g.add(nuc);
      const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), M('#3d2a4a')); nucleolus.position.set(-0.45, 0.2, 0.2); g.add(nucleolus);
      for (let i = 0; i < 10; i++) { const mito = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.45, 6, 12), M('#e9a23b')); mito.position.set(R(-2, 2), R(-1.3, 1.3), R(-1.6, 1.6)); mito.rotation.set(R(0, 3), R(0, 3), R(0, 3)); g.add(mito); }
      for (let i = 0; i < 4; i++) { const er = new THREE.Mesh(new THREE.TorusGeometry(1.05 + i * 0.16, 0.04, 8, 60, Math.PI * 1.1), M('#7fb3d5')); er.position.set(-0.3, 0.1, 0); er.rotation.set(R(-0.3, 0.3), 0.6, R(-0.3, 0.3)); g.add(er); for (let k = 0; k < 20; k++) { const rib = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), M('#2b4a6a')); const a = 0.6 + k / 20 * Math.PI * 1.1; rib.position.set(-0.3 + Math.cos(a) * (1.05 + i * 0.16) * 0.83, 0.1 + Math.sin(a) * (1.05 + i * 0.16) * 0.55 + 0.05, Math.sin(a) * 0.4); g.add(rib); } }
      for (let i = 0; i < 5; i++) { const golgi = new THREE.Mesh(new THREE.CylinderGeometry(0.55 - i * 0.06, 0.55 - i * 0.06, 0.05, 24), M('#f2b6c6')); golgi.position.set(1.4, -0.5 + i * 0.12, 0.6); golgi.rotation.x = 0.4; g.add(golgi); }
      for (let i = 0; i < 6; i++) { const lys = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), M('#5cb85c')); lys.position.set(R(-1.8, 1.8), R(-1.4, 1.4), R(-1.5, 1.5)); g.add(lys); }
      return { group: g, legend: [{ color: '#f4d3b8', label: 'Cell membrane (lipid bilayer)', hi: 'कोशिका झिल्ली' }, { color: '#6a4b7a', label: 'Nucleus with DNA', hi: 'केंद्रक' }, { color: '#e9a23b', label: 'Mitochondria — make ATP', hi: 'माइटोकॉन्ड्रिया' }, { color: '#7fb3d5', label: 'Endoplasmic reticulum + ribosomes', hi: 'अंतर्द्रव्यी जालिका' }, { color: '#f2b6c6', label: 'Golgi apparatus', hi: 'गॉल्जी' }, { color: '#5cb85c', label: 'Lysosomes (recycling)', hi: 'लाइसोसोम' }] };
    } },
};
