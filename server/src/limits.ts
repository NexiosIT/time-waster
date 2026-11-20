import { games } from '../../src/games/registry.generated';

export const DEFAULT_MAX_SCORE = 1_000_000;
export const GAME_ID = /^[a-z0-9-]+$/;
export const MAX_BODY_BYTES = 4 * 1024;
export const AT_MAX_FUTURE_MS = 5 * 60_000;
export const AT_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
export const BOARD_LIMIT = 10;

const HOUR = 60 * 60_000;
export const RATE = {
  submitPerPlayer: { limit: 60, windowMs: HOUR },
  loginPerGithubId: { limit: 10, windowMs: HOUR },
  loginGlobal: { limit: 600, windowMs: HOUR },
  loginPerIp: { limit: 30, windowMs: HOUR },
} as const;

const maxScores = new Map<string, number>();
for (const g of games) if (g.maxScore !== undefined) maxScores.set(g.id, g.maxScore);

/** The highest score the server accepts for `game` (games bundled at build time may set their own). */
export function maxScoreFor(game: string): number {
  return maxScores.get(game) ?? DEFAULT_MAX_SCORE;
}
