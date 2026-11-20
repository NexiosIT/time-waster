import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import { isBlocked, type Point } from './arena';
import { angleDiff, COINS_TO_MAX, headingAngle, speedForCoins, START_SPEED, TICK_MS } from './physics';
import drift, { cellOf, TRAIL_LEN, type DriftState } from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
const FAR_COIN: Point = { x: 2, y: 2 };

/** An open arena with the car placed explicitly, independent of the random layout. */
const open = (over: Partial<DriftState> = {}): DriftState => ({
  ...drift.init(ctx()), pillars: [], coin: FAR_COIN, x: 30, y: 10, ...over,
});

const capture = (s: DriftState): string[] => {
  const calls: string[] = [];
  drift.draw(s, {
    width: 60, height: 20, text() {}, clear() {},
    put: (x, y, ch, col) => { calls.push(`${x},${y},${ch},${col}`); },
  });
  return calls;
};

describe('drift', () => {
  it('starts at START, score 0, not over, valid coin', () => {
    const s = drift.init(ctx());
    expect(cellOf(s)).toEqual({ x: 6, y: 10 });
    expect(s.heading).toBe(0);
    expect(drift.score(s)).toBe(0);
    expect(drift.isOver(s)).toBe(false);
    expect(isBlocked(s.coin, s.pillars)).toBe(false);
  });

  it('onKey rotates heading, sets lastTurn, ignores other keys, does not mutate', () => {
    const s = drift.init(ctx());
    const l = drift.onKey(s, 'left');
    expect(l.heading).toBe(7);
    expect(l.lastTurn).toBe(-1);
    const r = drift.onKey(s, 'right');
    expect(r.heading).toBe(1);
    expect(r.lastTurn).toBe(1);
    for (const k of ['up', 'a', 'space']) expect(drift.onKey(s, k)).toBe(s);
    expect(s.heading).toBe(0);
    expect(s.lastTurn).toBe(1);
  });

  it('ignores keys once crashed', () => {
    const s = open({ crashed: true });
    expect(drift.onKey(s, 'left')).toBe(s);
  });

  it('update moves right at start speed without mutating input', () => {
    const s = open();
    const n = drift.update(s, ctx());
    expect(n.x).toBeCloseTo(30 + START_SPEED * 0.05);
    expect(s.x).toBe(30);
  });

  it('after a 90° turn, travel converges to heading, slower at higher speed', () => {
    const ticksToConverge = (coins: number): number => {
      const c = ctx();
      let s = drift.onKey(drift.onKey(open({ x: 20, y: 4, coins }), 'right'), 'right');
      let ticks = 0;
      while (Math.abs(angleDiff(s.travel, headingAngle(s.heading))) >= 1e-6) {
        s = drift.update(s, c);
        ticks++;
        expect(s.crashed).toBe(false);
        expect(ticks).toBeLessThan(200);
      }
      return ticks;
    };
    expect(ticksToConverge(0)).toBeLessThan(ticksToConverge(20));
  });

  it('speed stays constant between coins and rises when a coin is collected', () => {
    const c = ctx();
    let s = open();
    const deltas: number[] = [];
    for (let i = 0; i < 5; i++) {
      const n = drift.update(s, c);
      deltas.push(n.x - s.x);
      s = n;
    }
    for (const d of deltas) expect(d).toBeCloseTo(deltas[0]);

    s = open({ x: 30.6, coin: { x: 31, y: 10 } });
    const got = drift.update(s, c);
    expect(got.coins).toBe(1);
    expect(drift.score(got)).toBe(10);
    expect(isBlocked(got.coin, got.pillars)).toBe(false);
    expect(got.coin).not.toEqual({ x: 31, y: 10 });
    const next = drift.update(got, c);
    expect(next.x - got.x).toBeGreaterThan(deltas[0]);
  });

  it('hitting the right wall ends the run', () => {
    const c = ctx();
    let s = open({ x: 57.8 });
    for (let i = 0; i < 5 && !s.crashed; i++) s = drift.update(s, c);
    expect(s.crashed).toBe(true);
    expect(drift.isOver(s)).toBe(true);
  });

  it('hitting a pillar ends the run', () => {
    const s = drift.update(open({ x: 19.7, pillars: [{ x: 20, y: 10, w: 3, h: 2 }] }), ctx());
    expect(s.crashed).toBe(true);
  });

  it('max speed diagonal cannot tunnel through a 1-row pillar', () => {
    const c = ctx();
    let s = open({ x: 16, y: 10, coins: 20, heading: 1, travel: Math.PI / 4, pillars: [{ x: 17, y: 12, w: 8, h: 1 }] });
    for (let i = 0; i < 100 && !s.crashed && s.x <= 30; i++) s = drift.update(s, c);
    expect(s.crashed).toBe(true);
    expect(cellOf(s).y).toBeLessThanOrEqual(12);
  });

  describe('sub-stepping at max speed (horizontal, > 1 cell per tick)', () => {
    const offsets = Array.from({ length: 10 }, (_, i) => 16 + i / 10);
    const run = (over: Partial<DriftState>, stop: (s: DriftState) => boolean): DriftState => {
      const c = ctx();
      let s = open({ y: 10, coins: COINS_TO_MAX, heading: 0, travel: 0, ...over });
      for (let i = 0; i < 100 && !stop(s); i++) s = drift.update(s, c);
      return s;
    };

    it('moves more than one cell per tick (guard)', () => {
      expect(speedForCoins(COINS_TO_MAX) * TICK_MS / 1000).toBeGreaterThan(1);
    });

    it.each(offsets)('cannot tunnel through a 1-column pillar from x=%f', (x) => {
      const s = run({ x, pillars: [{ x: 19, y: 10, w: 1, h: 1 }] }, (t) => t.crashed || t.x > 30);
      expect(s.crashed).toBe(true);
      expect(cellOf(s).x).toBe(19);
    });

    it.each(offsets)('cannot skip a coin from x=%f', (x) => {
      const s = run({ x, pillars: [], coin: { x: 19, y: 10 } }, (t) => t.coins > COINS_TO_MAX || t.crashed || t.x > 30);
      expect(s.coins).toBe(COINS_TO_MAX + 1); // coin collected, not skipped
    });
  });

  it('crash wins over a coin in the same cell', () => {
    const s = drift.update(open({ x: 58.6, coin: { x: 59, y: 10 } }), ctx());
    expect(s.crashed).toBe(true);
    expect(s.coins).toBe(0);
  });

  it('is a no-op once crashed', () => {
    const s = open({ crashed: true });
    expect(drift.update(s, ctx())).toBe(s);
  });

  it('records a trail: most recent first, no consecutive duplicates', () => {
    const c = ctx();
    let s = open();
    for (let i = 0; i < 6; i++) s = drift.update(s, c);
    for (let i = 1; i < s.trail.length; i++) expect(s.trail[i]).not.toEqual(s.trail[i - 1]);
    expect(s.trail[0]).toEqual(cellOf(s));
    expect(s.trail.length).toBeGreaterThan(0);
  });

  it('caps the trail length', () => {
    const c = ctx();
    let s = open({ x: 5, coins: 20 });
    for (let i = 0; i < 40 && !s.crashed; i++) s = drift.update(s, c);
    expect(s.trail.length).toBe(TRAIL_LEN);
  });

  it('travel stays in [0, 2π) after many spins', () => {
    const c = ctx();
    let s = open();
    for (let i = 0; i < 400; i++) {
      s = drift.update(drift.onKey(s, 'right'), c);
      expect(s.travel).toBeGreaterThanOrEqual(0);
      expect(s.travel).toBeLessThan(2 * Math.PI);
    }
    expect(s.crashed).toBe(false);
  });

  it('draws car glyph, coin and walls; trail only while drifting', () => {
    const base = drift.init(ctx());
    const calls = capture(base);
    expect(calls.some((l) => l.startsWith('6,10,→,'))).toBe(true);
    expect(calls.some((l) => l.endsWith(',●,yellow'))).toBe(true);
    expect(calls.some((l) => l.startsWith('0,0,┌,'))).toBe(true);

    const trail = [{ x: 10, y: 5 }, { x: 9, y: 5 }, { x: 8, y: 5 }];
    const drifting = capture({ ...base, heading: 2, travel: 0, trail });
    expect(drifting.filter((l) => l.includes(',·,gray'))).toHaveLength(3);
    const straight = capture({ ...base, heading: 0, travel: 0, trail });
    expect(straight.some((l) => l.includes('·'))).toBe(false);
  });
});
