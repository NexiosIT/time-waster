import type { Color, Game, GameContext, Key, Screen } from '../../core/types';

// Falling blocks: steer each piece, fill rows to clear them, don't let the stack
// reach the top. The board is 10 x 18 cells inside a border; each cell is drawn
// two characters wide so blocks look square in a terminal.

export const BOARD_W = 10, BOARD_H = 18;
const ORIGIN_X = 19;          // screen column of the board's left border
const PANEL_X = ORIGIN_X + BOARD_W * 2 + 4;
const LINE_SCORE = [0, 100, 300, 500, 800];
const KICKS = [0, -1, 1, -2, 2]; // sideways nudges tried when a rotation doesn't fit

type Cell = number | null;    // a piece kind (colour), or empty
export type Board = Cell[][]; // board[y][x], y = 0 at the top

export interface Piece { kind: number; rot: number; x: number; y: number }

export interface DropState {
  board: Board;
  piece: Piece;
  queue: number[];  // upcoming kinds; refilled with shuffled sets of all seven in update()
  fall: number;     // ticks since the piece last fell
  score: number;
  lines: number;
  level: number;
  over: boolean;
}

interface P { x: number; y: number }

// The seven shapes in their spawn orientation, inside a box of size n.
const SHAPES: { n: number; cells: [number, number][]; color: Color }[] = [
  { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], color: 'brightRed' },     // long bar
  { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]], color: 'brightBlue' },    // square
  { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], color: 'brightYellow' },  // T
  { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: 'brightMagenta' }, // S
  { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: 'brightCyan' },    // Z
  { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: 'brightGreen' },   // J
  { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: 'white' },         // L
];

/** The board cells a piece covers. Rotation turns the shape clockwise in its box. */
export function cellsOf(p: Piece): P[] {
  const { n, cells } = SHAPES[p.kind];
  const turns = p.kind === 1 ? 0 : ((p.rot % 4) + 4) % 4; // the square doesn't turn
  return cells.map(([cx, cy]) => {
    let x = cx, y = cy;
    for (let i = 0; i < turns; i++) [x, y] = [n - 1 - y, x];
    return { x: p.x + x, y: p.y + y };
  });
}

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_H }, () => Array<Cell>(BOARD_W).fill(null));
}

/** True when the piece leaves the board (sides or bottom) or overlaps a block. Above the top is allowed. */
export function collides(board: Board, p: Piece): boolean {
  return cellsOf(p).some(({ x, y }) => x < 0 || x >= BOARD_W || y >= BOARD_H || (y >= 0 && board[y][x] !== null));
}

/** How many rows the piece can still fall. */
export function dropDistance(board: Board, p: Piece): number {
  let d = 0;
  while (!collides(board, { ...p, y: p.y + d + 1 })) d++;
  return d;
}

export function clearLines(board: Board): { board: Board; cleared: number } {
  const kept = board.filter((row) => row.some((c) => c === null));
  const cleared = BOARD_H - kept.length;
  const fresh = Array.from({ length: cleared }, () => Array<Cell>(BOARD_W).fill(null));
  return { board: [...fresh, ...kept.map((r) => r.slice())], cleared };
}

/** Ticks between rows falling: 18 at level 1 (0.9 s), faster each level, never under 2. */
export function fallTicks(level: number): number {
  return Math.max(2, 18 - 2 * (level - 1));
}

function shuffledSet(rnd: () => number): number[] {
  const a = [0, 1, 2, 3, 4, 5, 6];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function spawn(kind: number): Piece {
  return { kind, rot: 0, x: Math.floor((BOARD_W - SHAPES[kind].n) / 2), y: 0 };
}

function init(ctx: GameContext): DropState {
  const [first, ...rest] = shuffledSet(ctx.random);
  return {
    board: emptyBoard(),
    piece: spawn(first),
    queue: [...rest, ...shuffledSet(ctx.random)],
    fall: 0,
    score: 0,
    lines: 0,
    level: 1,
    over: false,
  };
}

/** Put the piece into the board, clear lines, score them, and bring in the next piece. */
function lock(s: DropState, bonus: number): DropState {
  const filled = s.board.map((r) => r.slice());
  for (const { x, y } of cellsOf(s.piece)) if (y >= 0) filled[y][x] = s.piece.kind;
  const { board, cleared } = clearLines(filled);
  const lines = s.lines + cleared;
  // The queue is refilled every tick, so it is never empty in play; the fallback only guards.
  const [kind, ...queue] = s.queue.length > 0 ? s.queue : [0, 1, 2, 3, 4, 5, 6];
  const piece = spawn(kind);
  const toppedOut = cellsOf(s.piece).some((c) => c.y < 0) || collides(board, piece);
  return {
    ...s,
    board,
    piece,
    queue,
    fall: 0,
    lines,
    level: Math.floor(lines / 10) + 1,
    score: s.score + bonus + LINE_SCORE[cleared] * s.level,
    over: toppedOut,
  };
}

function tryMove(s: DropState, p: Piece): DropState {
  return collides(s.board, p) ? s : { ...s, piece: p };
}

function rotate(s: DropState, dir: 1 | -1): DropState {
  const turned = { ...s.piece, rot: (s.piece.rot + dir + 4) % 4 };
  for (const dx of KICKS) {
    const p = { ...turned, x: turned.x + dx };
    if (!collides(s.board, p)) return { ...s, piece: p };
  }
  return s;
}

function onKey(s: DropState, key: Key): DropState {
  if (s.over) return s;
  const p = s.piece;
  switch (key) {
    case 'left': return tryMove(s, { ...p, x: p.x - 1 });
    case 'right': return tryMove(s, { ...p, x: p.x + 1 });
    case 'up': return rotate(s, 1);
    case 'z': return rotate(s, -1);
    case 'down': {
      const down = { ...p, y: p.y + 1 };
      return collides(s.board, down) ? lock(s, 0) : { ...s, piece: down, score: s.score + 1 };
    }
    case 'space': {
      const d = dropDistance(s.board, p);
      return lock({ ...s, piece: { ...p, y: p.y + d } }, d * 2);
    }
    default: return s;
  }
}

function update(s: DropState, ctx: GameContext): DropState {
  if (s.over) return s;
  const queue = s.queue.length < 7 ? [...s.queue, ...shuffledSet(ctx.random)] : s.queue;
  const fall = s.fall + 1;
  if (fall < fallTicks(s.level)) return { ...s, queue, fall };
  const down = { ...s.piece, y: s.piece.y + 1 };
  if (collides(s.board, down)) return lock({ ...s, queue }, 0);
  return { ...s, queue, fall: 0, piece: down };
}

// ---- drawing ----

function block(screen: Screen, x: number, y: number, chars: string, color: Color): void {
  if (y < 0) return;
  screen.put(ORIGIN_X + 1 + x * 2, 1 + y, chars[0], color);
  screen.put(ORIGIN_X + 2 + x * 2, 1 + y, chars[1], color);
}

function drawBorder(screen: Screen): void {
  const r = ORIGIN_X + BOARD_W * 2 + 1, b = BOARD_H + 1;
  for (let x = ORIGIN_X + 1; x < r; x++) {
    screen.put(x, 0, '─', 'gray');
    screen.put(x, b, '─', 'gray');
  }
  for (let y = 1; y < b; y++) {
    screen.put(ORIGIN_X, y, '│', 'gray');
    screen.put(r, y, '│', 'gray');
  }
  screen.put(ORIGIN_X, 0, '┌', 'gray');
  screen.put(r, 0, '┐', 'gray');
  screen.put(ORIGIN_X, b, '└', 'gray');
  screen.put(r, b, '┘', 'gray');
}

function draw(s: DropState, screen: Screen): void {
  drawBorder(screen);
  s.board.forEach((row, y) => row.forEach((c, x) => {
    if (c !== null) block(screen, x, y, '██', SHAPES[c].color);
  }));
  if (!s.over) {
    const color = SHAPES[s.piece.kind].color;
    const d = dropDistance(s.board, s.piece);
    for (const { x, y } of cellsOf({ ...s.piece, y: s.piece.y + d })) block(screen, x, y, '░░', 'gray');
    for (const { x, y } of cellsOf(s.piece)) block(screen, x, y, '██', color);
  }

  screen.text(PANEL_X, 1, 'NEXT', 'gray');
  const next = s.queue[0];
  if (next !== undefined) {
    const { cells, color } = SHAPES[next];
    for (const [cx, cy] of cells) {
      screen.put(PANEL_X + cx * 2, 3 + cy, '█', color);
      screen.put(PANEL_X + cx * 2 + 1, 3 + cy, '█', color);
    }
  }
  screen.text(PANEL_X, 8, 'LINES', 'gray');
  screen.text(PANEL_X, 9, String(s.lines), 'white');
  screen.text(PANEL_X, 11, 'LEVEL', 'gray');
  screen.text(PANEL_X, 12, String(s.level), 'white');
  if (s.over) screen.text(ORIGIN_X + BOARD_W - 3, 9, 'GAME OVER', 'brightRed');
}

const blockDrop: Game<DropState> = {
  id: 'block-drop',
  title: 'Block Drop',
  description: 'Steer falling blocks, fill rows to clear them.',
  tickMs: 50,
  controls: '←→↑↓ Spc drop',
  init,
  onKey,
  update,
  draw,
  score: (s) => s.score,
  isOver: (s) => s.over,
};

export default blockDrop;
