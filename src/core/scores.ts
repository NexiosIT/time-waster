import fs from 'node:fs';
import { readText, writeAtomic } from './fsutil';

export type ScoreEntry = { score: number; at: string };
type Scores = Record<string, ScoreEntry[]>;

const TOP_N = 10;

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
  writeAtomic(file, JSON.stringify(all, null, 2));
  return { rank: idx < TOP_N ? idx + 1 : null, isBest, top };
}
