import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { binDir } from './core/paths';

export interface LaunchCommand {
  file: string;
  args: string[];
  /** true: pass args to the child as-is (windowsVerbatimArguments); quotes are already in the args. */
  verbatim: boolean;
}

export function launchCommand(pluginRoot: string, hasWt: boolean): LaunchCommand {
  const arcade = path.win32.join(pluginRoot, 'dist', 'arcade.js');
  if (hasWt) {
    // spawn quotes the path itself if it contains spaces
    return { file: 'wt', args: ['-w', '0', 'nt', 'node', arcade], verbatim: false };
  }
  // `start` needs an empty title argument, which spawn's quoting does not reliably produce,
  // so build the command line ourselves.
  return { file: 'cmd', args: ['/c', `start "" cmd /c node "${arcade}"`], verbatim: true };
}

const norm = (p: string) => p.replace(/\\+$/, '').toLowerCase();

export function isOnPath(dir: string, pathEnv: string): boolean {
  const want = norm(dir);
  return pathEnv
    .split(';')
    .filter((e) => e.length > 0)
    .some((e) => norm(e) === want);
}

/** Spawn detached; resolves null once the process started, or a message if it failed to start. */
export function spawnDetached(cmd: LaunchCommand, timeoutMs = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd.file, cmd.args, {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: cmd.verbatim,
      });
      const timer = setTimeout(() => resolve(null), timeoutMs); // no news is good news
      child.once('error', (e) => {
        clearTimeout(timer);
        resolve(e.message);
      });
      child.once('spawn', () => {
        clearTimeout(timer);
        child.unref();
        resolve(null);
      });
    } catch (e) {
      resolve(e instanceof Error ? e.message : String(e));
    }
  });
}

export async function main(): Promise<void> {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(__dirname, '..');
    const hasWt = spawnSync('where', ['wt'], { stdio: 'ignore' }).status === 0;
    const failure = await spawnDetached(launchCommand(root, hasWt));
    if (failure) {
      console.log('Could not open the arcade: ' + failure);
      return;
    }
    console.log('Arcade opened.');
    if (!isOnPath(binDir(), process.env.PATH ?? process.env.Path ?? '')) {
      console.log('To start the arcade while Claude is busy, run once in PowerShell, then open a new terminal:');
      console.log(
        `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:USERPROFILE\\.time-waster\\bin", 'User')`,
      );
      console.log('Then restart Claude Code.');
    }
  } catch (e) {
    console.log('Could not open the arcade: ' + (e instanceof Error ? e.message : String(e)));
  }
}

if (require.main === module) {
  void main();
}
