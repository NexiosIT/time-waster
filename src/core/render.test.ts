import { describe, it, expect } from 'vitest';
import { CellBuffer } from './buffer';
import { renderDiff, ENTER_ALT, LEAVE_ALT } from './render';

const moves = (s: string) => s.match(/\x1b\[\d+;\d+H/g) ?? [];

describe('renderDiff', () => {
  it('returns empty string for identical buffers', () => {
    const a = new CellBuffer(10, 3);
    a.text(0, 0, 'hi');
    expect(renderDiff(a, a)).toBe('');
  });
  it('emits one move and the char for a single changed cell', () => {
    const a = new CellBuffer(10, 3), b = new CellBuffer(10, 3);
    b.put(4, 2, 'x');
    const out = renderDiff(a, b);
    expect(moves(out)).toEqual(['\x1b[3;5H']);
    expect(out).toContain('x');
  });
  it('uses one move for adjacent changed cells', () => {
    const a = new CellBuffer(10, 3), b = new CellBuffer(10, 3);
    b.text(2, 1, 'abc');
    const out = renderDiff(a, b);
    expect(moves(out)).toEqual(['\x1b[2;3H']);
    expect(out).toContain('abc');
  });
  it('uses separate moves for non-adjacent cells', () => {
    const a = new CellBuffer(10, 3), b = new CellBuffer(10, 3);
    b.put(0, 0, 'a'); b.put(5, 0, 'b');
    expect(moves(renderDiff(a, b))).toHaveLength(2);
  });
  it('starts each frame with an SGR and only re-emits on colour change', () => {
    const a = new CellBuffer(10, 1), b = new CellBuffer(10, 1);
    b.text(0, 0, 'ab', 'red');
    b.text(2, 0, 'c', 'brightGreen');
    const out = renderDiff(a, b);
    expect(out).toBe('\x1b[1;1H\x1b[31mab\x1b[92mc');
  });
  it('maps gray to 90', () => {
    const a = new CellBuffer(2, 1), b = new CellBuffer(2, 1);
    b.put(0, 0, 'x', 'gray');
    expect(renderDiff(a, b)).toContain('\x1b[90m');
  });
  it('does a full redraw when prev is null', () => {
    const b = new CellBuffer(3, 2);
    b.text(0, 0, 'abc');
    const out = renderDiff(null, b);
    expect(out.startsWith('\x1b[2J')).toBe(true);
    expect(out).toContain('abc');
    expect(moves(out)).toHaveLength(2);
  });
  it('does a full redraw when sizes differ', () => {
    expect(renderDiff(new CellBuffer(2, 2), new CellBuffer(3, 2)).startsWith('\x1b[2J')).toBe(true);
  });
  it('never writes the last cell of the last row (full or diff)', () => {
    const b = new CellBuffer(3, 2);
    b.text(0, 1, 'xyz');
    expect(renderDiff(null, b)).not.toContain('z');
    expect(renderDiff(null, b)).toContain('xy');
    const a = new CellBuffer(3, 2);
    expect(renderDiff(a, b)).not.toContain('z');
    expect(renderDiff(a, b)).toContain('xy');
  });
  it('exports alt-screen sequences', () => {
    expect(ENTER_ALT).toBe('\x1b[?1049h\x1b[?25l');
    expect(LEAVE_ALT).toBe('\x1b[0m\x1b[?25h\x1b[?1049l');
  });
});
