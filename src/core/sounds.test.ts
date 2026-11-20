import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { createRandom } from './random';
import { FIRST_MS, GAP_MS, SOUNDS, SoundDj } from './sounds';
import { BellBeeper, WindowsBeeper, beepScript, createBeeper } from './beeper';

describe('SOUNDS', () => {
  it('are short, audible arcade sounds with unique names', () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SOUNDS.map(s => s.name)).size).toBe(SOUNDS.length);
    for (const s of SOUNDS) {
      expect(s.notes.length).toBeGreaterThan(0);
      const total = s.notes.reduce((t, [, ms]) => t + ms, 0);
      expect(total).toBeLessThanOrEqual(1000);
      for (const [hz, ms] of s.notes) {
        expect(hz === 0 || (hz >= 37 && hz <= 32767)).toBe(true); // Console.Beep's range
        expect(ms).toBeGreaterThan(0);
      }
    }
  });
});

describe('SoundDj', () => {
  it('stays quiet until FIRST_MS of play, then plays one sound', () => {
    const dj = new SoundDj(createRandom(1));
    expect(dj.tick(0)).toBeNull();
    expect(dj.tick(FIRST_MS - 1)).toBeNull();
    expect(dj.tick(FIRST_MS)).not.toBeNull();
    expect(dj.tick(FIRST_MS + 1)).toBeNull();
  });

  it('spaces sounds GAP_MS apart and never repeats one back to back', () => {
    const dj = new SoundDj(createRandom(2));
    const at: number[] = [];
    const names: string[] = [];
    for (let t = 0; t <= 600_000; t += 16) {
      const s = dj.tick(t);
      if (s) { at.push(t); names.push(s.name); }
    }
    for (let i = 1; i < at.length; i++) {
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(GAP_MS[0]);
      expect(at[i] - at[i - 1]).toBeLessThanOrEqual(GAP_MS[1] + 16);
      expect(names[i]).not.toBe(names[i - 1]);
    }
    expect(new Set(names).size).toBe(SOUNDS.length); // over 10 minutes, all of them come up
  });

  it('startRun resets the clock for a new run', () => {
    const dj = new SoundDj(createRandom(3));
    expect(dj.tick(FIRST_MS)).not.toBeNull();
    dj.startRun();
    expect(dj.tick(0)).toBeNull();
    expect(dj.tick(FIRST_MS)).not.toBeNull();
  });
});

describe('beepScript', () => {
  it('turns notes into PowerShell beeps and sleeps, one line per sound', () => {
    expect(beepScript([[988, 70], [0, 40], [1319.4, 220]]))
      .toBe('[console]::Beep(988,70);Start-Sleep -Milliseconds 40;[console]::Beep(1319,220)\n');
  });

  it('clamps frequencies into Console.Beep range', () => {
    expect(beepScript([[10, 5], [99999, 5]])).toBe('[console]::Beep(37,5);[console]::Beep(32767,5)\n');
  });
});

/** A fake child process with a readable copy of everything written to stdin. */
function fakeChild() {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  const stdin = new PassThrough();
  let written = '';
  stdin.on('data', (d) => { written += String(d); });
  let killed = false;
  Object.assign(proc, { stdin, kill: () => { killed = true; return true; } });
  return { proc, written: () => written, killed: () => killed };
}

describe('WindowsBeeper', () => {
  it('starts PowerShell once, on the first sound, and feeds it beep lines', async () => {
    const child = fakeChild();
    const calls: string[][] = [];
    const b = new WindowsBeeper((cmd, args) => { calls.push([cmd, ...args]); return child.proc; });
    expect(calls).toHaveLength(0);
    b.play([[988, 70]]);
    await new Promise(r => setImmediate(r));
    b.play([[440, 50]]);
    await new Promise(r => setImmediate(r));
    expect(calls).toEqual([['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '-']]);
    expect(child.written()).toBe('[console]::Beep(988,70)\n[console]::Beep(440,50)\n');
  });

  it('goes quiet for good if PowerShell cannot start', () => {
    const child = fakeChild();
    let spawns = 0;
    const b = new WindowsBeeper(() => { spawns++; return child.proc; });
    b.play([[988, 70]]);
    child.proc.emit('error', new Error('ENOENT'));
    b.play([[988, 70]]);
    expect(spawns).toBe(1);
    expect(child.killed()).toBe(true);
  });

  it('a throwing spawn never escapes', () => {
    const b = new WindowsBeeper(() => { throw new Error('nope'); });
    expect(() => b.play([[988, 70]])).not.toThrow();
    expect(() => b.play([[988, 70]])).not.toThrow();
  });

  it('stop ends the process, and the next sound starts a fresh one', () => {
    const children = [fakeChild(), fakeChild()];
    let n = 0;
    const b = new WindowsBeeper(() => children[n++].proc);
    b.play([[988, 70]]);
    b.stop();
    expect(children[0].killed()).toBe(true);
    b.play([[988, 70]]);
    expect(n).toBe(2);
    expect(() => b.stop()).not.toThrow();
  });
});

describe('BellBeeper and createBeeper', () => {
  it('rings the terminal bell once per sound', () => {
    let out = '';
    const b = new BellBeeper(s => { out += s; });
    b.play([[988, 70], [1319, 220]]);
    b.play([]);
    expect(out).toBe('\x07');
  });

  it('uses PowerShell beeps on Windows and the bell elsewhere', () => {
    expect(createBeeper('win32', () => {})).toBeInstanceOf(WindowsBeeper);
    expect(createBeeper('linux', () => {})).toBeInstanceOf(BellBeeper);
    expect(createBeeper('darwin', () => {})).toBeInstanceOf(BellBeeper);
  });
});
