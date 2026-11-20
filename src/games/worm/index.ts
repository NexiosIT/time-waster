import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { Color, Game, GameContext, Key, Screen } from '../../core/types';

// A game is a plain-data state plus pure functions over it. The host calls:
//   init(ctx) once, onKey(state, key) per key press, update(state, ctx) every tickMs,
//   then isOver(state); draw(state, screen) paints a cleared 60x20 screen.
// Every function returns a NEW state; never mutate the one you were given.
// Use ctx.random() for all randomness. Throwing counts as a crash.

type Dir = 'up' | 'down' | 'left' | 'right';
interface Point { x: number; y: number }

// The board sits inside a one-character border. Each board cell is drawn two
// characters wide: terminal characters are about twice as tall as they are wide,
// so this keeps cells square and sideways moves as fast on screen as vertical ones.
export const BOARD_W = Math.floor((GAME_WIDTH - 2) / 2); // 29
export const BOARD_H = GAME_HEIGHT - 2;                  // 18

export interface WormState {
  body: Point[];        // body[0] is the head (board coordinates)
  moved: Dir;           // direction of the last actual move (turns are validated against this)
  pending: Dir;         // direction to move on the next tick
  dot: Point | null;    // null only when the board is full
  score: number;
  over: boolean;
  turbo: boolean;       // space toggles: move every tick instead of every other tick
  tick: number;         // ticks since start, to move on every other tick at normal speed
}

const STEP: Record<Dir, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Pick a uniformly random cell not covered by the worm, or null if there is none. */
export function spawnDot(body: Point[], ctx: GameContext): Point | null {
  const free: Point[] = [];
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (!body.some(p => p.x === x && p.y === y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  return free[Math.floor(ctx.random() * free.length)];
}

function init(ctx: GameContext): WormState {
  const cx = Math.floor(BOARD_W / 2), cy = Math.floor(BOARD_H / 2);
  const body = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
  return {
    body, moved: 'right', pending: 'right', dot: spawnDot(body, ctx),
    score: 0, over: false, turbo: false, tick: 0,
  };
}

function onKey(state: WormState, key: Key): WormState {
  if (key === 'space') return { ...state, turbo: !state.turbo };
  if (key !== 'up' && key !== 'down' && key !== 'left' && key !== 'right') return state;
  if (key === OPPOSITE[state.moved]) return state; // can't reverse onto ourselves
  return { ...state, pending: key };
}

function update(prev: WormState, ctx: GameContext): WormState {
  const state = { ...prev, tick: prev.tick + 1 };
  if (!state.turbo && state.tick % 2 === 1) return state; // normal speed: move every other tick

  const head = state.body[0];
  const step = STEP[state.pending];
  const next = { x: head.x + step.x, y: head.y + step.y };

  if (next.x < 0 || next.x >= BOARD_W || next.y < 0 || next.y >= BOARD_H) {
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

const BORDER = 'gray';

function drawBorder(state: WormState, screen: Screen): void {
  const r = GAME_WIDTH - 1, b = GAME_HEIGHT - 1;
  for (let x = 1; x < r; x++) {
    screen.put(x, 0, '─', BORDER);
    screen.put(x, b, '─', BORDER);
  }
  for (let y = 1; y < b; y++) {
    screen.put(0, y, '│', BORDER);
    screen.put(r, y, '│', BORDER);
  }
  screen.put(0, 0, '┌', BORDER);
  screen.put(r, 0, '┐', BORDER);
  screen.put(0, b, '└', BORDER);
  screen.put(r, b, '┘', BORDER);
  if (state.turbo) screen.text(GAME_WIDTH - 10, 0, ' TURBO ', 'brightYellow');
}

/** Paint one board cell: two characters wide, inside the border. */
function cell(screen: Screen, p: Point, chars: string, color: Color): void {
  screen.put(1 + p.x * 2, 1 + p.y, chars[0], color);
  screen.put(2 + p.x * 2, 1 + p.y, chars[1], color);
}

function draw(state: WormState, screen: Screen): void {
  drawBorder(state, screen);
  if (state.dot) cell(screen, state.dot, '● ', 'yellow');
  state.body.forEach((p, i) => {
    if (i === 0) cell(screen, p, '▓▓', 'brightGreen');
    else cell(screen, p, '██', 'green');
  });
}

const worm: Game<WormState> = {
  id: 'worm',
  title: 'Worm',
  description: "Eat dots, grow longer, don't bite yourself.",
  tickMs: 60,           // normal speed moves every other tick (120 ms), turbo every tick
  controls: '←↑→↓ Spc turbo',
  length: { kind: 'open', minutes: 3 },
  init,
  onKey,
  update,
  draw,
  score: s => s.score,
  isOver: s => s.over,
};

export default worm;
