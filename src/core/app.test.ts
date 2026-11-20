import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { App } from './app';
import { loadScores } from './scores';
import { addRun, loadRuns } from './runs';
import type { ClaudeEvent } from './events';
import type { Game } from './types';

function fake(id: string, title: string, over: Partial<Game<number>> = {}): Game<number> {
  return {
    id, title, description: '', tickMs: 100, controls: 'arrows',
    init: () => 0,
    onKey: (s) => s,
    update: (s) => s + 1,
    draw: (s, screen) => screen.text(0, 0, `n=${s}`),
    score: (s) => s,
    isOver: (s) => s >= 3,
    ...over,
  };
}

let dir: string, file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-')); file = path.join(dir, 'scores.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const rows = (app: App, cols = 80, h = 30, now = 0) => {
  const b = app.render(cols, h, now);
  return Array.from({ length: h }, (_, y) => b.rowText(y));
};
const has = (r: string[], s: string) => r.some((l) => l.includes(s));
const mk = (games: Game<any>[], extra = {}) => new App({ games, scoresFile: file, nowMs: 0, seed: 1, ...extra });
function play(app: App, from = 100, to = 1000) { for (let t = from; t <= to; t += 100) app.tick(t); }

describe('App', () => {
  describe('Claude task clock in the menu', () => {
    const at = (ms: number) => new Date(ms).toISOString();
    const start = (ms = 0): ClaudeEvent => ({ type: 'start', at: at(ms), project: 'p' });
    const est = (minutes: number, ms = 0): ClaudeEvent => ({ type: 'estimate', minutes, at: at(ms), project: 'p' });
    const sized = () => [
      fake('a', 'Alpha', { length: { kind: 'timed', minutes: 1 } }),
      fake('b', 'Beta', { length: { kind: 'open', minutes: 2 } }),
      fake('g', 'Gamma', { length: { kind: 'rounds', minutes: 10 } }),
    ];
    const line = (r: string[], s: string) => r.find((l) => l.includes(s) && l.includes('Best ')) ?? '';

    it('start + estimate shows time left, stars the suggestion and pre-selects it', () => {
      const app = mk(sized());
      app.onEvent(start(), 0);
      app.onEvent(est(6), 0);
      const r = rows(app, 62, 23, 0);
      expect(r[3]).toContain('Claude ~6 min left · suggested: Beta (~3 min, new)');
      expect(line(r, 'Beta')).toContain('★');
      expect(line(r, 'Alpha')).not.toContain('★');
      app.key('enter', 0);
      expect(rows(app)[29]).toContain('Beta  Score 0');
    });

    it('start alone shows estimating; done clears it and shows the banner', () => {
      const app = mk(sized());
      app.onEvent(start(), 0);
      expect(has(rows(app, 62, 23, 0), 'Claude: estimating…')).toBe(true);
      app.onEvent({ type: 'done', at: at(1000), project: 'p' }, 1000);
      const r = rows(app, 62, 23, 1000);
      expect(r[0]).toContain('✓ Claude is done');
      expect(r[3].trim()).toBe('');
    });

    it('start and estimate never reach the banner', () => {
      const app = mk(sized());
      app.onEvent(start(), 0);
      expect(rows(app, 62, 23, 0)[0].trim()).toBe('');
      app.onEvent(est(6), 0);
      const r = rows(app, 62, 23, 0);
      expect(r[0].trim()).toBe('');
      expect(r[22]).not.toContain('Claude');
    });

    it('replay feeds the task clock only', () => {
      const app = mk(sized());
      app.replay([start(), est(6)], 0);
      const r = rows(app, 62, 23, 0);
      expect(has(r, 'Claude ~6 min left')).toBe(true);
      expect(r[0].trim()).toBe('');
    });

    it('7 min after a 5 min estimate shows running over and no star', () => {
      const app = mk(sized());
      app.onEvent(start(), 0);
      app.onEvent(est(5), 0);
      const r = rows(app, 62, 23, 7 * 60_000);
      expect(has(r, 'Claude is running over')).toBe(true);
      expect(r.join('\n')).not.toContain('★');
    });

    it('a new open game shows NEW and (est.); after 3 runs (you) and no NEW', () => {
      const rf = path.join(dir, 'runs.json');
      const app = mk([fake('b', 'Beta', { length: { kind: 'open', minutes: 2 } })], { runsFile: rf });
      let l = line(rows(app, 62, 23), 'Beta');
      expect(l).toContain('~3 min (est.)');
      expect(l).toContain('NEW');
      for (let i = 0; i < 3; i++) {
        app.key('enter', 0);
        play(app, 100, 300);
        app.key('escape', 300);
      }
      l = line(rows(app, 62, 23), 'Beta');
      expect(l).toContain('~1 min (you)');
      expect(l).not.toContain('NEW');
    });

    it('timed game shows its fixed length; game without length shows none', () => {
      const app = mk([fake('a', 'Alpha', { length: { kind: 'timed', minutes: 1 } }), fake('d', 'Delta')]);
      const r = rows(app, 62, 23);
      expect(line(r, 'Alpha')).toMatch(/ 1 min /);
      expect(line(r, 'Alpha')).not.toContain('~');
      expect(line(r, 'Delta')).not.toContain('min');
    });

    it('runs from the runs file are read at startup', () => {
      const rf = path.join(dir, 'runs.json');
      for (let i = 0; i < 3; i++) addRun(rf, 'b', 120_000);
      const app = mk([fake('b', 'Beta', { length: { kind: 'open', minutes: 2 } })], { runsFile: rf });
      expect(line(rows(app, 62, 23), 'Beta')).toContain('~2 min (you)');
    });

    it('a later tick without events does not move the cursor back', () => {
      const app = mk(sized());
      app.onEvent(start(), 0);
      app.onEvent(est(6), 0);
      app.key('up', 0); // Beta -> Alpha
      app.tick(60_000);
      rows(app, 62, 23, 60_000);
      app.tick(120_000);
      app.key('enter', 120_000);
      expect(rows(app)[29]).toContain('Alpha  Score 0');
    });

    it('entering the menu pre-selects the suggestion', () => {
      const app = mk(sized());
      app.onEvent(start(), 0);
      app.onEvent(est(6), 0);
      app.key('up', 0); // Alpha
      app.key('enter', 0);
      app.key('escape', 0); // ends run, back to the menu
      app.key('escape', 0);
      app.key('enter', 0);
      expect(rows(app)[29]).toContain('Beta  Score 0');
    });

    it('nothing suggested leaves the cursor alone', () => {
      const app = mk(sized());
      app.key('down', 0); app.key('down', 0); // Gamma
      app.onEvent(start(), 0);
      app.onEvent(est(0.5), 0); // nothing fits
      app.key('enter', 0);
      expect(rows(app)[29]).toContain('Gamma  Score 0');
    });

    it('menu fits the 62x23 minimum without overflowing', () => {
      const long = 'L'.repeat(40);
      const app = mk([fake('z', long, { length: { kind: 'open', minutes: 200 } })]);
      app.onEvent(start(), 0);
      app.onEvent(est(999), 0);
      const r = rows(app, 62, 23, 0);
      expect(r.every((l) => [...l].length === 62)).toBe(true);
      expect(line(r, 'Best -')).toContain('★');
    });
  });

  describe('run recording', () => {
    it('records a natural end with the played time', () => {
      const rf = path.join(dir, 'runs.json');
      const app = mk([fake('a', 'Alpha')], { runsFile: rf });
      app.key('enter', 0);
      play(app, 100, 300);
      expect(loadRuns(rf).a.map((e) => e.ms)).toEqual([300]);
    });

    it('records nothing for Esc, quit() or a crash', () => {
      const rf = path.join(dir, 'runs.json');
      const a = mk([fake('a', 'Alpha')], { runsFile: rf });
      a.key('enter', 0); a.tick(100); a.key('escape', 100);
      const b = mk([fake('a', 'Alpha')], { runsFile: rf });
      b.key('enter', 0); b.tick(100); b.quit();
      const c = mk([fake('a', 'Alpha', { update: () => { throw new Error('boom'); } })], { runsFile: rf });
      c.key('enter', 0); c.tick(100);
      expect(loadRuns(rf)).toEqual({});
    });

    it('still shows results when runsFile is unwritable', () => {
      const app = mk([fake('a', 'Alpha')], { runsFile: dir });
      app.key('enter', 0);
      play(app, 100, 300);
      expect(has(rows(app), 'Alpha — Score 3')).toBe(true);
    });
  });

  it('menu lists titles alphabetically, hides invalid and duplicate ids', () => {
    const app = mk([fake('b', 'Beta'), fake('a', 'Alpha'), fake('Bad Id', 'Zed'), fake('a', 'Dup')]);
    const r = rows(app);
    expect(has(r, 'ARCADE')).toBe(true);
    const text = r.join('\n');
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Beta'));
    expect(text).not.toContain('Zed');
    expect(text).not.toContain('Dup');
    expect(has(r, '↑↓ select · Enter play · Q quit')).toBe(true);
  });

  it('shows No games yet when empty; q quits; ctrl-c quits anywhere', () => {
    const app = mk([]);
    expect(has(rows(app), 'No games yet')).toBe(true);
    expect(app.key('q', 0)).toBe('quit');
    const app2 = mk([fake('a', 'Alpha')]);
    app2.key('enter', 0);
    expect(app2.key('ctrl-c', 0)).toBe('quit');
  });

  it('Enter starts the selected game; q in game goes to the game', () => {
    const app = mk([fake('a', 'Alpha'), fake('b', 'Beta')]);
    app.key('down', 0);
    app.key('enter', 0);
    expect(app.key('q', 0)).toBeUndefined();
    const r = rows(app);
    expect(r[r.length - 1]).toContain('Beta  Score 0  Best -  arrows  P pause · Esc end');
    expect(r[1]).toContain('n=0');
  });

  it('unknown startGameId shows the menu; valid one skips it', () => {
    expect(has(rows(mk([fake('a', 'Alpha')], { startGameId: 'nope' })), 'ARCADE')).toBe(true);
    expect(has(rows(mk([fake('a', 'Alpha')], { startGameId: 'a' })), 'n=0')).toBe(true);
  });

  it('a finished run saves exactly one score and shows New best!', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    play(app);
    play(app, 1100, 2000);
    expect(loadScores(file).a).toHaveLength(1);
    const r = rows(app);
    expect(has(r, 'New best!')).toBe(true);
    expect(has(r, 'Enter: play again · Esc: menu')).toBe(true);
    expect(loadScores(file).a[0].score).toBe(3);
  });

  it('results: Enter plays again, Esc returns to menu with cached best', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    play(app);
    app.key('enter', 1000);
    expect(has(rows(app), 'n=0')).toBe(true);
    app.key('escape', 1000); // ends the second run (score 0), saved, back to menu
    expect(has(rows(app), 'ARCADE')).toBe(true);
    expect(has(rows(app), 'Best 3')).toBe(true);
    expect(loadScores(file).a).toHaveLength(2);
  });

  it('a crash saves nothing and shows crash text; Enter returns to menu', () => {
    const app = mk([fake('a', 'Alpha', { update: () => { throw new Error('boom'); } })]);
    app.key('enter', 0);
    play(app);
    expect(has(rows(app), 'Alpha crashed: boom')).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    app.key('enter', 0);
    expect(has(rows(app), 'ARCADE')).toBe(true);
  });

  it('a draw crash goes to the crash screen', () => {
    const app = mk([fake('a', 'Alpha', { draw: () => { throw new Error('bad draw'); } })]);
    app.key('enter', 0);
    expect(has(rows(app), 'Alpha crashed: bad draw')).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('escape ends the run and saves the score so far', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    play(app, 100, 200);
    app.key('escape', 200);
    expect(loadScores(file).a[0].score).toBe(2);
    expect(has(rows(app), 'ARCADE')).toBe(true);
  });

  it('a store failure shows Couldn\'t save score and does not throw', () => {
    fs.mkdirSync(file); // scores path is a directory: reads and writes fail
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    expect(() => play(app)).not.toThrow();
    expect(has(rows(app), "Couldn't save score")).toBe(true);
  });

  it('onEvent shows the banner on row 0 while game keys still reach the game', () => {
    let keys = 0;
    const app = mk([fake('a', 'Alpha', { onKey: (s) => { keys++; return s; } })]);
    app.key('enter', 0);
    app.onEvent({ type: 'done', at: '', project: '' }, 0);
    expect(rows(app, 80, 30, 100)[0]).toContain('✓ Claude is done');
    app.key('left', 100);
    expect(keys).toBe(1);
  });

  it('marker shows on the status line after 10s and is cleared when the run ends', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    app.onEvent({ type: 'attention', at: '', project: '' }, 0);
    const r = rows(app, 80, 30, 20_000);
    expect(r[0].trim()).toBe('');
    expect(r[29].trimEnd().endsWith('● Claude needs you')).toBe(true);
    play(app);
    expect(rows(app, 80, 30, 20_000)[29]).not.toContain('Claude');
  });

  it('too-small terminal shows only the message and pauses play', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    const r = rows(app, 50, 20);
    expect(has(r, 'Make the window bigger')).toBe(true);
    expect(r.filter((l) => l.trim()).length).toBe(1);
    play(app, 100, 1000);
    expect(has(rows(app), 'n=0')).toBe(true);
  });

  it('sanitises control characters in crash text', () => {
    const msg = ['a', 'b' + String.fromCharCode(27) + '[2Jc'].join(String.fromCharCode(10));
    const app = mk([fake('a', 'Alpha', { update: () => { throw new Error(msg); } })]);
    app.key('enter', 0);
    play(app);
    const r = rows(app);
    expect(has(r, 'Alpha crashed: a b [2Jc')).toBe(true);
    expect(r.join('').includes(String.fromCharCode(27))).toBe(false);
  });

  it('drops game keys while too small', () => {
    let keys = 0;
    const app = mk([fake('a', 'Alpha', { onKey: (s) => { keys++; return s; } })]);
    app.key('enter', 0);
    rows(app, 50, 20);
    app.key('left', 0);
    expect(keys).toBe(0);
    rows(app);
    app.key('left', 0);
    expect(keys).toBe(1);
  });

  it('ctrl-c quits from results and crash screens', () => {
    const a = mk([fake('a', 'Alpha')]);
    a.key('enter', 0); play(a);
    expect(a.key('ctrl-c', 0)).toBe('quit');
    const b = mk([fake('a', 'Alpha', { update: () => { throw new Error('x'); } })]);
    b.key('enter', 0); play(b);
    expect(b.key('ctrl-c', 0)).toBe('quit');
  });

  it('marker is cleared after Esc ends the run', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.key('enter', 0);
    app.onEvent({ type: 'done', at: '', project: '' }, 0);
    app.key('escape', 100);
    expect(rows(app, 80, 30, 20_000)[29]).not.toContain('Claude');
  });

  it('ctrl-c mid-run saves the score (quit ends the run)', () => {
    const app = mk([fake('a', 'Alpha', { isOver: () => false })]);
    app.key('enter', 0);
    app.tick(100); app.tick(200);
    expect(app.key('ctrl-c', 200)).toBe('quit');
    expect(loadScores(file).a.map((e) => e.score)).toEqual([2]);
  });

  it('quit() on the menu saves nothing', () => {
    const app = mk([fake('a', 'Alpha')]);
    app.quit();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('quit() while paused saves the score', () => {
    const app = mk([fake('a', 'Alpha', { isOver: () => false })]);
    app.key('enter', 0);
    app.tick(100);
    app.key('p', 100);
    app.quit();
    expect(loadScores(file).a).toHaveLength(1);
  });

  it('shows the selected game description in the menu, clipped to 60 chars', () => {
    const app = mk([fake('a', 'Alpha', { description: 'First game' }), fake('b', 'Beta', { description: 'x'.repeat(80) })]);
    let r = rows(app);
    expect(has(r, 'First game')).toBe(true);
    app.key('down', 0);
    r = rows(app);
    expect(has(r, 'First game')).toBe(false);
    expect(has(r, 'x'.repeat(60))).toBe(true);
    expect(has(r, 'x'.repeat(61))).toBe(false);
  });

  it('skips malformed games instead of crashing', () => {
    const bad: any[] = [
      fake('t', 'T', { title: 5 as any }),
      fake('d', 'D', { description: undefined as any }),
      fake('c', 'C', { controls: null as any }),
      fake('k0', 'K0', { tickMs: 0 }),
      fake('kn', 'KN', { tickMs: NaN }),
      fake('ks', 'KS', { tickMs: '100' as any }),
      fake('f1', 'F1', { init: undefined as any }),
      fake('f2', 'F2', { onKey: 1 as any }),
      fake('f3', 'F3', { update: null as any }),
      fake('f4', 'F4', { draw: {} as any }),
      fake('f5', 'F5', { score: undefined as any }),
      fake('f6', 'F6', { isOver: 'x' as any }),
    ];
    const app = mk([...bad, fake('ok', 'Fine')]);
    const text = rows(app).join('\n');
    expect(text).toContain('Fine');
    for (const n of ['K0', 'KN', 'KS', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6']) expect(text).not.toContain(n);
    expect(rows(app).filter((l) => l.includes('Best ')).length).toBe(1);
  });

  it('skips a game whose length is malformed, keeps one without length', () => {
    const app = mk([
      fake('a', 'Alpha', { length: { kind: 'timed', minutes: 1 } }),
      fake('b', 'Bravo', { length: { kind: 'sometimes', minutes: 1 } as any }),
      fake('c', 'Charlie', { length: { kind: 'open', minutes: 0 } }),
      fake('d', 'Delta'),
    ]);
    const r = rows(app);
    expect(has(r, 'Alpha')).toBe(true);
    expect(has(r, 'Bravo')).toBe(false);
    expect(has(r, 'Charlie')).toBe(false);
    expect(has(r, 'Delta')).toBe(true);
  });

  it('Esc on the crash screen returns to the menu', () => {
    const app = mk([fake('a', 'Alpha', { update: () => { throw new Error('boom'); } })]);
    app.key('enter', 0);
    play(app);
    app.key('escape', 0);
    expect(has(rows(app), 'ARCADE')).toBe(true);
  });
});
