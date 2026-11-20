import { describe, expect, test } from 'vitest';
import { normalizeWebName } from './webname';

describe('normalizeWebName', () => {
  test('trims and collapses whitespace', () => {
    expect(normalizeWebName('  Kim   B ')).toBe('Kim B');
  });
  test('accepts letters from any script, digits and _ - .', () => {
    expect(normalizeWebName('Zoë')).toBe('Zoë');
    expect(normalizeWebName('a_b-c.d 9')).toBe('a_b-c.d 9');
    expect(normalizeWebName('x'.repeat(20))).toBe('x'.repeat(20));
  });
  test('rejects empty, too long, markup, control characters and non-strings', () => {
    for (const bad of ['', '   ', 'x'.repeat(21), '<b>', 'a\nb', 'a\tb!', 'semi;colon']) expect(normalizeWebName(bad)).toBeNull();
    for (const bad of [undefined, null, 5, {}, ['a']]) expect(normalizeWebName(bad)).toBeNull();
  });
});
