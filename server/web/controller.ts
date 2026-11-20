import { CellBuffer } from '../../src/core/buffer';
import { GameSession } from '../../src/core/session';
import { GAME_HEIGHT, GAME_WIDTH } from '../../src/core/types';
import type { Game, Key } from '../../src/core/types';

export type PlayState = 'ready' | 'playing' | 'results' | 'crashed';

export interface PlayDeps {
  game: Game<any>;
  nowMs: number;
  seed: () => number;
  loadBest: () => number | null;
  saveBest: (n: number) => void;
}

/** The browser play page's state machine around the arcade's own GameSession. */
export class PlayController {
  state: PlayState = 'ready';
  nameFocused = false;
  result: { score: number; isBest: boolean } | null = null;
  onExit?: () => void;

  private session: GameSession<any> | null = null;
  private last = new CellBuffer(GAME_WIDTH, GAME_HEIGHT);
  private crash = '';
  private pausedByPage = false;

  constructor(private deps: PlayDeps) {}

  key(k: Key, nowMs: number): void {
    if (this.nameFocused) return;
    switch (this.state) {
      case 'ready':
      case 'crashed':
        if (k === 'enter') this.start(nowMs);
        return;
      case 'results':
        if (k === 'enter') this.start(nowMs);
        else if (k === 'escape') this.onExit?.();
        return;
      case 'playing':
        if (k === 'p') this.pausedByPage = false; // the player took over pausing
        this.session!.key(k);
        this.afterRun();
    }
  }

  tick(nowMs: number): void {
    if (this.state !== 'playing') return;
    this.session!.tick(nowMs);
    this.afterRun();
  }

  setHidden(hidden: boolean, nowMs: number): void {
    const s = this.session;
    if (this.state !== 'playing' || !s) return;
    if (hidden && s.status === 'playing') {
      s.key('p');
      this.pausedByPage = true;
    } else if (!hidden && this.pausedByPage && s.status === 'paused') {
      s.tick(nowMs); // drop the time spent hidden
      s.key('p');
      this.pausedByPage = false;
    }
  }

  frame(): CellBuffer {
    if (this.state === 'playing' && this.session) {
      this.session.draw(this.last);
      this.afterRun();
    }
    return this.last;
  }

  status(): string {
    const g = this.deps.game;
    const best = this.deps.loadBest();
    const bestText = best === null ? '-' : String(best);
    switch (this.state) {
      case 'ready':
        return `${g.title}  Your best ${bestText}  ${g.controls}  Press Enter to start`;
      case 'playing':
        return `${g.title}  Score ${this.session!.score}  Your best ${bestText}  ${g.controls}  P pause · Esc end`;
      case 'results':
        return `${g.title}  Score ${this.result!.score}${this.result!.isBest ? '  New best!' : ''}  Enter play again · Esc leaderboard`;
      case 'crashed':
        return `${this.crash}  Enter to restart`;
    }
  }

  private start(nowMs: number): void {
    this.result = null;
    this.pausedByPage = false;
    this.session = new GameSession(this.deps.game, { seed: this.deps.seed(), nowMs });
    this.state = 'playing';
    this.afterRun();
  }

  private afterRun(): void {
    const s = this.session;
    if (this.state !== 'playing' || !s) return;
    if (s.status === 'crashed') {
      this.crash = `${this.deps.game.title} crashed: ${s.error ?? 'unknown error'}`;
      this.session = null;
      this.state = 'crashed';
    } else if (s.status === 'over') {
      const score = s.score;
      const prev = this.deps.loadBest();
      const isBest = prev === null || score > prev;
      if (isBest) this.deps.saveBest(score);
      this.result = { score, isBest };
      this.session = null;
      this.state = 'results';
    }
  }
}
