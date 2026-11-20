import * as os from 'node:os';
import * as path from 'node:path';

export function dataDir(home: string = os.homedir()): string {
  return path.join(home, '.time-waster');
}
export function eventsFile(home?: string): string {
  return path.join(dataDir(home), 'events.jsonl');
}
export function scoresFile(home?: string): string {
  return path.join(dataDir(home), 'scores.json');
}
export function binDir(home?: string): string {
  return path.join(dataDir(home), 'bin');
}
/** Heartbeat a running arcade refreshes; tells the auto-launcher one is already open. */
export function aliveFile(home?: string): string {
  return path.join(dataDir(home), 'arcade.alive');
}
