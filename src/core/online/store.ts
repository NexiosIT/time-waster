import fs from 'node:fs';
import * as path from 'node:path';

export type Account = { serverUrl: string; token: string; login: string };
export type OutboxEntry = { game: string; score: number; at: string };

const OUTBOX_MAX = 50;
const RENAME_TRIES = 5;
const RENAME_DELAY_MS = 20;
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Same back-off as scores.ts for transient Windows file errors.
function withRetry<T>(op: () => T): T {
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

function readText(file: string): string | null {
  try {
    return withRetry(() => fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function writeAtomic(file: string, text: string): void {
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

function isAccount(d: unknown): d is Account {
  if (typeof d !== 'object' || d === null) return false;
  const a = d as Record<string, unknown>;
  return typeof a.serverUrl === 'string' && typeof a.token === 'string' && typeof a.login === 'string';
}

function isEntry(d: unknown): d is OutboxEntry {
  if (typeof d !== 'object' || d === null) return false;
  const e = d as Record<string, unknown>;
  return typeof e.game === 'string' && typeof e.score === 'number' && Number.isFinite(e.score) && typeof e.at === 'string';
}

export function loadAccount(file: string): Account | null {
  try {
    const text = readText(file);
    if (text === null) return null;
    const d: unknown = JSON.parse(text);
    return isAccount(d) ? { serverUrl: d.serverUrl, token: d.token, login: d.login } : null;
  } catch {
    return null;
  }
}

export function saveAccount(file: string, a: Account): void {
  writeAtomic(file, JSON.stringify(a, null, 2));
}

export function clearAccount(file: string): void {
  withRetry(() => fs.rmSync(file, { force: true }));
}

export function appendOutbox(file: string, e: OutboxEntry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(e) + '\n');
}

export function readOutbox(file: string): OutboxEntry[] {
  let text: string | null;
  try {
    text = readText(file);
  } catch {
    return [];
  }
  if (text === null) return [];
  const out: OutboxEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const d: unknown = JSON.parse(line);
      if (isEntry(d)) out.push({ game: d.game, score: d.score, at: d.at });
    } catch {
      // skip bad line
    }
  }
  return out;
}

export function writeOutbox(file: string, entries: OutboxEntry[]): void {
  const kept = entries.slice(-OUTBOX_MAX);
  writeAtomic(file, kept.map((e) => JSON.stringify(e) + '\n').join(''));
}
