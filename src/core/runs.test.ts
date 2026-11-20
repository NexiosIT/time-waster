import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addRun, loadRuns, RUNS_KEPT } from './runs';
import { runsFile } from './paths';

let tmp: string;
let file: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  file = path.join(tmp, 'sub', 'runs.json');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runs', () => {
  it('runsFile lives in the data dir', () => {
    expect(runsFile('H')).toBe(path.join('H', '.time-waster', 'runs.json'));
  });

  it('addRun then loadRuns round-trips', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    expect(addRun(file, 'worm', 61000, at)).toEqual([{ ms: 61000, at: at.toISOString() }]);
    expect(loadRuns(file)).toEqual({ worm: [{ ms: 61000, at: at.toISOString() }] });
  });

  it('keeps only the last 20, oldest dropped', () => {
    expect(RUNS_KEPT).toBe(20);
    for (let i = 0; i < 25; i++) addRun(file, 'g', i * 1000);
    const list = loadRuns(file).g;
    expect(list).toHaveLength(20);
    expect(list.map((e) => e.ms)).toEqual(Array.from({ length: 20 }, (_, i) => (i + 5) * 1000));
  });

  it('missing file gives {}', () => {
    expect(loadRuns(file)).toEqual({});
  });

  it('corrupt file gives {}, is backed up, and addRun still works', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{nope');
    expect(loadRuns(file)).toEqual({});
    expect(fs.existsSync(file + '.bak')).toBe(true);
    addRun(file, 'g', 1000);
    expect(loadRuns(file).g).toHaveLength(1);
  });

  it('non-finite or negative ms makes the file invalid', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ g: [{ ms: -1, at: 'x' }] }));
    expect(loadRuns(file)).toEqual({});
    fs.writeFileSync(file, '{"g":[{"ms":1e999,"at":"x"}]}');
    expect(loadRuns(file)).toEqual({});
  });

  it('addRun rejects NaN or negative ms and leaves the file unchanged', () => {
    addRun(file, 'g', 1000);
    const before = fs.readFileSync(file, 'utf8');
    expect(() => addRun(file, 'g', NaN)).toThrow();
    expect(() => addRun(file, 'g', -5)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});
