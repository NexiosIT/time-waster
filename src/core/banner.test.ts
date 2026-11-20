import { describe, it, expect } from 'vitest';
import { Banner, BANNER_MS } from './banner';
import type { ClaudeEvent } from './events';

const done = (project = 'proj'): ClaudeEvent => ({ type: 'done', at: 't', project });
const attn = (project = 'proj'): ClaudeEvent => ({ type: 'attention', at: 't', project });

describe('Banner', () => {
  it('is null when nothing pushed', () => {
    expect(new Banner().view(0)).toBeNull();
  });

  it('shows full for BANNER_MS then collapses to marker', () => {
    const b = new Banner();
    b.push(done(), 0);
    expect(BANNER_MS).toBe(10_000);
    expect(b.view(9_999)).toEqual({ mode: 'full', text: '✓ Claude is done — proj' });
    expect(b.view(10_000)).toEqual({ mode: 'marker', text: '● Claude done' });
    expect(b.view(500_000)).toEqual({ mode: 'marker', text: '● Claude done' });
  });

  it('newest event wins and restarts the full window', () => {
    const b = new Banner();
    b.push(done(), 0);
    b.push(attn(), 5_000);
    expect(b.view(14_999)).toEqual({ mode: 'full', text: '! Claude needs you — proj' });
    expect(b.view(15_000)).toEqual({ mode: 'marker', text: '● Claude needs you' });
  });

  it('clearMarker during marker yields null', () => {
    const b = new Banner();
    b.push(done(), 0);
    b.clearMarker();
    expect(b.view(10_000)).toBeNull();
  });

  it('clearMarker during full stays full until expiry, then null', () => {
    const b = new Banner();
    b.push(done(), 0);
    b.clearMarker();
    expect(b.view(5_000)?.mode).toBe('full');
    expect(b.view(10_000)).toBeNull();
  });

  it('push after clearMarker starts a fresh full banner and marker', () => {
    const b = new Banner();
    b.push(done(), 0);
    b.clearMarker();
    b.push(attn(), 20_000);
    expect(b.view(20_000)?.mode).toBe('full');
    expect(b.view(30_000)).toEqual({ mode: 'marker', text: '● Claude needs you' });
  });

  it('drops the project suffix when project is empty', () => {
    const b = new Banner();
    b.push(attn(''), 0);
    expect(b.view(0)).toEqual({ mode: 'full', text: '! Claude needs you' });
    const c = new Banner();
    c.push(done(''), 0);
    expect(c.view(0)?.text).toBe('✓ Claude is done');
  });
});
