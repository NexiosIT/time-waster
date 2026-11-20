import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import worm, { spawnDot } from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
type Point = { x: number; y: number };
const row = (n: number, y: number) => Array.from({ length: n }, (_, i) => ({ x: 14 - i, y }));

describe('worm', () => {
  it('starts with length 3 and score 0', () => {
    const s = worm.init(ctx());
    expect(s.body).toHaveLength(3);
    expect(worm.score(s)).toBe(0);
    expect(worm.isOver(s)).toBe(false);
  });

  it('moves the head one cell right per update without mutating its input', () => {
    const c = ctx();
    const s = worm.init(c);
    const n = worm.update(s, c);
    expect(n.body[0]).toEqual({ x: 31, y: 10 });
    expect(n.body).toHaveLength(3);
    expect(s.body[0]).toEqual({ x: 30, y: 10 });
  });

  it('ignores reversing, even via two quick presses within one tick', () => {
    const c = ctx();
    const s = worm.onKey(worm.init(c), 'left');
    expect(worm.update(s, c).body[0]).toEqual({ x: 31, y: 10 });
    const t = worm.onKey(worm.onKey(worm.init(c), 'up'), 'left');
    const n = worm.update(t, c);
    expect(n.body[0]).toEqual({ x: 30, y: 9 });
    expect(worm.isOver(n)).toBe(false);
  });

  it('turns up', () => {
    const c = ctx();
    const s = worm.update(worm.onKey(worm.init(c), 'up'), c);
    expect(s.body[0]).toEqual({ x: 30, y: 9 });
  });

  it('eating grows, scores 10 and respawns the dot off the worm', () => {
    const c = ctx();
    const s = worm.init(c);
    s.dot = { x: 31, y: 10 };
    const n = worm.update(s, c);
    expect(worm.score(n)).toBe(10);
    expect(n.body).toHaveLength(4);
    expect(n.dot).not.toBeNull();
    expect(n.body.some(p => p.x === n.dot!.x && p.y === n.dot!.y)).toBe(false);
  });

  it('hitting the right wall ends the game', () => {
    const c = ctx();
    let s = worm.init(c);
    s.dot = { x: 0, y: 0 };
    for (let i = 0; i < 29; i++) s = worm.update(s, c); // head reaches x = 59
    expect(worm.isOver(s)).toBe(false);
    expect(worm.isOver(worm.update(s, c))).toBe(true);
  });

  it('turning back into its own body ends the game', () => {
    const c = ctx();
    let s = worm.init(c);
    s.body = row(5, 5);
    s.dot = { x: 0, y: 0 };
    for (const k of ['up', 'left', 'down'] as const) s = worm.update(worm.onKey(s, k), c);
    expect(worm.isOver(s)).toBe(true);
  });

  it('may enter the cell the tail is leaving, unless it grows that tick', () => {
    const c = ctx();
    const s = worm.init(c);
    // 2x2 square: head (1,1) having moved down, now turning left, would step into tail cell (0,1).
    s.body = [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }];
    s.moved = 'down';
    s.pending = 'left';
    s.dot = { x: 5, y: 5 };
    expect(worm.isOver(worm.update(s, c))).toBe(false);
    s.dot = { x: 0, y: 1 }; // eating on the tail cell: tail stays, so it is a collision
    expect(worm.isOver(worm.update(s, c))).toBe(true);
  });

  it('dot never spawns on the worm', () => {
    const body = worm.init(ctx()).body;
    for (let seed = 1; seed <= 100; seed++) {
      const d = spawnDot(body, ctx(seed))!;
      expect(body.some(p => p.x === d.x && p.y === d.y)).toBe(false);
    }
  });

  it('spawnDot returns null on a full board', () => {
    const body: Point[] = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 60; x++) body.push({ x, y });
    expect(spawnDot(body, ctx())).toBeNull();
  });

  it('draws worm, head and dot', () => {
    const s = worm.init(ctx());
    const calls: string[] = [];
    worm.draw(s, {
      width: 60, height: 20, text() {}, clear() {},
      put: (x, y, ch, col) => { calls.push(`${x},${y},${ch},${col}`); },
    });
    expect(calls).toContain('30,10,▓,brightGreen');
    expect(calls).toContain('29,10,█,green');
    expect(calls.some(l => l.endsWith(',●,yellow'))).toBe(true);
  });
});
