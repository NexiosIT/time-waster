import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isFresh, isArcadeRunning, touchAlive, clearAlive, STALE_MS } from './alive';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-alive-')), 'sub', 'arcade.alive');

describe('isFresh', () => {
  it('is true within the stale window and false after it', () => {
    expect(isFresh(1000, 1000 + STALE_MS - 1)).toBe(true);
    expect(isFresh(1000, 1000 + STALE_MS)).toBe(false);
  });
  it('treats a timestamp from the future (clock skew) as fresh', () => {
    expect(isFresh(5000, 1000)).toBe(true);
  });
});

describe('heartbeat file', () => {
  it('is not running when the file is missing', () => {
    expect(isArcadeRunning(tmpFile(), Date.now())).toBe(false);
  });
  it('is running right after a touch (creating the folder), and not once stale', () => {
    const f = tmpFile();
    touchAlive(f);
    expect(isArcadeRunning(f, Date.now())).toBe(true);
    expect(isArcadeRunning(f, Date.now() + STALE_MS + 1000)).toBe(false);
  });
  it('is not running after clear, and clear on a missing file does not throw', () => {
    const f = tmpFile();
    touchAlive(f);
    clearAlive(f);
    expect(isArcadeRunning(f, Date.now())).toBe(false);
    expect(() => clearAlive(f)).not.toThrow();
  });
});
