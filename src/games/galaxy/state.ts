import type { Key } from '../../core/types';
import { WAVES, marchInterval } from './waves';

export const ROWS = 4;
export const COLS = 8;
export const CELL_W = 4;
export const FORMATION_W = 31;
export const SHIP_Y = 18;
export const SHIP_W = 3;
export const DEBRIS_Y = 16;
export const LOSE_ROW = 17;
export const LIVES = 3;
export const POINTS = { drone: 10, brute: 20, stinger: 30 } as const;
export const WAVE_BONUS = 100;
export const CLEAR_BONUS = 500;
export const BLINK_TICKS = 20;
export const BANNER_TICKS = 40;
export const ENEMY_SHOT_EVERY = 2;

const SHIP_MAX_X = 57;

export type Kind = 'drone' | 'brute' | 'stinger';
export type Point = { x: number; y: number };

export type GalaxyState = {
  wave: number;
  lives: number;
  score: number;
  shipX: number;
  shot: Point | null;
  enemyShots: Point[];
  alive: boolean[][];
  fx: number;
  fy: number;
  dir: 1 | -1;
  marchIn: number;
  tick: number;
  debris: Point[];
  blink: number;
  banner: number;
  over: boolean;
};

export function kindOfRow(r: number): Kind {
  return r === 0 ? 'drone' : r <= 2 ? 'brute' : 'stinger';
}

export function enemyAt(s: GalaxyState, r: number, c: number): Point {
  return { x: s.fx + c * CELL_W, y: s.fy + r };
}

export function initState(): GalaxyState {
  const debris: Point[] = [];
  for (const x0 of [10, 28, 46]) {
    for (let dx = 0; dx < 4; dx++) debris.push({ x: x0 + dx, y: DEBRIS_Y });
  }
  return {
    wave: 1,
    lives: LIVES,
    score: 0,
    shipX: 28,
    shot: null,
    enemyShots: [],
    alive: Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(true)),
    fx: 14,
    fy: WAVES[0].startRow,
    dir: 1,
    marchIn: marchInterval(WAVES[0], ROWS * COLS, ROWS * COLS),
    tick: 0,
    debris,
    blink: 0,
    banner: 0,
    over: false,
  };
}

export function onKey(s: GalaxyState, key: Key): GalaxyState {
  if (s.over || s.banner > 0) return s;
  if (key === 'left') return { ...s, shipX: Math.max(0, s.shipX - 2) };
  if (key === 'right') return { ...s, shipX: Math.min(SHIP_MAX_X, s.shipX + 2) };
  if (key === 'space' && s.shot === null) {
    return { ...s, shot: { x: s.shipX + 1, y: SHIP_Y - 1 } };
  }
  return s;
}

/** Advance the player shot one row, resolving debris and enemy hits. */
export function stepShot(s: GalaxyState): GalaxyState {
  if (s.shot === null) return s;
  const x = s.shot.x;
  const y = s.shot.y - 1;
  if (y < 1) return { ...s, shot: null };

  const di = s.debris.findIndex((p) => p.x === x && p.y === y);
  if (di >= 0) {
    return { ...s, shot: null, debris: s.debris.filter((_, i) => i !== di) };
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!s.alive[r][c]) continue;
      const e = enemyAt(s, r, c);
      if (e.y === y && x >= e.x && x <= e.x + 2) {
        return {
          ...s,
          shot: null,
          score: s.score + POINTS[kindOfRow(r)],
          alive: s.alive.map((row, ri) => (ri === r ? row.map((a, ci) => (ci === c ? false : a)) : row)),
        };
      }
    }
  }
  return { ...s, shot: { x, y } };
}
