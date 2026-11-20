import { describe, expect, test } from 'vitest';
import { RateLimiter } from './ratelimit';

describe('RateLimiter', () => {
  test('allows limit hits per window, refuses the next, allows again after the window', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.hit('a', 0)).toBe(true);
    expect(rl.hit('a', 100)).toBe(true);
    expect(rl.hit('a', 200)).toBe(true);
    expect(rl.hit('a', 300)).toBe(false);
    expect(rl.hit('b', 300)).toBe(true); // keys are independent
    expect(rl.hit('a', 999)).toBe(false);
    expect(rl.hit('a', 1000)).toBe(true); // the hit at 0 slid out of the window
    expect(rl.hit('a', 1050)).toBe(false);
    expect(rl.hit('a', 2300)).toBe(true);
  });
});
