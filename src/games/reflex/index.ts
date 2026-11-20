import { GAME_WIDTH } from '../../core/types';
import type { Color, Game, GameContext, Key, Screen } from '../../core/types';

// Plain-data state, pure functions. A target appears after a short gap, fades over
// its lifetime, and must be answered with the matching key. Time comes from the
// tick count (TICK_MS per update) and ctx.elapsedMs (run clock).

const TARGETS = ['up', 'down', 'left', 'right', 'a', 's', 'd', 'f', 'j', 'k', 'l'];
const SYMBOL: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };

const TICK_MS = 50;
const GAP_MS = 250;
const RUN_MS = 60000;
const LIFE_START = 1500, LIFE_MIN = 450, LIFE_HIT = 40, LIFE_MISS = 200;
const BOX = 3;
// Box top-left ranges: inside the area, off the edges, below the HUD row.
const X_MIN = 1, X_MAX = GAME_WIDTH - 1 - BOX;   // 1..56
const Y_MIN = 2, Y_MAX = 20 - 1 - BOX;           // 2..16

export interface ReflexState {
  target: string | null;  // null during the gap
  x: number;              // box top-left (meaningful once a target has shown)
  y: number;
  prevX: number;          // spot of the previous target, to avoid repeating it (-1: none)
  prevY: number;
  gapLeft: number;        // ms until the next target appears (during the gap)
  timeLeft: number;       // ms until the current target fades
  lifetime: number;       // ms a target lives
  score: number;
  streak: number;
  hits: number;
  misses: number;
  elapsedMs: number;      // last run clock seen in update
  over: boolean;
}

const multiplier = (streak: number) => (streak >= 25 ? 3 : streak >= 10 ? 2 : 1);

function init(_ctx: GameContext): ReflexState {
  return {
    target: null, x: 0, y: 0, prevX: -1, prevY: -1,
    gapLeft: GAP_MS, timeLeft: 0, lifetime: LIFE_START,
    score: 0, streak: 0, hits: 0, misses: 0, elapsedMs: 0, over: false,
  };
}

/** Back to the gap after a hit or miss. */
function toGap(s: ReflexState): ReflexState {
  return { ...s, target: null, prevX: s.x, prevY: s.y, gapLeft: GAP_MS, timeLeft: 0 };
}

function miss(s: ReflexState): ReflexState {
  return toGap({
    ...s, misses: s.misses + 1, streak: 0,
    lifetime: Math.min(LIFE_START, s.lifetime + LIFE_MISS),
  });
}

function onKey(s: ReflexState, key: Key): ReflexState {
  if (s.over || s.target === null) return s; // keys during the gap are ignored
  if (!TARGETS.includes(key)) return s;      // not a game key: neither hit nor miss
  if (key !== s.target) return miss(s);
  const streak = s.streak + 1;
  const bonus = Math.round(10 * s.timeLeft / s.lifetime);
  return toGap({
    ...s, streak, hits: s.hits + 1,
    score: s.score + (10 + bonus) * multiplier(streak),
    lifetime: Math.max(LIFE_MIN, s.lifetime - LIFE_HIT),
  });
}

function spawn(s: ReflexState, ctx: GameContext): ReflexState {
  const target = TARGETS[Math.floor(ctx.random() * TARGETS.length)];
  const spots: { x: number; y: number }[] = [];
  for (let y = Y_MIN; y <= Y_MAX; y++) {
    for (let x = X_MIN; x <= X_MAX; x++) {
      if (x !== s.prevX || y !== s.prevY) spots.push({ x, y });
    }
  }
  const p = spots[Math.floor(ctx.random() * spots.length)];
  return { ...s, target, x: p.x, y: p.y, gapLeft: 0, timeLeft: s.lifetime };
}

function update(prev: ReflexState, ctx: GameContext): ReflexState {
  let s: ReflexState = { ...prev, elapsedMs: ctx.elapsedMs };
  if (ctx.elapsedMs >= RUN_MS) return { ...s, over: true };
  if (s.over) return s;
  if (s.target === null) {
    s = { ...s, gapLeft: s.gapLeft - TICK_MS };
    return s.gapLeft <= 0 ? spawn(s, ctx) : s;
  }
  s = { ...s, timeLeft: s.timeLeft - TICK_MS };
  return s.timeLeft <= 0 ? miss(s) : s;
}

function fadeColor(s: ReflexState): Color {
  const f = s.timeLeft / s.lifetime;
  return f > 2 / 3 ? 'brightWhite' : f > 1 / 3 ? 'white' : 'gray';
}

function draw(s: ReflexState, screen: Screen): void {
  const left = Math.max(0, RUN_MS - s.elapsedMs);
  const secs = Math.ceil(left / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  screen.text(0, 0,
    `Time ${clock}   Streak ${s.streak} ×${multiplier(s.streak)}   Hits ${s.hits}  Misses ${s.misses}`,
    'white');

  if (s.target === null) return;
  const c = fadeColor(s);
  const { x, y } = s;
  screen.text(x, y, '┌─┐', c);
  screen.text(x, y + 1, '│ │', c);
  screen.text(x, y + 2, '└─┘', c);
  screen.put(x + 1, y + 1, SYMBOL[s.target] ?? s.target, c);
}

const reflex: Game<ReflexState> = {
  id: 'reflex',
  title: 'Reflex',
  description: 'Press the key before it fades. 60 seconds.',
  tickMs: TICK_MS,
  controls: '←↑→↓ a s d f j k l',
  length: { kind: 'timed', minutes: 1 },
  init,
  onKey,
  update,
  draw,
  score: s => s.score,
  isOver: s => s.over,
};

export default reflex;
