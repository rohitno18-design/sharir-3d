/**
 * Equipment is solid: every bar, plate, dumbbell, bench and the floor is tested against
 * the posed skin at 24 moments of every movement (src/dev/props.js), and against the other
 * dumbbell. Prints the worst contacts. Fails if anything goes more than 12 mm into the body:
 * a few millimetres is skin resting on a bench or a bar, more shows on screen.
 *
 *   npm run props
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = "const s = await import('/src/dev/props.js'); return await s.scanProps(app, { steps: 24 });";
const r = spawnSync(process.execPath, [join(HERE, 'probe.mjs'), code, '--gpu', '--timeout', '600'], { encoding: 'utf8' });
let rows;
try { rows = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))); } catch { console.log(r.stdout, r.stderr); process.exit(1); }
for (const x of rows.slice(0, 20)) console.log(`${String(x.mm).padStart(4)} mm  ${x.id.padEnd(28)} ${x.what}  (at ${x.t})`);
const bad = rows.filter(x => x.mm > 12);
console.log(bad.length ? `\n${bad.length} contacts go more than 12 mm into the body.` : '\nEverything stays out of the body.');
process.exit(bad.length ? 1 : 0);
