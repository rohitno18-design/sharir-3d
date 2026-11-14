/**
 * How well the body holds together in every movement: what comes out through the skin,
 * what lifts off the muscles it lies on, which branches pull away from their trunks, and
 * which nerves and vessels are stretched into sticks. Nerves and vessels by default.
 *
 *   npm run body                 eight movements that load every joint, middle of the rep
 *   npm run body -- --all        every movement, two moments each (about 25 minutes)
 *
 * The checks live in src/dev/inside.js. Lower totals are better; compare before and after
 * any change to bindings (rig.js, skinweld.js, batched.js).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const all = process.argv.includes('--all');
const pre = all ? '' : "window.__only=['romanian-deadlift','back-squat','split-squat','hip-thrust','bench-press','overhead-press','lateral-raise','barbell-row']; window.__moments=[0.5];";
const code = pre + readFileSync(join(HERE, 'body-check.js'), 'utf8');
const r = spawnSync(process.execPath, [join(HERE, 'probe.mjs'), code, '--gpu', '--timeout', all ? '1800' : '600'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
process.stdout.write(r.stdout);
process.exit(r.status || 0);
