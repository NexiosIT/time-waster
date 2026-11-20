import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import game, { BOARD_H, BOARD_W, cellsOf, clearLines, collides, dropDistance, emptyBoard, fallTicks, type DropState } from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });

/** A board whose bottom rows are full except the given gap columns. */
function withRows(rows: number, gaps: number[] = []): (number | null)[][] {
  const b = emptyBoard();
  for (let y = BOARD_H - rows; y < BOARD_H; y++) for (let x = 0; x < BOARD_W; x++) if (!gaps.includes(x)) b[y][x] = 0;
  return b;
}

const xs = (s: DropState) => cellsOf(s.piece).map((c) => c.x);
const ys = (s: DropState) => cellsOf(s.piece).map((c) => c.y);

describe('block drop', () => {
  it('starts with an empty board, a piece at the top, score 0', () => {
    const s = game.init(ctx());
    expect(s.board.flat().every((c) => c === null)).toBe(true);
    expect(Math.min(...ys(s))).toBeLessThanOrEqual(1);
    expect(game.score(s)).toBe(0);
    expect(game.isOver(s)).toBe(false);
    expect(s.queue.length).toBeGreaterThanOrEqual(7);
  });

  it('deals pieces in shuffled sets containing all seven shapes', () => {
    const s = game.init(ctx(3));
    const first7 = [s.piece.kind, ...s.queue.slice(0, 6)];
    expect(new Set(first7).size).toBe(7);
  });

  it('left and right move the piece and stop at the walls, without mutating input', () => {
    const s = game.init(ctx());
    const l = game.onKey(s, 'left');
    expect(xs(l)).toEqual(xs(s).map((x) => x - 1));
    expect(xs(s)).toEqual(cellsOf(s.piece).map((c) => c.x)); // untouched
    let t = s;
    for (let i = 0; i < 20; i++) t = game.onKey(t, 'left');
    expect(Math.min(...xs(t))).toBe(0);
    for (let i = 0; i < 20; i++) t = game.onKey(t, 'right');
    expect(Math.max(...xs(t))).toBe(BOARD_W - 1);
  });

  it('up rotates (z the other way), and a rotation into the wall is kicked back inside', () => {
    const s: DropState = { ...game.init(ctx()), piece: { kind: 0, rot: 0, x: 3, y: 0 } }; // I, horizontal
    const r = game.onKey(s, 'up');
    expect(new Set(xs(r)).size).toBe(1); // vertical now
    expect(game.onKey(r, 'z').piece.rot).toBe(0);
    // vertical I against the left wall, rotate back to horizontal: must stay on the board
    let t = r;
    for (let i = 0; i < 10; i++) t = game.onKey(t, 'left');
    const back = game.onKey(t, 'up');
    expect(Math.min(...xs(back))).toBeGreaterThanOrEqual(0);
    expect(collides(back.board, back.piece)).toBe(false);
  });

  it('gravity moves the piece down one row every fallTicks ticks', () => {
    const c = ctx();
    let s = game.init(c);
    const top = Math.min(...ys(s));
    for (let i = 0; i < fallTicks(1) - 1; i++) s = game.update(s, c);
    expect(Math.min(...ys(s))).toBe(top);
    s = game.update(s, c);
    expect(Math.min(...ys(s))).toBe(top + 1);
  });

  it('down drops one row and scores 1', () => {
    const s = game.init(ctx());
    const d = game.onKey(s, 'down');
    expect(ys(d)).toEqual(ys(s).map((y) => y + 1));
    expect(game.score(d)).toBe(1);
  });

  it('space drops the piece to the bottom, locks it, scores 2 per row and brings the next piece', () => {
    const s = game.init(ctx());
    const dist = dropDistance(s.board, s.piece);
    const d = game.onKey(s, 'space');
    expect(d.board[BOARD_H - 1].some((c) => c !== null)).toBe(true);
    expect(game.score(d)).toBe(dist * 2);
    expect(d.piece.kind).toBe(s.queue[0]);
    expect(d.queue.length).toBe(s.queue.length - 1);
  });

  it('a piece that cannot fall any further locks on the next gravity step', () => {
    const c = ctx();
    let s = game.init(c);
    s = { ...s, piece: { ...s.piece, y: s.piece.y + dropDistance(s.board, s.piece) }, fall: fallTicks(1) - 1 };
    const n = game.update(s, c);
    expect(n.board.flat().filter((x) => x !== null)).toHaveLength(4);
    expect(n.piece.kind).toBe(s.queue[0]);
  });

  it('clearLines removes full rows and shifts the rest down', () => {
    const b = withRows(2);
    b[BOARD_H - 3][4] = 5;
    const r = clearLines(b);
    expect(r.cleared).toBe(2);
    expect(r.board[BOARD_H - 1][4]).toBe(5);
    expect(r.board[BOARD_H - 1].filter((c) => c !== null)).toHaveLength(1);
    expect(r.board).toHaveLength(BOARD_H);
  });

  it('completing four lines at once scores 800 at level 1, and counts the lines', () => {
    // four full rows except column 0; a vertical I dropped into column 0 clears them
    const s: DropState = { ...game.init(ctx()), board: withRows(4, [0]), piece: { kind: 0, rot: 1, x: -2, y: 0 } };
    expect(xs(s).every((x) => x === 0)).toBe(true);
    const d = game.onKey(s, 'space');
    expect(d.lines).toBe(4);
    expect(d.board.flat().every((c) => c === null)).toBe(true);
    expect(game.score(d)).toBe(800 + dropDistance(s.board, s.piece) * 2);
  });

  it('every 10 lines is a new level, and pieces fall faster', () => {
    const s: DropState = { ...game.init(ctx()), lines: 9, board: withRows(1, [0]), piece: { kind: 0, rot: 1, x: -2, y: 0 } };
    const d = game.onKey(s, 'space');
    expect(d.lines).toBe(10);
    expect(d.level).toBe(2);
    expect(fallTicks(2)).toBeLessThan(fallTicks(1));
  });

  it('the run is over when a new piece has no room', () => {
    const b = emptyBoard();
    for (let y = 0; y < BOARD_H; y++) for (let x = 3; x <= 6; x++) b[y][x] = 1; // a tower where pieces appear
    const s: DropState = { ...game.init(ctx()), board: b, piece: { kind: 0, rot: 1, x: -2, y: -1 } };
    const d = game.onKey(s, 'space');
    expect(game.isOver(d)).toBe(true);
    expect(game.onKey(d, 'left')).toBe(d);
  });

  it('draws the border, the piece, a ghost where it will land, and the next piece', () => {
    const s = game.init(ctx());
    const cells = new Map<string, string>();
    game.draw(s, {
      width: 60, height: 20, clear() {},
      put: (x, y, ch) => { cells.set(`${x},${y}`, ch); },
      text: (x, y, str) => { [...str].forEach((ch, i) => cells.set(`${x + i},${y}`, ch)); },
    });
    const all = [...cells.values()].join('');
    expect(all).toContain('█');
    expect(all).toContain('░');
    expect(all).toContain('┌');
    const panel = Array.from({ length: 20 }, (_, y) => Array.from({ length: 60 }, (_, x) => cells.get(`${x},${y}`) ?? ' ').join('')).join('\n');
    expect(panel).toContain('NEXT');
    expect(panel).toContain('LINES');
    expect(panel).toContain('LEVEL');
  });
});
