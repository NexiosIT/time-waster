import * as fs from 'node:fs';
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

export function loadScores(file: string): Scores {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    const data: unknown = JSON.parse(text);
    if (isValid(data)) return data;
  } catch {
    // fall through to backup
  }
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

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeAtomic(file: string, data: Scores): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!transient || attempt >= RENAME_TRIES) {
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          // ignore
        }
        throw err;
      }
      sleepSync(RENAME_DELAY_MS);
    }
  }
}

export function addScore(
  file: string,
  gameId: string,
  score: number,
  at: Date = new Date(),
): { rank: number | null; isBest: boolean; top: ScoreEntry[] } {
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
