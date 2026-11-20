import { describe, expect, test } from 'vitest';
import type { Game } from '../../src/core/types';
import galaxy from '../../src/games/galaxy/index';
import reflex from '../../src/games/reflex/index';
import { PlayController } from './controller';

// Score = ticks survived; over after 3 ticks; 'x' adds 100.
function fake(over: Partial<Game<number>> = {}): Game<number> {
  return {
    id: 'fake', title: 'Fake', description: '', tickMs: 100, controls: 'x boost',
    init: () => 0,
    onKey: (s, k) => (k === 'x' ? s + 100 : s),
    update: (s) => s + 1,
    draw: (s, screen) => screen.text(0, 0, `n=${s}`),
    score: (s) => s,
    isOver: (s) => s % 100 >= 3,
    ...over,
  };
}

function make(game: Game<any> = fake(), best: number | null = null) {
  const saved: number[] = [];
  let exits = 0;
  const c = new PlayController({ game, nowMs: 0, seed: () => 1, loadBest: () => best, saveBest: (n) => saved.push(n) });
  c.onExit = () => exits++;
  return { c, saved, exits: () => exits };
}
const run = (c: PlayController, from: number, to: number, step = 100) => { for (let t = from; t <= to; t += step) c.tick(t); };

describe('PlayController', () => {
  test('starts ready; Enter starts a run; other keys do nothing', () => {
    const { c } = make();
    expect(c.state).toBe('ready');
    expect(c.status()).toContain('Press Enter to start');
    c.key('x', 0);
    expect(c.state).toBe('ready');
    c.key('enter', 0);
    expect(c.state).toBe('playing');
  });

  test('while playing, keys go to the game and the frame shows its drawing', () => {
    const { c } = make();
    c.key('enter', 0);
    c.key('x', 0);
    run(c, 100, 100);
    expect(c.frame().get(0, 0).ch).toBe('n');
    expect(c.status()).toContain('Fake  Score 101');
    expect(c.status()).toContain('x boost  P pause · Esc end');
  });

  test('a finished run goes to results and saves a new best', () => {
    const { c, saved } = make(fake(), 1);
    c.key('enter', 0);
    run(c, 100, 300);
    expect(c.state).toBe('results');
    expect(c.result).toEqual({ score: 3, isBest: true });
    expect(saved).toEqual([3]);
  });

  test('a lower score is not a new best and is not saved', () => {
    const { c, saved } = make(fake(), 50);
    c.key('enter', 0);
    run(c, 100, 300);
    expect(c.result).toEqual({ score: 3, isBest: false });
    expect(saved).toEqual([]);
  });

  test('Esc ends a run early and still shows results', () => {
    const { c } = make();
    c.key('enter', 0);
    run(c, 100, 100);
    c.key('escape', 100);
    expect(c.state).toBe('results');
    expect(c.result?.score).toBe(1);
  });

  test('in results, Enter plays again and Esc exits', () => {
    const { c, exits } = make();
    c.key('enter', 0);
    run(c, 100, 300);
    c.key('enter', 300);
    expect(c.state).toBe('playing');
    run(c, 400, 600);
    c.key('escape', 600);
    expect(exits()).toBe(1);
  });

  test('keys are ignored while the name field has focus (Review Focus 1)', () => {
    const { c, exits } = make();
    c.key('enter', 0);
    run(c, 100, 300);
    c.nameFocused = true;
    for (const k of ['enter', 'escape', 'p', 'space', 'left', 'x']) c.key(k, 300);
    expect(c.state).toBe('results');
    expect(exits()).toBe(0);
  });

  test('a crashing game shows the crash and Enter restarts', () => {
    const { c } = make(fake({ update: () => { throw new Error('boom'); } }));
    c.key('enter', 0);
    run(c, 100, 100);
    expect(c.state).toBe('crashed');
    expect(c.status()).toContain('Fake crashed');
    c.key('enter', 100);
    expect(c.state).toBe('playing');
  });

  test('hiding the tab pauses a run and showing it resumes (Review Focus 4)', () => {
    const { c } = make();
    c.key('enter', 0);
    c.setHidden(true, 0);
    run(c, 100, 1000);
    expect(c.state).toBe('playing');
    c.setHidden(false, 1000);
    run(c, 1100, 1300);
    expect(c.state).toBe('results');
  });

  test('a run the player paused stays paused after the tab comes back', () => {
    const { c } = make();
    c.key('enter', 0);
    c.key('p', 0);
    c.setHidden(true, 0);
    c.setHidden(false, 0);
    run(c, 100, 1000);
    expect(c.state).toBe('playing');
    expect(c.status()).toContain('Score 0');
  });

  test('the real games run in the controller', () => {
    for (const g of [reflex, galaxy]) {
      const { c } = make(g);
      c.key('enter', 0);
      run(c, 50, 1000, 50);
      const b = c.frame();
      expect(b.width).toBe(60);
      expect(b.height).toBe(20);
      let drawn = 0;
      for (let y = 0; y < 20; y++) for (let x = 0; x < 60; x++) if (b.get(x, y).ch !== ' ') drawn++;
      expect(drawn).toBeGreaterThan(0);
    }
  });
});
