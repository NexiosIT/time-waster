import { describe, it, expect } from 'vitest';
import { CellBuffer } from './buffer';

describe('CellBuffer', () => {
  it('starts with empty white cells', () => {
    expect(new CellBuffer(3, 2).get(1, 1)).toEqual({ ch: ' ', color: 'white' });
  });
  it('clips text at the right edge', () => {
    const b = new CellBuffer(60, 1);
    b.text(58, 0, 'abcd');
    expect(b.get(58, 0).ch).toBe('a');
    expect(b.get(59, 0).ch).toBe('b');
  });
  it('ignores out-of-range puts', () => {
    const b = new CellBuffer(3, 3);
    expect(() => { b.put(-1, 0, 'x'); b.put(0, 9, 'x'); b.text(-2, 0, 'abc'); }).not.toThrow();
    expect(b.rowText(0)).toBe('c  ');
  });
  it('treats one code point as one cell', () => {
    const b = new CellBuffer(4, 1);
    b.text(0, 0, '█●😀', 'red');
    expect(b.rowText(0)).toBe('█●😀 ');
    expect(b.get(0, 0).color).toBe('red');
  });
  it('blits at an offset with clipping', () => {
    const src = new CellBuffer(2, 2);
    src.text(0, 0, 'ab', 'red');
    src.text(0, 1, 'cd');
    const dst = new CellBuffer(4, 3);
    dst.blit(src, 1, 1);
    expect(dst.rowText(1)).toBe(' ab ');
    expect(dst.rowText(2)).toBe(' cd ');
    expect(dst.get(1, 1).color).toBe('red');
    dst.blit(src, 3, 2);
    expect(dst.get(3, 2).ch).toBe('a');
  });
  it('clear resets cells', () => {
    const b = new CellBuffer(2, 1);
    b.text(0, 0, 'ab', 'red');
    b.clear();
    expect(b.get(0, 0)).toEqual({ ch: ' ', color: 'white' });
  });
});
