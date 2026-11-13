/**
 * Photograph the app.
 *
 *   node tools/shot.mjs out.png "<js>" [--gpu]        one photo after the snippet has run
 *   node tools/shot.mjs out-folder/ "<js>" [--gpu]    several: the snippet calls `await snap('name')`
 *
 * The snippet runs like tools/probe.mjs snippets do (`app` and `v` in scope). The picture
 * is the 3D canvas as it is drawn on screen.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [out, code, ...rest] = process.argv.slice(2);
const many = /[\\/]$/.test(out);
const js = `const shots = {}; const snap = async (name, wait = 900) => { await new Promise(r => setTimeout(r, wait)); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); v.renderer.render(v.scene, v.camera); shots[name] = v.canvas.toDataURL('image/png'); };
${code};
${many ? '' : "await snap('one');"} return shots;`;
const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'probe.mjs'), js, ...rest], { encoding: 'utf8', maxBuffer: 1 << 29 });
const i = r.stdout.indexOf('{');
let shots;
try { shots = JSON.parse(r.stdout.slice(i)); } catch { console.log(r.stdout.slice(0, 2000), r.stderr); process.exit(1); }
if (many) mkdirSync(out, { recursive: true });
for (const [name, url] of Object.entries(shots)) {
  const file = many ? join(out, name + '.png') : out;
  writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  console.log('saved', file);
}
