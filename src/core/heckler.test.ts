import { describe, it, expect } from 'vitest';
import { Heckler, CHECK_MS, FIRST_MS, GAP_MS, SHOW_MS, STUCK_MS } from './heckler';
import { AHEAD, ALL_LINES, BEHIND, IN_GAME, LEADER, NO_BEST, RUN_BEST, RUN_WORSE, START, STUCK, fill } from './heckles';
import { createRandom } from './random';

const base = { game: 'Worm', expectedMs: null as number | null };
const filled = (list: string[], score: number, best: number | string, time = '') =>
  list.map((l) => fill(l, { score, best, game: 'Worm', time }));

/** Feed ticks of 1 s play time; returns each new line as [second, text]. */
function play(h: Heckler, secs: number, score: (t: number) => number, best: number | null, extra: Partial<typeof base> = {}) {
  const seen: [number, string][] = [];
  let last: string | null = null;
  for (let t = 1; t <= secs; t++) {
    h.tick({ ...base, ...extra, nowMs: t * 1000, playedMs: t * 1000, score: score(t), best });
    const cur = h.current(t * 1000);
    if (cur && cur !== last) seen.push([t, cur]);
    last = cur;
  }
  return seen;
}

describe('Heckler', () => {
  it('opens every run with a jab a few seconds in', () => {
    const h = new Heckler(createRandom(1));
    h.startRun();
    const seen = play(h, FIRST_MS / 1000, (t) => t, 1000);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe(FIRST_MS / 1000);
    expect(filled(START, FIRST_MS / 1000, 1000)).toContain(seen[0][1]);
  });

  it('jabs when you are behind your best pace at a checkpoint', () => {
    const h = new Heckler(createRandom(1));
    h.startRun();
    const seen = play(h, CHECK_MS / 1000, () => 0, 1000);
    expect(seen.map((s) => s[0])).toEqual([FIRST_MS / 1000, CHECK_MS / 1000]);
    expect(filled(BEHIND, 0, 1000, '20s')).toContain(seen[1][1]);
  });

  it('a good run gets heckled too (ahead of your best pace)', () => {
    const h = new Heckler(() => 0.99);
    h.startRun();
    const seen = play(h, CHECK_MS / 1000, (t) => t * 10, 100);
    expect(filled(AHEAD, 200, 100, '20s')).toContain(seen[seen.length - 1][1]);
  });

  it('on pace (between behind and ahead) the checkpoint stays quiet', () => {
    const h = new Heckler(() => 0.99);
    h.startRun();
    // best 1000, unknown length → pace target 500; 60%–100% of it is "on pace"
    const seen = play(h, CHECK_MS / 1000, (t) => 380 + t, 1000);
    expect(seen.map((s) => s[0])).toEqual([FIRST_MS / 1000]);
  });

  it('uses the expected length when known', () => {
    const h = new Heckler(() => 0.99);
    h.startRun();
    // expected 200 s: at 20 s the target is 10% of 1000 = 100; 70 is on pace (≥ 60)
    const seen = play(h, CHECK_MS / 1000, (t) => 50 + t, 1000, { expectedMs: 200_000 });
    expect(seen.map((s) => s[0])).toEqual([FIRST_MS / 1000]);
  });

  it('jabs when the score has not moved for a while', () => {
    const h = new Heckler(() => 0); // the no-best chance never fires with rnd 0
    h.startRun();
    const seen = play(h, STUCK_MS / 1000, () => 5, null);
    expect(seen.map((s) => s[0])).toEqual([FIRST_MS / 1000, STUCK_MS / 1000]);
    expect(filled(STUCK, 5, '-', '20s')).toContain(seen[1][1]);
  });

  it('with no best yet, sometimes throws a generic line at a checkpoint', () => {
    const h = new Heckler(() => 0.99);
    h.startRun();
    const seen = play(h, CHECK_MS / 1000, (t) => t, null);
    expect(filled(NO_BEST, 20, '-', '20s')).toContain(seen[seen.length - 1][1]);
  });

  it('shows a line for SHOW_MS and keeps GAP_MS between lines', () => {
    const h = new Heckler(createRandom(2));
    h.startRun();
    const seen = play(h, 300, () => 0, 1000);
    expect(seen.length).toBeGreaterThan(5);
    for (let i = 1; i < seen.length; i++) expect((seen[i][0] - seen[i - 1][0]) * 1000).toBeGreaterThanOrEqual(GAP_MS);
    const h2 = new Heckler(createRandom(2));
    h2.startRun();
    play(h2, FIRST_MS / 1000, () => 0, 1000);
    expect(h2.current(FIRST_MS)).not.toBeNull();
    expect(h2.current(FIRST_MS + SHOW_MS)).toBeNull();
  });

  it('never fires while paused (play time frozen)', () => {
    const h = new Heckler(createRandom(3));
    h.startRun();
    for (let t = 1; t <= 300; t++) {
      h.tick({ ...base, nowMs: t * 1000, playedMs: FIRST_MS - 1000, score: 0, best: 1000 });
      expect(h.current(t * 1000)).toBeNull();
    }
  });

  it('startRun clears the previous run and opens with a new jab', () => {
    const h = new Heckler(createRandom(4));
    h.startRun();
    play(h, CHECK_MS / 1000, () => 0, 1000);
    h.startRun();
    expect(h.current(CHECK_MS)).toBeNull();
    // the new run's play time starts at 0 again, but the wall clock went on: use later times
    const seen: string[] = [];
    for (let t = 1; t <= FIRST_MS / 1000; t++) {
      const nowMs = (CHECK_MS / 1000 + GAP_MS / 1000 + t) * 1000;
      h.tick({ ...base, nowMs, playedMs: t * 1000, score: t, best: 1000 });
      const cur = h.current(nowMs);
      if (cur && !seen.includes(cur)) seen.push(cur);
    }
    expect(seen).toHaveLength(1);
  });

  it('run over: backhanded compliment on a new best, a comparison otherwise', () => {
    const h = new Heckler(createRandom(5));
    expect(filled(RUN_BEST, 3100, 3100)).toContain(h.runOver({ score: 3100, best: 3100, isBest: true, game: 'Worm' }));
    expect(filled(RUN_WORSE, 1240, 3100)).toContain(h.runOver({ score: 1240, best: 3100, isBest: false, game: 'Worm' }));
  });
});

describe('heckle lines', () => {
  const SWEARS = /\b(damn|hell|shit|crap|fuck\w*|ass|bullshit|piss\w*)\b/i;
  // Insults at the person and slurs are off limits; swearing about the playing is fine.
  const OFF_LIMITS = /\b(idiot|stupid|moron|loser|dumb\w*|retard\w*|cunt|bitch\w*|bastard|dick\w*|asshole|jerk|slut|whore|fag\w*|gay|ugly|fat)\b/i;
  const big = { score: 123456, best: 999999, game: 'Tank Duel', time: '45s', leader: 'octocat' };

  it('every template fills without leftover placeholders', () => {
    for (const l of ALL_LINES) {
      const out = fill(l, big);
      expect(out).not.toMatch(/[{}]/);
      expect(out.length).toBeLessThanOrEqual(90);
    }
  });

  it('in-game lines fit the top row of a 62-column window', () => {
    for (const l of IN_GAME) expect(fill(l, big).length, l).toBeLessThanOrEqual(62);
  });

  it('has plenty of lines, swears in about half of them, and never insults the person', () => {
    expect(ALL_LINES.length).toBeGreaterThanOrEqual(60);
    for (const list of [START, BEHIND, AHEAD, STUCK, NO_BEST, RUN_WORSE, RUN_BEST, LEADER]) {
      expect(list.length).toBeGreaterThanOrEqual(5);
    }
    for (const l of LEADER) expect(l).toContain('{leader}');
    const swearing = ALL_LINES.filter((l) => SWEARS.test(l)).length / ALL_LINES.length;
    expect(swearing).toBeGreaterThanOrEqual(0.45);
    expect(swearing).toBeLessThanOrEqual(0.65);
    for (const l of ALL_LINES) expect(l).not.toMatch(OFF_LIMITS);
  });
});
