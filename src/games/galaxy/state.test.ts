import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import { WAVES, marchInterval } from './waves';
import {
  BANNER_TICKS, BLINK_TICKS, CELL_W, CLEAR_BONUS, COLS, DEBRIS_Y, ENEMY_SHOT_EVERY, LOSE_ROW, POINTS,
  ROWS, SHIP_Y, WAVE_BONUS, enemyAt, initState, kindOfRow, onKey, step, stepShot,
} from './state';
import type { GalaxyState } from './state';

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

const never = () => 0.99;
const always = () => 0;
const dead = (): boolean[][] => Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
const only = (cells: [number, number][]): boolean[][] => {
  const a = dead();
  for (const [r, c] of cells) a[r][c] = true;
  return a;
};
const run = (s: GalaxyState, n: number, random: () => number): GalaxyState => {
  for (let i = 0; i < n; i++) s = step(s, random);
  return s;
};

describe('galaxy step', () => {
  it('does not mutate its input', () => {
    let s = initState();
    const random = createRandom(7);
    for (let i = 0; i < 300; i++) {
      const before = structuredClone(s);
      const n = step(s, random);
      expect(s).toEqual(before);
      s = n;
    }
  });

  it('advances tick and counts blink down to 0', () => {
    const s = step({ ...initState(), blink: 1 }, never);
    expect(s.tick).toBe(1);
    expect(s.blink).toBe(0);
    expect(step(s, never).blink).toBe(0);
  });

  it('moves the formation 1 column after marchTicks ticks', () => {
    const s = initState();
    const ticks = WAVES[0].marchTicks;
    expect(run(s, ticks - 1, never).fx).toBe(14);
    const n = run(s, ticks, never);
    expect(n.fx).toBe(15);
    expect(n.fy).toBe(s.fy);
    expect(n.marchIn).toBe(marchInterval(WAVES[0], 32, 32));
  });

  it('drops a row and reverses at the right wall', () => {
    const s = { ...initState(), fx: 28, marchIn: 1 };
    const a = step(s, never);
    expect(a.fx).toBe(29);
    expect(a.fy).toBe(s.fy);
    const b = step({ ...a, marchIn: 1 }, never);
    expect(b.fx).toBe(29);
    expect(b.fy).toBe(s.fy + 1);
    expect(b.dir).toBe(-1);
    const c = step({ ...b, marchIn: 1 }, never);
    expect(c.fx).toBe(28);
  });

  it('drops a row and reverses at the left wall', () => {
    const s = { ...initState(), fx: 0, dir: -1 as const, marchIn: 1 };
    const n = step(s, never);
    expect(n.fx).toBe(0);
    expect(n.fy).toBe(s.fy + 1);
    expect(n.dir).toBe(1);
  });

  it('a thinned formation reaches the walls', () => {
    const turnFx = (alive: boolean[][], dir: 1 | -1) => {
      let s: GalaxyState = { ...initState(), alive, dir, fx: 14 };
      const fy = s.fy;
      while (s.fy === fy) s = step({ ...s, marchIn: 1 }, never);
      return s;
    };
    // Full formation turns at fx 29 (right) and fx 0 (left).
    expect(turnFx(initState().alive, 1).fx).toBe(29);
    // Only the far-left column alive: it travels further right (column 0 reaches x 57..59).
    expect(turnFx(only([[0, 0], [3, 0]]), 1).fx).toBe(57);
    // Only the far-right column alive: it travels further left (column 7 reaches x 0).
    expect(turnFx(only([[0, 7], [3, 7]]), -1).fx).toBe(-28);
    // Only the far-right column alive marching right turns at the same place as a full one.
    expect(turnFx(only([[3, 7]]), 1).fx).toBe(29);
  });

  it('march interval speeds up as enemies die', () => {
    const alive = only([[3, 0]]);
    const n = step({ ...initState(), alive, marchIn: 1 }, never);
    expect(n.marchIn).toBe(marchInterval(WAVES[0], 1, 32));
  });

  it('does not fire when random returns 0.99', () => {
    expect(run(initState(), 50, never).enemyShots).toEqual([]);
  });

  it('fires from the lowest alive enemy of the chosen column when random returns 0', () => {
    const s = { ...initState(), marchIn: 99 };
    const n = step(s, always);
    const e = enemyAt(s, 3, 0);
    expect(n.enemyShots).toEqual([{ x: e.x + 1, y: e.y + 1 }]);

    const alive = s.alive.map((row) => [...row]);
    alive[3][0] = false;
    alive[2][0] = false;
    const m = step({ ...s, alive }, always);
    const e1 = enemyAt(s, 1, 0);
    expect(m.enemyShots).toEqual([{ x: e1.x + 1, y: e1.y + 1 }]);
  });

  it('does not fire when the shot would spawn at or below the debris row', () => {
    const low = { ...initState(), fy: DEBRIS_Y - 1 - (ROWS - 1), marchIn: 99 };
    expect(step(low, always).enemyShots).toEqual([]);
    const ok = { ...initState(), fy: DEBRIS_Y - 2 - (ROWS - 1), marchIn: 99 };
    expect(step(ok, always).enemyShots).toHaveLength(1);
  });

  it('picks among alive columns only', () => {
    const s = { ...initState(), alive: only([[0, 2], [1, 5]]), marchIn: 99 };
    // 2 alive columns; 0.6 * 2 → index 1 → column 5.
    const vals = [0, 0.6];
    const n = step(s, () => vals.shift() ?? 0.99);
    const e = enemyAt(s, 1, 5);
    expect(n.enemyShots).toEqual([{ x: e.x + 1, y: e.y + 1 }]);
  });

  it('never has more than maxEnemyShots enemy shots', () => {
    let s: GalaxyState = { ...initState(), debris: [] };
    for (let i = 0; i < 300 && !s.over; i++) {
      s = step(s, always);
      expect(s.enemyShots.length).toBeLessThanOrEqual(WAVES[0].maxEnemyShots);
    }
    const full = { ...initState(), enemyShots: [{ x: 1, y: 8 }, { x: 3, y: 8 }] };
    expect(step(full, always).enemyShots).toHaveLength(2);
  });

  it('moves enemy shots down every ENEMY_SHOT_EVERY ticks', () => {
    const s = { ...initState(), enemyShots: [{ x: 5, y: 8 }] };
    const a = step(s, never); // tick 1
    expect(a.enemyShots).toEqual([{ x: 5, y: 8 }]);
    const b = step(a, never); // tick 2
    expect(b.enemyShots).toEqual([{ x: 5, y: 9 }]);
    expect(ENEMY_SHOT_EVERY).toBe(2);
  });

  it('an enemy shot removes a debris cell and itself', () => {
    const s = { ...initState(), tick: 1, enemyShots: [{ x: 11, y: 15 }] };
    const n = step(s, never);
    expect(n.enemyShots).toEqual([]);
    expect(n.debris).toHaveLength(11);
    expect(n.debris.some((p) => p.x === 11 && p.y === DEBRIS_Y)).toBe(false);
  });

  it('enemy shots vanish below row 19', () => {
    const s = { ...initState(), tick: 1, enemyShots: [{ x: 0, y: 19 }] };
    expect(step(s, never).enemyShots).toEqual([]);
    const t = { ...initState(), tick: 1, enemyShots: [{ x: 0, y: 18 }] };
    expect(step(t, never).enemyShots).toEqual([{ x: 0, y: 19 }]);
  });

  it('a hit costs one life, clears enemy shots and starts the blink; a hit during the blink costs nothing', () => {
    const s = {
      ...initState(),
      tick: 1,
      enemyShots: [{ x: 30, y: SHIP_Y - 1 }, { x: 5, y: 5 }],
    };
    const a = step(s, never);
    expect(a.lives).toBe(2);
    expect(a.enemyShots).toEqual([]);
    expect(a.blink).toBe(BLINK_TICKS);
    expect(a.over).toBe(false);

    // Hit on the ship's left cell during the blink.
    const b = run({ ...a, enemyShots: [{ x: 28, y: SHIP_Y - 1 }] }, 2, never);
    expect(b.lives).toBe(2);
    expect(b.blink).toBe(BLINK_TICKS - 2);
  });

  it('a shot beside the ship misses', () => {
    const s = { ...initState(), tick: 1, enemyShots: [{ x: 31, y: SHIP_Y - 1 }] };
    const n = step(s, never);
    expect(n.lives).toBe(3);
    expect(n.enemyShots).toEqual([{ x: 31, y: SHIP_Y }]);
  });

  it('losing the third life ends the game', () => {
    const s = { ...initState(), lives: 1, tick: 1, enemyShots: [{ x: 29, y: SHIP_Y - 1 }] };
    const n = step(s, never);
    expect(n.lives).toBe(0);
    expect(n.over).toBe(true);
  });

  it('an alive enemy at row 17 ends the game even with 3 lives', () => {
    const s = { ...initState(), fy: LOSE_ROW - 3, marchIn: 99 };
    const n = step(s, never);
    expect(n.lives).toBe(3);
    expect(n.over).toBe(true);

    // Dead rows don't count.
    const alive = s.alive.map((row, r) => row.map((a) => (r === 3 ? false : a)));
    expect(step({ ...s, alive }, never).over).toBe(false);
  });

  it('the formation marching down to row 17 ends the game', () => {
    const s = { ...initState(), fy: LOSE_ROW - 4, fx: 29, marchIn: 1 };
    const n = step(s, never);
    expect(n.fy).toBe(LOSE_ROW - 3);
    expect(n.over).toBe(true);
  });

  it('killing the last enemy of wave 1 with 3 lives adds 300 and starts wave 2', () => {
    const base = initState();
    const s: GalaxyState = {
      ...base,
      alive: only([[3, 0]]),
      fx: 20,
      dir: -1,
      shipX: 40,
      debris: [{ x: 11, y: DEBRIS_Y }],
      enemyShots: [{ x: 50, y: 10 }],
    };
    const e = enemyAt(s, 3, 0);
    const n = step({ ...s, shot: { x: e.x + 1, y: e.y + 1 } }, always);
    expect(n.score).toBe(POINTS.stinger + WAVE_BONUS * 3);
    expect(n.wave).toBe(2);
    expect(n.fy).toBe(WAVES[1].startRow);
    expect(n.fy).toBe(3);
    expect(n.fx).toBe(14);
    expect(n.dir).toBe(1);
    expect(n.alive).toEqual(base.alive);
    expect(n.debris).toEqual(base.debris);
    expect(n.shot).toBeNull();
    expect(n.enemyShots).toEqual([]);
    expect(n.marchIn).toBe(marchInterval(WAVES[1], 32, 32));
    expect(n.lives).toBe(3);
    expect(n.shipX).toBe(40);
    expect(n.over).toBe(false);
    expect(n.banner).toBe(0);
  });

  it('the wave bonus scales with lives left', () => {
    const s = { ...initState(), lives: 1, alive: dead() };
    expect(step(s, never).score).toBe(WAVE_BONUS);
  });

  it('clearing wave 5 adds 300 + 500, shows the banner and ends after BANNER_TICKS ticks', () => {
    const s: GalaxyState = { ...initState(), wave: 5, fy: WAVES[4].startRow, alive: only([[0, 4]]) };
    const e = enemyAt(s, 0, 4);
    const n = step({ ...s, shot: { x: e.x, y: e.y + 1 } }, always);
    expect(n.score).toBe(POINTS.drone + WAVE_BONUS * 3 + CLEAR_BONUS);
    expect(n.banner).toBe(BANNER_TICKS);
    expect(n.wave).toBe(5);
    expect(n.over).toBe(false);

    const almost = run(n, BANNER_TICKS - 1, always);
    expect(almost.over).toBe(false);
    expect(almost.banner).toBe(1);
    expect(almost.tick).toBe(n.tick);
    expect(almost.score).toBe(n.score);
    const done = step(almost, always);
    expect(done.banner).toBe(0);
    expect(done.over).toBe(true);
  });

  it('keys during the banner and after over change nothing', () => {
    const b = { ...initState(), banner: 5, alive: dead() };
    for (const k of ['left', 'right', 'space'] as const) expect(onKey(b, k)).toBe(b);
    const o = { ...initState(), over: true };
    for (const k of ['left', 'right', 'space'] as const) expect(onKey(o, k)).toBe(o);
    expect(step(o, always)).toBe(o);
  });
});
