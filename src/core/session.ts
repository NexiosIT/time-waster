import { createRandom } from './random';
import { GAME_HEIGHT, GAME_WIDTH } from './types';
import type { Game, GameContext, Key, Screen } from './types';

export type SessionStatus = 'playing' | 'paused' | 'over' | 'crashed';

const MAX_STEPS = 5;
const PAUSED_TEXT = 'PAUSED — P to resume';
const TOO_SMALL_TEXT = 'Make the window bigger';

export class GameSession<S> {
  status: SessionStatus = 'playing';
  error?: string;
  score = 0;

  private state!: S;
  private tooSmall = false;
  private lastMs: number;
  private elapsedMs = 0;
  private acc = 0;
  private random: () => number;

  constructor(private game: Game<S>, opts: { seed: number; nowMs: number }) {
    this.random = createRandom(opts.seed);
    this.lastMs = opts.nowMs;
    this.guard(() => {
      this.state = this.game.init(this.ctx());
      this.refreshScore();
    });
  }

  key(k: Key): void {
    if (this.finished() || k === 'ctrl-c') return;
    if (k === 'escape') { this.end(); return; }
    if (k === 'p') {
      this.status = this.status === 'paused' ? 'playing' : 'paused';
      return;
    }
    if (this.status !== 'playing') return;
    this.guard(() => {
      this.state = this.game.onKey(this.state, k);
      this.refreshScore();
    });
  }

  tick(nowMs: number): void {
    const dt = Math.max(0, nowMs - this.lastMs);
    this.lastMs = nowMs;
    if (this.finished() || this.status !== 'playing' || this.tooSmall) return;
    this.elapsedMs += dt;
    this.acc += dt;
    const tickMs = this.game.tickMs;
    const due = Math.floor(this.acc / tickMs);
    const steps = Math.min(due, MAX_STEPS);
    this.acc = due > MAX_STEPS ? 0 : this.acc - steps * tickMs;
    this.guard(() => {
      for (let i = 0; i < steps; i++) {
        this.state = this.game.update(this.state, this.ctx());
        this.refreshScore();
        if (this.game.isOver(this.state)) { this.status = 'over'; return; }
      }
      if (steps === 0 && this.game.isOver(this.state)) this.status = 'over';
    });
  }

  setTooSmall(tooSmall: boolean): void {
    this.tooSmall = tooSmall;
  }

  end(): void {
    if (this.finished()) return;
    this.status = 'over';
  }

  draw(screen: Screen): void {
    screen.clear();
    if (this.status === 'crashed') return;
    this.guard(() => this.game.draw(this.state, screen));
    if (this.finished() && this.error !== undefined) { screen.clear(); return; }
    const overlay = this.tooSmall ? TOO_SMALL_TEXT : this.status === 'paused' ? PAUSED_TEXT : null;
    if (overlay) {
      screen.text(
        Math.floor((GAME_WIDTH - overlay.length) / 2),
        Math.floor(GAME_HEIGHT / 2),
        overlay,
        'brightYellow',
      );
    }
  }

  private finished(): boolean {
    return this.status === 'over' || this.status === 'crashed';
  }

  private ctx(): GameContext {
    return { random: this.random, elapsedMs: this.elapsedMs };
  }

  private refreshScore(): void {
    const s: unknown = this.game.score(this.state);
    if (typeof s !== 'number' || !Number.isFinite(s)) throw new Error('invalid score');
    this.score = s;
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.status = 'crashed';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
}
