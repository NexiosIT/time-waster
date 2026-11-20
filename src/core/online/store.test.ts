import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadAccount, saveAccount, clearAccount, appendOutbox, readOutbox, writeOutbox } from './store';
import { accountFile, outboxFile } from '../paths';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'online-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('paths', () => {
  it('puts online files in the data dir', () => {
    expect(accountFile('/h')).toBe(path.join('/h', '.time-waster', 'online.json'));
    expect(outboxFile('/h')).toBe(path.join('/h', '.time-waster', 'outbox.jsonl'));
  });
});

describe('account', () => {
  it('account round-trips; missing or corrupt online.json loads as null', () => {
    const file = path.join(tmp, 'sub', 'online.json');
    expect(loadAccount(file)).toBeNull();
    const a = { serverUrl: 'https://x.test', token: 't', login: 'bob' };
    saveAccount(file, a);
    expect(loadAccount(file)).toEqual(a);
    fs.writeFileSync(file, '{"serverUrl": "x", "tok');
    expect(loadAccount(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ serverUrl: 'x', token: 1, login: 'b' }));
    expect(loadAccount(file)).toBeNull();
    fs.writeFileSync(file, 'null');
    expect(loadAccount(file)).toBeNull();
    saveAccount(file, a);
    clearAccount(file);
    expect(loadAccount(file)).toBeNull();
    expect(() => clearAccount(file)).not.toThrow();
  });
});

describe('outbox', () => {
  it('outbox appends, skips corrupt lines and keeps only the last 50 on write', () => {
    const file = path.join(tmp, 'sub', 'outbox.jsonl');
    expect(readOutbox(file)).toEqual([]);
    appendOutbox(file, { game: 'snake', score: 1, at: 'a' });
    fs.appendFileSync(file, 'garbage\n{"game":"x"}\n\n');
    appendOutbox(file, { game: 'snake', score: 2, at: 'b' });
    expect(readOutbox(file)).toEqual([
      { game: 'snake', score: 1, at: 'a' },
      { game: 'snake', score: 2, at: 'b' },
    ]);
    const many = Array.from({ length: 60 }, (_, i) => ({ game: 'g', score: i, at: 't' }));
    writeOutbox(file, many);
    const back = readOutbox(file);
    expect(back).toHaveLength(50);
    expect(back[0].score).toBe(10);
    expect(back[49].score).toBe(59);
    writeOutbox(file, []);
    expect(readOutbox(file)).toEqual([]);
  });
});
