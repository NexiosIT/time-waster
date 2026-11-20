import type { Game, GameLength } from './types';
import type { RunEntry, Runs } from './runs';

export type Expected = { ms: number; basis: 'timed' | 'you' | 'est'; isNew: boolean };

export const NEW_MARGIN = 1.5;
export const MIN_RUNS = 3;
export const PERCENTILE = 0.75;

export function expectedLength(length: GameLength, runs: RunEntry[]): Expected {
  const base = length.minutes * 60000;
  if (length.kind === 'timed') return { ms: base, basis: 'timed', isNew: runs.length === 0 };
  if (runs.length < MIN_RUNS) return { ms: base * NEW_MARGIN, basis: 'est', isNew: true };
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const ms = sorted[Math.ceil(PERCENTILE * sorted.length) - 1];
  return { ms, basis: 'you', isNew: false };
}

export function formatMinutes(ms: number): string {
  return `~${Math.max(1, Math.ceil(ms / 60000))} min`;
}

export function suggest(games: Game<any>[], runs: Runs, leftMs: number): string | null {
  if (leftMs <= 0) return null;
  const cands: { id: string; title: string; ms: number; isNew: boolean; last: string }[] = [];
  for (const game of games) {
    if (!game.length) continue;
    const list = runs[game.id] ?? [];
    const e = expectedLength(game.length, list);
    if (e.ms > leftMs) continue;
    cands.push({
      id: game.id,
      title: game.title,
      ms: e.ms,
      isNew: e.isNew,
      last: list.length ? list[list.length - 1].at : '',
    });
  }
  if (cands.length === 0) return null;
  const pool = cands.some((c) => c.isNew) ? cands.filter((c) => c.isNew) : cands;
  pool.sort(
    (a, b) =>
      b.ms - a.ms ||
      (a.last < b.last ? -1 : a.last > b.last ? 1 : 0) ||
      a.title.localeCompare(b.title),
  );
  return pool[0].id;
}
