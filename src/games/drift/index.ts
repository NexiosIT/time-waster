import { GAME_HEIGHT, GAME_WIDTH, type Game, type GameContext, type Key, type Screen } from '../../core/types';
import { carZone, generatePillars, grown, inRect, intersects, isWall, pointRect, spawnCoin, START, type Point, type Rect } from './arena';
import {
  addEffect, DURATION, gripNow, hasEffect, modifiers, removeEffect, tickEffects, type Effect,
} from './effects';
import { newObstacle, OBSTACLE_EVERY, SHUFFLE_TICKS, shuffleLayout, type Pending } from './obstacles';
import {
  headingAngle, isDrifting, rotateHeading, speedForCoins, TICK_MS, turnToward,
} from './physics';
import {
  FIRST_POWER_AT, nextPowerGap, pickPower, POWER_BLINK, POWER_LIFE, POWER_LOOK, resolveMystery, type PowerKind, type PowerUp,
} from './powerups';

export const TRAIL_LEN = 6;
const BASE_COIN = 10;
export const RAIN_COUNT = 5;

export interface DriftState {
  x: number; y: number;      // float position, in cells
  heading: number;           // 0..7
  travel: number;            // radians, [0, 2π)
  lastTurn: 1 | -1;          // last steering press: 1 = right (clockwise), -1 = left
  coins: number;
  coin: Point;
  extraCoins: Point[];       // Coin rain extras
  pillars: Rect[];
  shuffle: { pillars: Rect[]; ticksLeft: number } | null; // pending new pillar layout
  oil: Rect[];               // solid oil patches (low grip)
  pending: Pending[];        // blinking warnings that turn solid later
  trail: Point[];            // most recent cell first, at most TRAIL_LEN, no consecutive duplicates
  crashed: boolean;
  points: number;            // score
  scheduleCoins: number;     // coins that drive schedules (Coin rain extras excluded)
  nextPowerAt: number | null; // scheduleCoins at which the next power-up spawns; null while one is on the floor
  powerUp: PowerUp | null;
  effects: Effect[];
  tick: number;              // +1 per update, used for blinking
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
    coin: spawnCoin(START, pillars, ctx), extraCoins: [], pillars, oil: [], shuffle: null, pending: [], trail: [], crashed: false,
    points: 0, scheduleCoins: 0, nextPowerAt: FIRST_POWER_AT, powerUp: null, effects: [], tick: 0,
  };
}

function onKey(state: DriftState, key: Key): DriftState {
  if (state.crashed) return state;
  if (key === 'right') return { ...state, heading: rotateHeading(state.heading, 1), lastTurn: 1 };
  if (key === 'left') return { ...state, heading: rotateHeading(state.heading, -1), lastTurn: -1 };
  return state;
}

/** Applies a collected power-up. */
export function applyPower(state: DriftState, kind: PowerKind, ctx: GameContext): DriftState {
  if (kind === 'mystery') {
    const outcome = resolveMystery(ctx);
    return outcome === 'slick' ? { ...state, effects: addEffect(state.effects, 'slick') } : applyPower(state, outcome, ctx);
  }
  if (kind === 'shuffle') {
    const avoid = [...carZone(state.x, state.y, state.travel), ...spawnAvoid({ ...state, shuffle: null }), ...state.oil,
      ...[...state.oil, ...state.pending.map((p) => p.rect)].map((r) => grown(r, 2))];
    return { ...state, shuffle: { pillars: shuffleLayout(state.pillars, avoid, ctx), ticksLeft: SHUFFLE_TICKS } };
  }
  if (kind === 'rain' && !hasEffect(state.effects, 'rain')) {
    const speed = speedForCoins(state.coins) * modifiers(state.effects).speedMul;
    const extras: Point[] = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      const avoid = [...spawnAvoid(state), ...extras.map(pointRect)];
      extras.push(spawnCoin(cellOf(state), state.pillars, ctx, { speed, avoid }));
    }
    return { ...state, extraCoins: extras, effects: addEffect(state.effects, kind) };
  }
  return { ...state, effects: addEffect(state.effects, kind) };
}

/** Cells a new coin or power-up must not land on. */
export function spawnAvoid(state: DriftState): Rect[] {
  const rects = [pointRect(state.coin), ...state.extraCoins.map(pointRect)];
  if (state.powerUp) rects.push(pointRect(state.powerUp.at));
  rects.push(...state.oil, ...state.pending.map((p) => p.rect));
  if (state.shuffle) rects.push(...state.shuffle.pillars);
  return rects;
}

function update(state: DriftState, ctx: GameContext): DriftState {
  if (state.crashed) return state;
  const effects = tickEffects(state.effects);
  let st: DriftState = {
    ...state, effects, extraCoins: hasEffect(effects, 'rain') ? state.extraCoins : [],
  };
  const speed = speedForCoins(st.coins) * modifiers(st.effects).speedMul;
  const travel = turnToward(st.travel, headingAngle(st.heading), gripNow(speed, st.effects, st.oil.some((r) => inRect(cellOf(st), r))), st.lastTurn);
  const dx = Math.cos(travel) * speed * TICK_MS / 1000;
  const dy = Math.sin(travel) * speed * TICK_MS / 1000 * 0.5;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));

  let { x, y } = st;
  let crashed = false;
  for (let i = 0; i < n; i++) {
    x += dx / n;
    y += dy / n;
    const cell = cellOf({ x, y });
    if (isWall(cell)) { crashed = true; break; }
    const hit = st.pillars.find((r) => inRect(cell, r));
    if (hit) {
      if (!hasEffect(st.effects, 'shield')) { crashed = true; break; }
      st = { ...st, pillars: st.pillars.filter((r) => r !== hit), effects: removeEffect(st.effects, 'shield') };
    }
    const extra = st.extraCoins.findIndex((p) => samePoint(p, cell));
    if (extra >= 0) {
      st = {
        ...st, coins: st.coins + 1, points: st.points + BASE_COIN * modifiers(st.effects).coinMul,
        extraCoins: st.extraCoins.filter((_, j) => j !== extra),
      };
    }
    if (samePoint(cell, st.coin)) {
      const { speedMul, coinMul } = modifiers(st.effects);
      const coins = st.coins + 1;
      st = { ...st, coins, scheduleCoins: st.scheduleCoins + 1, points: st.points + BASE_COIN * coinMul };
      st = { ...st, coin: spawnCoin(cell, st.pillars, ctx, { speed: speedForCoins(coins) * speedMul, avoid: spawnAvoid(st) }) };
      if (st.scheduleCoins % OBSTACLE_EVERY === 0) {
        const avoid = [...carZone(x, y, travel), ...spawnAvoid(st)];
        const ob = newObstacle({ pillars: st.pillars, oil: st.oil, pending: st.pending, avoid, coins: st.coins, gapTo: st.shuffle?.pillars }, ctx);
        if (ob) st = { ...st, pending: [...st.pending, ob] };
      }
    }
    if (st.powerUp && samePoint(cell, st.powerUp.at)) {
      st = applyPower(st, st.powerUp.kind, ctx);
      st = { ...st, powerUp: null, nextPowerAt: st.scheduleCoins + nextPowerGap(ctx) };
    }
    if (st.trail.length === 0 || !samePoint(st.trail[0], cell)) {
      st = { ...st, trail: [cell, ...st.trail].slice(0, TRAIL_LEN) };
    }
  }
  st = { ...st, x, y, travel, crashed };

  if (st.powerUp) {
    const ticksLeft = st.powerUp.ticksLeft - 1;
    st = ticksLeft > 0
      ? { ...st, powerUp: { ...st.powerUp, ticksLeft } }
      : { ...st, powerUp: null, nextPowerAt: st.scheduleCoins + nextPowerGap(ctx) };
  }
  if (st.powerUp === null && st.nextPowerAt !== null && st.scheduleCoins >= st.nextPowerAt) {
    const spawnSpeed = speedForCoins(st.coins) * modifiers(st.effects).speedMul;
    const at = spawnCoin(cellOf(st), st.pillars, ctx, { speed: spawnSpeed, avoid: spawnAvoid(st) });
    st = { ...st, powerUp: { kind: pickPower(ctx), at, ticksLeft: POWER_LIFE }, nextPowerAt: null };
  }
  return { ...resolveShuffle(resolvePending(st)), tick: st.tick + 1 };
}

/** Counts a pending shuffle down; at 0 the new pillars replace the old, minus any on the car zone or a pickup. */
function resolveShuffle(st: DriftState): DriftState {
  if (!st.shuffle) return st;
  const ticksLeft = st.shuffle.ticksLeft - 1;
  if (ticksLeft > 0) return { ...st, shuffle: { ...st.shuffle, ticksLeft } };
  const blocked = [...carZone(st.x, st.y, st.travel), pointRect(st.coin), ...st.extraCoins.map(pointRect)];
  if (st.powerUp) blocked.push(pointRect(st.powerUp.at));
  return { ...st, pillars: st.shuffle.pillars.filter((p) => !blocked.some((b) => intersects(p, b))), shuffle: null };
}

/** Counts pending obstacles down; at 0 they turn solid unless the car's zone is on them. */
function resolvePending(st: DriftState): DriftState {
  if (st.pending.length === 0) return st;
  const zone = carZone(st.x, st.y, st.travel);
  const pending: Pending[] = [];
  const pillars = [...st.pillars];
  const oil = [...st.oil];
  for (const p of st.pending) {
    const ticksLeft = Math.max(0, p.ticksLeft - 1);
    if (ticksLeft > 0 || zone.some((z) => intersects(z, p.rect))) pending.push({ ...p, ticksLeft });
    else (p.kind === 'pillar' ? pillars : oil).push(p.rect);
  }
  return { ...st, pending, pillars, oil };
}

const READOUT_MAX_X = 57;
const LABEL: Record<Effect['kind'], string> =
  { double: '×2', grip: 'G', rain: '$', nitro: 'N', shield: 'S', slick: 'SLICK' };

function drawReadout(effects: Effect[], screen: Screen): void {
  let x = 2;
  for (const e of effects) {
    const color = e.kind === 'slick' ? 'brightRed' : POWER_LOOK[e.kind].color;
    const filled = Math.ceil(4 * e.ticksLeft / DURATION[e.kind]);
    const text = `${LABEL[e.kind]} ${'█'.repeat(filled)}${'░'.repeat(4 - filled)} `;
    for (const ch of text) {
      if (x > READOUT_MAX_X) return;
      screen.put(x++, 0, ch, color);
    }
  }
}

function fillRect(screen: Screen, r: Rect, ch: string, color: 'blue' | 'gray' | 'magenta'): void {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) screen.put(x, y, ch, color);
}

function draw(state: DriftState, screen: Screen): void {
  const W = GAME_WIDTH - 1, H = GAME_HEIGHT - 1;
  for (let x = 1; x < W; x++) { screen.put(x, 0, '─', 'gray'); screen.put(x, H, '─', 'gray'); }
  for (let y = 1; y < H; y++) { screen.put(0, y, '│', 'gray'); screen.put(W, y, '│', 'gray'); }
  screen.put(0, 0, '┌', 'gray'); screen.put(W, 0, '┐', 'gray');
  screen.put(0, H, '└', 'gray'); screen.put(W, H, '┘', 'gray');

  for (const r of state.pillars) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) screen.put(x, y, '█', 'blue');
  }

  for (const r of state.oil) fillRect(screen, r, '≈', 'blue');
  if (Math.floor(state.tick / 4) % 2 === 0) {
    for (const r of state.shuffle?.pillars ?? []) {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++)
          if (!state.pillars.some((p) => inRect({ x, y }, p))) screen.put(x, y, '░', 'magenta');
    }
    for (const p of state.pending) fillRect(screen, p.rect, p.kind === 'pillar' ? '░' : '≈', 'gray');
  }

  const car = cellOf(state);
  if (isDrifting(state.travel, state.heading)) {
    for (const t of state.trail) if (!samePoint(t, car)) screen.put(t.x, t.y, '·', 'gray');
  }
  screen.put(state.coin.x, state.coin.y, '●', 'yellow');
  for (const e of state.extraCoins) screen.put(e.x, e.y, '●', 'yellow');
  const p = state.powerUp;
  if (p && (p.ticksLeft > POWER_BLINK || Math.floor(state.tick / 4) % 2 === 0)) {
    screen.put(p.at.x, p.at.y, POWER_LOOK[p.kind].ch, POWER_LOOK[p.kind].color);
  }
  drawReadout(state.effects, screen);
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
  score: s => s.points,
  isOver: s => s.crashed,
};

export default drift;
