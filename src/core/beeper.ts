import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Note, SoundPort } from './sounds';

// Plays sounds without blocking the arcade. On Windows one hidden PowerShell process
// is started on the first sound and fed [console]::Beep commands over stdin; it plays
// them one after another while the game keeps running. Elsewhere the terminal bell
// rings once per sound. Any failure makes it go quiet for the rest of the session.

export type Spawn = (cmd: string, args: string[]) => ChildProcess;

/** The PowerShell lines for one sound: a beep per tone, a sleep per rest. */
export function beepScript(notes: readonly Note[]): string {
  return notes
    .map(([hz, ms]) => {
      const d = Math.max(1, Math.round(ms));
      return hz > 0 ? `[console]::Beep(${Math.min(32767, Math.max(37, Math.round(hz)))},${d})` : `Start-Sleep -Milliseconds ${d}`;
    })
    .join(';') + '\n';
}

export class WindowsBeeper implements SoundPort {
  private proc: ChildProcess | null = null;
  private dead = false;

  constructor(private spawnFn: Spawn = (cmd, args) => spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })) {}

  play(notes: readonly Note[]): void {
    if (this.dead || notes.length === 0) return;
    try {
      const p = this.process();
      if (!p?.stdin || p.stdin.destroyed) return;
      // Skip a sound rather than pile up data Node hasn't even handed to the pipe yet.
      // (Sounds are short and seconds apart, so PowerShell's own queue stays tiny.)
      if (p.stdin.writableLength > 0) return;
      p.stdin.write(beepScript(notes));
    } catch {
      this.giveUp();
    }
  }

  stop(): void {
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    try { p.stdin?.end(); } catch { /* ignore */ }
    try { p.kill(); } catch { /* ignore */ }
  }

  private process(): ChildProcess | null {
    if (this.proc) return this.proc;
    const p = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-']);
    p.on('error', () => this.giveUp());
    p.on('exit', () => { if (this.proc === p) this.proc = null; });
    p.stdin?.on('error', () => this.giveUp());
    this.proc = p;
    return p;
  }

  private giveUp(): void {
    this.dead = true;
    this.stop();
  }
}

/** Fallback for terminals without Console.Beep: one bell per sound. */
export class BellBeeper implements SoundPort {
  constructor(private write: (s: string) => void) {}
  play(notes: readonly Note[]): void {
    if (notes.length > 0) try { this.write('\x07'); } catch { /* ignore */ }
  }
  stop(): void {}
}

export function createBeeper(platform: string, write: (s: string) => void): SoundPort {
  return platform === 'win32' ? new WindowsBeeper() : new BellBeeper(write);
}
