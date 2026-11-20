import { describe, it, expect } from 'vitest';
import { createRandom } from '../../core/random';
import { CellBuffer } from '../../core/buffer';
import type { Color, Screen } from '../../core/types';
import game, { MAX_SCORE } from './index';
import { drawState } from './draw';
import { initState, COLS, POINTS, WAVE_BONUS, LIVES, CLEAR_BONUS } from './state';
import type { GalaxyState } from './state';

const ctx = { random: createRandom(1), elapsedMs: 0 };

function render(s: GalaxyState): CellBuffer {
  const b = new CellBuffer(60, 20);
  drawState(s, b);
  return b;
}

/** Screen that records every write, to check clipping. */
function recorder() {
  const writes: { x: number; y: number; ch: string }[] = [];
  const screen: Screen = {
    width: 60,
    height: 20,
    put: (x, y, ch, _c?: Color) => void writes.push({ x, y, ch }),
    text: (x, y, s) => {
      let cx = x;
      for (const ch of s) writes.push({ x: cx++, y, ch });
    },
    clear: () => {},
  };
  return { writes, screen };
}

describe('galaxy contract', () => {
  it('has the exact metadata', () => {
    expect(game.id).toBe('galaxy');
    expect(game.title).toBe('Galaxy');
    expect(game.description).toBe('Clear 5 waves of invaders. 3 lives. Good luck at wave 5.');
    expect(game.tickMs).toBe(50);
    expect(game.controls).toBe('←→ move  Space fire');
    expect(game.length).toEqual({ kind: 'rounds', minutes: 3 });
    expect(game.maxScore).toBe(MAX_SCORE);
  });

  it('MAX_SCORE is 5200 and matches the formula', () => {
    expect(MAX_SCORE).toBe(5200);
    expect(MAX_SCORE).toBe(
      5 * COLS * (POINTS.drone + 2 * POINTS.brute + POINTS.stinger) +
        5 * WAVE_BONUS * LIVES +
        CLEAR_BONUS,
    );
  });

  it('starts at 0, survives updates and does not mutate', () => {
    const s0 = game.init(ctx);
    const snap = JSON.stringify(s0);
    let s = s0;
    for (let i = 0; i < 5; i++) s = game.update(game.onKey(s, 'space'), ctx);
    expect(JSON.stringify(s0)).toBe(snap);
    expect(game.score(s0)).toBe(0);
    expect(game.isOver(s)).toBe(false);
  });
});

describe('galaxy drawing', () => {
  it('draws the init frame', () => {
    const b = render(initState());
    expect(b.rowText(0)).toContain('Wave 1/5');
    expect(b.rowText(0)).toContain('Lives ♥♥♥');
    expect(b.rowText(0).trimEnd().endsWith('Score 0')).toBe(true);
    expect(b.rowText(18)).toContain('/^\\');
    expect(b.rowText(2)).toContain('<o>');
    expect(b.rowText(5)).toContain('/V\\');
    expect(b.get(28, 18).color).toBe('brightGreen');
  });

  it('hides the ship on odd ticks while blinking', () => {
    const s = { ...initState(), blink: 5 };
    expect(render({ ...s, tick: 1 }).rowText(18)).not.toContain('/^\\');
    expect(render({ ...s, tick: 2 }).rowText(18)).toContain('/^\\');
  });

  it('draws shots and debris', () => {
    const s = { ...initState(), shot: { x: 5, y: 10 }, enemyShots: [{ x: 7, y: 11 }] };
    const b = render(s);
    expect(b.get(5, 10)).toEqual({ ch: '╎', color: 'brightWhite' });
    expect(b.get(7, 11)).toEqual({ ch: '¦', color: 'brightRed' });
    expect(b.get(10, 16)).toEqual({ ch: '▓', color: 'gray' });
  });

  it('keeps every write inside the area and row 0 HUD only', () => {
    for (const fx of [-20, 0, 29, 40]) {
      const { writes, screen } = recorder();
      const s: GalaxyState = {
        ...initState(),
        fx,
        fy: 16,
        shot: { x: 0, y: 1 },
        enemyShots: [{ x: 59, y: 19 }, { x: 0, y: 19 }],
        shipX: 57,
      };
      drawState(s, screen);
      const clipped = writes.filter((w) => w.x >= 0 && w.x < 60 && w.y >= 0 && w.y < 20);
      // The recorder has no clipping, so anything out of range is a real escape.
      expect(clipped.length).toBe(writes.length);
    }
    const b = render({ ...initState(), fx: 0, fy: 0, shot: { x: 3, y: 1 } });
    expect(b.rowText(0)).toMatch(/^Wave 1\/5   Lives ♥♥♥\s+Score 0$/);
  });

  it('only writes alive enemies', () => {
    const s = initState();
    const alive = s.alive.map((r, ri) => r.map((_, ci) => ri === 0 && ci === 0));
    const b = render({ ...s, alive });
    expect(b.rowText(2)).toContain('<o>');
    expect(b.rowText(5)).not.toContain('/V\\');
  });

  it('shows GALAXY CLEARED during the banner', () => {
    expect(render(initState()).rowText(9)).not.toContain('GALAXY CLEARED');
    const b = render({ ...initState(), banner: 10 });
    expect(b.rowText(9)).toContain('GALAXY CLEARED');
    expect(b.rowText(9).indexOf('GALAXY CLEARED')).toBe(23);
    expect(b.get(23, 9).color).toBe('brightYellow');
  });
});
