import { CellBuffer } from './buffer';
import { Banner } from './banner';
import { GameSession } from './session';
import { addScore, loadScores } from './scores';
import type { ScoreEntry } from './scores';
import type { ClaudeEvent } from './events';
import { GAME_HEIGHT, GAME_WIDTH, MIN_COLS, MIN_ROWS } from './types';
import type { Color, Game, Key } from './types';
import type { OnlinePort } from './online/online';
import { drawAccount, drawMenuHint, drawSignIn, drawWorld } from './onlineScreens';

export interface AppOptions {
  games: Game<any>[];
  scoresFile: string;
  nowMs: number;
  seed?: number;
  startGameId?: string;
  /** Absent: no online UI at all. */
  online?: OnlinePort;
}

type ScreenName = 'menu' | 'playing' | 'results' | 'crashed' | 'signin' | 'account';

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
  private online: OnlinePort | undefined;
  private worldTab = false;
  private confirmDelete = false;

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
    this.online = opts.online;
    this.refreshBest();
    const start = opts.startGameId ? this.games.find((g) => g.id === opts.startGameId) : undefined;
    if (start) this.start(start, opts.nowMs);
    else this.online?.refreshWorldBest(opts.nowMs);
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
        else if (k === 'o' && this.online) this.openOnline();
        break;
      case 'signin':
        if (k === 'escape') {
          this.online!.cancelSignIn();
          this.toMenu(nowMs);
        }
        break;
      case 'account':
        this.accountKey(k, nowMs);
        break;
      case 'playing':
        if (this.tooSmall && k !== 'p' && k !== 'escape') break;
        this.session!.key(k);
        if (k === 'escape' && this.session!.status === 'over') {
          this.banner.clearMarker();
          this.finish(this.session!.score);
          this.toMenu(nowMs);
        } else this.afterRun();
        break;
      case 'results':
        if (k === 'enter' && this.game) this.start(this.game, nowMs);
        else if (k === 'escape') this.toMenu(nowMs);
        else if (k === 'tab' && this.online) this.worldTab = !this.worldTab;
        break;
      case 'crashed':
        if (k === 'enter' || k === 'escape') this.toMenu(nowMs);
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

    // Signed out elsewhere (sign-out, revoked session): the account screen has nothing to show.
    if (this.screen === 'account' && !this.online!.account()) this.toMenu(nowMs);
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

  private toMenu(nowMs: number): void {
    this.banner.clearMarker();
    this.session = null;
    this.results = null;
    this.screen = 'menu';
    this.refreshBest();
    this.online?.refreshWorldBest(nowMs);
  }

  /** Only `account()` says whether we are signed in; `signIn()` may still hold an old phase. */
  private openOnline(): void {
    const online = this.online!;
    if (online.account()) {
      this.confirmDelete = false;
      this.screen = 'account';
    } else {
      online.startSignIn();
      this.screen = 'signin';
    }
  }

  private accountKey(k: Key, nowMs: number): void {
    const online = this.online!;
    if (this.confirmDelete) {
      if (k === 'y') {
        online.signOut(true);
        this.toMenu(nowMs);
      } else if (k === 'n' || k === 'escape') this.confirmDelete = false;
    } else if (k === 'escape') this.toMenu(nowMs);
    else if (k === 's') {
      online.signOut(false);
      this.toMenu(nowMs);
    } else if (k === 'd') this.confirmDelete = true;
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
    this.online?.recordRun(id, score, new Date());
    this.online?.loadBoard(id);
    this.worldTab = false;
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
      const online = this.online;
      this.games.forEach((g, i) => {
        const best = this.best.has(g.id) ? String(this.best.get(g.id)) : '-';
        const line = `${i === this.sel ? '> ' : '  '}${g.title}`;
        const color = i === this.sel ? 'brightWhite' : 'white';
        if (!online) {
          area.text(10, 4 + i, clip(line, 36), color);
          area.text(48, 4 + i, clip(`Best ${best}`, 12), 'gray');
          return;
        }
        const world = online.worldBest(g.id);
        area.text(4, 4 + i, clip(line, 28), color);
        area.text(33, 4 + i, clip(`Best ${best}`, 12), 'gray');
        area.text(46, 4 + i, clip(`World ${world ? world.score : '-'}`, 14), 'gray');
      });
      area.text(0, 17, clip(this.games[this.sel].description, GAME_WIDTH), 'gray');
      if (online) drawMenuHint(area, online.account());
    } else if (this.screen === 'results' && this.results) {
      const r = this.results;
      centre(1, `${this.game!.title} — Score ${r.score}`, 'brightWhite');
      if (r.isBest) centre(3, 'New best!', 'brightGreen');
      if (r.saveFailed) centre(3, "Couldn't save score", 'brightRed');
      const online = this.online;
      if (online && this.worldTab) drawWorld(area, online.board(this.game!.id), !!online.account());
      else r.top.forEach((e, i) => centre(5 + i, `${String(i + 1).padStart(2)}. ${e.score}`));
      centre(18, `Enter: play again · Esc: menu${online ? ' · Tab: You / World' : ''}`, 'gray');
    } else if (this.screen === 'signin') {
      drawSignIn(area, this.online!.signIn());
    } else if (this.screen === 'account') {
      drawAccount(area, this.online!.account()?.login ?? '', this.confirmDelete);
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
