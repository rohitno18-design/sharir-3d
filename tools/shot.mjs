/**
 * Photograph the app after running a snippet: node tools/shot.mjs out.png "<js>" [--gpu]
 * The snippet runs like tools/probe.mjs snippets do; the picture is the 3D canvas.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [out, code, ...rest] = process.argv.slice(2);
const js = `${code}; await new Promise(r => setTimeout(r, 900)); v.renderer.render(v.scene, v.camera); return v.canvas.toDataURL('image/png');`;
const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'probe.mjs'), js, ...rest], { encoding: 'utf8', maxBuffer: 1 << 28 });
const i = r.stdout.indexOf('data:image/png;base64,');
if (i < 0) { console.log(r.stdout, r.stderr); process.exit(1); }
writeFileSync(out, Buffer.from(r.stdout.slice(i + 22).trim(), 'base64'));
console.log('saved', out);
