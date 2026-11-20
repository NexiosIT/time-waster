import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import { nextPowerGap, pickPower, POWER_LOOK, resolveMystery, type PowerKind } from './powerups';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
const KINDS = Object.keys(POWER_LOOK) as PowerKind[];

describe('powerups', () => {
  it('pickPower returns only PowerKinds and every kind shows up', () => {
    const c = ctx(7);
    const seen = new Set<PowerKind>();
    for (let i = 0; i < 2000; i++) {
      const k = pickPower(c);
      expect(KINDS).toContain(k);
      seen.add(k);
    }
    expect(seen.size).toBe(KINDS.length);
  });

  it('resolveMystery never returns mystery and can return slick', () => {
    const c = ctx(3);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(resolveMystery(c));
    expect(seen.has('mystery')).toBe(false);
    expect(seen.has('slick')).toBe(true);
    expect(seen.size).toBe(7);
  });

  it('nextPowerGap is 3 or 4', () => {
    const c = ctx(5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(nextPowerGap(c));
    expect([...seen].sort()).toEqual([3, 4]);
  });
});
