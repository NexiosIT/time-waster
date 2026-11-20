import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { App } from './app';
import { CellBuffer } from './buffer';
import {
  DOUBLE_CHANCE, DROP_CHANCE, GLITCH_GAP_MS, GLITCH_LEN_MS, JINX_SPEED, Jinx, isJinxed,
} from './jinx';
import { GameSession } from './session';
import { GAME_HEIGHT, GAME_WIDTH } from './types';
import type { Game } from './types';

/** Counts updates; each key press adds 100. Never ends. */
function counter(over: Partial<Game<number>> = {}): Game<number> {
  return {
    id: 'counter', title: 'Counter', description: '', tickMs: 100, controls: '',
    init: () => 0,
    onKey: (s) => s + 100,
    update: (s) => s + 1,
    draw: (s, screen) => screen.text(0, 0, `n=${s}`),
    score: (s) => s,
    isOver: () => false,
    ...over,
  };
}
const run = (s: GameSession<number>, to: number, step = 10) => { for (let t = step; t <= to; t += step) s.tick(t); };

describe('isJinxed', () => {
  it('matches "thomas" anywhere in any name, ignoring case', () => {
    expect(isJinxed(['thomas'])).toBe(true);
    expect(isJinxed(['ThOmAs.Peeters'])).toBe(true);
    expect(isJinxed(['robin', 'xTHOMASx'])).toBe(true);
    expect(isJinxed(['robin', undefined, null, ''])).toBe(false);
    expect(isJinxed(['tomas', 'thom as'])).toBe(false);
    expect(isJinxed([])).toBe(false);
  });
});

describe('Jinx', () => {
  it('speeds up the tick interval', () => {
    const j = new Jinx(1);
    expect(j.tickMs(100)).toBe(100 * JINX_SPEED);
    expect(j.tickMs(1)).toBe(1);
  });

  it('drops some key presses and doubles others, at roughly the set rates', () => {
    const j = new Jinx(1);
    const n = 20_000;
    let dropped = 0, doubled = 0;
    for (let i = 0; i < n; i++) {
      const out = j.keys('up');
      if (out.length === 0) dropped++;
      if (out.length === 2) doubled++;
      for (const k of out) expect(k).toBe('up');
    }
    expect(dropped / n).toBeCloseTo(DROP_CHANCE, 1);
    expect(doubled / n).toBeCloseTo(DOUBLE_CHANCE, 1);
  });

  it('glitches in short bursts separated by quiet stretches', () => {
    const j = new Jinx(2);
    expect(j.glitching).toBe(false);
    const bursts: number[] = [];
    let len = 0;
    for (let t = 0; t < 120_000; t += 10) {
      j.advance(10);
      if (j.glitching) len += 10;
      else if (len) { bursts.push(len); len = 0; }
    }
    expect(bursts.length).toBeGreaterThanOrEqual(120_000 / (GLITCH_GAP_MS[1] + GLITCH_LEN_MS[1]) - 1);
    expect(bursts.length).toBeLessThanOrEqual(120_000 / GLITCH_GAP_MS[0]);
    for (const b of bursts) {
      expect(b).toBeGreaterThanOrEqual(GLITCH_LEN_MS[0]);
      expect(b).toBeLessThanOrEqual(GLITCH_LEN_MS[1] + 10);
    }
  });

  it('paints noise only inside the play area', () => {
    const j = new Jinx(3);
    const buf = new CellBuffer(GAME_WIDTH, GAME_HEIGHT);
    let puts = 0;
    const screen = {
      width: GAME_WIDTH, height: GAME_HEIGHT, clear() {}, text() {},
      put(x: number, y: number, ch: string) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(GAME_WIDTH);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(GAME_HEIGHT);
        expect(ch).toHaveLength(1);
        buf.put(x, y, ch);
        puts++;
      },
    };
    for (let i = 0; i < 50; i++) j.paint(screen);
    expect(puts).toBeGreaterThan(50 * 20);
  });
});

describe('GameSession with the jinx', () => {
  it('runs games faster', () => {
    const plain = new GameSession(counter(), { seed: 1, nowMs: 0 });
    const jinxed = new GameSession(counter(), { seed: 1, nowMs: 0, jinx: true });
    run(plain, 3000);
    run(jinxed, 3000);
    expect(plain.score).toBe(30);
    expect(jinxed.score).toBe(40); // 3000 / 75
  });

  it('drops and doubles game keys, but never the host keys', () => {
    const s = new GameSession(counter({ tickMs: 1_000_000 }), { seed: 1, nowMs: 0, jinx: true });
    for (let i = 0; i < 1000; i++) s.key('up');
    expect(s.score).not.toBe(100 * 1000);
    expect(s.score % 100).toBe(0);
    for (let i = 0; i < 50; i++) {
      s.key('p');
      expect(s.status).toBe('paused');
      s.key('p');
      expect(s.status).toBe('playing');
    }
    s.key('escape');
    expect(s.status).toBe('over');
  });

  it('leaves an un-jinxed session exactly as before', () => {
    const s = new GameSession(counter({ tickMs: 1_000_000 }), { seed: 1, nowMs: 0 });
    for (let i = 0; i < 1000; i++) s.key('up');
    expect(s.score).toBe(100 * 1000);
  });

  it('paints glitches over the game now and then, never while paused', () => {
    const s = new GameSession(counter(), { seed: 4, nowMs: 0, jinx: true });
    const noisy = () => {
      const buf = new CellBuffer(GAME_WIDTH, GAME_HEIGHT);
      s.draw(buf);
      let n = 0;
      for (let y = 0; y < GAME_HEIGHT; y++) n += buf.rowText(y).replace(/n=\d+/, '').replace('PAUSED — P to resume', '').trim().length;
      return n;
    };
    let seen = false;
    for (let t = 10; t <= 40_000 && !seen; t += 10) { s.tick(t); seen = noisy() > 0; }
    expect(seen).toBe(true);
    s.key('p');
    expect(noisy()).toBe(0);
  });
});

describe('App with the jinx', () => {
  const app = (usernames: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jinx-'));
    const a = new App({
      games: [counter()], scoresFile: path.join(dir, 'scores.json'), nowMs: 0, seed: 1,
      startGameId: 'counter', usernames,
    });
    for (let t = 10; t <= 3000; t += 10) a.tick(t);
    fs.rmSync(dir, { recursive: true, force: true });
    const b = a.render(80, 30, 3000);
    return Array.from({ length: 30 }, (_, y) => b.rowText(y)).join('\n');
  };

  it('jinxes a player whose OS username contains thomas', () => {
    expect(app(['Thomas'])).toContain('n=40');
    expect(app(['robin'])).toContain('n=30');
    expect(app([])).toContain('n=30');
  });
});
