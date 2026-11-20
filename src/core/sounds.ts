// Random arcade sounds while you play: short chiptune beeps (coin, jump, laser, ...)
// at random moments. This file decides WHEN and WHAT; beeper.ts makes the noise.

/** One tone: frequency in Hz (0 = rest) and duration in ms. */
export type Note = readonly [hz: number, ms: number];
export interface Sound { name: string; notes: readonly Note[] }

export const FIRST_MS = 3_000;               // play time before the first sound of a run
export const GAP_MS = [4_000, 12_000] as const; // play time between sounds

const up = (from: number, to: number, steps: number, ms: number): Note[] =>
  Array.from({ length: steps }, (_, i) => [Math.round(from * (to / from) ** (i / (steps - 1))), ms] as Note);

export const SOUNDS: readonly Sound[] = [
  { name: 'coin', notes: [[988, 70], [1319, 220]] },
  { name: 'jump', notes: up(300, 900, 6, 25) },
  { name: 'laser', notes: up(1800, 400, 7, 20) },
  { name: 'power-up', notes: [[523, 70], [659, 70], [784, 70], [1047, 70], [784, 70], [1047, 160]] },
  { name: 'explosion', notes: up(400, 80, 8, 35) },
  { name: 'blip', notes: [[1200, 40], [0, 40], [1200, 40]] },
  { name: 'extra life', notes: [[1319, 90], [1568, 90], [2637, 90], [2093, 90], [2349, 90], [3136, 160]] },
  { name: 'game over', notes: [[392, 180], [370, 180], [349, 180], [330, 400]] },
  { name: 'bonus', notes: [[1047, 50], [1319, 50], [1568, 50], [2093, 50], [1568, 50], [2093, 50], [2637, 120]] },
  { name: 'warp', notes: [...up(200, 1600, 8, 18), ...up(1600, 200, 8, 18)] },
];

/** Where sounds go. A real one plays them; tests use a fake. */
export interface SoundPort {
  play(notes: readonly Note[]): void;
  stop(): void;
}

/** Decides when the next random sound plays, in play time (frozen while paused). */
export class SoundDj {
  private nextAt = FIRST_MS;
  private last = -1;

  constructor(private rnd: () => number) {}

  startRun(): void {
    this.nextAt = FIRST_MS;
  }

  /** The sound to play now, if one is due. Never the same sound twice in a row. */
  tick(playedMs: number): Sound | null {
    if (playedMs < this.nextAt) return null;
    this.nextAt = playedMs + GAP_MS[0] + this.rnd() * (GAP_MS[1] - GAP_MS[0]);
    let i = Math.floor(this.rnd() * SOUNDS.length);
    if (i === this.last) i = (i + 1) % SOUNDS.length;
    this.last = i;
    return SOUNDS[i];
  }
}
