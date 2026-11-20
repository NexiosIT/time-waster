import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import worm, { spawnDot, BOARD_W, BOARD_H, type WormState } from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
type Point = { x: number; y: number };
const row = (n: number, y: number) => Array.from({ length: n }, (_, i) => ({ x: 14 - i, y }));
/** One move at normal speed takes two ticks. */
const move = (s: WormState, c: GameContext) => worm.update(worm.update(s, c), c);

describe('worm', () => {
  it('starts with length 3 and score 0, in the middle of the board', () => {
    const s = worm.init(ctx());
    expect(s.body).toEqual([{ x: 14, y: 9 }, { x: 13, y: 9 }, { x: 12, y: 9 }]);
    expect(worm.score(s)).toBe(0);
    expect(worm.isOver(s)).toBe(false);
  });

  it('moves the head one cell right per two ticks without mutating its input', () => {
    const c = ctx();
    const s = worm.init(c);
    const half = worm.update(s, c);
    expect(half.body[0]).toEqual({ x: 14, y: 9 });
    const n = worm.update(half, c);
    expect(n.body[0]).toEqual({ x: 15, y: 9 });
    expect(n.body).toHaveLength(3);
    expect(s.body[0]).toEqual({ x: 14, y: 9 });
  });

  it('space toggles turbo: one cell per tick, and space again goes back', () => {
    const c = ctx();
    let s = worm.onKey(worm.init(c), 'space');
    expect(s.turbo).toBe(true);
    s = worm.update(s, c);
    expect(s.body[0]).toEqual({ x: 15, y: 9 });
    s = worm.update(s, c);
    expect(s.body[0]).toEqual({ x: 16, y: 9 });
    s = worm.onKey(s, 'space');
    expect(s.turbo).toBe(false);
    expect(move(s, c).body[0]).toEqual({ x: 17, y: 9 });
  });

  it('ignores reversing, even via two quick presses within one move', () => {
    const c = ctx();
    const s = worm.onKey(worm.init(c), 'left');
    expect(move(s, c).body[0]).toEqual({ x: 15, y: 9 });
    const t = worm.onKey(worm.onKey(worm.init(c), 'up'), 'left');
    const n = move(t, c);
    expect(n.body[0]).toEqual({ x: 14, y: 8 });
    expect(worm.isOver(n)).toBe(false);
  });

  it('turns up', () => {
    const c = ctx();
    const s = move(worm.onKey(worm.init(c), 'up'), c);
    expect(s.body[0]).toEqual({ x: 14, y: 8 });
  });

  it('eating grows, scores 10 and respawns the dot off the worm', () => {
    const c = ctx();
    const s = { ...worm.init(c), dot: { x: 15, y: 9 } };
    const n = move(s, c);
    expect(worm.score(n)).toBe(10);
    expect(n.body).toHaveLength(4);
    expect(n.dot).not.toBeNull();
    expect(n.body.some(p => p.x === n.dot!.x && p.y === n.dot!.y)).toBe(false);
  });

  it('hitting the right wall ends the game', () => {
    const c = ctx();
    let s: WormState = { ...worm.init(c), dot: { x: 0, y: 0 } };
    for (let i = 0; i < BOARD_W - 1 - 14; i++) s = move(s, c); // head reaches the last column
    expect(s.body[0].x).toBe(BOARD_W - 1);
    expect(worm.isOver(s)).toBe(false);
    expect(worm.isOver(move(s, c))).toBe(true);
  });

  it('turning back into its own body ends the game', () => {
    const c = ctx();
    let s: WormState = { ...worm.init(c), body: row(5, 5), dot: { x: 0, y: 0 } };
    for (const k of ['up', 'left', 'down'] as const) s = move(worm.onKey(s, k), c);
    expect(worm.isOver(s)).toBe(true);
  });

  it('may enter the cell the tail is leaving, unless it grows that move', () => {
    const c = ctx();
    // 2x2 square: head (1,1) having moved down, now turning left, would step into tail cell (0,1).
    const s: WormState = {
      ...worm.init(c),
      body: [{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }],
      moved: 'down',
      pending: 'left',
      dot: { x: 5, y: 5 },
    };
    expect(worm.isOver(move(s, c))).toBe(false);
    expect(worm.isOver(move({ ...s, dot: { x: 0, y: 1 } }, c))).toBe(true); // tail stays when eating
  });

  it('dot never spawns on the worm', () => {
    const body = worm.init(ctx()).body;
    for (let seed = 1; seed <= 100; seed++) {
      const d = spawnDot(body, ctx(seed))!;
      expect(body.some(p => p.x === d.x && p.y === d.y)).toBe(false);
      expect(d.x).toBeLessThan(BOARD_W);
      expect(d.y).toBeLessThan(BOARD_H);
    }
  });

  it('spawnDot returns null on a full board', () => {
    const body: Point[] = [];
    for (let y = 0; y < BOARD_H; y++) for (let x = 0; x < BOARD_W; x++) body.push({ x, y });
    expect(spawnDot(body, ctx())).toBeNull();
  });

  describe('draw', () => {
    const paint = (s: WormState) => {
      const cells = new Map<string, string>();
      worm.draw(s, {
        width: 60, height: 20, clear() {},
        put: (x, y, ch, col) => { cells.set(`${x},${y}`, `${ch},${col}`); },
        text: (x, y, str, col) => { [...str].forEach((ch, i) => cells.set(`${x + i},${y}`, `${ch},${col}`)); },
      });
      return cells;
    };

    it('draws a border around the whole 60x20 area', () => {
      const cells = paint(worm.init(ctx()));
      expect(cells.get('0,0')).toBe('┌,gray');
      expect(cells.get('59,0')).toBe('┐,gray');
      expect(cells.get('0,19')).toBe('└,gray');
      expect(cells.get('59,19')).toBe('┘,gray');
      expect(cells.get('30,19')).toBe('─,gray');
      expect(cells.get('0,10')).toBe('│,gray');
      expect(cells.get('59,10')).toBe('│,gray');
    });

    it('draws each board cell two characters wide inside the border', () => {
      const s = { ...worm.init(ctx()), dot: { x: 0, y: 0 } };
      const cells = paint(s);
      // head (14,9) -> screen columns 29 and 30, row 10
      expect(cells.get('29,10')).toBe('▓,brightGreen');
      expect(cells.get('30,10')).toBe('▓,brightGreen');
      expect(cells.get('27,10')).toBe('█,green');
      expect(cells.get('28,10')).toBe('█,green');
      expect(cells.get('1,1')).toBe('●,yellow');
    });

    it('shows TURBO in the top border only while turbo is on', () => {
      const text = (cells: Map<string, string>) =>
        Array.from({ length: 60 }, (_, x) => (cells.get(`${x},0`) ?? ' ,').split(',')[0]).join('');
      expect(text(paint(worm.init(ctx())))).not.toContain('TURBO');
      expect(text(paint(worm.onKey(worm.init(ctx()), 'space')))).toContain('TURBO');
    });
  });
});
