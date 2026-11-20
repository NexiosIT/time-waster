import { CellBuffer } from './buffer';
import { Banner } from './banner';
import { GameSession } from './session';
import { addScore, loadScores } from './scores';
import type { ScoreEntry } from './scores';
import type { ClaudeEvent } from './events';
import { GAME_HEIGHT, GAME_WIDTH, MIN_COLS, MIN_ROWS } from './types';
import type { Color, Game, Key } from './types';

export interface AppOptions {
  games: Game<any>[];
  scoresFile: string;
  nowMs: number;
  seed?: number;
  startGameId?: string;
}

type ScreenName = 'menu' | 'playing' | 'results' | 'crashed';

interface Results {
  score: number;
  isBest: boolean;
  top: ScoreEntry[];
  saveFailed: boolean;
}

const ID_RE = /^[a-z0-9-]+$/;
const TOO_SMALL = 'Make the window bigger';
const MENU_HINTS = '↑↓ select · Enter play · Q quit';

export class App {
  private games: Game<any>[];
  private scoresFile: string;
  private seed: number;
  private runs = 0;
  private banner = new Banner();
  private screen: ScreenName = 'menu';
  private sel = 0;
  private game: Game<any> | null = null;
  private session: GameSession<any> | null = null;
  private results: Results | null = null;
  private crash = '';
  private tooSmall = false;
  private best = new Map<string, number>();

  constructor(opts: AppOptions) {
    const seen = new Set<string>();
    const ok: Game<any>[] = [];
    for (const g of opts.games) {
      if (!wellFormed(g) || !ID_RE.test(g.id) || seen.has(g.id)) continue;
      seen.add(g.id);
      ok.push(g);
    }
    this.games = ok.sort((a, b) => a.title.localeCompare(b.title));
    this.scoresFile = opts.scoresFile;
    this.seed = opts.seed ?? Date.now();
    this.refreshBest();
    const start = opts.startGameId ? this.games.find((g) => g.id === opts.startGameId) : undefined;
    if (start) this.start(start, opts.nowMs);
  }

  key(k: Key, nowMs: number): 'quit' | void {
    if (k === 'ctrl-c') {
      this.quit();
      return 'quit';
    }
    switch (this.screen) {
      case 'menu':
        if (k === 'q') return 'quit';
        if (k === 'up' && this.games.length) this.sel = (this.sel + this.games.length - 1) % this.games.length;
        else if (k === 'down' && this.games.length) this.sel = (this.sel + 1) % this.games.length;
        else if (k === 'enter' && this.games[this.sel]) this.start(this.games[this.sel], nowMs);
        break;
      case 'playing':
        if (this.tooSmall && k !== 'p' && k !== 'escape') break;
        this.session!.key(k);
        if (k === 'escape' && this.session!.status === 'over') {
          this.banner.clearMarker();
          this.finish(this.session!.score);
          this.toMenu();
        } else this.afterRun();
        break;
      case 'results':
        if (k === 'enter' && this.game) this.start(this.game, nowMs);
        else if (k === 'escape') this.toMenu();
        break;
      case 'crashed':
        if (k === 'enter' || k === 'escape') this.toMenu();
        break;
    }
  }

  /** Closing the arcade ends a run in progress and saves its score. */
  quit(): void {
    const s = this.session;
    if (this.screen !== 'playing' || !s || (s.status !== 'playing' && s.status !== 'paused')) return;
    s.end();
    this.finish(s.score);
  }

  tick(nowMs: number): void {
    if (this.screen !== 'playing') return;
    this.session!.tick(nowMs);
    this.afterRun();
  }

  onEvent(ev: ClaudeEvent, nowMs: number): void {
    this.banner.push(ev, nowMs);
  }

  render(cols: number, rows: number, nowMs: number): CellBuffer {
    const buf = new CellBuffer(cols, rows);
    const tooSmall = cols < MIN_COLS || rows < MIN_ROWS;
    this.tooSmall = tooSmall;
    if (this.screen === 'playing') this.session!.setTooSmall(tooSmall);
    if (tooSmall) {
      buf.text(Math.max(0, Math.floor((cols - TOO_SMALL.length) / 2)), Math.floor(rows / 2), TOO_SMALL, 'brightYellow');
      return buf;
    }
    const view = this.banner.view(nowMs);
    const bcolor = this.banner.color();
    if (view?.mode === 'full') buf.text(0, 0, clip(view.text, cols), bcolor);

    const area = new CellBuffer(GAME_WIDTH, GAME_HEIGHT);
    let status = '';
    if (this.screen === 'playing') {
      this.session!.draw(area);
      this.afterRun(); // a draw failure turns into the crash screen
    }
    if (this.screen === 'playing') {
      const g = this.game!;
      const best = this.best.has(g.id) ? String(this.best.get(g.id)) : '-';
      status = `${g.title}  Score ${this.session!.score}  Best ${best}  ${g.controls}  P pause · Esc end`;
    } else {
      this.drawScreen(area);
      status = this.screen === 'menu' ? MENU_HINTS : '';
    }
    buf.blit(area, Math.floor((cols - GAME_WIDTH) / 2), 1);

    const marker = view?.mode === 'marker' ? view.text : '';
    const room = marker ? cols - marker.length - 3 : cols;
    buf.text(0, rows - 1, clip(status, room), 'white');
    if (marker) buf.text(cols - marker.length - 1, rows - 1, marker, bcolor);
    return buf;
  }

  private start(game: Game<any>, nowMs: number): void {
    this.game = game;
    this.results = null;
    this.session = new GameSession(game, { seed: this.seed + this.runs++, nowMs });
    this.screen = 'playing';
    this.afterRun();
  }

  private toMenu(): void {
    this.banner.clearMarker();
    this.session = null;
    this.results = null;
    this.screen = 'menu';
    this.refreshBest();
  }

  private afterRun(): void {
    const s = this.session;
    if (this.screen !== 'playing' || !s) return;
    if (s.status === 'crashed') {
      this.banner.clearMarker();
      this.crash = `${this.game!.title} crashed: ${(s.error ?? 'unknown error').replace(/\p{Cc}+/gu, ' ')}`;
      this.session = null;
      this.screen = 'crashed';
    } else if (s.status === 'over') {
      this.banner.clearMarker();
      this.finish(s.score);
    }
  }

  private finish(score: number): void {
    const id = this.game!.id;
    try {
      const r = addScore(this.scoresFile, id, score);
      this.results = { score, isBest: r.isBest, top: r.top, saveFailed: false };
      if (r.top.length) this.best.set(id, Math.max(...r.top.map((e) => e.score)));
    } catch {
      this.results = { score, isBest: false, top: [], saveFailed: true };
    }
    this.session = null;
    this.screen = 'results';
  }

  private refreshBest(): void {
    this.best.clear();
    try {
      const all = loadScores(this.scoresFile);
      for (const [id, list] of Object.entries(all)) {
        if (list.length) this.best.set(id, Math.max(...list.map((e) => e.score)));
      }
    } catch {
      // store unavailable: bests show as '-'
    }
  }

  private drawScreen(area: CellBuffer): void {
    const centre = (y: number, s: string, c: Color = 'white') =>
      area.text(Math.max(0, Math.floor((GAME_WIDTH - s.length) / 2)), y, clip(s, GAME_WIDTH), c);
    if (this.screen === 'menu') {
      centre(1, 'ARCADE', 'brightCyan');
      if (!this.games.length) { centre(5, 'No games yet', 'gray'); return; }
      this.games.forEach((g, i) => {
        const best = this.best.has(g.id) ? String(this.best.get(g.id)) : '-';
        const line = `${i === this.sel ? '> ' : '  '}${g.title}`;
        area.text(10, 4 + i, clip(line, 36), i === this.sel ? 'brightWhite' : 'white');
        area.text(48, 4 + i, clip(`Best ${best}`, 12), 'gray');
      });
      area.text(0, 17, clip(this.games[this.sel].description, GAME_WIDTH), 'gray');
    } else if (this.screen === 'results' && this.results) {
      const r = this.results;
      centre(1, `${this.game!.title} — Score ${r.score}`, 'brightWhite');
      if (r.isBest) centre(3, 'New best!', 'brightGreen');
      if (r.saveFailed) centre(3, "Couldn't save score", 'brightRed');
      r.top.forEach((e, i) => centre(5 + i, `${String(i + 1).padStart(2)}. ${e.score}`));
      centre(18, 'Enter: play again · Esc: menu', 'gray');
    } else if (this.screen === 'crashed') {
      centre(8, this.crash, 'brightRed');
      centre(18, 'Enter or Esc: menu', 'gray');
    }
  }
}

function wellFormed(g: Game<any>): boolean {
  return (
    typeof g.id === 'string' &&
    typeof g.title === 'string' &&
    typeof g.description === 'string' &&
    typeof g.controls === 'string' &&
    typeof g.tickMs === 'number' && Number.isFinite(g.tickMs) && g.tickMs > 0 &&
    [g.init, g.onKey, g.update, g.draw, g.score, g.isOver].every((f) => typeof f === 'function')
  );
}

function clip(s: string, n: number): string {
  return n <= 0 ? '' : s.length > n ? s.slice(0, n) : s;
}
