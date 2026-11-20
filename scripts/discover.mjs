import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Sorted names of subfolders of gamesDir that contain an index.ts. */
export function discoverGames(gamesDir) {
  if (!existsSync(gamesDir)) return [];
  return readdirSync(gamesDir)
    .filter((name) => statSync(join(gamesDir, name)).isDirectory())
    .filter((name) => existsSync(join(gamesDir, name, 'index.ts')))
    .sort();
}
