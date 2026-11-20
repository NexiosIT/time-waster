import { describe, expect, it } from 'vitest';
import { WAVES, marchInterval } from './waves';
import {
  CELL_W, COLS, POINTS, ROWS, SHIP_Y, enemyAt, initState, kindOfRow, onKey, stepShot,
} from './state';

describe('galaxy state', () => {
  it('has the initial values', () => {
    const s = initState();
    expect(s.wave).toBe(1);
    expect(s.lives).toBe(3);
    expect(s.score).toBe(0);
    expect(s.shipX).toBe(28);
    expect(s.fx).toBe(14);
    expect(s.fy).toBe(WAVES[0].startRow);
    expect(s.dir).toBe(1);
    expect(s.shot).toBeNull();
    expect(s.enemyShots).toEqual([]);
    expect(s.alive).toHaveLength(ROWS);
    expect(s.alive.every((r) => r.length === COLS && r.every(Boolean))).toBe(true);
    expect(s.marchIn).toBe(marchInterval(WAVES[0], 32, 32));
    expect(s.over).toBe(false);
    expect(s.debris).toHaveLength(12);
    expect(s.debris.every((p) => p.y === 16)).toBe(true);
    const xs = s.debris.map((p) => p.x).sort((a, b) => a - b);
    expect(xs).toEqual([10, 11, 12, 13, 28, 29, 30, 31, 46, 47, 48, 49]);
  });

  it('maps rows to kinds and enemies to cells', () => {
    expect([0, 1, 2, 3].map(kindOfRow)).toEqual(['drone', 'brute', 'brute', 'stinger']);
    const s = initState();
    expect(enemyAt(s, 2, 3)).toEqual({ x: s.fx + 3 * CELL_W, y: s.fy + 2 });
  });

  it('onKey does not mutate and moves by 2', () => {
    const s = initState();
    const before = structuredClone(s);
    const n = onKey(s, 'left');
    expect(s).toEqual(before);
    expect(n.shipX).toBe(26);
    expect(onKey(s, 'right').shipX).toBe(30);
  });

  it('clamps the ship at both edges', () => {
    expect(onKey({ ...initState(), shipX: 0 }, 'left').shipX).toBe(0);
    expect(onKey({ ...initState(), shipX: 1 }, 'left').shipX).toBe(0);
    expect(onKey({ ...initState(), shipX: 57 }, 'right').shipX).toBe(57);
    expect(onKey({ ...initState(), shipX: 56 }, 'right').shipX).toBe(57);
  });

  it('fires one shot at a time', () => {
    const a = onKey(initState(), 'space');
    expect(a.shot).toEqual({ x: 29, y: SHIP_Y - 1 });
    const b = onKey(onKey(a, 'left'), 'space');
    expect(b.shot).toEqual({ x: 29, y: SHIP_Y - 1 });
  });

  it('ignores keys when over or during a banner', () => {
    const o = { ...initState(), over: true };
    expect(onKey(o, 'left')).toEqual(o);
    expect(onKey(o, 'space')).toEqual(o);
    const b = { ...initState(), banner: 5 };
    expect(onKey(b, 'right')).toEqual(b);
    expect(onKey(b, 'space')).toEqual(b);
  });

  it('stepShot moves the shot up and removes it at the top', () => {
    const s = { ...initState(), shot: { x: 5, y: 10 } };
    const before = structuredClone(s);
    const n = stepShot(s);
    expect(s).toEqual(before);
    expect(n.shot).toEqual({ x: 5, y: 9 });
    expect(stepShot({ ...s, shot: { x: 5, y: 2 } }).shot).toEqual({ x: 5, y: 1 });
    expect(stepShot({ ...s, shot: { x: 5, y: 1 } }).shot).toBeNull();
    expect(stepShot({ ...s, shot: null })).toEqual({ ...s, shot: null });
  });

  it('stepShot destroys a debris cell and the shot', () => {
    const s = { ...initState(), shot: { x: 11, y: 17 } };
    const n = stepShot(s);
    expect(n.shot).toBeNull();
    expect(n.debris).toHaveLength(11);
    expect(n.debris.some((p) => p.x === 11 && p.y === 16)).toBe(false);
  });

  it('stepShot kills the bottom-row enemy by its middle cell for 30', () => {
    const s = initState();
    const e = enemyAt(s, 3, 2);
    const n = stepShot({ ...s, shot: { x: e.x + 1, y: e.y + 1 } });
    expect(n.shot).toBeNull();
    expect(n.alive[3][2]).toBe(false);
    expect(n.score).toBe(POINTS.stinger);
    expect(s.alive[3][2]).toBe(true);
  });

  it('stepShot scores 10 for a top-row enemy, hitting any of its 3 cells', () => {
    const s = initState();
    const e = enemyAt(s, 0, 0);
    for (const dx of [0, 2]) {
      const n = stepShot({ ...s, shot: { x: e.x + dx, y: e.y + 1 } });
      expect(n.alive[0][0]).toBe(false);
      expect(n.score).toBe(10);
    }
  });

  it('a shot in the gap column hits nothing', () => {
    const s = initState();
    const e = enemyAt(s, 3, 0);
    const n = stepShot({ ...s, shot: { x: e.x + 3, y: e.y + 1 } });
    expect(n.shot).toEqual({ x: e.x + 3, y: e.y });
    expect(n.score).toBe(0);
    expect(n.alive).toEqual(s.alive);
  });
});
