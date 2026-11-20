// `claude plugin test` runs every *.test.ts under a folder, including the vitest
// files in src/. Run it on a copy holding only the plugin's own files.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const copy = mkdtempSync(join(tmpdir(), 'tw-mod-'));
try {
  for (const part of ['.claude-plugin', 'hooks']) cpSync(join(root, part), join(copy, part), { recursive: true });
  const r = spawnSync('claude', ['plugin', 'test', copy], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
} finally {
  rmSync(copy, { recursive: true, force: true });
}
