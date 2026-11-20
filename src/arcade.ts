import { App } from './core/app';
import { parseKeys } from './core/keys';
import { ENTER_ALT, LEAVE_ALT, renderDiff } from './core/render';
import { EventWatcher, trimEvents } from './core/events';
import { accountFile, aliveFile, eventsFile, outboxFile, scoresFile } from './core/paths';
import { onlineConfig } from './core/online/config';
import { Online } from './core/online/online';
import { BEAT_MS, clearAlive, touchAlive } from './core/alive';
import type { CellBuffer } from './core/buffer';
import { games } from './games/registry.generated';

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The arcade needs an interactive terminal.');
  process.exit(1);
}

try { trimEvents(eventsFile()); } catch { /* ignore */ }
const cfg = onlineConfig(process.env);
const online = cfg ? new Online({ ...cfg, accountFile: accountFile(), outboxFile: outboxFile() }) : undefined;
const app = new App({ games, scoresFile: scoresFile(), nowMs: Date.now(), startGameId: process.argv[2], online });
const watcher = new EventWatcher(eventsFile(), (ev) => app.onEvent(ev, Date.now()));
watcher.start();

// Heartbeat: tells the auto-launcher (mod hook) that an arcade is already open.
const beat = () => { try { touchAlive(aliveFile()); } catch { /* ignore */ } };
beat();
const beatTimer = setInterval(beat, BEAT_MS);

let prev: CellBuffer | null = null;
let timer: NodeJS.Timeout | null = null;
let done = false;

function shutdown(code: number, err?: unknown): void {
  if (done) return;
  done = true;
  if (err === undefined) try { app.quit(); } catch { /* ignore */ } // save the score of a run in progress (never after a crash)
  if (timer) clearInterval(timer);
  clearInterval(beatTimer);
  clearAlive(aliveFile());
  watcher.stop();
  process.stdout.write(LEAVE_ALT);
  try { process.stdin.setRawMode(false); } catch { /* ignore */ }
  if (err !== undefined) console.error(err);
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
process.on('uncaughtException', (e) => shutdown(1, e));

process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
process.stdout.write(ENTER_ALT);

process.stdin.on('data', (data: string) => {
  for (const k of parseKeys(data)) {
    if (app.key(k, Date.now()) === 'quit') return shutdown(0);
  }
});
process.stdout.on('resize', () => { prev = null; });

timer = setInterval(() => {
  const now = Date.now();
  app.tick(now);
  const buf = app.render(process.stdout.columns || 80, process.stdout.rows || 24, now);
  const out = renderDiff(prev, buf);
  if (out) process.stdout.write(out);
  prev = buf;
}, 16);
