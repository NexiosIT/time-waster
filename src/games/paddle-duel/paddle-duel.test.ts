import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import { GAME_WIDTH } from '../../core/types';
import type { GameContext } from '../../core/types';
import game, {
  BOTTOM, MAX_PADDLE, MAX_SPEED, MAX_VY, MIN_PADDLE, PADDLE_H, PLAYER_FACE, SERVE_SPEED, SERVE_TICKS,
  STEP, TOP, WIN, covers, hitOffset, scoreOf, type DuelState,
} from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });
const run = (s: DuelState, c: GameContext, n: number) => {
  for (let i = 0; i < n && !s.over; i++) s = game.update(s, c);
  return s;
};
/** A state with the ball in play at a given position and velocity. */
const inPlay = (c: GameContext, ball: DuelState['ball'], extra: Partial<DuelState> = {}): DuelState =>
  ({ ...game.init(c), serve: 0, ball, ...extra });

/** Press-only bot: every `every` ticks, one press toward the ball (with jitter). */
function playMatch(seed: number, every: number, jitter: number, idle = false): DuelState {
  const c = ctx(seed);
  const noise = createRandom(seed + 999);
  let s = game.init(c);
  for (let t = 0; t < 100_000 && !s.over; t++) {
    if (!idle && t % every === 0) {
      const target = s.ball.y + (noise() - 0.5) * jitter - (PADDLE_H - 1) / 2;
      if (target < s.paddle - 1) s = game.onKey(s, 'up');
      else if (target > s.paddle + 1) s = game.onKey(s, 'down');
    }
    s = game.update(s, c);
  }
  return s;
}

describe('paddle-duel', () => {
  it('starts 0-0 with both paddles centred and the ball waiting to serve', () => {
    const s = game.init(ctx());
    expect(game.score(s)).toBe(0);
    expect(game.isOver(s)).toBe(false);
    expect([s.you, s.them]).toEqual([0, 0]);
    expect(s.serve).toBe(SERVE_TICKS);
    expect(s.ball.vx).toBe(-SERVE_SPEED); // first serve comes to you
  });

  it('up/down move the paddle one step per press, clamped, without mutating', () => {
    const s0 = game.init(ctx());
    const s1 = game.onKey(s0, 'up');
    expect(s1.paddle).toBe(s0.paddle - STEP);
    expect(s0.paddle).not.toBe(s1.paddle);
    expect(game.onKey(s0, 's').paddle).toBe(s0.paddle + STEP);
    let s = s0;
    for (let i = 0; i < 20; i++) s = game.onKey(s, 'up');
    expect(s.paddle).toBe(MIN_PADDLE);
    for (let i = 0; i < 20; i++) s = game.onKey(s, 'down');
    expect(s.paddle).toBe(MAX_PADDLE);
    expect(game.onKey(s0, 'left')).toBe(s0);
  });

  it('holds the ball during the serve countdown, then sets it moving', () => {
    const c = ctx();
    const s0 = game.init(c);
    const waiting = run(s0, c, SERVE_TICKS);
    expect(waiting.ball).toEqual(s0.ball);
    const moving = game.update(waiting, c);
    expect(moving.ball.x).toBeLessThan(s0.ball.x);
    expect(s0.serve).toBe(SERVE_TICKS);
  });

  it('bounces off the top and bottom walls', () => {
    const c = ctx();
    const up = game.update(inPlay(c, { x: 30, y: TOP + 0.2, vx: 0.5, vy: -0.5 }), c);
    expect(up.ball.vy).toBe(0.5);
    expect(up.ball.y).toBeGreaterThanOrEqual(TOP);
    const down = game.update(inPlay(c, { x: 30, y: BOTTOM - 0.2, vx: 0.5, vy: 0.5 }), c);
    expect(down.ball.vy).toBe(-0.5);
    expect(down.ball.y).toBeLessThanOrEqual(BOTTOM);
  });

  it('your paddle returns the ball faster, angled by where it hit', () => {
    const c = ctx();
    const paddle = 8;
    const centre = game.update(inPlay(c, { x: PLAYER_FACE + 0.3, y: 9.5, vx: -0.6, vy: 0 }, { paddle }), c);
    expect(centre.ball.vx).toBeCloseTo(0.6 + 0.07);
    expect(centre.ball.vy).toBeCloseTo(0);
    expect(centre.ball.x).toBeGreaterThan(PLAYER_FACE);
    expect(centre.rally).toBe(1);
    const edge = game.update(inPlay(c, { x: PLAYER_FACE + 0.3, y: 8, vx: -0.6, vy: 0 }, { paddle }), c);
    expect(edge.ball.vy).toBeLessThan(0);
  });

  it('a fast ball cannot tunnel through a paddle', () => {
    const c = ctx();
    const s = game.update(inPlay(c, { x: PLAYER_FACE + 0.1, y: 9, vx: -MAX_SPEED, vy: 0 }, { paddle: 8 }), c);
    expect(s.ball.vx).toBeGreaterThan(0);
    expect(s.them).toBe(0);
  });

  it('a miss gives the computer the point and re-serves toward you', () => {
    const c = ctx();
    let s = inPlay(c, { x: 4, y: 2, vx: -1, vy: 0 }, { paddle: MAX_PADDLE });
    for (let i = 0; i < 10 && s.them === 0; i++) s = game.update(s, c);
    expect([s.you, s.them]).toEqual([0, 1]);
    expect(s.serve).toBe(SERVE_TICKS);
    expect(s.ball.vx).toBeLessThan(0);
  });

  it('getting past the computer wins you the point and serves toward it', () => {
    const c = ctx();
    const s = run(inPlay(c, { x: GAME_WIDTH - 1.5, y: 9, vx: 1, vy: 0 }), c, 3);
    expect([s.you, s.them]).toEqual([1, 0]);
    expect(s.ball.vx).toBeGreaterThan(0);
  });

  it('ends at 7 and stops changing after that', () => {
    const c = ctx();
    const s = run(inPlay(c, { x: GAME_WIDTH - 1.5, y: 9, vx: 1, vy: 0 }, { you: WIN - 1, them: 3 }), c, 3);
    expect(game.isOver(s)).toBe(true);
    expect(game.update(s, c)).toBe(s);
    expect(game.onKey(s, 'up')).toBe(s);
  });

  it('scores 100 per point, plus 100 per point of margin when you win', () => {
    const base = game.init(ctx());
    expect(scoreOf({ ...base, you: 3, them: 7 })).toBe(300);
    expect(scoreOf({ ...base, you: 7, them: 4 })).toBe(1000);
    expect(scoreOf({ ...base, you: 7, them: 0 })).toBe(game.maxScore);
  });

  it('hitOffset and covers describe the paddle face', () => {
    expect(hitOffset(8, 9.5)).toBe(0);
    expect(hitOffset(8, 7)).toBe(-1);
    expect(hitOffset(8, 12)).toBe(1);
    expect(covers(8, 7.5)).toBe(true);
    expect(covers(8, 11.5)).toBe(true);
    expect(covers(8, 7.4)).toBe(false);
    expect(covers(8, 11.6)).toBe(false);
    expect(MAX_VY).toBeLessThan(1);
  });

  it('balance: standing still loses, a press-only tracking bot can win', () => {
    for (const seed of [1, 2, 3]) {
      const idle = playMatch(seed, 1, 0, true);
      expect(idle.them).toBe(WIN);
      const bot = playMatch(seed, 3, 3);
      expect(bot.over).toBe(true);
      expect(bot.you).toBe(WIN);
    }
  });

  it('draws inside the play area with single-width characters', () => {
    const screen = {
      width: 60, height: 20, clear() {},
      put(x: number, y: number, ch: string) {
        expect(ch).toHaveLength(1);
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(60);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(20);
      },
      text(x: number, y: number, s: string) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x + s.length).toBeLessThanOrEqual(60);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(20);
      },
    };
    const c = ctx();
    game.draw(game.init(c), screen);
    game.draw(run(game.init(c), c, 200), screen);
    game.draw({ ...game.init(c), you: WIN, over: true }, screen);
  });
});
