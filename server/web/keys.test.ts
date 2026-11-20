import { describe, expect, test } from 'vitest';
import { keyAction, keyFromEvent } from './keys';

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

describe('keyAction', () => {
  const e = (key: string, extra: Partial<{ repeat: boolean; ctrlKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...extra });

  test('Tab always stays with the browser so the page can be navigated by keyboard', () => {
    for (const state of ['ready', 'playing', 'results', 'crashed'] as const) {
      expect(keyAction(e('Tab'), state, false)).toEqual({ key: null, prevent: false });
    }
  });

  test('while playing, game keys go to the game and keys that would scroll are prevented', () => {
    expect(keyAction(e('ArrowLeft'), 'playing', false)).toEqual({ key: 'left', prevent: true });
    expect(keyAction(e(' '), 'playing', false)).toEqual({ key: 'space', prevent: true });
    expect(keyAction(e('a'), 'playing', false)).toEqual({ key: 'a', prevent: false });
    expect(keyAction(e('ArrowLeft', { repeat: true }), 'playing', false)).toEqual({ key: 'left', prevent: true });
  });

  test('outside a run only Enter and Esc act, and held keys are ignored', () => {
    expect(keyAction(e('Enter'), 'results', false)).toEqual({ key: 'enter', prevent: true });
    expect(keyAction(e('Escape'), 'ready', false)).toEqual({ key: 'escape', prevent: true });
    expect(keyAction(e('Escape', { repeat: true }), 'results', false)).toEqual({ key: null, prevent: false });
    expect(keyAction(e('Enter', { repeat: true }), 'results', false)).toEqual({ key: null, prevent: false });
    expect(keyAction(e(' '), 'results', false)).toEqual({ key: null, prevent: false });
    expect(keyAction(e('ArrowDown'), 'ready', false)).toEqual({ key: null, prevent: false });
  });

  test('nothing is taken while focus is in the save form', () => {
    expect(keyAction(e('Enter'), 'results', true)).toEqual({ key: null, prevent: false });
    expect(keyAction(e('p'), 'playing', true)).toEqual({ key: null, prevent: false });
  });

  test('modifier shortcuts stay with the browser', () => {
    expect(keyAction(e('r', { ctrlKey: true }), 'playing', false)).toEqual({ key: null, prevent: false });
  });
});
