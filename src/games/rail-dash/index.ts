import type { Color, Game, GameContext, Key, Screen } from '../../core/types';

// Endless runner, seen from above: the track scrolls down toward you. Switch
// between three lanes, jump low fences, roll under overhead bars, go around
// trains (or run up a ramp onto their roofs), grab coins. It speeds up the
// further you get.
//
// Fairness: one lane (safeLane) never gets a train. It only moves to another lane
// when no train is anywhere near the top of the track, so on every row there is
// always a lane without a train, and enough room to get there.

export const PLAYER_ROW = 17;
export const ACTION_TICKS = 22;    // a jump or roll lasts this many ticks (0.88 s), whatever the speed
const LANES = 3;
const LANE_W = 7;
const ORIGIN_X = Math.floor((60 - (LANES * (LANE_W + 1) + 1)) / 2); // left edge of the track
const COIN_POINTS = 10;
const SAFE_GAP = 8;                // the safe lane may only move when every train is at least this far down

export type Kind = 'train' | 'ramp' | 'low' | 'high' | 'coin';
export interface Thing { kind: Kind; lane: number; y: number; len: number } // rows y .. y+len-1

export interface DashState {
  lane: number;
  air: number;       // ticks of jump left
  roll: number;      // ticks of roll left
  up: boolean;       // on a train roof (or in the air above roof height)
  things: Thing[];
  distance: number;  // rows run
  coins: number;
  tick: number;      // ticks since the last scroll
  nextWave: number;  // rows until the next row of things appears
  safeLane: number;
  over: boolean;
}

/** Ticks per row: 5 at the start (5 rows a second), one faster every 200 rows, at least 2. */
export function stepTicks(distance: number): number {
  return Math.max(2, 5 - Math.floor(distance / 200));
}

const covers = (t: Thing, row: number) => row >= t.y && row < t.y + t.len;
const trainAt = (things: Thing[], lane: number, row: number) =>
  things.some((t) => t.kind === 'train' && t.lane === lane && covers(t, row));

function init(_ctx: GameContext): DashState {
  return { lane: 1, air: 0, roll: 0, up: false, things: [], distance: 0, coins: 0, tick: 0, nextWave: 8, safeLane: 1, over: false };
}

function onKey(s: DashState, key: Key): DashState {
  if (s.over) return s;
  switch (key) {
    case 'left':
    case 'right': {
      const lane = s.lane + (key === 'left' ? -1 : 1);
      // From the ground you can't step into the side of a train; from a roof you can step across.
      if (lane < 0 || lane >= LANES || (!s.up && trainAt(s.things, lane, PLAYER_ROW))) return s;
      return { ...s, lane };
    }
    // Pressing again restarts the jump or roll, so close obstacles can be taken one after another.
    case 'up': return { ...s, air: ACTION_TICKS, roll: 0 };
    case 'down': return { ...s, roll: ACTION_TICKS, air: 0 };
    default: return s;
  }
}

/** A new row of things just above the top of the track. */
function wave(s: DashState, rnd: () => number): { things: Thing[]; safeLane: number; nextWave: number } {
  let safeLane = s.safeLane;
  const roomToMove = s.things.every((t) => t.kind !== 'train' || t.y >= SAFE_GAP);
  if (roomToMove && rnd() < 0.6) safeLane = Math.floor(rnd() * LANES);
  const add: Thing[] = [];
  const one = (kind: Kind, lane: number) => add.push({ kind, lane, y: -1, len: 1 });
  for (let lane = 0; lane < LANES; lane++) {
    const r = rnd();
    if (lane === safeLane) {
      if (r < 0.15) one('low', lane);
      else if (r < 0.3) one('high', lane);
      else if (r < 0.65) for (let i = 1; i <= 3; i++) add.push({ kind: 'coin', lane, y: -i, len: 1 });
    } else if (r < 0.4) {
      const len = 3 + Math.floor(rnd() * 4);
      if (rnd() < 0.5) {
        // a ramp right in front of the train leads up onto its roof
        add.push({ kind: 'train', lane, y: -len - 1, len }, { kind: 'ramp', lane, y: -1, len: 1 });
      } else add.push({ kind: 'train', lane, y: -len, len });
    } else if (r < 0.55) one('low', lane);
    else if (r < 0.7) one('high', lane);
    else if (r < 0.8) one('coin', lane);
  }
  return { things: [...s.things, ...add], safeLane, nextWave: 5 + Math.floor(rnd() * 4) };
}

/** What happens to the runner on its row: ride a roof, take a ramp, crash, or pick up coins. */
function check(s: DashState): DashState {
  const under = trainAt(s.things, s.lane, PLAYER_ROW);
  let up = s.up && (under || s.air > 0); // off the end of a roof (and not mid-jump): back to the ground
  if (!up && under) return { ...s, over: true }; // ran into the front or side of a train
  let coins = s.coins, roll = s.roll;
  const things: Thing[] = [];
  for (const t of s.things) {
    if (t.lane !== s.lane || !covers(t, PLAYER_ROW) || t.kind === 'train') { things.push(t); continue; }
    if (t.kind === 'coin') { coins++; continue; }
    things.push(t);
    if (up) continue; // fences, bars and ramps are all below roof height
    if (t.kind === 'ramp') { up = true; roll = 0; continue; }
    if ((t.kind === 'low' && s.air === 0) || (t.kind === 'high' && s.roll === 0)) return { ...s, over: true };
  }
  return { ...s, up, roll, coins, things };
}

function update(s: DashState, ctx: GameContext): DashState {
  if (s.over) return s;
  const timed = { ...s, air: Math.max(0, s.air - 1), roll: Math.max(0, s.roll - 1) };
  const tick = s.tick + 1;
  if (tick < stepTicks(s.distance)) return check({ ...timed, tick });
  let next: DashState = {
    ...timed,
    tick: 0,
    distance: s.distance + 1,
    things: s.things.map((t) => ({ ...t, y: t.y + 1 })).filter((t) => t.y < 20),
    nextWave: s.nextWave - 1,
  };
  if (next.nextWave <= 0) next = { ...next, ...wave(next, ctx.random) };
  return check(next);
}

// ---- drawing ----

const laneLeft = (lane: number) => ORIGIN_X + 1 + lane * (LANE_W + 1);

function span(screen: Screen, lane: number, y: number, ch: string, color: Color): void {
  if (y < 0 || y >= 20) return;
  for (let i = 1; i <= LANE_W - 2; i++) screen.put(laneLeft(lane) + i, y, ch, color);
}

function draw(s: DashState, screen: Screen): void {
  // rails: solid outer edges, dashed inner lines that scroll with the track
  for (let y = 0; y < 20; y++) {
    for (let l = 0; l <= LANES; l++) {
      const x = ORIGIN_X + l * (LANE_W + 1);
      if (l === 0 || l === LANES) screen.put(x, y, '│', 'gray');
      else if ((y - s.distance) % 3 !== 0) screen.put(x, y, '┊', 'gray');
    }
  }
  for (const t of s.things) {
    if (t.kind === 'train') {
      for (let y = t.y; y < t.y + t.len; y++) span(screen, t.lane, y, y === t.y + t.len - 1 ? '▓' : '█', y === t.y + t.len - 1 ? 'brightBlue' : 'blue');
    } else if (t.kind === 'ramp') span(screen, t.lane, t.y, '^', 'brightCyan');
    else if (t.kind === 'low') span(screen, t.lane, t.y, '═', 'brightYellow');
    else if (t.kind === 'high') span(screen, t.lane, t.y, '▀', 'brightRed');
    else if (t.y >= 0) screen.put(laneLeft(t.lane) + 3, t.y, '●', 'yellow');
  }
  const px = laneLeft(s.lane) + 3;
  if (s.over) screen.put(px, PLAYER_ROW, 'X', 'brightRed');
  else if (s.air > 0) {
    screen.put(px, PLAYER_ROW - 1, '▲', 'brightWhite');
    screen.put(px, PLAYER_ROW, '·', 'gray');
  } else if (s.roll > 0) screen.put(px, PLAYER_ROW, '▄', 'brightGreen');
  else screen.put(px, PLAYER_ROW, '▲', s.up ? 'brightMagenta' : 'brightGreen');

  // legend (left) and stats (right)
  screen.text(1, 3, '═ jump  ↑', 'brightYellow');
  screen.text(1, 5, '▀ roll  ↓', 'brightRed');
  screen.text(1, 7, '█ train ←→', 'brightBlue');
  screen.text(1, 9, '^ ramp: roof', 'brightCyan');
  screen.text(1, 11, '● coin', 'yellow');
  const right = ORIGIN_X + LANES * (LANE_W + 1) + 3;
  screen.text(right, 3, 'COINS', 'gray');
  screen.text(right, 4, String(s.coins), 'yellow');
  screen.text(right, 6, 'SPEED', 'gray');
  screen.text(right, 7, String(6 - stepTicks(s.distance)), 'white');
  screen.text(right, 9, 'DISTANCE', 'gray');
  screen.text(right, 10, String(s.distance), 'white');
  if (s.up) screen.text(right, 13, 'ON A ROOF', 'brightMagenta');
}

const railDash: Game<DashState> = {
  id: 'rail-dash',
  title: 'Rail Dash',
  description: 'Switch lanes, jump, roll. Dodge trains, grab coins.',
  tickMs: 40,
  controls: '←→ ↑jump ↓roll',
  init,
  onKey,
  update,
  draw,
  score: (s) => s.distance + s.coins * COIN_POINTS,
  isOver: (s) => s.over,
};

export default railDash;
