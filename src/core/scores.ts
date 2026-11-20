import fs from 'node:fs';
import * as path from 'node:path';

export type ScoreEntry = { score: number; at: string };
type Scores = Record<string, ScoreEntry[]>;

const TOP_N = 10;
const RENAME_TRIES = 5;
const RENAME_DELAY_MS = 20;

function isValid(data: unknown): data is Scores {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  return Object.values(data).every(
    (list) =>
      Array.isArray(list) &&
      list.every(
        (e) =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.score === 'number' &&
          Number.isFinite(e.score) &&
          typeof e.at === 'string',
      ),
  );
}

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Runs op, retrying transient Windows file errors with a short back-off.
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

function parse(text: string): Scores | null {
  try {
    const data: unknown = JSON.parse(text);
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}

export function loadScores(file: string): Scores {
  const text = readText(file);
  if (text === null) return {};
  const data = parse(text);
  if (data) return data;
  // Corrupt: only back it up if nobody replaced it since we read it.
  const again = readText(file);
  if (again === null) return {};
  if (again !== text) return parse(again) ?? {};
  try {
    fs.renameSync(file, file + '.bak');
  } catch {
    // best effort
  }
  return {};
}

export function bestScore(file: string, gameId: string): number | null {
  const list = loadScores(file)[gameId] ?? [];
  return list.length ? Math.max(...list.map((e) => e.score)) : null;
}

function writeAtomic(file: string, data: Scores): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
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

export function addScore(
  file: string,
  gameId: string,
  score: number,
  at: Date = new Date(),
): { rank: number | null; isBest: boolean; top: ScoreEntry[] } {
  if (!Number.isFinite(score)) throw new Error(`Invalid score: ${score}`);
  const all = loadScores(file); // re-read right before writing
  const previous = all[gameId] ?? [];
  const isBest = previous.every((e) => score > e.score);
  const entry: ScoreEntry = { score, at: at.toISOString() };
  // stable sort: equal scores keep older entries first; new entry is appended last
  const sorted = [...previous, entry].sort((a, b) => b.score - a.score);
  const idx = sorted.indexOf(entry);
  const top = sorted.slice(0, TOP_N);
  all[gameId] = top;
  writeAtomic(file, all);
  return { rank: idx < TOP_N ? idx + 1 : null, isBest, top };
}
