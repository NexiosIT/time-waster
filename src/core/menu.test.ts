import { describe, it, expect } from 'vitest';
import { lengthLabel, rowSegments, taskLine } from './menu';
import type { Expected } from './length';

const est = (min: number, isNew = true): Expected => ({ ms: min * 60_000, basis: 'est', isNew });

describe('taskLine', () => {
  it('covers every task state', () => {
    expect(taskLine({ state: 'none' }, null)).toBe('');
    expect(taskLine({ state: 'estimating' }, null)).toBe('Claude: estimating…');
    expect(taskLine({ state: 'overdue' }, null)).toBe('Claude is running over');
    expect(taskLine({ state: 'running', leftMs: 6 * 60_000 }, null)).toBe('Claude ~6 min left');
  });
  it('adds the suggestion, marking new games', () => {
    const v = { state: 'running', leftMs: 6 * 60_000 } as const;
    expect(taskLine(v, { title: 'Beta', expected: est(3) })).toBe('Claude ~6 min left · suggested: Beta (~3 min, new)');
    expect(taskLine(v, { title: 'Beta', expected: { ms: 120_000, basis: 'you', isNew: false } }))
      .toBe('Claude ~6 min left · suggested: Beta (~2 min)');
  });
});

describe('lengthLabel', () => {
  it('formats each basis', () => {
    expect(lengthLabel(null)).toBe('');
    expect(lengthLabel({ ms: 60_000, basis: 'timed', isNew: true })).toBe('1 min');
    expect(lengthLabel(est(3))).toBe('~3 min (est.)');
    expect(lengthLabel({ ms: 90_000, basis: 'you', isNew: false })).toBe('~2 min (you)');
  });
});

describe('rowSegments', () => {
  const lay = (segs: ReturnType<typeof rowSegments>) => {
    const line = Array(60).fill(' ');
    for (const s of segs) [...s.text].forEach((ch, i) => { line[s.x + i] = ch; });
    return line.join('');
  };
  it('lays out cursor, title, length, NEW, star and best without overlap', () => {
    const segs = rowSegments({ selected: true, title: 'Beta', expected: est(3), suggested: true, best: '42' });
    const line = lay(segs);
    expect(line).toMatch(/^ {2}> Beta +~3 min \(est\.\) +NEW +★ +Best 42 *$/);
    const sorted = [...segs].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1].x + [...sorted[i - 1].text].length).toBeLessThan(sorted[i].x);
    expect(Math.max(...segs.map((s) => s.x + [...s.text].length))).toBeLessThanOrEqual(60);
  });
  it('clips long titles and huge values to their slots', () => {
    const segs = rowSegments({ selected: false, title: 'T'.repeat(50), expected: est(9999), suggested: false, best: '1'.repeat(20) });
    const sorted = [...segs].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i - 1].x + sorted[i - 1].text.length).toBeLessThan(sorted[i].x);
    expect(Math.max(...segs.map((s) => s.x + s.text.length))).toBeLessThanOrEqual(60);
    expect(lay(segs)).not.toContain('★');
  });
  it('omits length and NEW for a game without length', () => {
    const line = lay(rowSegments({ selected: false, title: 'Delta', expected: null, suggested: false, best: '-' }));
    expect(line).not.toContain('min');
    expect(line).not.toContain('NEW');
  });
});
