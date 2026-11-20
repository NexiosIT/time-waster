import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Run after scripts/build.mjs, which generates src/games/registry.generated.ts.
await build({
  entryPoints: { main: join(root, 'server/src/main.ts'), admin: join(root, 'server/src/admin.ts') },
  outdir: join(root, 'server/dist'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  external: ['node:*'],
  logLevel: 'info',
});
