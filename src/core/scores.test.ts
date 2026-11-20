import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addScore, bestScore, loadScores } from './scores';
import { dataDir, scoresFile, eventsFile, binDir } from './paths';

let tmp: string;
let file: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scores-'));
  file = path.join(tmp, 'sub', 'scores.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('paths', () => {
  it('derives locations from home', () => {
    expect(dataDir('H')).toBe(path.join('H', '.time-waster'));
    expect(scoresFile('H')).toBe(path.join('H', '.time-waster', 'scores.json'));
    expect(eventsFile('H')).toBe(path.join('H', '.time-waster', 'events.jsonl'));
    expect(binDir('H')).toBe(path.join('H', '.time-waster', 'bin'));
  });
});

describe('scores', () => {
  it('missing dir/file gives {} and addScore creates the dir', () => {
    expect(loadScores(file)).toEqual({});
    expect(bestScore(file, 'worm')).toBeNull();
    addScore(file, 'worm', 3);
    expect(fs.existsSync(file)).toBe(true);
    expect(bestScore(file, 'worm')).toBe(3);
  });

  it('keeps top 10 sorted desc; lower 11th gets rank null', () => {
    for (let i = 1; i <= 10; i++) addScore(file, 'g', i * 10);
    const r = addScore(file, 'g', 5);
    expect(r.rank).toBeNull();
    expect(r.top.map((e) => e.score)).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]);
    const r2 = addScore(file, 'g', 55);
    expect(r2.rank).toBe(6);
    expect(r2.top).toHaveLength(10);
    expect(loadScores(file).g).toHaveLength(10);
  });

  it('isBest only when strictly greater than all previous', () => {
    expect(addScore(file, 'g', 10).isBest).toBe(true);
    expect(addScore(file, 'g', 10).isBest).toBe(false);
    expect(addScore(file, 'g', 11).isBest).toBe(true);
    expect(addScore(file, 'h', 1).isBest).toBe(true);
  });

  it('ties rank after older equal scores', () => {
    addScore(file, 'g', 10, new Date('2026-01-01'));
    const r = addScore(file, 'g', 10, new Date('2026-01-02'));
    expect(r.rank).toBe(2);
    expect(r.top[0].at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('corrupt file is backed up and treated as empty', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    expect(loadScores(file)).toEqual({});
    expect(fs.existsSync(file + '.bak')).toBe(true);
    expect(fs.readFileSync(file + '.bak', 'utf8')).toBe('{oops');
  });

  it('structurally invalid JSON is treated as corrupt', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ g: [{ score: 'x', at: 1 }] }));
    expect(loadScores(file)).toEqual({});
    expect(fs.existsSync(file + '.bak')).toBe(true);
    fs.writeFileSync(file, '[1,2]');
    expect(loadScores(file)).toEqual({});
  });

  it('re-reads before write so external entries survive', () => {
    addScore(file, 'worm', 5);
    const data = loadScores(file);
    data.worm.push({ score: 6, at: '2026-01-01T00:00:00.000Z' });
    fs.writeFileSync(file, JSON.stringify(data));
    addScore(file, 'worm', 7);
    expect(loadScores(file).worm.map((e) => e.score)).toEqual([7, 6, 5]);
  });

  it('leaves no tmp files behind', () => {
    addScore(file, 'g', 1);
    addScore(file, 'g', 2);
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects non-finite scores without touching the file', () => {
    expect(() => addScore(file, 'g', NaN)).toThrow();
    expect(() => addScore(file, 'g', Infinity)).toThrow();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('does not back up a file replaced by valid content after a corrupt read', () => {
    addScore(file, 'g', 1);
    const good = fs.readFileSync(file, 'utf8');
    const real = fs.readFileSync;
    let calls = 0;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((f: any, o: any) => {
      calls++;
      if (calls === 1) return '{oops';
      return real(f, o);
    }) as any);
    // first read returns corrupt text, re-read returns the real (valid) content
    expect(loadScores(file).g).toHaveLength(1);
    expect(fs.existsSync(file + '.bak')).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(good);
  });

  describe('failure paths', () => {
    const err = (code: string) => Object.assign(new Error(code), { code });

    it('retries transient rename errors then succeeds', () => {
      const real = fs.renameSync;
      let n = 0;
      vi.spyOn(fs, 'renameSync').mockImplementation(((a: any, b: any) => {
        if (n++ < 2) throw err('EPERM');
        return real(a, b);
      }) as any);
      addScore(file, 'g', 4);
      expect(n).toBe(3);
      expect(bestScore(file, 'g')).toBe(4);
    });

    it('persistent EPERM throws, removes tmp, keeps original', () => {
      addScore(file, 'g', 4);
      const before = fs.readFileSync(file, 'utf8');
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw err('EPERM');
      });
      expect(() => addScore(file, 'g', 9)).toThrow();
      expect(spy).toHaveBeenCalledTimes(5);
      spy.mockRestore();
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
      expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('non-transient rename error is not retried', () => {
      const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw err('ENOSPC');
      });
      expect(() => addScore(file, 'g', 1)).toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
      expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });

    it('persistent read EPERM makes addScore throw and leaves file unchanged', () => {
      addScore(file, 'g', 4);
      const before = fs.readFileSync(file, 'utf8');
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw err('EPERM');
      });
      expect(() => addScore(file, 'g', 9)).toThrow();
      vi.restoreAllMocks();
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });

    it('removes a partial tmp when the tmp write fails', () => {
      vi.spyOn(fs, 'writeFileSync').mockImplementation(((f: any) => {
        fs.appendFileSync(f, 'partial');
        throw err('ENOSPC');
      }) as any);
      expect(() => addScore(file, 'g', 1)).toThrow();
      vi.restoreAllMocks();
      expect(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    });
  });
});
