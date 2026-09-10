/**
 * Decimate the anatomy meshes, then re-compress them.
 *
 * Z-Anatomy's meshes are authored for offline rendering: 8.65 M triangles across the whole
 * body. Drawing that at 1280x720 costs ~50 ms a frame on an integrated GPU, which is 20 fps
 * — no amount of draw-call batching helps, because the cost is vertex throughput, not
 * state changes. Cutting triangles is the only lever that moves it.
 *
 * Reads the pristine Blender exports in build/ (never the already-compressed files in
 * public/models/, so passes never stack) and writes meshopt-compressed GLBs back out.
 *
 *   node tools/optimize_models.mjs            # write public/models/
 *   node tools/optimize_models.mjs --dry-run  # report the numbers, touch nothing
 *
 * Ratios are per file, because the systems degrade very differently. Tubes (nerves,
 * vessels) carry far more radial segments than their silhouette needs, so they take the
 * deepest cut. Bone and skin hold the shapes you actually look at, so they take the least.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld, dedup, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'build');
const OUT = path.join(ROOT, 'public', 'models');

// ratio = triangles to keep. error = how far a vertex may move, as a fraction of that
// mesh's own radius, so small parts get a proportionally small budget.
const PLAN = {
  nervous:        { ratio: 0.18, error: 0.03 },   // 2.20 M — long thin tubes, heaviest waste
  muscular:       { ratio: 0.30, error: 0.02 },   // 2.32 M — big smooth organic surfaces
  cardiovascular: { ratio: 0.20, error: 0.03 },   // 1.58 M — tubes again
  skeletal:       { ratio: 0.45, error: 0.01 },   // 0.91 M — bone shape is the subject
  joints:         { ratio: 0.35, error: 0.02 },   // 0.36 M
  visceral:       { ratio: 0.40, error: 0.015 },  // 1.00 M — organs, looked at up close
  regions:        { ratio: 0.55, error: 0.01 },   // 0.15 M — skin, the default silhouette
  lymphoid:       { ratio: 0.30, error: 0.02 },   // 0.13 M
  references:     null,                            // flat planes, already trivial
  extra:          null,                            // procedural, already light
};

const dry = process.argv.includes('--dry-run');

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptEncoder, 'meshopt.encoder': MeshoptEncoder });

const tris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const i = prim.getIndices();
      n += (i ? i.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  return Math.round(n);
};

const primTris = (mesh) => {
  let n = 0;
  for (const prim of mesh.listPrimitives()) {
    const i = prim.getIndices();
    n += (i ? i.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
};

const parentOf = (node) =>
  node.getParentNode ? node.getParentNode() : node.listParents().find(p => p.propertyType === 'Node') || null;

/**
 * part name -> triangles it draws, resolved the same way src/core/loader.js resolves it:
 * walk up from the mesh to the nearest ancestor whose name the registry knows. quantize()
 * inserts un-named wrapper nodes to carry the dequantization transform, so a part's
 * geometry legitimately ends up on a child of the node that names it.
 */
const perPart = (doc, known) => {
  const m = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let owner = node;
    while (owner && !known.has(owner.getName())) owner = parentOf(owner);
    if (!owner) continue;
    m.set(owner.getName(), (m.get(owner.getName()) || 0) + primTris(mesh));
  }
  return m;
};

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

let beforeAll = 0, afterAll = 0;
const report = [];

for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.glb'))) {
  const key = path.basename(file, '.glb');
  const plan = PLAN[key];
  const doc = await io.read(path.join(SRC, file));
  const before = tris(doc);
  const known = new Set(doc.getRoot().listNodes().map(n => n.getName()).filter(Boolean));
  const nodesBefore = perPart(doc, known);

  if (plan) {
    // weld first: Blender exports split vertices per face-corner, and an edge collapse
    // cannot cross a split, so without this the simplifier has almost nothing to work with.
    await doc.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: plan.ratio, error: plan.error, lockBorder: false }),
      dedup(),
    );
  }
  // Match what the original files shipped: 16-bit positions, 8-bit normals. meshopt only
  // entropy-codes what it is given, so without this a smaller mesh can still make a bigger
  // file. The loader already de-normalises these back to floats before baking transforms.
  await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 8, quantizeTexcoord: 12 }));

  const after = tris(doc);
  const nodesAfter = perPart(doc, known);

  // Every node name is a part in the registry. A part that drew triangles before and draws
  // none now has silently left the atlas — that is a failure, not a saving.
  const emptied = [...nodesBefore].filter(([n, t]) => t > 0 && !(nodesAfter.get(n) > 0)).map(([n]) => n);
  if (emptied.length) throw new Error(`${file}: ${emptied.length} parts lost all geometry, e.g. ${emptied.slice(0, 6).join(' | ')}`);

  beforeAll += before; afterAll += after;
  report.push({ file: key, before, after, pct: Math.round(after / before * 100), nodes: [...nodesAfter.values()].filter(t => t > 0).length });

  if (!dry) {
    doc.createExtension(KHRMeshQuantization).setRequired(true);
    doc.createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(path.join(OUT, file), doc);
  }
}

const pad = (s, n) => String(s).padStart(n);
console.log('\n  file             before        after     kept   nodes');
console.log('  ' + '-'.repeat(52));
for (const r of report)
  console.log(`  ${r.file.padEnd(15)} ${pad(r.before.toLocaleString(), 10)} ${pad(r.after.toLocaleString(), 12)} ${pad(r.pct + '%', 7)} ${pad(r.nodes, 7)}`);
console.log('  ' + '-'.repeat(52));
console.log(`  ${'TOTAL'.padEnd(15)} ${pad(beforeAll.toLocaleString(), 10)} ${pad(afterAll.toLocaleString(), 12)} ${pad(Math.round(afterAll / beforeAll * 100) + '%', 7)}`);
console.log(dry ? '\n  (dry run — nothing written)\n' : `\n  written to ${OUT}\n`);
