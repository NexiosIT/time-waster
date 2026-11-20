import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverGames } from './discover.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'discover-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('discoverGames', () => {
  it('returns sorted folders containing index.ts', () => {
    mkdirSync(join(dir, 'worm')); writeFileSync(join(dir, 'worm', 'index.ts'), '');
    mkdirSync(join(dir, 'bricks')); writeFileSync(join(dir, 'bricks', 'index.ts'), '');
    mkdirSync(join(dir, 'notes'));
    writeFileSync(join(dir, 'registry.generated.ts'), '');
    expect(discoverGames(dir)).toEqual(['bricks', 'worm']);
  });
  it('returns [] for a missing dir', () => {
    expect(discoverGames(join(dir, 'nope'))).toEqual([]);
  });
  it('returns [] for an empty dir', () => {
    expect(discoverGames(dir)).toEqual([]);
  });
});
