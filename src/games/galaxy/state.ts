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
const FIELD_MAX_X = 59;
const SHOT_MAX_Y = 19;

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

/** Formation, debris and shots as they are at the start of `wave`. */
function waveStart(wave: number) {
  const spec = WAVES[wave - 1];
  const debris: Point[] = [];
  for (const x0 of [10, 28, 46]) {
    for (let dx = 0; dx < 4; dx++) debris.push({ x: x0 + dx, y: DEBRIS_Y });
  }
  return {
    wave,
    shot: null,
    enemyShots: [],
    alive: Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(true)),
    fx: 14,
    fy: spec.startRow,
    dir: 1 as const,
    marchIn: marchInterval(spec, ROWS * COLS, ROWS * COLS),
    debris,
  };
}

export function initState(): GalaxyState {
  return {
    ...waveStart(1),
    lives: LIVES,
    score: 0,
    shipX: 28,
    tick: 0,
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

function aliveCount(s: GalaxyState): number {
  return s.alive.reduce((n, row) => n + row.filter(Boolean).length, 0);
}

function aliveColumns(s: GalaxyState): number[] {
  const cols: number[] = [];
  for (let c = 0; c < COLS; c++) if (s.alive.some((row) => row[c])) cols.push(c);
  return cols;
}

/** Move enemy shots down, resolving debris and ship hits. */
function stepEnemyShots(s: GalaxyState): GalaxyState {
  if (s.tick % ENEMY_SHOT_EVERY !== 0 || s.enemyShots.length === 0) return s;
  let debris = s.debris;
  const shots: Point[] = [];
  for (const p of s.enemyShots) {
    const x = p.x;
    const y = p.y + 1;
    if (y > SHOT_MAX_Y) continue;
    const di = debris.findIndex((d) => d.x === x && d.y === y);
    if (di >= 0) {
      debris = debris.filter((_, i) => i !== di);
      continue;
    }
    if (s.blink === 0 && y === SHIP_Y && x >= s.shipX && x < s.shipX + SHIP_W) {
      const lives = s.lives - 1;
      return { ...s, debris, lives, enemyShots: [], blink: BLINK_TICKS, over: lives === 0 };
    }
    shots.push({ x, y });
  }
  return { ...s, debris, enemyShots: shots };
}

function enemyFire(s: GalaxyState, random: () => number): GalaxyState {
  const spec = WAVES[s.wave - 1];
  if (s.enemyShots.length >= spec.maxEnemyShots || random() >= spec.fireChance) return s;
  const cols = aliveColumns(s);
  if (cols.length === 0) return s;
  const c = cols[Math.floor(random() * cols.length)];
  let r = ROWS - 1;
  while (!s.alive[r][c]) r--;
  const e = enemyAt(s, r, c);
  // Too low: the shot would reach the ship faster than a human can react.
  if (e.y + 1 >= DEBRIS_Y) return s;
  return { ...s, enemyShots: [...s.enemyShots, { x: e.x + 1, y: e.y + 1 }] };
}

function march(s: GalaxyState): GalaxyState {
  const cols = aliveColumns(s);
  if (cols.length === 0) return s;
  if (s.marchIn > 1) return { ...s, marchIn: s.marchIn - 1 };
  const marchIn = marchInterval(WAVES[s.wave - 1], aliveCount(s), ROWS * COLS);
  const fx = s.fx + s.dir;
  const left = fx + cols[0] * CELL_W;
  const right = fx + cols[cols.length - 1] * CELL_W + 2;
  if (left < 0 || right > FIELD_MAX_X) {
    return { ...s, fy: s.fy + 1, dir: s.dir === 1 ? -1 : 1, marchIn };
  }
  return { ...s, fx, marchIn };
}

function reachedLoseRow(s: GalaxyState): boolean {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (s.alive[r].some(Boolean)) return s.fy + r >= LOSE_ROW;
  }
  return false;
}

/** Advance the game by one tick. */
export function step(s: GalaxyState, random: () => number): GalaxyState {
  // 1. Finished, or showing the wave-5 banner.
  if (s.over) return s;
  if (s.banner > 0) {
    const banner = s.banner - 1;
    return { ...s, banner, over: banner === 0 };
  }

  // 2. Clock, blink and player shot.
  let n: GalaxyState = { ...s, tick: s.tick + 1, blink: Math.max(0, s.blink - 1) };
  n = stepShot(n);

  // 3. Enemy shots.
  n = stepEnemyShots(n);
  if (n.over) return n;

  // 4. Enemy fire. 5. March.
  n = enemyFire(n, random);
  n = march(n);

  // 6. Formation reached the ship's row.
  if (reachedLoseRow(n)) return { ...n, over: true };

  // 7. Wave cleared.
  if (aliveCount(n) === 0) {
    const score = n.score + WAVE_BONUS * n.lives;
    if (n.wave === WAVES.length) {
      return { ...n, score: score + CLEAR_BONUS, banner: BANNER_TICKS };
    }
    return { ...n, ...waveStart(n.wave + 1), score };
  }
  return n;
}
