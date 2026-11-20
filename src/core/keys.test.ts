import { describe, it, expect } from 'vitest';
import { parseKeys } from './keys';

describe('parseKeys', () => {
  it.each([
    ['\x1b[A', ['up']],
    ['\x1b[B', ['down']],
    ['\x1b[C', ['right']],
    ['\x1b[D', ['left']],
    ['\x1bOA', ['up']],
    ['\x1b', ['escape']],
    ['\r', ['enter']],
    ['\n', ['enter']],
    [' ', ['space']],
    ['\x03', ['ctrl-c']],
    ['P', ['p']],
    ['\x7f', ['backspace']],
    ['\b', ['backspace']],
    ['\t', ['tab']],
    ['\x1b[A\x1b[Ca', ['up', 'right', 'a']],
    ['\x1b[99~', []],
    ['\x1b[1;5A', []],
    ['\x1b[99~x', ['x']],
    ['\x1ba', ['escape', 'a']],
    ['\x1b\x1b[A', ['escape', 'up']],
    ['\x01\x02z', ['z']],
    ['', []],
  ])('%j -> %j', (input, expected) => {
    expect(parseKeys(input)).toEqual(expected);
  });
});
