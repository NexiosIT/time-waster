import { describe, expect, it } from 'vitest';
import {
  COINS_TO_MAX,
  GRIP_FAST,
  GRIP_SLOW,
  MAX_SPEED,
  START_SPEED,
  angleDiff,
  gripFor,
  isDrifting,
  rotateHeading,
  speedForCoins,
  turnToward,
} from './physics';

describe('drift physics', () => {
  it('rotateHeading wraps both ways', () => {
    expect(rotateHeading(0, -1)).toBe(7);
    expect(rotateHeading(7, 1)).toBe(0);
    expect(rotateHeading(3, 1)).toBe(4);
  });

  it('speedForCoins starts slow, rises with shrinking steps, caps at 20 coins', () => {
    expect(speedForCoins(0)).toBe(START_SPEED);
    expect(speedForCoins(COINS_TO_MAX)).toBe(MAX_SPEED);
    expect(speedForCoins(50)).toBe(MAX_SPEED);
    const step1 = speedForCoins(1) - speedForCoins(0);
    const step19 = speedForCoins(20) - speedForCoins(19);
    expect(step1).toBeGreaterThan(step19);
    expect(step19).toBeGreaterThan(0);
  });

  it('grip falls as speed rises', () => {
    expect(gripFor(START_SPEED)).toBeCloseTo(GRIP_SLOW);
    expect(gripFor(MAX_SPEED)).toBeCloseTo(GRIP_FAST);
    expect(gripFor(16)).toBeLessThan(gripFor(10));
  });

  it('angleDiff takes the short way and stays in (-π, π]', () => {
    expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(0, Math.PI)).toBeCloseTo(Math.PI);
    for (const [a, b] of [[50, -3], [-20, 7], [0, 100]]) {
      const d = angleDiff(a, b);
      expect(d).toBeGreaterThan(-Math.PI);
      expect(d).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('turnToward moves at most maxStep and lands exactly when close', () => {
    expect(turnToward(0, Math.PI / 2, 0.2, 1)).toBeCloseTo(0.2);
    expect(turnToward(0, 0.1, 0.2, 1)).toBeCloseTo(0.1);
    expect(turnToward(0.1, 2 * Math.PI - 0.1, 0.5, 1)).toBeCloseTo(2 * Math.PI - 0.1); // short way, wraps
  });

  it('turnToward uses lastTurn when target is exactly opposite', () => {
    expect(turnToward(0, Math.PI, 0.2, 1)).toBeCloseTo(0.2);
    expect(turnToward(0, Math.PI, 0.2, -1)).toBeCloseTo(2 * Math.PI - 0.2);
  });

  it('isDrifting compares travel with heading', () => {
    expect(isDrifting(0, 0)).toBe(false);
    expect(isDrifting(0, 2)).toBe(true);
  });
});
