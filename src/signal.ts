import * as path from 'node:path';
import { toEvent, appendEvent, writeShim } from './core/events';
import { eventsFile, binDir } from './core/paths';

export function main(argv: string[], stdinText: string, home?: string): void {
  try {
    const cmd = argv[0];
    const { cwd: cwdFlag, positional } = parseArgs(argv.slice(1));
    if (cmd === 'attention') {
      const ev = toEvent(cmd, stdinText, new Date());
      if (ev) appendEvent(eventsFile(home), ev);
    } else if (cmd === 'done') {
      // From the Stop hook: the session's cwd on stdin. From the mod: --cwd, the same string its `start` used.
      const ev = toEvent(cmd, stdinText, new Date());
      if (ev) {
        if (cwdFlag !== undefined) ev.project = path.win32.basename(cwdFlag);
        else if (ev.project === '') ev.project = path.win32.basename(process.cwd());
        appendEvent(eventsFile(home), ev);
      }
    } else if (cmd === 'start' || cmd === 'estimate') {
      const project = path.win32.basename(cwdFlag ?? process.cwd());
      const at = new Date().toISOString();
      if (cmd === 'start') {
        appendEvent(eventsFile(home), { type: 'start', at, project });
      } else if (/^\d+$/.test(positional[0] ?? '')) {
        const minutes = Number(positional[0]);
        if (minutes >= 1 && minutes <= 120) appendEvent(eventsFile(home), { type: 'estimate', minutes, at, project });
      }
    } else if (cmd === 'shim') {
      writeShim(binDir(home), process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(__dirname, '..'));
    }
  } catch {
    // never fail: a non-zero Stop hook exit would block Claude
  }
}

function parseArgs(rest: string[]): { cwd: string | undefined; positional: string[] } {
  let cwd: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cwd' && i + 1 < rest.length) cwd = rest[++i];
    else positional.push(rest[i]);
  }
  return { cwd, positional };
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => (data += c));
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch {
      finish();
    }
  });
}

if (require.main === module) {
  readStdin(100)
    .then((text) => main(process.argv.slice(2), text))
    .catch(() => {})
    .then(() => process.exit(0));
}
