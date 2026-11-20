import { describe, expect, it } from 'vitest';
import { WAVES, marchInterval } from './waves';

describe('galaxy wave table', () => {
  it('has five waves', () => {
    expect(WAVES.length).toBe(5);
  });

  it('starts wave 1 at row 2', () => {
    expect(WAVES[0].startRow).toBe(2);
  });

  it('makes each wave strictly harder than the previous one', () => {
    for (let i = 1; i < WAVES.length; i++) {
      const prev = WAVES[i - 1];
      const cur = WAVES[i];
      expect(cur.startRow).toBe(prev.startRow + 1);
      expect(cur.marchTicks).toBeLessThan(prev.marchTicks);
      expect(cur.fireChance).toBeGreaterThan(prev.fireChance);
      expect(cur.maxEnemyShots).toBeGreaterThanOrEqual(prev.maxEnemyShots);
    }
  });

  it('keeps minMarchTicks at or below marchTicks in every wave', () => {
    for (const w of WAVES) {
      expect(w.minMarchTicks).toBeLessThanOrEqual(w.marchTicks);
    }
  });

  it('interpolates march interval by alive fraction', () => {
    expect(marchInterval(WAVES[0], 32, 32)).toBe(12);
    expect(marchInterval(WAVES[0], 1, 32)).toBe(3);
    expect(marchInterval(WAVES[0], 16, 32)).toBe(8);
  });

  it('never drops below minMarchTicks', () => {
    for (const w of WAVES) {
      for (let alive = 0; alive <= 32; alive++) {
        expect(marchInterval(w, alive, 32)).toBeGreaterThanOrEqual(w.minMarchTicks);
      }
    }
  });
});
