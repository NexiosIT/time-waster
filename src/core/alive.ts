import * as fs from 'node:fs';
import * as path from 'node:path';

/** How often a running arcade refreshes its heartbeat file. */
export const BEAT_MS = 2000;
/** A heartbeat older than this means no arcade is running (it crashed or was closed). */
export const STALE_MS = 6000;

export function isFresh(mtimeMs: number, nowMs: number): boolean {
  return nowMs - mtimeMs < STALE_MS;
}

export function isArcadeRunning(file: string, nowMs: number): boolean {
  try {
    return isFresh(fs.statSync(file).mtimeMs, nowMs);
  } catch {
    return false;
  }
}

/** Create or refresh the heartbeat file (and its folder). */
export function touchAlive(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(process.pid));
}

export function clearAlive(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}
