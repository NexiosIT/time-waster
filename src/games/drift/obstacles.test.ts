import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import { grown, intersects, type Rect } from './arena';
import { MAX_OIL, MAX_PILLARS, newObstacle, OIL_FROM, shuffleLayout, type Pending } from './obstacles';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
const none = { pillars: [] as Rect[], oil: [] as Rect[], pending: [] as Pending[], avoid: [] as Rect[] };
const pend = (kind: Pending['kind'], x: number): Pending => ({ kind, rect: { x, y: 3, w: 1, h: 1 }, ticksLeft: 5 });

describe('newObstacle', () => {
  it('no oil before OIL_FROM coins', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(newObstacle({ ...none, coins: OIL_FROM - 1 }, ctx(seed))?.kind).toBe('pillar');
    }
  });

  it('produces both kinds once OIL_FROM is reached', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) kinds.add(newObstacle({ ...none, coins: OIL_FROM }, ctx(seed))!.kind);
    expect(kinds).toEqual(new Set(['pillar', 'oil']));
  });

  it('caps are respected (pending counted)', () => {
    const oilFull = {
      ...none, oil: [{ x: 3, y: 3, w: 1, h: 1 }], pending: [pend('oil', 5), pend('oil', 7)], coins: 50,
    };
    for (let seed = 1; seed <= 100; seed++) expect(newObstacle(oilFull, ctx(seed))?.kind).not.toBe('oil');
    const solid = Array.from({ length: 6 }, () => ({ x: 1, y: 1, w: 1, h: 1 }));
    const pillarFull = {
      ...none, pillars: solid, pending: Array.from({ length: 6 }, (_, i) => pend('pillar', i)), coins: 50,
    };
    for (let seed = 1; seed <= 100; seed++) expect(newObstacle(pillarFull, ctx(seed))?.kind).not.toBe('pillar');
  });

  it('returns null when full', () => {
    const rect = { x: 3, y: 3, w: 1, h: 1 };
    const full = {
      pillars: Array.from({ length: MAX_PILLARS }, () => rect),
      oil: Array.from({ length: MAX_OIL }, () => rect),
      pending: [] as Pending[], avoid: [] as Rect[], coins: 99,
    };
    for (let seed = 1; seed <= 50; seed++) expect(newObstacle(full, ctx(seed))).toBeNull();
  });

  it('returns null when placement fails', () => {
    expect(newObstacle({ ...none, avoid: [{ x: 0, y: 0, w: 60, h: 20 }], coins: 0 }, ctx())).toBeNull();
  });
});

describe('shuffleLayout', () => {
  const old: Rect[] = [3, 10, 17, 24, 31, 38, 45].map((x) => ({ x, y: 4, w: 3, h: 2 }));
  const avoid: Rect[] = [{ x: 1, y: 7, w: 20, h: 7 }];

  it('shuffleLayout keeps the count and gaps, avoids the avoid rects', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const out = shuffleLayout(old, avoid, ctx(seed));
      expect(out).toHaveLength(7);
      out.forEach((r, i) => {
        expect(avoid.some((a) => intersects(r, a))).toBe(false);
        out.slice(i + 1).forEach((q) => expect(intersects(grown(r, 2), q)).toBe(false));
      });
    }
  });

  it('shuffleLayout never exceeds the old count when space is tight', () => {
    const tight: Rect[] = [{ x: 3, y: 3, w: 54, h: 14 }];
    for (let seed = 1; seed <= 10; seed++) {
      expect(shuffleLayout(old, tight, ctx(seed)).length).toBeLessThanOrEqual(old.length);
    }
    expect(shuffleLayout(old, [{ x: 0, y: 0, w: 60, h: 20 }], ctx(1)).length).toBeLessThanOrEqual(old.length);
  });
});
