import { createRandom } from './random';
import { GAME_HEIGHT, GAME_WIDTH } from './types';
import type { Color, Key, Screen } from './types';

// The jinx: a running joke. A player whose username contains "thomas" (any case) gets
// every game a bit harder and now and then glitchy:
//   - every game ticks faster (JINX_SPEED),
//   - some key presses are dropped and some register twice,
//   - every so often the screen flickers with noise for a moment.
// It never touches the host keys (Esc, P, Ctrl+C) and never changes a game's own state
// or randomness, so games stay pure and their tests unaffected.

export const JINX_NAME = 'thomas';
export const JINX_SPEED = 0.75;     // tickMs multiplier: 0.75 = ticks come 33% faster
export const DROP_CHANCE = 0.08;    // a key press is lost
export const DOUBLE_CHANCE = 0.05;  // a key press registers twice
export const GLITCH_GAP_MS = [6000, 18000] as const;  // quiet time between glitches
export const GLITCH_LEN_MS = [200, 600] as const;     // how long a glitch lasts

const NOISE = '░▒▓█#%&@$/\\|=+*';
const NOISE_COLORS: Color[] = ['brightGreen', 'brightMagenta', 'brightCyan', 'brightRed', 'white', 'gray'];

/** True if any of the given names contains "thomas", ignoring case. */
export function isJinxed(names: ReadonlyArray<string | null | undefined>): boolean {
  return names.some(n => typeof n === 'string' && n.toLowerCase().includes(JINX_NAME));
}

export class Jinx {
  private rand: () => number;
  private quietMs: number;
  private glitchMs = 0;

  constructor(seed: number) {
    // Its own random stream, so the game's ctx.random() sequence is unchanged.
    this.rand = createRandom((seed ^ 0x5eed7a11) >>> 0);
    this.quietMs = this.between(GLITCH_GAP_MS);
  }

  /** The tick interval the game actually runs at. */
  tickMs(base: number): number {
    return Math.max(1, Math.round(base * JINX_SPEED));
  }

  /** What one key press turns into: usually itself, sometimes nothing, sometimes twice. */
  keys(k: Key): Key[] {
    const r = this.rand();
    if (r < DROP_CHANCE) return [];
    if (r < DROP_CHANCE + DOUBLE_CHANCE) return [k, k];
    return [k];
  }

  /** Advance the glitch clock by `dt` ms of play. */
  advance(dt: number): void {
    if (this.glitchMs > 0) {
      this.glitchMs -= dt;
      if (this.glitchMs <= 0) {
        this.glitchMs = 0;
        this.quietMs = this.between(GLITCH_GAP_MS);
      }
      return;
    }
    this.quietMs -= dt;
    if (this.quietMs <= 0) this.glitchMs = this.between(GLITCH_LEN_MS);
  }

  get glitching(): boolean {
    return this.glitchMs > 0;
  }

  /** Paint noise over the game: scattered junk cells and one torn row. Fresh every frame. */
  paint(screen: Screen): void {
    const cells = 20 + Math.floor(this.rand() * 40);
    for (let i = 0; i < cells; i++) {
      screen.put(this.int(GAME_WIDTH), this.int(GAME_HEIGHT), this.pick<string>(NOISE), this.pick(NOISE_COLORS));
    }
    const y = this.int(GAME_HEIGHT);
    const from = this.int(GAME_WIDTH);
    const len = 5 + this.int(25);
    const color = this.pick(NOISE_COLORS);
    for (let x = from; x < Math.min(GAME_WIDTH, from + len); x++) screen.put(x, y, this.pick<string>('▀▄═─'), color);
  }

  private between([lo, hi]: readonly [number, number]): number {
    return lo + this.rand() * (hi - lo);
  }

  private int(n: number): number {
    return Math.floor(this.rand() * n);
  }

  private pick<T>(xs: ArrayLike<T>): T {
    return xs[this.int(xs.length)];
  }
}
