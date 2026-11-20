import { describe, it, expect } from 'vitest';
import {
  addEffect, removeEffect, hasEffect, tickEffects, modifiers, gripNow,
  DURATION, LOW_GRIP, type Effect,
} from './effects';
import { gripFor, GRIP_SLOW, GRIP_FAST, MAX_SPEED, START_SPEED } from './physics';

describe('effects', () => {
  it('addEffect resets an existing timer instead of duplicating', () => {
    let e: Effect[] = addEffect([], 'double');
    for (let i = 0; i < 50; i++) e = tickEffects(e);
    expect(e[0].ticksLeft).toBe(150);
    e = addEffect(e, 'double');
    expect(e).toHaveLength(1);
    expect(e[0].ticksLeft).toBe(200);
  });

  it('grip and slick cancel each other', () => {
    const a = addEffect(addEffect([], 'grip'), 'slick');
    expect(a.map((x) => x.kind)).toEqual(['slick']);
    const b = addEffect(addEffect([], 'slick'), 'grip');
    expect(b.map((x) => x.kind)).toEqual(['grip']);
  });

  it('removeEffect and hasEffect work', () => {
    const e = addEffect([], 'shield');
    expect(hasEffect(e, 'shield')).toBe(true);
    expect(hasEffect(removeEffect(e, 'shield'), 'shield')).toBe(false);
  });

  it('tickEffects drops expired effects and does not mutate', () => {
    const start = addEffect([], 'nitro');
    const snapshot = JSON.parse(JSON.stringify(start));
    let e = start;
    for (let i = 0; i < DURATION.nitro; i++) e = tickEffects(e);
    expect(e).toEqual([]);
    expect(start).toEqual(snapshot);
  });

  it('modifiers stack', () => {
    expect(modifiers([])).toEqual({ speedMul: 1, coinMul: 1 });
    expect(modifiers(addEffect([], 'double'))).toEqual({ speedMul: 1, coinMul: 2 });
    expect(modifiers(addEffect([], 'nitro'))).toEqual({ speedMul: 1.5, coinMul: 3 });
    expect(modifiers(addEffect(addEffect([], 'nitro'), 'double'))).toEqual({ speedMul: 1.5, coinMul: 6 });
  });

  it('gripNow priority', () => {
    const s = START_SPEED + 5;
    expect(gripNow(s, [], false)).toBe(gripFor(s));
    expect(gripNow(s, [], true)).toBe(LOW_GRIP);
    expect(gripNow(s, addEffect([], 'grip'), true)).toBe(GRIP_SLOW);
    expect(gripNow(s, addEffect([], 'slick'), false)).toBe(LOW_GRIP);
    expect(gripNow(MAX_SPEED, [], false)).toBe(GRIP_FAST);
  });

  it('slick stays survivable: LOW_GRIP is 0.05 and slick lasts 60 ticks', () => {
    expect(LOW_GRIP).toBe(0.05);
    expect(DURATION.slick).toBe(60);
    expect(LOW_GRIP).toBeLessThan(GRIP_FAST);
  });
});
