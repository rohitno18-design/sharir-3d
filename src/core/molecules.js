import * as THREE from 'three';

const CPK = { H: '#f2f2f2', C: '#3a3f47', N: '#3050f8', O: '#ff2a2a', S: '#e6c200', P: '#ff8000', Cl: '#1fd01f', F: '#90e050', Br: '#a62929', I: '#940094', Na: '#ab5cf2', K: '#8f40d4', Ca: '#3dff00', Mg: '#8aff00', Fe: '#e06633', Co: '#f090a0', Zn: '#7d80b0', Cu: '#c88033', Se: '#ffa100', B: '#ffb5b5', Si: '#f0c8a0' };
const VDW = { H: 1.1, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, Cl: 1.75, F: 1.47, Br: 1.85, I: 1.98, Na: 2.27, K: 2.75, Ca: 2.31, Mg: 1.73, Fe: 2.0, Co: 2.0, Zn: 1.39, Cu: 1.4, Se: 1.9 };

let cache = null;
export async function loadMolecules() {
  if (!cache) cache = fetch('/data/molecules.json').then(r => r.json());
  return cache;
}

/** Build a ball-and-stick THREE.Group for a molecule record { atoms:[[x,y,z,el]], bonds:[[a,b,order]] } */
export function buildMolecule(mol) {
  const g = new THREE.Group();
  const atoms = mol.atoms;
  const center = new THREE.Vector3();
  for (const a of atoms) center.add(new THREE.Vector3(a[0], a[1], a[2]));
  center.divideScalar(atoms.length || 1);
  const scale = 0.55; // Å → scene units
  const byEl = {};
  atoms.forEach((a, i) => { (byEl[a[3]] ||= []).push(i); });
  const sphere = new THREE.SphereGeometry(1, 28, 20);
  const pos = i => new THREE.Vector3(atoms[i][0], atoms[i][1], atoms[i][2]).sub(center).multiplyScalar(scale);
  for (const [elm, idx] of Object.entries(byEl)) {
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(CPK[elm] || '#d070d0'), roughness: 0.35, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const inst = new THREE.InstancedMesh(sphere, mat, idx.length);
    const r = (VDW[elm] || 1.6) * 0.27 * scale;
    const m = new THREE.Matrix4();
    idx.forEach((i, k) => { m.compose(pos(i), new THREE.Quaternion(), new THREE.Vector3(r, r, r)); inst.setMatrixAt(k, m); });
    inst.userData.element = elm;
    g.add(inst);
  }
  // bonds
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  const bondMat = new THREE.MeshPhysicalMaterial({ color: 0xb8bcc4, roughness: 0.4, metalness: 0.1 });
  const n = mol.bonds.reduce((s, b) => s + (b[2] >= 2 ? b[2] : 1), 0);
  const inst = new THREE.InstancedMesh(cyl, bondMat, Math.max(1, n));
  const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const up = new THREE.Vector3(0, 1, 0);
  let k = 0;
  for (const [a, b, order] of mol.bonds) {
    const pa = pos(a), pb = pos(b);
    const dir = pb.clone().sub(pa); const len = dir.length(); dir.normalize();
    q.setFromUnitVectors(up, dir);
    const copies = order >= 2 ? order : 1;
    const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0)).normalize();
    for (let c = 0; c < copies; c++) {
      const off = copies === 1 ? 0 : (c - (copies - 1) / 2) * 0.09 * scale;
      const mid = pa.clone().add(pb).multiplyScalar(0.5).addScaledVector(side, off);
      const rad = copies === 1 ? 0.045 * scale : 0.03 * scale;
      m.compose(mid, q, new THREE.Vector3(rad, len, rad));
      inst.setMatrixAt(k++, m);
    }
  }
  inst.count = k;
  g.add(inst);
  return g;
}

export function moleculeLabel(key) {
  return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
