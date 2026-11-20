import { loadJson, writeAtomic } from './jsonfile';

export type RunEntry = { ms: number; at: string };
export type Runs = Record<string, RunEntry[]>;

export const RUNS_KEPT = 20;

function isValid(data: unknown): data is Runs {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  return Object.values(data).every(
    (list) =>
      Array.isArray(list) &&
      list.every(
        (e) =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.ms === 'number' &&
          Number.isFinite(e.ms) &&
          e.ms >= 0 &&
          typeof e.at === 'string',
      ),
  );
}

export function loadRuns(file: string): Runs {
  return loadJson(file, isValid) ?? {};
}

/** Appends a run for gameId; returns that game's list, newest last, at most RUNS_KEPT. */
export function addRun(file: string, gameId: string, ms: number, at: Date = new Date()): RunEntry[] {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`Invalid run time: ${ms}`);
  const all = loadRuns(file); // re-read right before writing
  const list = [...(all[gameId] ?? []), { ms, at: at.toISOString() }].slice(-RUNS_KEPT);
  all[gameId] = list;
  writeAtomic(file, all);
  return list;
}
