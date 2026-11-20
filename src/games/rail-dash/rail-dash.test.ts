import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import type { GameContext } from '../../core/types';
import game, { PLAYER_ROW, ACTION_TICKS, stepTicks, type DashState, type Thing } from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });

/** A state with nothing on the track and no wave coming soon, plus the given things. */
function clear(things: Thing[] = [], over: Partial<DashState> = {}): DashState {
  return { ...game.init(ctx()), things, nextWave: 1000, ...over };
}

/** Advance exactly one scroll step (stepTicks ticks). */
function step(s: DashState, c: GameContext): DashState {
  const n = stepTicks(s.distance);
  for (let i = 0; i < n; i++) s = game.update(s, c);
  return s;
}

describe('rail dash', () => {
  it('starts in the middle lane, running, score 0', () => {
    const s = game.init(ctx());
    expect(s.lane).toBe(1);
    expect(game.score(s)).toBe(0);
    expect(game.isOver(s)).toBe(false);
  });

  it('left and right switch lanes within the three lanes, without mutating input', () => {
    const s = clear();
    expect(game.onKey(s, 'left').lane).toBe(0);
    expect(game.onKey(game.onKey(s, 'left'), 'left').lane).toBe(0);
    expect(game.onKey(game.onKey(s, 'right'), 'right').lane).toBe(2);
    expect(s.lane).toBe(1);
  });

  it('you cannot switch into the side of a train', () => {
    const s = clear([{ kind: 'train', lane: 0, y: PLAYER_ROW - 2, len: 5 }]);
    expect(game.onKey(s, 'left').lane).toBe(1);
  });

  it('the track scrolls one row per step and distance is the score', () => {
    const c = ctx();
    const s = clear([{ kind: 'coin', lane: 0, y: 3, len: 1 }]);
    const n = step(s, c);
    expect(n.things[0].y).toBe(4);
    expect(n.distance).toBe(1);
    expect(game.score(n)).toBe(1);
  });

  it('running into a train ends the run', () => {
    const c = ctx();
    const s = clear([{ kind: 'train', lane: 1, y: PLAYER_ROW - 5, len: 5 }]);
    expect(game.isOver(step(s, c))).toBe(true);
  });

  it('a low fence ends the run unless you jump it', () => {
    const c = ctx();
    const s = clear([{ kind: 'low', lane: 1, y: PLAYER_ROW - 1, len: 1 }]);
    expect(game.isOver(step(s, c))).toBe(true);
    const jumped = step(game.onKey(s, 'up'), c);
    expect(game.isOver(jumped)).toBe(false);
    expect(jumped.air).toBeGreaterThan(0);
  });

  it('an overhead bar ends the run unless you roll under it', () => {
    const c = ctx();
    const s = clear([{ kind: 'high', lane: 1, y: PLAYER_ROW - 1, len: 1 }]);
    expect(game.isOver(step(s, c))).toBe(true);
    expect(game.isOver(step(game.onKey(s, 'down'), c))).toBe(false);
    expect(game.isOver(step(game.onKey(s, 'up'), c))).toBe(true); // jumping doesn't clear a bar
  });

  it('pressing up again in the air restarts the jump', () => {
    const c = ctx();
    let s = game.onKey(clear(), 'up');
    for (let i = 0; i < 15; i++) s = game.update(s, c);
    expect(game.onKey(s, 'up').air).toBe(ACTION_TICKS);
  });

  it('a jump or roll lasts ACTION_TICKS ticks (about 0.9 s) at any speed, and one replaces the other', () => {
    expect(ACTION_TICKS * game.tickMs).toBeGreaterThanOrEqual(800);
    const c = ctx();
    for (const distance of [0, 2000]) {
      let s = game.onKey(clear([], { distance }), 'up');
      expect(s.air).toBe(ACTION_TICKS);
      for (let i = 0; i < ACTION_TICKS - 1; i++) s = game.update(s, c);
      expect(s.air).toBe(1);
      expect(game.update(s, c).air).toBe(0);
    }
    const r = game.onKey(game.onKey(clear(), 'up'), 'down');
    expect(r.air).toBe(0);
    expect(r.roll).toBe(ACTION_TICKS);
  });

  it('a ramp takes you up onto the train behind it, and you ride it safely', () => {
    const c = ctx();
    let s = clear([
      { kind: 'ramp', lane: 1, y: PLAYER_ROW - 1, len: 1 },
      { kind: 'train', lane: 1, y: PLAYER_ROW - 6, len: 5 },
    ]);
    s = step(s, c);
    expect(s.up).toBe(true);
    for (let i = 0; i < 5; i++) s = step(s, c);
    expect(game.isOver(s)).toBe(false);
    expect(s.up).toBe(true);
  });

  it('when the train ends you drop back to the ground', () => {
    const c = ctx();
    let s = clear([{ kind: 'train', lane: 1, y: PLAYER_ROW - 1, len: 2 }], { up: true });
    s = step(s, c);
    expect(s.up).toBe(true);
    s = step(step(s, c), c);
    expect(s.up).toBe(false);
    expect(game.isOver(s)).toBe(false);
  });

  it('a jump carries you across a gap to the next train', () => {
    const c = ctx();
    let s = clear([
      { kind: 'train', lane: 1, y: PLAYER_ROW, len: 1 },        // under you now, ends next row
      { kind: 'train', lane: 1, y: PLAYER_ROW - 5, len: 3 },    // the next one, 2 rows of gap
    ], { up: true });
    s = game.onKey(s, 'up');
    for (let i = 0; i < 5; i++) s = step(s, c);
    expect(game.isOver(s)).toBe(false);
    expect(s.up).toBe(true);
  });

  it('jumping into the front of a train without a ramp still ends the run', () => {
    const c = ctx();
    const s = game.onKey(clear([{ kind: 'train', lane: 1, y: PLAYER_ROW - 5, len: 5 }]), 'up');
    expect(game.isOver(step(s, c))).toBe(true);
  });

  it('on a roof, fences and bars pass underneath', () => {
    const c = ctx();
    const s = clear([
      { kind: 'train', lane: 1, y: PLAYER_ROW - 6, len: 8 },
      { kind: 'low', lane: 1, y: PLAYER_ROW - 1, len: 1 },
      { kind: 'high', lane: 1, y: PLAYER_ROW - 2, len: 1 },
    ], { up: true });
    expect(game.isOver(step(step(s, c), c))).toBe(false);
  });

  it('on a roof you can step across to the next train, but not from the ground', () => {
    const trains: Thing[] = [
      { kind: 'train', lane: 1, y: PLAYER_ROW - 2, len: 5 },
      { kind: 'train', lane: 0, y: PLAYER_ROW - 2, len: 5 },
    ];
    expect(game.onKey(clear(trains, { up: true }), 'left').lane).toBe(0);
    expect(game.onKey(clear(trains.slice(1)), 'left').lane).toBe(1);
  });

  it('ramps only appear directly in front of a train', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const c = ctx(seed);
      let s = game.init(c);
      let ramps = 0;
      for (let i = 0; i < 3000; i++) {
        s = { ...game.update(s, c), over: false };
        for (const r of s.things.filter((t) => t.kind === 'ramp')) {
          ramps++;
          expect(s.things.some((t) => t.kind === 'train' && t.lane === r.lane && t.y + t.len === r.y)).toBe(true);
        }
      }
      expect(ramps).toBeGreaterThan(0);
    }
  });

  it('coins in your lane are collected for 10 points', () => {
    const c = ctx();
    const s = clear([{ kind: 'coin', lane: 1, y: PLAYER_ROW - 1, len: 1 }, { kind: 'coin', lane: 0, y: PLAYER_ROW - 1, len: 1 }]);
    const n = step(s, c);
    expect(n.coins).toBe(1);
    expect(game.score(n)).toBe(1 + 10);
    expect(n.things.filter((t) => t.kind === 'coin')).toHaveLength(1);
  });

  it('the track speeds up with distance', () => {
    expect(stepTicks(0)).toBeGreaterThan(stepTicks(600));
    expect(stepTicks(100000)).toBeGreaterThanOrEqual(1);
  });

  it('there is always a lane without a train, on every row, as far as you run', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const c = ctx(seed);
      let s = game.init(c);
      for (let i = 0; i < 2500; i++) {
        s = { ...game.update(s, c), over: false, lane: 1, air: 0, roll: 0 }; // keep running regardless
        for (let row = 0; row < 20; row++) {
          const blocked = [0, 1, 2].filter((lane) =>
            s.things.some((t) => t.kind === 'train' && t.lane === lane && row >= t.y && row < t.y + t.len));
          expect(blocked.length).toBeLessThan(3);
        }
      }
    }
  });

  it('a careful runner survives a long way (the track is always fair)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const c = ctx(seed);
      let s = game.init(c);
      for (let i = 0; i < 6000 && !s.over; i++) {
        s = autopilot(s);
        s = game.update(s, c);
      }
      expect(s.over).toBe(false);
      expect(s.distance).toBeGreaterThan(500);
    }
  });

  it('draws lanes, the runner, things on the track and the legend', () => {
    const s = clear([
      { kind: 'train', lane: 0, y: 5, len: 3 },
      { kind: 'low', lane: 1, y: 8, len: 1 },
      { kind: 'high', lane: 2, y: 9, len: 1 },
      { kind: 'coin', lane: 1, y: 12, len: 1 },
      { kind: 'ramp', lane: 0, y: 8, len: 1 },
    ]);
    const rows = Array.from({ length: 20 }, () => Array<string>(60).fill(' '));
    game.draw(s, {
      width: 60, height: 20, clear() {},
      put: (x, y, ch) => { if (rows[y]) rows[y][x] = ch; },
      text: (x, y, str) => { [...str].forEach((ch, i) => { if (rows[y]) rows[y][x + i] = ch; }); },
    });
    const all = rows.map((r) => r.join('')).join('\n');
    for (const ch of ['█', '═', '▀', '●', '▲', '^']) expect(all).toContain(ch);
    expect(all).toContain('ramp');
    expect(all).toContain('jump');
    expect(all).toContain('roll');
  });
});

/** Test helper: a simple player that looks ahead and dodges. */
function autopilot(state: DashState): DashState {
  let s = state;
  const ahead = (lane: number, from: number, to: number) =>
    s.things.filter((t) => t.lane === lane && t.kind !== 'coin' && t.y + t.len - 1 >= from && t.y <= to);
  const trainSoon = (lane: number) => ahead(lane, PLAYER_ROW - 14, PLAYER_ROW).some((t) => t.kind === 'train');
  // jump or roll for a fence or bar on (or about to reach) the runner's row in this lane
  const brace = (lane: number) => {
    const b = ahead(lane, PLAYER_ROW - 1, PLAYER_ROW).find((t) => t.kind !== 'train');
    const enough = 2 * stepTicks(s.distance) + 1; // still in the air (or rolling) when it gets here
    if (b?.kind === 'low' && s.air < enough) s = game.onKey(s, 'up');
    if (b?.kind === 'high' && s.roll < enough) s = game.onKey(s, 'down');
  };
  if (trainSoon(s.lane)) {
    for (const target of [0, 1, 2].sort((a, b) => Math.abs(a - s.lane) - Math.abs(b - s.lane))) {
      if (trainSoon(target)) continue;
      const before = s;
      for (let lane = Math.min(s.lane, target); lane <= Math.max(s.lane, target); lane++) brace(lane);
      let t = s;
      while (t.lane !== target) {
        const moved = game.onKey(t, target < t.lane ? 'left' : 'right');
        if (moved.lane === t.lane) break;
        t = moved;
      }
      if (t.lane === target) { s = t; break; }
      s = before;
    }
  }
  brace(s.lane);
  return s;
}
