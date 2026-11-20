import { describe, expect, test } from 'vitest';
import { CellBuffer } from '../../src/core/buffer';
import { COLOR_CLASSES, gridLines } from './grid';

describe('gridLines', () => {
  test('one line per row, runs of one colour in one span', () => {
    const b = new CellBuffer(4, 2);
    b.text(0, 0, 'ab', 'red');
    b.text(2, 0, 'c', 'brightGreen');
    expect(gridLines(b)).toEqual([
      '<span class="c-red">ab</span><span class="c-brightGreen">c</span><span class="c-white"> </span>',
      '<span class="c-white">    </span>',
    ]);
  });
  test('escapes HTML special characters', () => {
    const b = new CellBuffer(3, 1);
    b.text(0, 0, '<&>');
    expect(gridLines(b)).toEqual(['<span class="c-white">&lt;&amp;&gt;</span>']);
  });
  test('lists the 16 arcade colours', () => {
    expect(COLOR_CLASSES).toHaveLength(16);
    expect(COLOR_CLASSES).toContain('brightYellow');
  });
});
