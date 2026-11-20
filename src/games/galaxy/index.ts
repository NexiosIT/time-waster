import type { Game } from '../../core/types';
import { drawState } from './draw';
import {
  COLS, POINTS, WAVE_BONUS, LIVES, CLEAR_BONUS, initState, onKey, step,
} from './state';
import type { GalaxyState } from './state';
import { WAVES } from './waves';

// Plain-data state, pure functions: see state.ts (rules) and draw.ts (painting).

/** Every enemy of every wave, the wave bonus at full lives each wave, and the clear bonus. */
export const MAX_SCORE =
  WAVES.length * COLS * (POINTS.drone + 2 * POINTS.brute + POINTS.stinger) +
  WAVES.length * WAVE_BONUS * LIVES +
  CLEAR_BONUS;

const galaxy: Game<GalaxyState> = {
  id: 'galaxy',
  title: 'Galaxy',
  description: 'Clear 5 waves of invaders. 3 lives. Good luck at wave 5.',
  tickMs: 50,
  controls: '←→ move  Space fire',
  length: { kind: 'rounds', minutes: 3 },
  maxScore: MAX_SCORE,
  init: () => initState(),
  onKey,
  update: (s, ctx) => step(s, ctx.random),
  draw: drawState,
  score: s => s.score,
  isOver: s => s.over,
};

export default galaxy;
