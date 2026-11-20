import { describe, expect, it } from 'vitest';
import { expectedLength, formatMinutes, suggest } from './length';
import type { Game, GameLength } from './types';
import type { RunEntry, Runs } from './runs';

const S = 1000;
const MIN = 60000;
const run = (s: number, at = '2026-01-01T00:00:00.000Z'): RunEntry => ({ ms: s * S, at });
const runsOf = (secs: number[]): RunEntry[] => secs.map((s) => run(s));

describe('expectedLength', () => {
  it('timed', () => {
    const l: GameLength = { kind: 'timed', minutes: 1 };
    expect(expectedLength(l, [])).toEqual({ ms: 60000, basis: 'timed', isNew: true });
    expect(expectedLength(l, [run(50)]).isNew).toBe(false);
  });
  it('estimates with fewer than 3 runs', () => {
    expect(expectedLength({ kind: 'open', minutes: 2 }, runsOf([10, 20]))).toEqual({
      ms: 180000,
      basis: 'est',
      isNew: true,
    });
  });
  it('uses 75th percentile nearest-rank', () => {
    const l: GameLength = { kind: 'open', minutes: 2 };
    expect(expectedLength(l, runsOf([60, 120, 180, 240]))).toEqual({ ms: 180000, basis: 'you', isNew: false });
    expect(expectedLength(l, runsOf([60, 120, 180])).ms).toBe(180000);
    expect(expectedLength(l, runsOf([600, ...Array(10).fill(60)])).ms).toBe(60000);
  });
});

const g = (id: string, length?: GameLength): Game<any> => ({ id, title: id, length }) as Game<any>;

describe('suggest', () => {
  const reflex = g('reflex', { kind: 'timed', minutes: 1 });
  const lander = g('lander', { kind: 'rounds', minutes: 4 });
  const dodge = g('dodge', { kind: 'open', minutes: 2 });
  const worm = g('worm', { kind: 'open', minutes: 2 });
  const runs: Runs = {
    reflex: [run(60)],
    lander: runsOf([240, 240, 240]),
    worm: runsOf([300, 300, 300]),
  };
  const all = [reflex, lander, dodge, worm];

  it('prefers new games that fit', () => {
    expect(suggest(all, runs, 6 * MIN)).toBe('dodge');
  });
  it('fits the remaining time', () => {
    expect(suggest(all, runs, 2.5 * MIN)).toBe('reflex');
    expect(suggest(all, runs, 30 * S)).toBeNull();
    expect(suggest(all, runs, 0)).toBeNull();
  });
  it('picks longest fit when none new', () => {
    expect(suggest([reflex, lander, worm], runs, 6 * MIN)).toBe('worm');
  });
  it('breaks ties by oldest play', () => {
    const a = g('a', { kind: 'open', minutes: 2 });
    const b = g('b', { kind: 'open', minutes: 2 });
    const r: Runs = {
      a: [run(240, '2026-03-01T00:00:00.000Z'), run(240, '2026-03-02T00:00:00.000Z'), run(240, '2026-03-03T00:00:00.000Z')],
      b: [run(240, '2026-02-01T00:00:00.000Z'), run(240, '2026-02-02T00:00:00.000Z'), run(240, '2026-02-03T00:00:00.000Z')],
    };
    expect(suggest([a, b], r, 5 * MIN)).toBe('b');
  });
  it('ignores games without length', () => {
    expect(suggest([g('none')], {}, 10 * MIN)).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('rounds up, minimum 1', () => {
    expect(formatMinutes(90000)).toBe('~2 min');
    expect(formatMinutes(1000)).toBe('~1 min');
  });
});
