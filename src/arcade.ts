import { App } from './core/app';
import { parseKeys } from './core/keys';
import { ENTER_ALT, LEAVE_ALT, renderDiff } from './core/render';
import { EventWatcher, trimEvents } from './core/events';
import { eventsFile, scoresFile } from './core/paths';
import type { CellBuffer } from './core/buffer';
import { games } from './games/registry.generated';

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log('The arcade needs an interactive terminal.');
  process.exit(1);
}

trimEvents(eventsFile());
const app = new App({ games, scoresFile: scoresFile(), nowMs: Date.now(), startGameId: process.argv[2] });
const watcher = new EventWatcher(eventsFile(), (ev) => app.onEvent(ev, Date.now()));
watcher.start();

let prev: CellBuffer | null = null;
let timer: NodeJS.Timeout | null = null;
let done = false;

function shutdown(code: number, err?: unknown): void {
  if (done) return;
  done = true;
  if (timer) clearInterval(timer);
  watcher.stop();
  process.stdout.write(LEAVE_ALT);
  try { process.stdin.setRawMode(false); } catch { /* ignore */ }
  if (err !== undefined) console.error(err);
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
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
  process.stdout.write(renderDiff(prev, buf));
  prev = buf;
}, 16);
