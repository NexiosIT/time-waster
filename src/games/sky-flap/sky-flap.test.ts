import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import { GAME_WIDTH } from '../../core/types';
import type { GameContext } from '../../core/types';
import game, {
  BOTTOM, COL_W, FLAP_VY, PLAYER_X, TOP, gapFor, hits, makeColumn, speedFor,
  type Column, type FlapState,
} from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
const run = (s: FlapState, c: GameContext, n: number) => {
  for (let i = 0; i < n; i++) s = game.update(s, c);
  return s;
};
const col = (x: number, gapTop: number, gap = 7): Column => ({ x, gapTop, gap, passed: false });

describe('sky-flap', () => {
  it('starts at score 0, hovering, with one column off-screen to the right', () => {
    const s = game.init(ctx());
    expect(game.score(s)).toBe(0);
    expect(game.isOver(s)).toBe(false);
    expect(s.started).toBe(false);
    expect(s.columns).toHaveLength(1);
    expect(s.columns[0].x).toBeGreaterThanOrEqual(GAME_WIDTH);
  });

  it('hovers in place until the first flap', () => {
    const c = ctx();
    const s0 = game.init(c);
    const s = run(s0, c, 100);
    expect(s.y).toBe(s0.y);
    expect(s.columns).toEqual(s0.columns);
    expect(game.isOver(s)).toBe(false);
  });

  it('a flap starts the run and kicks the glider up, without mutating the input', () => {
    const c = ctx();
    const s0 = game.init(c);
    const s1 = game.onKey(s0, 'space');
    expect(s1.started).toBe(true);
    expect(s1.vy).toBe(FLAP_VY);
    expect(s0.started).toBe(false);
    const s2 = game.update(s1, c);
    expect(s2.y).toBeLessThan(s1.y);
    expect(s1.y).toBe(s0.y);
    expect(game.onKey(s0, 'up').started).toBe(true);
    expect(game.onKey(s0, 'left')).toBe(s0);
  });

  it('falls and ends the run on the ground when you stop flapping', () => {
    const c = ctx();
    let s = game.onKey(game.init(c), 'space');
    let n = 0;
    while (!game.isOver(s) && n++ < 200) s = game.update(s, c);
    expect(game.isOver(s)).toBe(true);
    expect(s.y).toBe(BOTTOM);
    expect(game.score(s)).toBe(0);
  });

  it('the ceiling stops the glider instead of ending the run', () => {
    const c = ctx();
    let s: FlapState = { ...game.onKey(game.init(c), 'space'), y: TOP, columns: [col(200, 2)] };
    s = game.update(game.onKey(s, 'space'), c);
    expect(s.y).toBe(TOP);
    expect(s.vy).toBe(0);
    expect(game.isOver(s)).toBe(false);
  });

  it('scores a point for slipping through a gap', () => {
    const c = ctx();
    // A column just ahead with the gap centred on the glider, and a flap each time it sinks.
    let s: FlapState = { ...game.onKey(game.init(c), 'space'), y: 9, vy: 0, columns: [col(PLAYER_X + 1, 6, 7)] };
    for (let i = 0; i < 20 && game.score(s) === 0; i++) {
      s = game.update(s.y > 9 ? game.onKey(s, 'space') : s, c);
      expect(game.isOver(s)).toBe(false);
    }
    expect(game.score(s)).toBe(1);
    expect(s.columns[0].passed).toBe(true);
  });

  it('crashes into the solid part of a column', () => {
    const c = ctx();
    const s: FlapState = { ...game.onKey(game.init(c), 'space'), y: 15, vy: FLAP_VY, columns: [col(PLAYER_X + 1, 2, 5)] };
    expect(game.isOver(run(s, c, 4))).toBe(true);
  });

  it('keeps spawning columns at a fixed spacing as it scrolls', () => {
    const c = ctx();
    let s = game.onKey(game.init(c), 'space');
    for (let i = 0; i < 200 && !s.over; i++) {
      s = game.update({ ...s, y: s.columns.find(k => k.x + COL_W > PLAYER_X - 1)!.gapTop + 2, vy: 0 }, c);
    }
    expect(s.over).toBe(false);
    expect(s.columns.length).toBeGreaterThanOrEqual(2);
    expect(game.score(s)).toBeGreaterThan(0);
  });

  it('hits() only counts solid rows inside the column', () => {
    const c = col(PLAYER_X, 5, 6);
    expect(hits(c, 4)).toBe(true);
    expect(hits(c, 5)).toBe(false);
    expect(hits(c, 10)).toBe(false);
    expect(hits(c, 11)).toBe(true);
    expect(hits(col(PLAYER_X + 1, 5), 1)).toBe(false);
  });

  it('new gaps stay on screen and within reach of the previous one', () => {
    const c = ctx(7);
    let prev: number | null = null;
    for (let i = 0; i < 500; i++) {
      const k = makeColumn(60, i % 50, prev, c);
      expect(k.gapTop).toBeGreaterThanOrEqual(TOP + 1);
      expect(k.gapTop + k.gap - 1).toBeLessThanOrEqual(BOTTOM - 1);
      if (prev !== null) expect(Math.abs(k.gapTop - prev)).toBeLessThanOrEqual(6);
      prev = k.gapTop;
    }
  });

  it('gets harder: narrower gaps and faster scrolling, both capped', () => {
    expect(gapFor(0)).toBe(7);
    expect(gapFor(10)).toBe(6);
    expect(gapFor(100)).toBe(5);
    expect(speedFor(10)).toBeGreaterThan(speedFor(0));
    expect(speedFor(1000)).toBe(0.8);
  });

  it('is fair: a simple press-only autopilot clears 60 columns, past max difficulty', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const c = ctx(seed);
      let s = game.onKey(game.init(c), 'space');
      for (let i = 0; i < 20_000 && !s.over && s.score < 60; i++) {
        const next = s.columns.find(k => k.x + COL_W > PLAYER_X)!;
        // Aim for the lower part of the gap and flap when sinking below it.
        if (s.vy >= 0 && s.y > next.gapTop + next.gap - 2.5) s = game.onKey(s, 'space');
        s = game.update(s, c);
      }
      expect({ seed, over: s.over, score: s.score }).toEqual({ seed, over: false, score: 60 });
    }
  });

  it('ignores keys once the run is over', () => {
    const s: FlapState = { ...game.init(ctx()), over: true };
    expect(game.onKey(s, 'space')).toBe(s);
    expect(game.update(s, ctx())).toBe(s);
  });

  it('draws without throwing', () => {
    const cells: string[] = [];
    const screen = {
      width: 60, height: 20, clear() {},
      put(x: number, y: number, ch: string) {
        expect(ch).toHaveLength(1);
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(60);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(20);
        cells.push(ch);
      },
      text() {},
    };
    const c = ctx();
    game.draw(game.init(c), screen);
    game.draw(run(game.onKey(game.init(c), 'space'), c, 30), screen);
    expect(cells).toContain('>');
  });
});
