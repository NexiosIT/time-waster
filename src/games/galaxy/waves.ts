export type WaveSpec = {
  startRow: number;
  marchTicks: number;
  minMarchTicks: number;
  fireChance: number;
  maxEnemyShots: number;
};

/** Wave difficulty table. Index 0 = wave 1. */
export const WAVES: readonly WaveSpec[] = [
  { startRow: 2, marchTicks: 12, minMarchTicks: 3, fireChance: 0.02, maxEnemyShots: 2 },
  { startRow: 3, marchTicks: 10, minMarchTicks: 2, fireChance: 0.03, maxEnemyShots: 2 },
  { startRow: 4, marchTicks: 8, minMarchTicks: 2, fireChance: 0.04, maxEnemyShots: 2 },
  { startRow: 5, marchTicks: 7, minMarchTicks: 1, fireChance: 0.05, maxEnemyShots: 3 },
  { startRow: 6, marchTicks: 6, minMarchTicks: 1, fireChance: 0.06, maxEnemyShots: 3 },
];

/** Ticks between march steps: scales from marchTicks (full) down toward minMarchTicks (one left). */
export function marchInterval(spec: WaveSpec, alive: number, total: number): number {
  return Math.max(
    spec.minMarchTicks,
    Math.round(spec.minMarchTicks + ((spec.marchTicks - spec.minMarchTicks) * alive) / total),
  );
}
