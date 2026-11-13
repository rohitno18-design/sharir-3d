/**
 * Stress test: click around the app at random, the way a person does, and after every
 * click check that the body is still on screen, nothing is left over from another tab,
 * and nothing threw an error. The same seed always replays the same clicks.
 *
 *   npm run soak                    seeds 1 to 6, 120 steps each
 *   npm run soak -- 7               one seed
 *   npm run soak -- 1 20 --steps 200   seeds 1 to 20, 200 steps each
 *
 * Exit code 1 if any seed fails. The checks themselves live in src/dev/soak.js.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const si = args.indexOf('--steps');
const steps = si >= 0 ? +args[si + 1] : 120;
const nums = args.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1)).map(Number).filter(n => n > 0);
const from = nums[0] || 1, to = nums[1] || (nums[0] ? nums[0] : 6);

let bad = 0;
for (let a = from; a <= to; a += 3) {
  const seeds = []; for (let s = a; s <= Math.min(to, a + 2); s++) seeds.push(s);
  const code = `const s = await import('/src/dev/soak.js'); const out = []; for (const seed of [${seeds}]) { const r = await s.run({ steps: ${steps}, seed, stopAt: 3 }); out.push({ seed, ok: r.ok, failures: r.failures }); } return out;`;
  const r = spawnSync(process.execPath, [join(HERE, 'probe.mjs'), code, '--gpu', '--timeout', String(60 + seeds.length * steps * 0.9)], { encoding: 'utf8' });
  let res;
  try { res = JSON.parse(r.stdout.slice(r.stdout.indexOf('['))); } catch { console.log(`seeds ${seeds}: could not run\n${r.stdout}${r.stderr}`); bad++; continue; }
  for (const x of res) {
    if (x.ok) console.log(`seed ${x.seed}: clean (${steps} steps)`);
    else { bad++; console.log(`seed ${x.seed}: FAILED`); for (const f of x.failures) console.log('  ' + JSON.stringify(f)); }
  }
}
console.log(bad ? `\n${bad} seed(s) failed.` : '\nAll seeds clean.');
process.exit(bad ? 1 : 0);
