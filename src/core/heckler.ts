import { AHEAD, BEHIND, NO_BEST, RUN_BEST, RUN_WORSE, START, STUCK, fill } from './heckles';

export const FIRST_MS = 8_000;    // play time before the opening jab of every run
export const CHECK_MS = 20_000;   // how often (in play time) to compare against your best
export const STUCK_MS = 20_000;   // play time without a score change before a "stuck" jab
export const SHOW_MS = 5_000;     // how long a line stays up
export const GAP_MS = 12_000;     // minimum wall-clock time between lines
export const BEHIND_RATIO = 0.6;  // below this share of your best pace counts as behind
const CHANCE = 0.5;               // how often a checkpoint jabs when ahead, or with no best yet

export interface HeckleTick {
  nowMs: number;
  /** Play time: frozen while paused, so a paused game is never heckled. */
  playedMs: number;
  score: number;
  best: number | null;
  /** The game's expected run length, when known. */
  expectedMs: number | null;
  game: string;
}

/** Decides when to jab and with what. Pure apart from the random source. */
export class Heckler {
  private line: string | null = null;
  private shownAt = -Infinity;
  private lastLineAt = -Infinity;
  private nextCheck = CHECK_MS;
  private opened = false;
  private lastScore: number | null = null;
  private lastChange = 0;

  constructor(private rnd: () => number) {}

  startRun(): void {
    this.line = null;
    this.shownAt = -Infinity;
    this.nextCheck = CHECK_MS;
    this.opened = false;
    this.lastScore = null;
    this.lastChange = 0;
  }

  tick(i: HeckleTick): void {
    if (this.lastScore !== null && i.score !== this.lastScore) this.lastChange = i.playedMs;
    this.lastScore = i.score;

    let pool: string[] | null = null;
    if (!this.opened && i.playedMs >= FIRST_MS) {
      this.opened = true;
      pool = START;
    } else if (i.playedMs >= this.nextCheck) {
      while (this.nextCheck <= i.playedMs) this.nextCheck += CHECK_MS;
      if (i.best !== null && i.best > 0) {
        const share = i.expectedMs ? Math.min(1, i.playedMs / i.expectedMs) : 0.5;
        const target = i.best * share;
        if (i.score < BEHIND_RATIO * target) pool = BEHIND;
        else if (i.score >= target && this.rnd() >= CHANCE) pool = AHEAD;
      } else if (i.best === null && this.rnd() >= CHANCE) pool = NO_BEST;
    }
    if (!pool && i.playedMs - this.lastChange >= STUCK_MS) {
      pool = STUCK;
      this.lastChange = i.playedMs; // next "stuck" only after another full stretch
    }
    if (!pool || i.nowMs - this.lastLineAt < GAP_MS) return;
    this.line = fill(this.pick(pool), { score: i.score, best: i.best ?? '-', game: i.game, time: duration(i.playedMs) });
    this.shownAt = i.nowMs;
    this.lastLineAt = i.nowMs;
  }

  /** The line to show now, or null. */
  current(nowMs: number): string | null {
    return this.line !== null && nowMs - this.shownAt < SHOW_MS ? this.line : null;
  }

  /** A line for the results screen. */
  runOver(r: { score: number; best: number | null; isBest: boolean; game: string }): string {
    const pool = r.isBest ? RUN_BEST : RUN_WORSE;
    return fill(this.pick(pool), { score: r.score, best: r.best ?? '-', game: r.game, time: '' });
  }

  private pick(pool: string[]): string {
    return pool[Math.min(pool.length - 1, Math.floor(this.rnd() * pool.length))];
  }
}

function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 120 ? `${s}s` : `${Math.floor(s / 60)} min`;
}
