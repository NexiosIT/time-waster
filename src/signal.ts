import * as path from 'node:path';
import { toEvent, appendEvent, writeShim } from './core/events';
import { eventsFile, binDir } from './core/paths';

export function main(argv: string[], stdinText: string, home?: string): void {
  try {
    const cmd = argv[0];
    if (cmd === 'done' || cmd === 'attention') {
      const ev = toEvent(cmd, stdinText, new Date());
      if (ev) appendEvent(eventsFile(home), ev);
    } else if (cmd === 'start' || cmd === 'estimate') {
      const rest = argv.slice(1);
      let cwd = process.cwd();
      const positional: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--cwd' && i + 1 < rest.length) cwd = rest[++i];
        else positional.push(rest[i]);
      }
      const project = path.win32.basename(cwd);
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
