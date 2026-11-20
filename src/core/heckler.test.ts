import { describe, it, expect } from 'vitest';
import { Heckler, CHECK_MS, GAP_MS, SHOW_MS, STUCK_MS } from './heckler';
import { ALL_LINES, BEHIND, NO_BEST, RUN_BEST, RUN_WORSE, STUCK, fill } from './heckles';
import { createRandom } from './random';

const base = { game: 'Worm', expectedMs: null as number | null };

/** Feed ticks of 1 s play time with the given score function; returns lines seen (deduped by start). */
function play(h: Heckler, secs: number, score: (t: number) => number, best: number | null, extra: Partial<typeof base> = {}) {
  const seen: string[] = [];
  let last: string | null = null;
  for (let t = 1; t <= secs; t++) {
    const nowMs = t * 1000;
    h.tick({ ...base, ...extra, nowMs, playedMs: t * 1000, score: score(t), best });
    const cur = h.current(nowMs);
    if (cur && cur !== last) seen.push(cur);
    last = cur;
  }
  return seen;
}

describe('Heckler', () => {
  it('jabs when you are behind your best pace at a checkpoint, not when on pace', () => {
    const behind = new Heckler(createRandom(1));
    behind.startRun();
    expect(play(behind, CHECK_MS / 1000, () => 10, 1000)).toHaveLength(1);

    const onPace = new Heckler(createRandom(1));
    onPace.startRun();
    // best 1000, unknown length → target 500; score climbs steadily past 60% of it
    expect(play(onPace, CHECK_MS / 1000, (t) => t * 20, 1000)).toHaveLength(0);
  });

  it('uses the expected length when known', () => {
    const h = new Heckler(createRandom(1));
    h.startRun();
    // expected 450 s: at 45 s the target is 10% of 1000 = 100, so 70 is enough (≥ 60 of it)
    expect(play(h, CHECK_MS / 1000, (t) => t * 2, 1000, { expectedMs: 450_000 })).toHaveLength(0);
  });

  it('jabs when the score has not moved for a while', () => {
    const h = new Heckler(() => 0); // no-best generic lines never fire with rnd 0 → only "stuck"
    h.startRun();
    const seen = play(h, STUCK_MS / 1000, () => 5, null);
    expect(seen).toHaveLength(1);
    expect(STUCK.some((l) => seen[0] === fill(l, { score: 5, best: '-', game: 'Worm', time: '45s' }))).toBe(true);
  });

  it('with no best yet, sometimes throws a generic line at a checkpoint', () => {
    const h = new Heckler(() => 0.99);
    h.startRun();
    const seen = play(h, CHECK_MS / 1000, (t) => t, null);
    expect(seen).toHaveLength(1);
    expect(NO_BEST.map((l) => fill(l, { score: 45, best: '-', game: 'Worm', time: '45s' }))).toContain(seen[0]);
  });

  it('shows a line for SHOW_MS and keeps GAP_MS between lines', () => {
    const h = new Heckler(createRandom(2));
    h.startRun();
    // stuck at 0 with a best: both triggers keep wanting to fire
    const times: number[] = [];
    let last: string | null = null;
    for (let t = 1; t <= 200; t++) {
      h.tick({ ...base, nowMs: t * 1000, playedMs: t * 1000, score: 0, best: 1000 });
      const cur = h.current(t * 1000);
      if (cur && cur !== last) times.push(t);
      last = cur;
    }
    for (let i = 1; i < times.length; i++) expect((times[i] - times[i - 1]) * 1000).toBeGreaterThanOrEqual(GAP_MS);
    const h2 = new Heckler(createRandom(2));
    h2.startRun();
    play(h2, CHECK_MS / 1000, () => 0, 1000);
    expect(h2.current(CHECK_MS)).not.toBeNull();
    expect(h2.current(CHECK_MS + SHOW_MS)).toBeNull();
  });

  it('never fires while paused (play time frozen)', () => {
    const h = new Heckler(createRandom(3));
    h.startRun();
    for (let t = 1; t <= 300; t++) {
      h.tick({ ...base, nowMs: t * 1000, playedMs: 10_000, score: 0, best: 1000 });
      expect(h.current(t * 1000)).toBeNull();
    }
  });

  it('startRun clears the previous run', () => {
    const h = new Heckler(createRandom(4));
    h.startRun();
    play(h, CHECK_MS / 1000, () => 0, 1000);
    h.startRun();
    expect(h.current(CHECK_MS)).toBeNull();
  });

  it('run over: backhanded compliment on a new best, a comparison otherwise', () => {
    const h = new Heckler(createRandom(5));
    const best = h.runOver({ score: 3100, best: 3100, isBest: true, game: 'Worm' });
    expect(RUN_BEST.map((l) => fill(l, { score: 3100, best: 3100, game: 'Worm', time: '' }))).toContain(best);
    const worse = h.runOver({ score: 1240, best: 3100, isBest: false, game: 'Worm' });
    expect(RUN_WORSE.map((l) => fill(l, { score: 1240, best: 3100, game: 'Worm', time: '' }))).toContain(worse);
  });
});

describe('heckle lines', () => {
  const SWEARS = /\b(damn|hell|shit|crap)\b/i;
  const HARSH = /\b(fuck|cunt|bitch|bastard|ass(hole)?|dick|retard|idiot|stupid|loser)\b/i;

  it('every template fills without leftover placeholders', () => {
    for (const l of ALL_LINES) {
      const out = fill(l, { score: 12, best: 34, game: 'Worm', time: '45s' });
      expect(out).not.toMatch(/[{}]/);
      expect(out.length).toBeLessThanOrEqual(80);
    }
  });

  it('has enough lines, about 1 in 4 with a mild swear, and nothing harsh', () => {
    expect(ALL_LINES.length).toBeGreaterThanOrEqual(40);
    for (const list of [BEHIND, STUCK, NO_BEST, RUN_WORSE, RUN_BEST]) expect(list.length).toBeGreaterThanOrEqual(5);
    const swearing = ALL_LINES.filter((l) => SWEARS.test(l)).length;
    expect(swearing / ALL_LINES.length).toBeGreaterThanOrEqual(0.2);
    expect(swearing / ALL_LINES.length).toBeLessThanOrEqual(0.35);
    for (const l of ALL_LINES) expect(l).not.toMatch(HARSH);
  });
});
