import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import {
  MIN_COIN_DIST, SAFE_ZONE, generatePillars, inRect, isBlocked, isWall, spawnCoin,
  type Rect,
} from './arena';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });

const grow = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('drift arena', () => {
  it('walls are the border', () => {
    expect(isWall({ x: 0, y: 5 })).toBe(true);
    expect(isWall({ x: 59, y: 5 })).toBe(true);
    expect(isWall({ x: 5, y: 19 })).toBe(true);
    expect(isWall({ x: 5, y: 0 })).toBe(true);
    expect(isWall({ x: -1, y: 5 })).toBe(true);
    expect(isWall({ x: 60, y: 5 })).toBe(true);
    expect(isWall({ x: 1, y: 1 })).toBe(false);
  });

  it('inRect and isBlocked', () => {
    const r = { x: 10, y: 5, w: 3, h: 2 };
    expect(inRect({ x: 12, y: 6 }, r)).toBe(true);
    expect(inRect({ x: 13, y: 6 }, r)).toBe(false);
    expect(isBlocked({ x: 11, y: 5 }, [r])).toBe(true);
    expect(isBlocked({ x: 0, y: 5 }, [])).toBe(true);
    expect(isBlocked({ x: 20, y: 5 }, [r])).toBe(false);
  });

  it('generates 5-7 legal pillars for every seed', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ps = generatePillars(ctx(seed));
      expect(ps.length).toBeGreaterThanOrEqual(5);
      expect(ps.length).toBeLessThanOrEqual(7);
      ps.forEach((p, i) => {
        expect(p.w).toBeGreaterThanOrEqual(2); expect(p.w).toBeLessThanOrEqual(4);
        expect(p.h).toBeGreaterThanOrEqual(1); expect(p.h).toBeLessThanOrEqual(2);
        expect(p.x).toBeGreaterThanOrEqual(3); expect(p.x + p.w - 1).toBeLessThanOrEqual(56);
        expect(p.y).toBeGreaterThanOrEqual(3); expect(p.y + p.h - 1).toBeLessThanOrEqual(16);
        expect(intersects(p, SAFE_ZONE)).toBe(false);
        ps.forEach((q, j) => {
          if (i !== j) expect(intersects(grow(p, 2), q)).toBe(false);
        });
      });
    }
  });

  it('is deterministic per seed', () => {
    expect(generatePillars(ctx(7))).toEqual(generatePillars(ctx(7)));
  });

  it('coin spawns on a legal cell, far from the car, for every seed', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = ctx(seed);
      const pillars = generatePillars(c);
      const car = { x: 30, y: 10 };
      const coin = spawnCoin(car, pillars, c);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        expect(isBlocked({ x: coin.x + dx, y: coin.y + dy }, pillars)).toBe(false);
      expect(Math.hypot(coin.x - car.x, 2 * (coin.y - car.y))).toBeGreaterThanOrEqual(MIN_COIN_DIST);
    }
  });

  it('coin still spawns when no cell meets the distance rule', () => {
    const car = { x: 30, y: 10 };
    // fill the interior except a 5x5 pocket (x 28..32, y 8..12) around the car
    const pillars: Rect[] = [
      { x: 1, y: 1, w: 58, h: 7 },
      { x: 1, y: 13, w: 58, h: 6 },
      { x: 1, y: 8, w: 27, h: 5 },
      { x: 33, y: 8, w: 26, h: 5 },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const coin = spawnCoin(car, pillars, ctx(seed));
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        expect(isBlocked({ x: coin.x + dx, y: coin.y + dy }, pillars)).toBe(false);
      expect(Math.hypot(coin.x - car.x, 2 * (coin.y - car.y))).toBeLessThan(MIN_COIN_DIST);
    }
  });

  it('does not mutate inputs', () => {
    const c = ctx(3);
    const pillars = generatePillars(c);
    const snap = JSON.stringify(pillars);
    const car = { x: 6, y: 10 };
    spawnCoin(car, pillars, c);
    expect(JSON.stringify(pillars)).toBe(snap);
    expect(car).toEqual({ x: 6, y: 10 });
  });
});
