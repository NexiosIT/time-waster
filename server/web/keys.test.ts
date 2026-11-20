import { describe, expect, test } from 'vitest';
import { keyFromEvent } from './keys';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, altKey: false, metaKey: false, ...mods });

describe('keyFromEvent', () => {
  test('maps named keys to the arcade key names', () => {
    expect(keyFromEvent(ev('ArrowUp'))).toBe('up');
    expect(keyFromEvent(ev('ArrowDown'))).toBe('down');
    expect(keyFromEvent(ev('ArrowLeft'))).toBe('left');
    expect(keyFromEvent(ev('ArrowRight'))).toBe('right');
    expect(keyFromEvent(ev(' '))).toBe('space');
    expect(keyFromEvent(ev('Enter'))).toBe('enter');
    expect(keyFromEvent(ev('Escape'))).toBe('escape');
    expect(keyFromEvent(ev('Backspace'))).toBe('backspace');
    expect(keyFromEvent(ev('Tab'))).toBe('tab');
  });
  test('lower-cases single characters', () => {
    expect(keyFromEvent(ev('A'))).toBe('a');
    expect(keyFromEvent(ev('p'))).toBe('p');
    expect(keyFromEvent(ev('7'))).toBe('7');
    expect(keyFromEvent(ev('-'))).toBe('-');
  });
  test('leaves modifier shortcuts and other keys to the browser', () => {
    expect(keyFromEvent(ev('r', { ctrlKey: true }))).toBeNull();
    expect(keyFromEvent(ev('r', { metaKey: true }))).toBeNull();
    expect(keyFromEvent(ev('ArrowLeft', { altKey: true }))).toBeNull();
    expect(keyFromEvent(ev('Shift'))).toBeNull();
    expect(keyFromEvent(ev('F5'))).toBeNull();
  });
});
