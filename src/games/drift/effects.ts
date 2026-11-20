import { gripFor, GRIP_SLOW } from './physics';

export type EffectKind = 'double' | 'grip' | 'rain' | 'nitro' | 'shield' | 'slick';
export interface Effect { kind: EffectKind; ticksLeft: number }

export const DURATION: Record<EffectKind, number> =
  { double: 200, grip: 120, rain: 120, nitro: 100, shield: 200, slick: 80 };
export const NITRO_SPEED = 1.5;
export const NITRO_VALUE = 3;
export const DOUBLE_VALUE = 2;
export const LOW_GRIP = 0.02;

const CANCELS: Partial<Record<EffectKind, EffectKind>> = { grip: 'slick', slick: 'grip' };

/** Adds an effect, resetting its timer if already present. Grip and slick cancel each other. */
export function addEffect(effects: Effect[], kind: EffectKind): Effect[] {
  const cancelled = CANCELS[kind];
  const rest = effects.filter((e) => e.kind !== kind && e.kind !== cancelled);
  return [...rest, { kind, ticksLeft: DURATION[kind] }];
}

export function removeEffect(effects: Effect[], kind: EffectKind): Effect[] {
  return effects.filter((e) => e.kind !== kind);
}

export function hasEffect(effects: Effect[], kind: EffectKind): boolean {
  return effects.some((e) => e.kind === kind);
}

/** Decrements every timer by one tick and drops effects that reach zero. */
export function tickEffects(effects: Effect[]): Effect[] {
  return effects
    .map((e) => ({ kind: e.kind, ticksLeft: e.ticksLeft - 1 }))
    .filter((e) => e.ticksLeft > 0);
}

/** Product of the active speed and coin multipliers. */
export function modifiers(effects: Effect[]): { speedMul: number; coinMul: number } {
  let speedMul = 1;
  let coinMul = 1;
  if (hasEffect(effects, 'nitro')) { speedMul *= NITRO_SPEED; coinMul *= NITRO_VALUE; }
  if (hasEffect(effects, 'double')) coinMul *= DOUBLE_VALUE;
  return { speedMul, coinMul };
}

/** Grip priority: grip effect, then slick, then oil, then the speed-based base grip. */
export function gripNow(speed: number, effects: Effect[], onOil: boolean): number {
  if (hasEffect(effects, 'grip')) return GRIP_SLOW;
  if (hasEffect(effects, 'slick') || onOil) return LOW_GRIP;
  return gripFor(speed);
}
