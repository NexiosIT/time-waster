export const TICK_MS = 50;
export const START_SPEED = 8;
export const MAX_SPEED = 24;
export const COINS_TO_MAX = 20;
export const GRIP_SLOW = 0.35;
export const GRIP_FAST = 0.1;
export const DRIFT_THRESHOLD = 0.3;

const TAU = 2 * Math.PI;

/** Angle in radians for a heading index 0..7 (0 = right, clockwise on screen). */
export function headingAngle(h: number): number {
  return h * (Math.PI / 4);
}

/** Rotates a heading index one step (dir = 1 or -1), wrapping within 0..7. */
export function rotateHeading(h: number, dir: 1 | -1): number {
  return (((h + dir) % 8) + 8) % 8;
}

/** Speed after collecting `coins` coins: rises quickly at first, then flattens, capped at MAX_SPEED. */
export function speedForCoins(coins: number): number {
  const t = Math.min(coins, COINS_TO_MAX) / COINS_TO_MAX;
  return START_SPEED + (MAX_SPEED - START_SPEED) * Math.sqrt(t);
}

/** Grip at a given speed: linear from GRIP_SLOW at START_SPEED down to GRIP_FAST at MAX_SPEED, clamped. */
export function gripFor(speed: number): number {
  const t = Math.min(Math.max((speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0), 1);
  return GRIP_SLOW + (GRIP_FAST - GRIP_SLOW) * t;
}

/** Shortest signed difference `to - from`, normalised to (-π, π]. */
export function angleDiff(from: number, to: number): number {
  const x = (((to - from) % TAU) + TAU) % TAU;
  return x > Math.PI ? x - TAU : x;
}

/**
 * Turns the travel direction toward `target` by at most `maxStep` radians.
 * When the target is exactly opposite, the turn direction is `lastTurn`.
 * Result is normalised to [0, 2π).
 */
export function turnToward(travel: number, target: number, maxStep: number, lastTurn: 1 | -1): number {
  let d = angleDiff(travel, target);
  if (Math.abs(Math.abs(d) - Math.PI) < 1e-9) d = Math.PI * lastTurn;
  const step = Math.min(Math.max(d, -maxStep), maxStep);
  return (((travel + step) % TAU) + TAU) % TAU;
}

/** True when the travel direction differs from the heading by more than DRIFT_THRESHOLD radians. */
export function isDrifting(travel: number, heading: number): boolean {
  return Math.abs(angleDiff(travel, headingAngle(heading))) > DRIFT_THRESHOLD;
}
