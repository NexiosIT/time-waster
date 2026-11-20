import { describe, expect, it } from 'vitest';
import { createRandom } from '../../core/random';
import { GAME_HEIGHT, GAME_WIDTH } from '../../core/types';
import type { GameContext } from '../../core/types';
import game, { aimPath, aiShot, explode, makeGround, trace, MAX_HP, PREVIEW_TICKS, type DuelState } from './index';

const ctx = (seed = 1): GameContext => ({ random: createRandom(seed), elapsedMs: 0 });

/** A calm, flat test field: ground top at row 15, player at x 10, CPU at x 50. */
function flat(over: Partial<DuelState> = {}): DuelState {
  const s = game.init(ctx());
  return {
    ...s,
    ground: Array.from({ length: GAME_WIDTH }, () => 15),
    player: { ...s.player, x: 10 },
    cpu: { ...s.cpu, x: 50 },
    wind: 0,
    ...over,
  };
}

/** Run update until the predicate holds (or give up). */
function runUntil(s: DuelState, c: GameContext, done: (s: DuelState) => boolean, max = 3000): DuelState {
  for (let i = 0; i < max && !done(s); i++) s = game.update(s, c);
  return s;
}

describe('tank duel', () => {
  it('starts aiming, full health, score 0, tanks on the ground on opposite sides', () => {
    const s = game.init(ctx());
    expect(s.phase.kind).toBe('aim');
    expect(s.player.hp).toBe(MAX_HP);
    expect(s.cpu.hp).toBe(MAX_HP);
    expect(game.score(s)).toBe(0);
    expect(game.isOver(s)).toBe(false);
    expect(s.player.x).toBeLessThan(GAME_WIDTH / 3);
    expect(s.cpu.x).toBeGreaterThan((GAME_WIDTH * 2) / 3);
    expect(s.ground).toHaveLength(GAME_WIDTH);
  });

  it('generates hilly ground inside the field, flat under each tank', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = makeGround(createRandom(seed));
      expect(Math.min(...g)).toBeGreaterThanOrEqual(5);
      expect(Math.max(...g)).toBeLessThan(GAME_HEIGHT);
      const s = game.init(ctx(seed));
      for (const t of [s.player, s.cpu]) {
        expect(s.ground[t.x - 1]).toBe(s.ground[t.x]);
        expect(s.ground[t.x + 1]).toBe(s.ground[t.x]);
      }
    }
  });

  it('arrows aim and set power within limits, without mutating the input', () => {
    const s = game.init(ctx());
    const a = game.onKey(s, 'left');
    expect(a.player.angle).toBe(s.player.angle + 2);
    expect(game.onKey(s, 'right').player.angle).toBe(s.player.angle - 2);
    expect(game.onKey(s, 'up').player.power).toBe(s.player.power + 2);
    expect(game.onKey(s, 'down').player.power).toBe(s.player.power - 2);
    expect(s.player.angle).toBe(45);
    let t = s;
    for (let i = 0; i < 200; i++) t = game.onKey(game.onKey(t, 'left'), 'up');
    expect(t.player.angle).toBe(180);
    expect(t.player.power).toBe(100);
    for (let i = 0; i < 200; i++) t = game.onKey(game.onKey(t, 'right'), 'down');
    expect(t.player.angle).toBe(0);
    expect(t.player.power).toBe(5);
  });

  it('space fires a shell; keys do nothing while it flies', () => {
    const s = game.onKey(game.init(ctx()), 'space');
    expect(s.phase.kind).toBe('flight');
    expect(game.onKey(s, 'left')).toBe(s);
    expect(game.onKey(s, 'space')).toBe(s);
  });

  it('after your shot lands, the computer aims and shoots back, then it is your turn', () => {
    const c = ctx();
    let s = game.onKey(flat(), 'space');
    const seen = new Set<string>();
    s = runUntil(s, c, (x) => {
      seen.add(x.phase.kind);
      return x.phase.kind === 'aim' || x.over;
    });
    expect(seen).toContain('flight');
    expect(seen).toContain('boom');
    expect(seen).toContain('cpuWait');
    expect(s.cpuShots).toBe(1);
    expect(s.phase.kind).toBe('aim');
  });

  it('trace finds where a shot lands, and is pushed by wind', () => {
    const s = flat();
    const calm = trace(s, 'player', 45, 60)!;
    expect(calm).not.toBeNull();
    expect(calm.x).toBeGreaterThan(s.player.x + 5);
    expect(calm.y).toBeGreaterThanOrEqual(14);
    const windy = trace({ ...s, wind: 0.006 }, 'player', 45, 60)!;
    expect(windy.x).toBeGreaterThan(calm.x + 2);
  });

  it('a shot off the side of the field lands nowhere', () => {
    expect(trace(flat(), 'player', 170, 100)).toBeNull();
  });

  it('an explosion digs a crater and damages a tank close by, not one far away', () => {
    const s = flat({ cpu: { ...flat().cpu, x: 33 } });
    const after = explode(s, 30.5, 15, 'player');
    expect(after.ground[30]).toBeGreaterThan(15);
    expect(after.ground[20]).toBe(15);
    expect(after.cpu.hp).toBeLessThan(MAX_HP);
    expect(after.player.hp).toBe(MAX_HP);
    expect(after.score).toBe(MAX_HP - after.cpu.hp); // damage you deal is your score
    expect(s.ground[30]).toBe(15); // input untouched
  });

  it('a direct hit does much more damage than a near miss', () => {
    const s = flat({ cpu: { ...flat().cpu, x: 30 } });
    const direct = MAX_HP - explode(s, 30.5, 14.5, 'player').cpu.hp;
    const near = MAX_HP - explode(s, 34.5, 15, 'player').cpu.hp;
    expect(direct).toBeGreaterThanOrEqual(40);
    expect(near).toBeLessThan(direct);
  });

  it('the computer aims well with no error: its best shot lands near you', () => {
    const s = flat();
    const shot = aiShot(s, () => 0.5); // 0.5 = no random error
    const hit = trace(s, 'cpu', shot.angle, shot.power)!;
    expect(Math.abs(hit.x - (s.player.x + 0.5))).toBeLessThan(3);
    expect(shot.angle).toBeGreaterThan(90); // it shoots to the left
  });

  it('the computer gets more accurate with every shot in a round', () => {
    const errorAt = (cpuShots: number) => {
      const s = flat({ cpuShots });
      const exact = aiShot(s, () => 0.5).power;
      return Math.abs(aiShot(s, () => 1).power - exact);
    };
    expect(errorAt(0)).toBeGreaterThan(errorAt(2));
  });

  it('destroying the computer scores a bonus and starts a new round', () => {
    const s = flat({ cpu: { ...flat().cpu, hp: 0 }, score: 40, phase: { kind: 'boom', owner: 'player', x: 50, y: 15, t: 1 } });
    const n = game.update(s, ctx());
    expect(n.round).toBe(2);
    expect(n.cpu.hp).toBe(MAX_HP);
    expect(n.phase.kind).toBe('aim');
    expect(game.score(n)).toBeGreaterThanOrEqual(140);
    expect(game.isOver(n)).toBe(false);
  });

  it('the run is over when your tank is destroyed', () => {
    const s = flat({ player: { ...flat().player, hp: 0 }, phase: { kind: 'boom', owner: 'cpu', x: 10, y: 15, t: 1 } });
    expect(game.isOver(game.update(s, ctx()))).toBe(true);
  });

  it('while aiming, a guide shows the start of the shell path, which follows angle and power', () => {
    const s = flat();
    const path = aimPath(s);
    expect(path.length).toBeGreaterThan(3);
    expect(path.length).toBeLessThanOrEqual(PREVIEW_TICKS);
    expect(Math.abs(path[0].x - (s.player.x + 0.5))).toBeLessThan(3); // starts at the barrel
    expect(path[path.length - 1].x).toBeGreaterThan(path[0].x);       // heads right at 45 degrees
    const steep = aimPath(game.onKey(game.onKey(game.onKey(s, 'left'), 'left'), 'left'));
    expect(steep).not.toEqual(path);
    const strong = aimPath(game.onKey(s, 'up'));
    expect(strong[strong.length - 1].x).toBeGreaterThan(path[path.length - 1].x);
  });

  it('the guide matches the real flight, and is not drawn once the shell is away', () => {
    const c = ctx();
    const s = flat();
    const path = aimPath(s);
    let f = game.onKey(s, 'space');
    for (let i = 0; i < 4; i++) f = game.update(f, c);
    if (f.phase.kind !== 'flight') throw new Error('expected flight');
    const sh = f.phase.shell;
    expect(path.some((p) => Math.abs(p.x - sh.x) < 0.01 && Math.abs(p.y - sh.y) < 0.01)).toBe(true);
    const dots = (st: DuelState) => {
      let n = 0;
      game.draw(st, { width: 60, height: 20, clear() {}, text() {}, put: (_x, _y, ch, col) => { if (ch === '·' && col === 'cyan') n++; } });
      return n;
    };
    expect(dots(s)).toBeGreaterThan(0);
    expect(dots(f)).toBe(0);
  });

  it('draws terrain, both tanks and the HUD', () => {
    const s = flat();
    const cells = new Map<string, string>();
    game.draw(s, {
      width: 60, height: 20, clear() {},
      put: (x, y, ch) => { cells.set(`${x},${y}`, ch); },
      text: (x, y, str) => { [...str].forEach((ch, i) => cells.set(`${x + i},${y}`, ch)); },
    });
    expect(cells.get('5,15')).toBe('█');
    expect(cells.get('10,14')).toBe('█'); // player body
    expect(cells.get('50,14')).toBe('█'); // cpu body
    const hud = Array.from({ length: 60 }, (_, x) => cells.get(`${x},0`) ?? ' ').join('');
    expect(hud).toContain('YOU 100');
    expect(hud).toContain('CPU 100');
  });
});
