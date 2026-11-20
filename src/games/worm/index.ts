import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { Game, GameContext, Key, Screen } from '../../core/types';

// A game is a plain-data state plus pure functions over it. The host calls:
//   init(ctx) once, onKey(state, key) per key press, update(state, ctx) every tickMs,
//   then isOver(state); draw(state, screen) paints a cleared 60x20 screen.
// Every function returns a NEW state; never mutate the one you were given.
// Use ctx.random() for all randomness. Throwing counts as a crash.

type Dir = 'up' | 'down' | 'left' | 'right';
interface Point { x: number; y: number }

export interface WormState {
  body: Point[];        // body[0] is the head
  moved: Dir;           // direction of the last actual move (turns are validated against this)
  pending: Dir;         // direction to move on the next tick
  dot: Point | null;    // null only when the board is full
  score: number;
  over: boolean;
}

const STEP: Record<Dir, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Pick a uniformly random cell not covered by the worm, or null if there is none. */
export function spawnDot(body: Point[], ctx: GameContext): Point | null {
  const free: Point[] = [];
  for (let y = 0; y < GAME_HEIGHT; y++) {
    for (let x = 0; x < GAME_WIDTH; x++) {
      if (!body.some(p => p.x === x && p.y === y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  return free[Math.floor(ctx.random() * free.length)];
}

function init(ctx: GameContext): WormState {
  const cx = GAME_WIDTH / 2, cy = GAME_HEIGHT / 2;
  const body = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
  return { body, moved: 'right', pending: 'right', dot: spawnDot(body, ctx), score: 0, over: false };
}

function onKey(state: WormState, key: Key): WormState {
  if (key !== 'up' && key !== 'down' && key !== 'left' && key !== 'right') return state;
  if (key === OPPOSITE[state.moved]) return state; // can't reverse onto ourselves
  return { ...state, pending: key };
}

function update(state: WormState, ctx: GameContext): WormState {
  const head = state.body[0];
  const step = STEP[state.pending];
  const next = { x: head.x + step.x, y: head.y + step.y };

  if (next.x < 0 || next.x >= GAME_WIDTH || next.y < 0 || next.y >= GAME_HEIGHT) {
    return { ...state, over: true };
  }

  const eats = state.dot !== null && same(next, state.dot);
  // When not growing, the tail cell is vacated this tick, so it is safe to enter.
  const kept = eats ? state.body : state.body.slice(0, -1);
  if (kept.some(p => same(p, next))) return { ...state, over: true };

  const body = [next, ...kept];
  if (!eats) return { ...state, body, moved: state.pending };

  const dot = spawnDot(body, ctx);
  return { ...state, body, moved: state.pending, score: state.score + 10, dot, over: dot === null };
}

function draw(state: WormState, screen: Screen): void {
  if (state.dot) screen.put(state.dot.x, state.dot.y, '●', 'yellow');
  state.body.forEach((p, i) => {
    if (i === 0) screen.put(p.x, p.y, '▓', 'brightGreen');
    else screen.put(p.x, p.y, '█', 'green');
  });
}

const worm: Game<WormState> = {
  id: 'worm',
  title: 'Worm',
  description: "Eat dots, grow longer, don't bite yourself.",
  tickMs: 120,
  controls: '←↑→↓ turn',
  init,
  onKey,
  update,
  draw,
  score: s => s.score,
  isOver: s => s.over,
};

export default worm;
