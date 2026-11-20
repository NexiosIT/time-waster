import { GAME_HEIGHT, GAME_WIDTH, type GameContext } from '../../core/types';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export const START: Point = { x: 6, y: 10 };
export const SAFE_ZONE: Rect = { x: 1, y: 7, w: 20, h: 7 };
export const MIN_COIN_DIST = 10;

const ATTEMPTS_PER_PILLAR = 500;
const MAX_RESTARTS = 20;

// Known-legal layout used only if every random restart fails.
const FALLBACK_PILLARS: Rect[] = [
  { x: 24, y: 3, w: 3, h: 2 },
  { x: 34, y: 3, w: 3, h: 2 },
  { x: 44, y: 3, w: 3, h: 2 },
  { x: 30, y: 14, w: 3, h: 2 },
  { x: 44, y: 14, w: 3, h: 2 },
];

export function isWall(p: Point): boolean {
  return p.x <= 0 || p.y <= 0 || p.x >= GAME_WIDTH - 1 || p.y >= GAME_HEIGHT - 1;
}

export function inRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export function isBlocked(p: Point, pillars: Rect[]): boolean {
  return isWall(p) || pillars.some((r) => inRect(p, r));
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const grown = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });

const randInt = (ctx: GameContext, min: number, max: number): number =>
  min + Math.floor(ctx.random() * (max - min + 1));

function tryPlace(count: number, ctx: GameContext): Rect[] | null {
  const pillars: Rect[] = [];
  while (pillars.length < count) {
    let placed = false;
    for (let a = 0; a < ATTEMPTS_PER_PILLAR && !placed; a++) {
      const w = randInt(ctx, 2, 4);
      const h = randInt(ctx, 1, 2);
      const x = randInt(ctx, 3, 56 - w + 1);
      const y = randInt(ctx, 3, 16 - h + 1);
      const cand: Rect = { x, y, w, h };
      if (intersects(cand, SAFE_ZONE)) continue;
      if (pillars.some((q) => intersects(grown(cand, 2), q))) continue;
      pillars.push(cand);
      placed = true;
    }
    if (!placed) return null;
  }
  return pillars;
}

export function generatePillars(ctx: GameContext): Rect[] {
  const count = 5 + Math.floor(ctx.random() * 3);
  for (let r = 0; r < MAX_RESTARTS; r++) {
    const result = tryPlace(count, ctx);
    if (result) return result;
  }
  return FALLBACK_PILLARS.map((p) => ({ ...p }));
}

export function spawnCoin(car: Point, pillars: Rect[], ctx: GameContext): Point {
  const candidates: Point[] = [];
  for (let y = 1; y < GAME_HEIGHT - 1; y++) {
    for (let x = 1; x < GAME_WIDTH - 1; x++) {
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (isBlocked({ x: x + dx, y: y + dy }, pillars)) { clear = false; break; }
      if (clear) candidates.push({ x, y });
    }
  }
  const far = candidates.filter((c) => Math.hypot(c.x - car.x, 2 * (c.y - car.y)) >= MIN_COIN_DIST);
  const pool = far.length > 0 ? far : candidates;
  return pool[Math.floor(ctx.random() * pool.length)];
}
