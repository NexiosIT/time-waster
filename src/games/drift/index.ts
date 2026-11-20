import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { Game, GameContext, Key, Screen } from '../../core/types';
import { generatePillars, inRect, isBlocked, spawnCoin, START, type Point, type Rect } from './arena';
import {
  gripFor, headingAngle, isDrifting, rotateHeading, speedForCoins, TICK_MS, turnToward,
} from './physics';

export const TRAIL_LEN = 12;

export interface DriftState {
  x: number; y: number;      // float position, in cells
  heading: number;           // 0..7
  travel: number;            // radians, [0, 2π)
  lastTurn: 1 | -1;          // last steering press: 1 = right (clockwise), -1 = left
  coins: number;
  coin: Point;
  pillars: Rect[];
  trail: Point[];            // most recent cell first, at most TRAIL_LEN, no consecutive duplicates
  crashed: boolean;
}

const CAR = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

export function cellOf(s: { x: number; y: number }): Point {
  return { x: Math.round(s.x), y: Math.round(s.y) };
}

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

function init(ctx: GameContext): DriftState {
  const pillars = generatePillars(ctx);
  return {
    x: START.x, y: START.y, heading: 0, travel: 0, lastTurn: 1, coins: 0,
    coin: spawnCoin(START, pillars, ctx), pillars, trail: [], crashed: false,
  };
}

function onKey(state: DriftState, key: Key): DriftState {
  if (state.crashed) return state;
  if (key === 'right') return { ...state, heading: rotateHeading(state.heading, 1), lastTurn: 1 };
  if (key === 'left') return { ...state, heading: rotateHeading(state.heading, -1), lastTurn: -1 };
  return state;
}

function update(state: DriftState, ctx: GameContext): DriftState {
  if (state.crashed) return state;
  const speed = speedForCoins(state.coins);
  const travel = turnToward(state.travel, headingAngle(state.heading), gripFor(speed), state.lastTurn);
  const dx = Math.cos(travel) * speed * TICK_MS / 1000;
  const dy = Math.sin(travel) * speed * TICK_MS / 1000 * 0.5;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));

  let { x, y, coins, coin, trail } = state;
  let crashed = false;
  for (let i = 0; i < n; i++) {
    x += dx / n;
    y += dy / n;
    const cell = cellOf({ x, y });
    if (isBlocked(cell, state.pillars)) { crashed = true; break; }
    if (samePoint(cell, coin)) {
      coins += 1;
      coin = spawnCoin(cell, state.pillars, ctx);
    }
    if (trail.length === 0 || !samePoint(trail[0], cell)) trail = [cell, ...trail].slice(0, TRAIL_LEN);
  }
  return { ...state, x, y, travel, coins, coin, trail, crashed };
}

function draw(state: DriftState, screen: Screen): void {
  const W = GAME_WIDTH - 1, H = GAME_HEIGHT - 1;
  for (let x = 1; x < W; x++) { screen.put(x, 0, '─', 'white'); screen.put(x, H, '─', 'white'); }
  for (let y = 1; y < H; y++) { screen.put(0, y, '│', 'white'); screen.put(W, y, '│', 'white'); }
  screen.put(0, 0, '┌', 'white'); screen.put(W, 0, '┐', 'white');
  screen.put(0, H, '└', 'white'); screen.put(W, H, '┘', 'white');

  for (const r of state.pillars) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) if (inRect({ x, y }, r)) screen.put(x, y, '█', 'blue');
  }

  const car = cellOf(state);
  if (isDrifting(state.travel, state.heading)) {
    for (const t of state.trail) if (!samePoint(t, car)) screen.put(t.x, t.y, '·', 'gray');
  }
  screen.put(state.coin.x, state.coin.y, '●', 'yellow');
  screen.put(car.x, car.y, CAR[state.heading], state.crashed ? 'red' : 'brightCyan');
}

const drift: Game<DriftState> = {
  id: 'drift',
  title: 'Drift',
  description: "Drift for coins. Every coin is faster. Don't touch the walls.",
  tickMs: TICK_MS,
  controls: '←→ steer',
  init,
  onKey,
  update,
  draw,
  score: s => s.coins * 10,
  isOver: s => s.crashed,
};

export default drift;
