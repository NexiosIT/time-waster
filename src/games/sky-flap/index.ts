import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { Game, GameContext, Key, Screen } from '../../core/types';

// Sky Flap: gravity pulls the glider down, each press of Space (or Up) kicks it up.
// Columns scroll in from the right; slip through the gap in each one for a point.
// Touching a column or the ground ends the run. The ceiling just stops you.

export const PLAYER_X = 12;            // the glider stays in this screen column
export const TOP = 1;                  // highest row the glider can occupy (row 0 is the ceiling)
export const BOTTOM = GAME_HEIGHT - 2; // lowest row (row 19 is the ground)
export const COL_W = 3;                // column width in characters
export const SPACING = 20;             // characters between the left edges of two columns

export const GRAVITY = 0.07;           // rows per tick, per tick
export const FLAP_VY = -0.55;          // vertical speed right after a flap
export const MAX_FALL = 0.75;          // terminal fall speed
const BASE_SPEED = 0.5;                // columns per tick at score 0
const MAX_SPEED = 0.8;
const START_GAP = 7, MIN_GAP = 5;

export interface Column {
  x: number;       // screen column of the left edge (may be negative while leaving)
  gapTop: number;  // first open row
  gap: number;     // open rows: gapTop .. gapTop + gap - 1
  passed: boolean; // already scored
}

export interface FlapState {
  y: number;           // glider row, fractional
  vy: number;          // rows per tick, positive is down
  columns: Column[];
  scroll: number;      // fractional scroll carried between ticks
  started: boolean;    // the glider hovers until the first flap
  flapTicks: number;   // ticks since the last flap, for the wing animation
  tick: number;
  score: number;
  over: boolean;
}

export const speedFor = (score: number) => Math.min(MAX_SPEED, BASE_SPEED + score * 0.01);
export const gapFor = (score: number) => Math.max(MIN_GAP, START_GAP - Math.floor(score / 10));

/** A new column at screen column x. The gap never jumps more than 6 rows from the previous one. */
export function makeColumn(x: number, score: number, prevGapTop: number | null, ctx: GameContext): Column {
  const gap = gapFor(score);
  let lo = TOP + 1, hi = BOTTOM - gap; // keep one solid row above and below every gap
  if (prevGapTop !== null) {
    lo = Math.max(lo, prevGapTop - 6);
    hi = Math.min(hi, prevGapTop + 6);
  }
  const gapTop = lo + Math.floor(ctx.random() * (hi - lo + 1));
  return { x, gapTop, gap, passed: false };
}

/** True when the glider's row overlaps a solid part of a column. */
export function hits(c: Column, row: number): boolean {
  if (PLAYER_X < c.x || PLAYER_X >= c.x + COL_W) return false;
  return row < c.gapTop || row >= c.gapTop + c.gap;
}

const rowOf = (y: number) => Math.round(y);

function init(ctx: GameContext): FlapState {
  return {
    y: Math.floor((TOP + BOTTOM) / 2), vy: 0,
    columns: [makeColumn(GAME_WIDTH + 4, 0, null, ctx)],
    scroll: 0, started: false, flapTicks: 99, tick: 0, score: 0, over: false,
  };
}

function onKey(state: FlapState, key: Key): FlapState {
  if (state.over) return state;
  if (key !== 'space' && key !== 'up' && key !== 'w') return state;
  return { ...state, started: true, vy: FLAP_VY, flapTicks: 0 };
}

function update(prev: FlapState, ctx: GameContext): FlapState {
  if (prev.over) return prev;
  const tick = prev.tick + 1;
  if (!prev.started) return { ...prev, tick }; // hovering on the start screen

  // Vertical motion.
  const vy = Math.min(MAX_FALL, prev.vy + GRAVITY);
  let y = prev.y + vy;
  let nextVy = vy;
  if (y < TOP) { y = TOP; nextVy = 0; }
  const flapTicks = prev.flapTicks + 1;
  if (rowOf(y) > BOTTOM) {
    return { ...prev, tick, flapTicks, y: BOTTOM, vy: 0, over: true };
  }

  // Scroll whole columns, one at a time, checking for a hit after each step so the
  // glider can never skip through a column.
  let scroll = prev.scroll + speedFor(prev.score);
  let columns = prev.columns;
  let score = prev.score;
  const row = rowOf(y);
  if (columns.some(c => hits(c, row))) {
    return { ...prev, tick, flapTicks, y, vy: nextVy, over: true };
  }
  while (scroll >= 1) {
    scroll -= 1;
    columns = columns.map(c => ({ ...c, x: c.x - 1 }));
    if (columns.some(c => hits(c, row))) {
      return { ...prev, tick, flapTicks, y, vy: nextVy, columns, scroll, score, over: true };
    }
    columns = columns.map(c => {
      if (c.passed || c.x + COL_W > PLAYER_X) return c;
      score += 1;
      return { ...c, passed: true };
    });
  }

  // Drop columns that left the screen; add a new one once the last is far enough in.
  columns = columns.filter(c => c.x + COL_W > 0);
  const last = columns[columns.length - 1];
  if (!last || last.x <= GAME_WIDTH - SPACING) {
    const x = last ? last.x + SPACING : GAME_WIDTH;
    columns = [...columns, makeColumn(x, score, last ? last.gapTop : null, ctx)];
  }

  return { ...prev, tick, flapTicks, y, vy: nextVy, columns, scroll, score };
}

function draw(state: FlapState, screen: Screen): void {
  for (let x = 0; x < GAME_WIDTH; x++) {
    screen.put(x, 0, '▔', 'gray');
    screen.put(x, GAME_HEIGHT - 1, (x + Math.floor(state.tick / 2)) % 4 === 0 ? '▓' : '▒', 'yellow');
  }

  for (const c of state.columns) {
    for (let dx = 0; dx < COL_W; dx++) {
      const x = c.x + dx;
      if (x < 0 || x >= GAME_WIDTH) continue;
      for (let y = TOP; y <= BOTTOM; y++) {
        if (y >= c.gapTop && y < c.gapTop + c.gap) continue;
        const edge = y === c.gapTop - 1 || y === c.gapTop + c.gap;
        screen.put(x, y, edge ? '█' : '▓', edge ? 'brightCyan' : 'cyan');
      }
    }
  }

  const row = rowOf(state.y);
  const color = state.over ? 'brightRed' : 'brightYellow';
  const wing = state.flapTicks < 3 ? '^' : state.vy > 0.3 ? 'v' : '-';
  screen.put(PLAYER_X - 1, row, wing, color);
  screen.put(PLAYER_X, row, '>', color);
  if (state.started && !state.over && state.flapTicks < 4) {
    screen.put(PLAYER_X - 2, Math.min(BOTTOM, row + 1), '.', 'gray');
  }

  screen.text(GAME_WIDTH - 12, 0, ` SCORE ${String(state.score).padStart(3)} `, 'brightWhite');
  if (!state.started) {
    const msg = 'Press Space to take off';
    screen.text(Math.floor((GAME_WIDTH - msg.length) / 2), 6, msg, 'brightWhite');
  }
}

const skyFlap: Game<FlapState> = {
  id: 'sky-flap',
  title: 'Sky Flap',
  description: 'Tap to flap through the gaps. One touch and you drop.',
  tickMs: 50,
  controls: 'Spc/↑ flap',
  length: { kind: 'open', minutes: 1 },
  init,
  onKey,
  update,
  draw,
  score: s => s.score,
  isOver: s => s.over,
};

export default skyFlap;
