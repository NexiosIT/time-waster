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

export function readText(file: string): string | null {
  try {
    return withRetry(() => fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function parse<T>(text: string, isValid: (data: unknown) => data is T): T | null {
  try {
    const data: unknown = JSON.parse(text);
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

/** Loads and validates a JSON file; null if missing. A corrupt file is moved to `.bak` and gives null. */
export function loadJson<T>(file: string, isValid: (data: unknown) => data is T): T | null {
  const text = readText(file);
  if (text === null) return null;
  const data = parse(text, isValid);
  if (data) return data;
  // Corrupt: only back it up if nobody replaced it since we read it.
  const again = readText(file);
  if (again === null) return null;
  if (again !== text) return parse(again, isValid);
  try {
    fs.renameSync(file, file + '.bak');
  } catch {
    // best effort
  }
  return null;
}

export function writeAtomic(file: string, data: unknown): void {
  writeTextAtomic(file, JSON.stringify(data, null, 2));
}

/** Writes text via a temp file and rename so readers never see a half-written file. */
export function writeTextAtomic(file: string, text: string): void {
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
