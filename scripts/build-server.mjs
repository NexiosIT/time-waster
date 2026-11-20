import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Run after scripts/build.mjs, which generates src/games/registry.generated.ts.

// The browser play bundle first: its content hash goes into the server as PLAY_JS_HASH (cache busting).
const playJs = join(root, 'server/dist/public/play.js');
await build({
  entryPoints: [join(root, 'server/web/main.ts')],
  outfile: playJs,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  logLevel: 'info',
});
const hash = createHash('sha256').update(readFileSync(playJs)).digest('hex').slice(0, 12);

await build({
  entryPoints: { main: join(root, 'server/src/main.ts'), admin: join(root, 'server/src/admin.ts') },
  outdir: join(root, 'server/dist'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['node:*'],
  define: { PLAY_JS_HASH: JSON.stringify(hash) },
  logLevel: 'info',
});
