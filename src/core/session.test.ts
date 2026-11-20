import { describe, it, expect } from 'vitest';
import { GameSession } from './session';
import { createRandom } from './random';
import { CellBuffer } from './buffer';
import type { Game } from './types';

function fake(over: Partial<Game<number>> = {}): Game<number> {
  return {
    id: 'fake', title: 'Fake', description: '', tickMs: 100, controls: '',
    init: () => 0,
    onKey: (s, k) => (k === 'x' ? s + 100 : s),
    update: (s) => s + 1,
    draw: (s, screen) => screen.text(0, 0, `n=${s}`),
    score: (s) => s,
    isOver: (s) => s >= 10 && s < 100 ? true : s >= 100,
    ...over,
  };
}

function run(s: GameSession<number>, from: number, to: number, step = 100) {
  for (let t = from; t <= to; t += step) s.tick(t);
}

describe('createRandom', () => {
  it('is deterministic per seed and within [0,1)', () => {
    const a = createRandom(1), b = createRandom(1), c = createRandom(2);
    const sa = [a(), a(), a()], sb = [b(), b(), b()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual([c(), c(), c()]);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('GameSession', () => {
  it('playedMs grows with ticks, not while paused; endedEarly only on escape', () => {
    const s = new GameSession(fake({ isOver: () => false }), { seed: 1, nowMs: 0 });
    run(s, 100, 300);
    expect(s.playedMs).toBe(300);
    s.key('p');
    run(s, 400, 700);
    expect(s.playedMs).toBe(300);
    s.key('p');
    s.tick(800);
    expect(s.playedMs).toBe(400);
    expect(s.endedEarly).toBe(false);
    s.key('escape');
    expect(s.endedEarly).toBe(true);
    const n = new GameSession(fake(), { seed: 1, nowMs: 0 });
    run(n, 100, 1000);
    expect(n.status).toBe('over');
    expect(n.endedEarly).toBe(false);
    n.key('escape');
    expect(n.endedEarly).toBe(false);
  });

  it('runs to game over', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    run(s, 0, 1000);
    expect(s.score).toBe(10);
    expect(s.status).toBe('over');
  });

  it('pause stops progress and resume continues without burst', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    run(s, 100, 300);
    expect(s.score).toBe(3);
    s.key('p');
    expect(s.status).toBe('paused');
    run(s, 400, 5000, 100);
    expect(s.score).toBe(3);
    s.key('p');
    expect(s.status).toBe('playing');
    s.tick(5100);
    expect(s.score).toBe(4);
  });

  it('escape ends with score so far, also while paused', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    run(s, 100, 300);
    s.key('escape');
    expect(s.status).toBe('over');
    expect(s.score).toBe(3);
    const p = new GameSession(fake(), { seed: 1, nowMs: 0 });
    p.key('p'); p.key('escape');
    expect(p.status).toBe('over');
  });

  it('pauses while too small', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    run(s, 100, 200);
    s.setTooSmall(true);
    run(s, 300, 2000);
    expect(s.score).toBe(2);
    const b = new CellBuffer(60, 20);
    s.draw(b);
    expect(b.rowText(10)).toContain('Make the window bigger');
    s.setTooSmall(false);
    s.tick(2100);
    expect(s.score).toBe(3);
  });

  it('p toggles pause while too small; too-small overlay wins', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    s.setTooSmall(true);
    s.key('p');
    expect(s.status).toBe('paused');
    const b = new CellBuffer(60, 20);
    s.draw(b);
    expect(b.rowText(10)).toContain('Make the window bigger');
    expect(b.rowText(10)).not.toContain('PAUSED');
  });

  it('draws the paused overlay centred', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    s.key('p');
    const b = new CellBuffer(60, 20);
    s.draw(b);
    const msg = 'PAUSED — P to resume';
    expect(b.rowText(10).indexOf(msg)).toBe(Math.floor((60 - msg.length) / 2));
  });

  it('caps catch-up at 5 updates and drops the backlog', () => {
    const s = new GameSession(fake({ isOver: () => false }), { seed: 1, nowMs: 0 });
    s.tick(100000);
    expect(s.score).toBe(5);
    s.tick(100100);
    expect(s.score).toBe(6);
  });

  it('does not pass p or escape to the game and ignores ctrl-c', () => {
    const seen: string[] = [];
    const s = new GameSession(fake({ onKey: (st, k) => { seen.push(k); return st; } }), { seed: 1, nowMs: 0 });
    s.key('p'); s.key('p'); s.key('ctrl-c'); s.key('a'); s.key('escape');
    expect(seen).toEqual(['a']);
  });

  it('keys reach the game only while playing; no-ops after over', () => {
    const s = new GameSession(fake(), { seed: 1, nowMs: 0 });
    s.key('p'); s.key('x');
    expect(s.score).toBe(0);
    s.key('p'); s.key('x');
    expect(s.score).toBe(100);
    s.end();
    s.key('x'); s.tick(1000);
    expect(s.score).toBe(100);
    const b = new CellBuffer(60, 20);
    s.draw(b);
    expect(b.rowText(0)).toContain('n=100');
  });

  it('provides seeded random and played elapsedMs in context', () => {
    const got: number[] = [];
    const el: number[] = [];
    const s = new GameSession(fake({
      isOver: () => false,
      init: (c) => { got.push(c.random()); return 0; },
      update: (st, c) => { el.push(c.elapsedMs); return st + 1; },
    }), { seed: 7, nowMs: 0 });
    expect(got[0]).toBe(createRandom(7)());
    s.tick(100); s.key('p'); s.tick(1000); s.key('p'); s.tick(1100);
    expect(el).toEqual([100, 200]);
  });

  it('isolates crashes', () => {
    const k = new GameSession(fake({ onKey: () => { throw new Error('boom'); } }), { seed: 1, nowMs: 0 });
    k.key('a');
    expect(k.status).toBe('crashed');
    expect(k.error).toBe('boom');
    const d = new GameSession(fake({ draw: () => { throw new Error('boom'); } }), { seed: 1, nowMs: 0 });
    d.draw(new CellBuffer(60, 20));
    expect(d.status).toBe('crashed');
    expect(d.error).toBe('boom');
    const i = new GameSession(fake({ init: () => { throw new Error('boom'); } }), { seed: 1, nowMs: 0 });
    expect(i.status).toBe('crashed');
    expect(i.error).toBe('boom');
    const u = new GameSession(fake({ update: () => { throw 'str'; } }), { seed: 1, nowMs: 0 });
    u.tick(100);
    expect(u.error).toBe('str');
    const o = new GameSession(fake({ isOver: () => { throw new Error('boom'); } }), { seed: 1, nowMs: 0 });
    o.tick(100);
    expect(o.status).toBe('crashed');
  });

  it('crashed session is inert and draws a cleared screen', () => {
    const s = new GameSession(fake({ init: () => { throw new Error('boom'); } }), { seed: 1, nowMs: 0 });
    const b = new CellBuffer(60, 20);
    b.text(0, 0, 'junk');
    s.draw(b);
    expect(b.rowText(0).trim()).toBe('');
    s.key('a'); s.tick(1000);
    expect(s.status).toBe('crashed');
  });

  it('treats a non-finite score as a crash', () => {
    const s = new GameSession(fake({ score: () => NaN }), { seed: 1, nowMs: 0 });
    expect(s.status).toBe('crashed');
    expect(s.error).toBe('invalid score');
    const t = new GameSession(fake({ score: (st) => (st > 0 ? ('x' as unknown as number) : 0) }), { seed: 1, nowMs: 0 });
    t.tick(100);
    expect(t.error).toBe('invalid score');
  });
});
