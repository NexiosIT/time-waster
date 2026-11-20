import type { GameContext } from '../../core/types';
import { grown, intersects, PILLAR_SIZE, placeRect, type Rect } from './arena';

export interface Pending { kind: 'pillar' | 'oil'; rect: Rect; ticksLeft: number }

export const OBSTACLE_EVERY = 5, WARN_TICKS = 40, MAX_PILLARS = 12, MAX_OIL = 3, OIL_FROM = 10;
export const SHUFFLE_TICKS = 30;
export const OIL_SIZE = { w: [3, 5] as [number, number], h: [1, 2] as [number, number] };

/** Queues a new obstacle (pending counts toward caps); null when capped or no room. */
export function newObstacle(
  args: { pillars: Rect[]; oil: Rect[]; pending: Pending[]; avoid: Rect[]; coins: number }, ctx: GameContext,
): Pending | null {
  const { pillars, oil, pending, avoid, coins } = args;
  const pillarCount = pillars.length + pending.filter((p) => p.kind === 'pillar').length;
  const oilCount = oil.length + pending.filter((p) => p.kind === 'oil').length;
  let kind: Pending['kind'];
  if (coins >= OIL_FROM && oilCount < MAX_OIL && ctx.random() < 1 / 3) kind = 'oil';
  else if (pillarCount < MAX_PILLARS) kind = 'pillar';
  else return null;
  const existing = [...pillars, ...oil, ...pending.map((p) => p.rect)];
  const rect = placeRect(existing, avoid, kind === 'oil' ? OIL_SIZE : PILLAR_SIZE, ctx);
  return rect ? { kind, rect, ticksLeft: WARN_TICKS } : null;
}

const SHUFFLE_RESTARTS = 20;

/** New positions for the pillars: at most the old count, 2-cell gaps, clear of `avoid`. Tops up with old pillars if it can't fit them all. */
export function shuffleLayout(old: Rect[], avoid: Rect[], ctx: GameContext): Rect[] {
  let best: Rect[] = [];
  for (let r = 0; r < SHUFFLE_RESTARTS && best.length < old.length; r++) {
    const placed: Rect[] = [];
    while (placed.length < old.length) {
      const rect = placeRect(placed, avoid, PILLAR_SIZE, ctx);
      if (!rect) break;
      placed.push(rect);
    }
    if (placed.length > best.length) best = placed;
  }
  const out = [...best];
  for (const o of old) {
    if (out.length >= old.length) break;
    if (avoid.some((a) => intersects(o, a))) continue;
    if (out.some((q) => intersects(grown(o, 2), q))) continue;
    out.push(o);
  }
  return out;
}
