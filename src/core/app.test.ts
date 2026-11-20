import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { App } from './app';
import { loadScores } from './scores';
import type { Game } from './types';
import type { BoardView, OnlinePort, SignIn } from './online/online';

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

  it('Esc on the crash screen returns to the menu', () => {
    const app = mk([fake('a', 'Alpha', { update: () => { throw new Error('boom'); } })]);
    app.key('enter', 0);
    play(app);
    app.key('escape', 0);
    expect(has(rows(app), 'ARCADE')).toBe(true);
  });
});

class FakeOnline implements OnlinePort {
  acct: { login: string } | null = null;
  bests: Record<string, { login: string; score: number }> = {};
  boards: Record<string, BoardView> = {};
  state: SignIn = { phase: 'idle' };
  calls: string[] = [];
  account() { return this.acct; }
  worldBest(game: string) { return this.bests[game] ?? null; }
  refreshWorldBest(nowMs: number) { this.calls.push(`refresh ${nowMs}`); }
  loadBoard(game: string) { this.calls.push(`load ${game}`); }
  board(game: string): BoardView { return this.boards[game] ?? { status: 'loading' }; }
  recordRun(game: string, score: number, at: Date) { this.calls.push(`record ${game} ${score} ${at instanceof Date}`); }
  flush() { return Promise.resolve(); }
  signIn() { return this.state; }
  startSignIn() { this.calls.push('start'); this.state = { phase: 'starting' }; }
  cancelSignIn() { this.calls.push('cancel'); this.state = { phase: 'idle' }; }
  signOut(deleteScores: boolean) { this.calls.push(`signOut ${deleteScores}`); this.acct = null; }
}

const LOGIN39 = 'L'.repeat(38) + 'Z';
const rowsAt = (app: App) => rows(app, 62, 23);
/** Rows 1..20 hold the 60x20 game area, centred in `cols`: nothing may be drawn outside it. */
function insideArea(r: string[], cols = 62) {
  const ox = Math.floor((cols - 60) / 2);
  for (let y = 1; y <= 20; y++) {
    expect(r[y].slice(0, ox).trim()).toBe('');
    expect(r[y].slice(ox + 60).trim()).toBe('');
  }
}

describe('App online', () => {
  it('without online, menu and results look exactly as before', () => {
    const app = mk([fake('a', 'Alpha')]);
    let r = rows(app);
    expect(r.join('\n')).not.toMatch(/World|share scores|Online as/);
    expect(r[r.length - 1].trimEnd()).toBe('↑↓ select · Enter play · Q quit');
    expect(r[5]).toContain('> Alpha');
    expect(r[5]).toContain('Best -');
    app.key('o', 0);
    expect(has(rows(app), 'ARCADE')).toBe(true);
    app.key('enter', 0);
    play(app);
    app.key('tab', 1000);
    r = rows(app);
    expect(has(r, 'New best!')).toBe(true);
    expect(has(r, ' 1. 3')).toBe(true);
    expect(r.join('\n')).not.toMatch(/World|Tab:/);
    expect(has(r, 'Enter: play again · Esc: menu')).toBe(true);
  });

  it('menu shows World bests and the sign-in hint; signed in shows "Online as <login>"', () => {
    const online = new FakeOnline();
    online.bests.a = { login: 'zed', score: 42 };
    const app = mk([fake('a', 'Alpha'), fake('b', 'Beta')], { online, nowMs: 5 });
    expect(online.calls).toContain('refresh 5');
    let r = rows(app);
    expect(r.find((l) => l.includes('Alpha'))).toMatch(/Best -\s+World 42/);
    expect(r.find((l) => l.includes('Beta'))).toMatch(/Best -\s+World -/);
    expect(has(r, 'O: share scores online')).toBe(true);
    expect(r[r.length - 1].trimEnd()).toBe('↑↓ select · Enter play · Q quit');
    online.acct = { login: 'robin' };
    r = rows(app);
    expect(has(r, 'Online as robin · O: account')).toBe(true);
    expect(has(r, 'share scores')).toBe(false);
  });

  it('O opens sign-in and shows the code; Esc cancels', () => {
    const online = new FakeOnline();
    const app = mk([fake('a', 'Alpha')], { online });
    app.key('o', 0);
    expect(online.calls).toContain('start');
    expect(has(rows(app), 'Asking GitHub...')).toBe(true);
    online.state = { phase: 'code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' };
    let r = rows(app);
    expect(has(r, 'Open https://github.com/login/device')).toBe(true);
    expect(has(r, 'and enter the code  ABCD-1234')).toBe(true);
    expect(has(r, 'Waiting for GitHub...')).toBe(true);
    app.key('escape', 0);
    expect(online.calls).toContain('cancel');
    expect(has(rows(app), 'ARCADE')).toBe(true);

    app.key('o', 0);
    online.state = { phase: 'failed', message: 'Code expired' };
    expect(has(rows(app), 'Code expired')).toBe(true);
    app.key('escape', 0);
    expect(has(rows(app), 'ARCADE')).toBe(true);

    app.key('o', 0);
    online.state = { phase: 'done', login: 'robin' };
    online.acct = { login: 'robin' };
    expect(has(rows(app), 'Signed in as robin')).toBe(true);
    app.key('escape', 0);
    r = rows(app);
    expect(has(r, 'ARCADE')).toBe(true);
    expect(has(r, 'Online as robin · O: account')).toBe(true);
  });

  it('O when signed in opens the account screen; D then Y signs out and deletes', () => {
    const online = new FakeOnline();
    online.acct = { login: 'robin' };
    const app = mk([fake('a', 'Alpha')], { online });
    app.key('o', 0);
    expect(online.calls).not.toContain('start');
    let r = rows(app);
    expect(has(r, 'Signed in as robin')).toBe(true);
    expect(r.join(' ')).toMatch(/S: sign out · D: sign out and delete my online scores\s+.*Esc: back/);
    app.key('d', 0);
    expect(has(rows(app), 'Delete all your online scores? Y/N')).toBe(true);
    app.key('n', 0);
    r = rows(app);
    expect(has(r, 'Delete all')).toBe(false);
    expect(has(r, 'Signed in as robin')).toBe(true);
    app.key('d', 0);
    app.key('escape', 0);
    expect(has(rows(app), 'Signed in as robin')).toBe(true);
    expect(online.calls.filter((c) => c.startsWith('signOut'))).toEqual([]);
    app.key('d', 0);
    app.key('y', 0);
    expect(online.calls).toContain('signOut true');
    r = rows(app);
    expect(has(r, 'ARCADE')).toBe(true);
    expect(has(r, 'O: share scores online')).toBe(true);

    // S signs out without deleting; Esc goes back to the menu
    online.acct = { login: 'robin' };
    app.key('o', 0);
    app.key('escape', 0);
    expect(has(rows(app), 'ARCADE')).toBe(true);
    app.key('o', 0);
    app.key('s', 0);
    expect(online.calls).toContain('signOut false');
    expect(has(rows(app), 'O: share scores online')).toBe(true);
  });

  it('the account screen falls back to the menu when the session is gone (401)', () => {
    const online = new FakeOnline();
    online.acct = { login: 'robin' };
    online.state = { phase: 'done', login: 'robin' }; // a stale phase must not count as signed in
    const app = mk([fake('a', 'Alpha')], { online });
    app.key('o', 0);
    online.acct = null;
    const r = rows(app);
    expect(has(r, 'ARCADE')).toBe(true);
    expect(has(r, 'O: share scores online')).toBe(true);
    app.key('o', 0);
    expect(online.calls).toContain('start');
  });

  it('a finished run is recorded online and its board loaded', () => {
    const online = new FakeOnline();
    const app = mk([fake('a', 'Alpha')], { online });
    app.key('enter', 0);
    play(app);
    expect(loadScores(file).a[0].score).toBe(3);
    expect(online.calls.slice(-2)).toEqual(['record a 3 true', 'load a']);
    app.key('escape', 2000);
    expect(online.calls).toContain('refresh 2000');
  });

  it('Tab on results switches to World: loading, offline and rows with my rank', () => {
    const online = new FakeOnline();
    const app = mk([fake('a', 'Alpha')], { online });
    app.key('enter', 0);
    play(app);
    let r = rows(app);
    expect(has(r, 'Tab: You / World')).toBe(true);
    expect(has(r, ' 1. 3')).toBe(true);
    app.key('tab', 0);
    expect(has(rows(app), 'loading...')).toBe(true);
    online.boards.a = { status: 'offline' };
    r = rows(app);
    expect(has(r, 'offline')).toBe(true);
    expect(has(r, ' 1. 3')).toBe(false);
    const top = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, login: `p${i + 1}`, score: 100 - i, at: '' }));
    online.boards.a = { status: 'ready', top, me: null };
    r = rows(app);
    expect(r.find((l) => l.includes(' 1. p1 '))).toMatch(/1\. p1\s+100/);
    expect(has(r, '10. p10')).toBe(true);
    expect(has(r, 'Your rank')).toBe(false);
    expect(has(r, 'O in the menu to join')).toBe(true);

    online.acct = { login: 'me' };
    online.boards.a = { status: 'ready', top, me: { rank: 23, score: 3 } };
    r = rows(app);
    expect(has(r, 'Your rank: 23')).toBe(true);
    expect(has(r, 'O in the menu to join')).toBe(false);

    online.boards.a = { status: 'ready', top, me: { rank: 2, score: 99 } };
    const b = app.render(80, 30, 0);
    const lineOf = (s: string) => Array.from({ length: 30 }, (_, i) => i).find((i) => b.rowText(i).includes(s))!;
    const y2 = lineOf(' 2. p2 ');
    const x = b.rowText(y2).indexOf('p2');
    expect(b.get(x, y2).color).toBe('brightYellow');
    expect(b.get(x, lineOf(' 3. p3 ')).color).not.toBe('brightYellow');
    expect(has(rows(app), 'Your rank')).toBe(false);

    app.key('tab', 0);
    expect(has(rows(app), ' 1. 3')).toBe(true);
  });

  it('Tab to World reloads the board (so it includes the run just sent); Tab back to You does not', () => {
    const online = new FakeOnline();
    const app = mk([fake('a', 'Alpha')], { online });
    app.key('enter', 0);
    play(app);
    const loads = () => online.calls.filter((c) => c === 'load a').length;
    expect(loads()).toBe(1);
    app.key('tab', 0);
    expect(loads()).toBe(2);
    app.key('tab', 0);
    expect(loads()).toBe(2);
    app.key('tab', 0);
    expect(loads()).toBe(3);
  });

  it('a 39-character login is clipped and the layout stays inside 60 columns', () => {
    const online = new FakeOnline();
    online.acct = { login: LOGIN39 };
    online.bests.a = { login: LOGIN39, score: 1_000_000 };
    const app = mk([fake('a', 'A'.repeat(50)), fake('b', 'Beta')], { online });
    let r = rowsAt(app);
    insideArea(r);
    expect(has(r, ' · O: account')).toBe(true);
    expect(has(r, 'World 1000000')).toBe(true);
    expect(r[r.length - 1].trimEnd()).toBe('↑↓ select · Enter play · Q quit');

    app.key('o', 0);
    r = rowsAt(app);
    insideArea(r);
    expect(has(r, 'Signed in as ' + LOGIN39)).toBe(true);
    expect(has(r, 'Esc: back')).toBe(true);
    app.key('escape', 0);

    online.acct = null;
    app.key('o', 0);
    online.state = { phase: 'done', login: LOGIN39 };
    insideArea(rowsAt(app));
    online.state = { phase: 'code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device/' + 'x'.repeat(40) };
    insideArea(rowsAt(app));
    app.key('escape', 0);

    online.acct = { login: LOGIN39 };
    app.key('down', 0);
    app.key('enter', 0);
    play(app);
    app.key('tab', 0);
    const top = Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, login: i === 0 ? LOGIN39 : `p${i}`, score: 1_000_000 - i, at: '' }));
    online.boards.b = { status: 'ready', top, me: { rank: 1, score: 1_000_000 } };
    r = rowsAt(app);
    insideArea(r);
    expect(has(r, ` 1. ${LOGIN39} 1000000`)).toBe(true);
    online.boards.b = { status: 'ready', top: [{ rank: 1, login: LOGIN39 + 'EXTRA', score: 1_000_000, at: '' }], me: { rank: 1234567, score: 1 } };
    r = rowsAt(app);
    insideArea(r);
    expect(has(r, 'EXTRA')).toBe(false);
  });

  it('render never throws when Online methods return offline/failed states', () => {
    const online = new FakeOnline();
    online.boards.a = { status: 'offline' };
    online.state = { phase: 'failed', message: "Couldn't reach GitHub" };
    online.startSignIn = () => { online.calls.push('start'); }; // stays failed
    const app = mk([fake('a', 'Alpha')], { online });
    expect(() => rows(app)).not.toThrow();
    expect(has(rows(app), 'World -')).toBe(true);
    app.key('o', 0);
    expect(has(rows(app), "Couldn't reach GitHub")).toBe(true);
    app.key('escape', 0);
    app.key('enter', 0);
    expect(() => play(app)).not.toThrow();
    app.key('tab', 0);
    expect(has(rows(app), 'offline')).toBe(true);
    online.boards.a = { status: 'ready', top: [], me: null };
    expect(() => rows(app)).not.toThrow();
    online.state = { phase: 'idle' };
    app.key('escape', 0);
    app.key('o', 0);
    expect(() => rows(app)).not.toThrow();
    expect(has(rows(app), 'Asking GitHub...')).toBe(true);
  });
});
