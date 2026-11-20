import fs from 'node:fs';
import * as path from 'node:path';

const RENAME_TRIES = 5;
const RENAME_DELAY_MS = 20;
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Runs op, retrying transient Windows file errors with a short back-off.
export function withRetry<T>(op: () => T): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !TRANSIENT.has(code) || attempt >= RENAME_TRIES) throw err;
      sleepSync(RENAME_DELAY_MS);
    }
  }
}

/** File text, or null when the file does not exist. */
export function readText(file: string): string | null {
  try {
    return withRetry(() => fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Writes via a temp file and rename so readers never see a half-written file. */
export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text);
    withRetry(() => fs.renameSync(tmp, file));
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}
