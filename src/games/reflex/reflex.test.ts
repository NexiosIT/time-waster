import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import { CellBuffer } from '../../core/buffer';
import type { GameContext } from '../../core/types';
import reflex, { type ReflexState } from './index';

const ctx = (seed = 1, elapsedMs = 0): GameContext => ({ random: createRandom(seed), elapsedMs });

/** Tick until a target is showing. */
function toTarget(s: ReflexState, c: GameContext): ReflexState {
  for (let i = 0; i < 20 && s.target === null; i++) s = reflex.update(s, c);
  return s;
}
const hit = (s: ReflexState, c: GameContext) => {
  const t = toTarget(s, c);
  return reflex.onKey(t, t.target!);
};
const wrongKey = (s: ReflexState) => (s.target === 'a' ? 's' : 'a');
const expire = (s: ReflexState, c: GameContext) => {
  s = toTarget(s, c);
  const m = s.misses;
  for (let i = 0; i < 100 && s.misses === m; i++) s = reflex.update(s, c);
  return s;
};

describe('reflex', () => {
  it('has the contract metadata', () => {
    expect(reflex.id).toBe('reflex');
    expect(reflex.title).toBe('Reflex');
    expect(reflex.tickMs).toBe(50);
    expect(reflex.length).toEqual({ kind: 'timed', minutes: 1 });
    expect(reflex.controls).toBe('←↑→↓ a s d f j k l');
  });

  it('starts at 0, not over, with a target only after the first 250 ms gap', () => {
    const c = ctx();
    let s = reflex.init(c);
    expect(reflex.score(s)).toBe(0);
    expect(reflex.isOver(s)).toBe(false);
    expect(s.target).toBeNull();
    for (let i = 0; i < 4; i++) s = reflex.update(s, c);
    expect(s.target).toBeNull();
    s = reflex.update(s, c);
    expect(s.target).not.toBeNull();
  });

  it('ignores keys during the gap (no miss)', () => {
    const c = ctx();
    const s = reflex.init(c);
    const t = reflex.onKey(s, 'a');
    expect(t).toEqual(s);
    expect(t.misses).toBe(0);
  });

  it('does not mutate its input', () => {
    const c = ctx();
    const s = toTarget(reflex.init(c), c);
    const copy = structuredClone(s);
    reflex.onKey(s, s.target!);
    reflex.onKey(s, wrongKey(s));
    reflex.update(s, c);
    expect(s).toEqual(copy);
  });

  it('correct key adds at least 10 and bumps the streak', () => {
    const c = ctx();
    const s = hit(reflex.init(c), c);
    expect(reflex.score(s)).toBeGreaterThanOrEqual(10);
    expect(s.streak).toBe(1);
    expect(s.hits).toBe(1);
  });

  it('wrong key resets the streak and adds nothing', () => {
    const c = ctx();
    let s = hit(reflex.init(c), c);
    s = toTarget(s, c);
    const before = reflex.score(s);
    s = reflex.onKey(s, wrongKey(s));
    expect(s.streak).toBe(0);
    expect(s.misses).toBe(1);
    expect(reflex.score(s)).toBe(before);
  });

  it('a target that expires is a miss', () => {
    const c = ctx();
    const s = expire(reflex.init(c), c);
    expect(s.misses).toBe(1);
    expect(s.streak).toBe(0);
  });

  it('keeps lifetime within 450..1500', () => {
    const c = ctx();
    let s = reflex.init(c);
    for (let i = 0; i < 60; i++) {
      s = hit(s, c);
      expect(s.lifetime).toBeGreaterThanOrEqual(450);
      expect(s.lifetime).toBeLessThanOrEqual(1500);
    }
    expect(s.lifetime).toBe(450);
    for (let i = 0; i < 10; i++) {
      s = expire(s, c);
      expect(s.lifetime).toBeLessThanOrEqual(1500);
    }
    expect(s.lifetime).toBe(1500);
  });

  it('applies x2 from streak 10 and x3 from streak 25', () => {
    const c = ctx();
    let s = reflex.init(c);
    const gains: number[] = [];
    for (let i = 0; i < 25; i++) {
      const before = reflex.score(s);
      s = hit(s, c);
      gains.push(reflex.score(s) - before);
    }
    // Full lifetime remaining on an instant hit: bonus 10, so 20 base.
    expect(gains[0]).toBe(20);
    expect(gains[8]).toBe(20);
    expect(gains[9]).toBe(40);
    expect(gains[23]).toBe(40);
    expect(gains[24]).toBe(60);
  });

  it('is over at 60 000 ms and not at 59 950 ms', () => {
    const s = reflex.init(ctx());
    expect(reflex.isOver(reflex.update(s, ctx(1, 59950)))).toBe(false);
    expect(reflex.isOver(reflex.update(s, ctx(1, 60000)))).toBe(true);
  });

  it('never repeats the previous spot', () => {
    const c = ctx(3);
    let s = reflex.init(c);
    let prev = '';
    for (let i = 0; i < 40; i++) {
      s = toTarget(hit(s, c), c);
      const p = `${s.x},${s.y}`;
      expect(p).not.toBe(prev);
      prev = p;
    }
  });

  it('draw writes only inside 60 x 20, keeps the box off row 0 and the edges', () => {
    const c = ctx(5);
    let s = reflex.init(c);
    for (let i = 0; i < 30; i++) {
      s = toTarget(hit(s, c), c);
      const buf = new CellBuffer(60, 20);
      let writes = 0;
      const spy = {
        width: 60, height: 20, clear: () => {},
        put(x: number, y: number, ch: string, col?: never) {
          writes++;
          expect(x >= 0 && x < 60 && y >= 0 && y < 20).toBe(true);
          if (y > 0) expect(x >= 1 && x <= 58 && y >= 2 && y <= 18).toBe(true);
          buf.put(x, y, ch, col);
        },
        text(x: number, y: number, str: string) { [...str].forEach((ch, k) => spy.put(x + k, y, ch)); },
      };
      reflex.draw(s, spy);
      expect(writes).toBeGreaterThan(0);
    }
  });
});
