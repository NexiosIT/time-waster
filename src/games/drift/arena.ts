import { GAME_HEIGHT, GAME_WIDTH, type GameContext } from '../../core/types';
import { MAX_SPEED, START_SPEED } from './physics';

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

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const grown = (r: Rect, n: number): Rect => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });

const randInt = (ctx: GameContext, min: number, max: number): number =>
  min + Math.floor(ctx.random() * (max - min + 1));

export const PILLAR_SIZE = { w: [2, 4] as [number, number], h: [1, 2] as [number, number] };

/** Random rect 2 cells clear of the walls and of `existing`, never touching `avoid`; null if no spot found. */
export function placeRect(
  existing: Rect[], avoid: Rect[], size: { w: [number, number]; h: [number, number] }, ctx: GameContext,
  attempts = ATTEMPTS_PER_PILLAR,
): Rect | null {
  for (let a = 0; a < attempts; a++) {
    const w = randInt(ctx, size.w[0], size.w[1]);
    const h = randInt(ctx, size.h[0], size.h[1]);
    const cand: Rect = { x: randInt(ctx, 3, 57 - w), y: randInt(ctx, 3, 17 - h), w, h };
    if (avoid.some((r) => intersects(cand, r))) continue;
    if (existing.some((q) => intersects(grown(cand, 2), q))) continue;
    return cand;
  }
  return null;
}

/** A 5x5 box around the car cell plus the 8 cells ahead along `travel`. */
export function carZone(x: number, y: number, travel: number): Rect[] {
  const zone: Rect[] = [{ x: Math.round(x) - 2, y: Math.round(y) - 2, w: 5, h: 5 }];
  for (let i = 1; i <= 8; i++) {
    zone.push({
      x: Math.round(x + i * Math.cos(travel)), y: Math.round(y + i * 0.5 * Math.sin(travel)), w: 1, h: 1,
    });
  }
  return zone;
}

function tryPlace(count: number, ctx: GameContext): Rect[] | null {
  const pillars: Rect[] = [];
  while (pillars.length < count) {
    const r = placeRect(pillars, [SAFE_ZONE], PILLAR_SIZE, ctx);
    if (!r) return null;
    pillars.push(r);
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

export const pointRect = (p: Point): Rect => ({ x: p.x, y: p.y, w: 1, h: 1 });

/** Free columns/rows a coin should keep around it; grows with speed so it stays reachable. */
export function clearanceFor(speed: number): { cx: number; cy: number } {
  const t = (speed - START_SPEED) / (MAX_SPEED - START_SPEED);
  const cx = Math.min(4, Math.max(1, Math.round(1 + 3 * t)));
  return { cx, cy: Math.ceil(cx / 2) };
}

/** The box around `p` that must stay free of pillars for a coin at `speed`. */
export function clearBox(p: Point, speed: number): Rect {
  const { cx, cy } = clearanceFor(speed);
  return { x: p.x - cx, y: p.y - cy, w: 2 * cx + 1, h: 2 * cy + 1 };
}

function hasClearance(p: Point, cx: number, cy: number, pillars: Rect[]): boolean {
  for (let dy = -cy; dy <= cy; dy++)
    for (let dx = -cx; dx <= cx; dx++)
      if (isBlocked({ x: p.x + dx, y: p.y + dy }, pillars)) return false;
  return true;
}

// Generated layouts (including the fallback) always leave legal cells, so the pool is never empty.
export function spawnCoin(
  car: Point, pillars: Rect[], ctx: GameContext, opts: { speed?: number; avoid?: Rect[] } = {},
): Point {
  const avoid = opts.avoid ?? [];
  const free: Point[] = [];
  for (let y = 1; y < GAME_HEIGHT - 1; y++)
    for (let x = 1; x < GAME_WIDTH - 1; x++) {
      const p = { x, y };
      if (!isBlocked(p, pillars) && !avoid.some((r) => inRect(p, r))) free.push(p);
    }
  let candidates: Point[] = [];
  for (let cx = clearanceFor(opts.speed ?? START_SPEED).cx; cx >= 1 && candidates.length === 0; cx--) {
    const cy = Math.ceil(cx / 2);
    candidates = free.filter((p) => hasClearance(p, cx, cy, pillars));
  }
  if (candidates.length === 0) candidates = free;
  const far = candidates.filter((c) => Math.hypot(c.x - car.x, 2 * (c.y - car.y)) >= MIN_COIN_DIST);
  const pool = far.length > 0 ? far : candidates;
  return pool[Math.floor(ctx.random() * pool.length)];
}
