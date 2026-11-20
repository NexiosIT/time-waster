import type { Color, GameContext } from '../../core/types';
import type { Point } from './arena';

export type PowerKind = 'double' | 'grip' | 'rain' | 'nitro' | 'shield' | 'shuffle' | 'mystery';
export interface PowerUp { kind: PowerKind; at: Point; ticksLeft: number }

export const POWER_LIFE = 160;
export const POWER_BLINK = 40;

export const POWER_LOOK: Record<PowerKind, { ch: string; color: Color }> = {
  double: { ch: '2', color: 'brightYellow' },
  grip: { ch: 'G', color: 'brightGreen' },
  rain: { ch: '$', color: 'yellow' },
  nitro: { ch: 'N', color: 'brightRed' },
  shield: { ch: 'S', color: 'brightCyan' },
  shuffle: { ch: 'X', color: 'brightMagenta' },
  mystery: { ch: '?', color: 'brightWhite' },
};

export const POWER_WEIGHTS: Record<PowerKind, number> =
  { double: 3, grip: 3, rain: 3, shield: 3, shuffle: 2, nitro: 2, mystery: 2 };

/** Weighted random power-up kind. */
export function pickPower(ctx: GameContext): PowerKind {
  const kinds = Object.keys(POWER_WEIGHTS) as PowerKind[];
  let roll = ctx.random() * kinds.reduce((sum, k) => sum + POWER_WEIGHTS[k], 0);
  for (const k of kinds) {
    roll -= POWER_WEIGHTS[k];
    if (roll < 0) return k;
  }
  return kinds[kinds.length - 1];
}

const MYSTERY_OUTCOMES: (Exclude<PowerKind, 'mystery'> | 'slick')[] =
  ['double', 'grip', 'rain', 'nitro', 'shield', 'shuffle', 'slick'];

/** A mystery box turns into one of seven equally likely outcomes. */
export function resolveMystery(ctx: GameContext): Exclude<PowerKind, 'mystery'> | 'slick' {
  return MYSTERY_OUTCOMES[Math.floor(ctx.random() * MYSTERY_OUTCOMES.length)];
}

/** Coins to collect before the first power-up of a run spawns. */
export const FIRST_POWER_AT = 2;

/** Coins to collect before the next power-up spawns: 3 or 4. */
export function nextPowerGap(ctx: GameContext): number {
  return 3 + Math.floor(ctx.random() * 2);
}
