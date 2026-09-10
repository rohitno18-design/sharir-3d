import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The .glb files live in public/ and so keep the same URL forever, which means a browser
// that cached one will happily go on using it after the model has been rebuilt. Stamping
// the URLs with a hash of the models' own sizes and timestamps means a rebuilt model gets
// a new URL and is re-fetched exactly once, while an untouched one stays cached.
function modelsId() {
  const dir = join(import.meta.dirname, 'public', 'models');
  const h = createHash('sha1');
  for (const f of readdirSync(dir).sort()) {
    const s = statSync(join(dir, f));
    h.update(`${f}:${s.size}:${s.mtimeMs}`);
  }
  return h.digest('hex').slice(0, 10);
}

export default defineConfig({
  server: { port: 5180, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  assetsInclude: ['**/*.glb'],
  define: { __MODELS_ID__: JSON.stringify(modelsId()) },
});
