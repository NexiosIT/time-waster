import { describe, it, expect } from 'vitest';
import { TaskClock, TASK_MAX_AGE_MS, OVERDUE_GRACE_MS } from './task';
import type { ClaudeEvent } from './events';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T0 + ms).toISOString();
const start = (ms: number, project = 'p'): ClaudeEvent => ({ type: 'start', at: at(ms), project });
const est = (ms: number, minutes: number, project = 'p'): ClaudeEvent => ({ type: 'estimate', minutes, at: at(ms), project });
const done = (ms: number, project = 'p'): ClaudeEvent => ({ type: 'done', at: at(ms), project });

describe('TaskClock', () => {
  it('starts as none', () => {
    expect(new TaskClock().view(T0)).toEqual({ state: 'none' });
  });
  it('start then estimate runs down to overdue', () => {
    const c = new TaskClock();
    c.apply(start(0));
    expect(c.view(T0 + 1000)).toEqual({ state: 'estimating' });
    c.apply(est(1000, 5));
    expect(c.view(T0)).toEqual({ state: 'running', leftMs: 300000 });
  });
  it('matches the spec numbers when estimate is at start', () => {
    const c = new TaskClock();
    c.apply(start(0));
    c.apply(est(0, 5));
    expect(c.view(T0)).toEqual({ state: 'running', leftMs: 300000 });
    expect(c.view(T0 + 180000)).toEqual({ state: 'running', leftMs: 120000 });
    expect(c.view(T0 + 300000)).toEqual({ state: 'overdue' });
  });
  it('done for the same project clears; other project does not', () => {
    const c = new TaskClock();
    c.apply(start(0));
    c.apply(est(0, 5));
    c.apply(done(10, 'other'));
    expect(c.view(T0 + 20).state).toBe('running');
    c.apply({ type: 'attention', at: at(15), project: 'p' });
    expect(c.view(T0 + 20).state).toBe('running');
    c.apply(done(30));
    expect(c.view(T0 + 40)).toEqual({ state: 'none' });
  });
  it('older or equal start is ignored', () => {
    const c = new TaskClock();
    c.apply(start(100, 'new'));
    c.apply(est(100, 5, 'new'));
    c.apply(start(50, 'old'));
    c.apply(start(100, 'same'));
    expect(c.view(T0 + 100)).toEqual({ state: 'running', leftMs: 300000 });
    c.apply(done(200, 'old'));
    expect(c.view(T0 + 200).state).toBe('running');
  });
  it('estimating times out to none', () => {
    const c = new TaskClock();
    c.apply(start(0));
    expect(c.view(T0 + TASK_MAX_AGE_MS - 1).state).toBe('estimating');
    expect(c.view(T0 + 31 * 60_000)).toEqual({ state: 'none' });
  });
  it('estimate from another project, or before start, is ignored', () => {
    const c = new TaskClock();
    c.apply(start(100));
    c.apply(est(200, 5, 'other'));
    c.apply(est(50, 5));
    expect(c.view(T0 + 300)).toEqual({ state: 'estimating' });
  });
  it('applying the same start twice gives the same view', () => {
    const c = new TaskClock();
    c.apply(start(0));
    c.apply(est(0, 5));
    const v = c.view(T0 + 1000);
    c.apply(start(0));
    expect(c.view(T0 + 1000)).toEqual(v);
  });
  it('overdue expires to none after the grace period', () => {
    expect(OVERDUE_GRACE_MS).toBe(10 * 60_000);
    const c = new TaskClock();
    c.apply(start(0));
    c.apply(est(0, 5));
    expect(c.view(T0 + 300000 + 1)).toEqual({ state: 'overdue' });
    expect(c.view(T0 + 300000 + OVERDUE_GRACE_MS)).toEqual({ state: 'overdue' });
    expect(c.view(T0 + 300000 + OVERDUE_GRACE_MS + 1)).toEqual({ state: 'none' });
  });
  it('an older start replayed after done leaves none', () => {
    const c = new TaskClock();
    c.apply(start(100));
    c.apply(done(200));
    c.apply(start(50));
    expect(c.view(T0 + 300)).toEqual({ state: 'none' });
  });
});
