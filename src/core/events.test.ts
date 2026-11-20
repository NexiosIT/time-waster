import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { toEvent, writeShim, appendEvent, trimEvents, readNewEvents, EventWatcher, ClaudeEvent } from './events';

const NOW = new Date('2026-11-20T10:00:00.000Z');
let tmp: string;
let file: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'events-'));
  file = path.join(tmp, 'events.jsonl');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const line = (type: 'done' | 'attention', at: string, project = 'p') => JSON.stringify({ type, at, project }) + '\n';

describe('toEvent', () => {
  it('done uses basename of cwd', () => {
    expect(toEvent('done', JSON.stringify({ cwd: 'C:\\code\\order-app' }), NOW)).toEqual({
      type: 'done',
      at: NOW.toISOString(),
      project: 'order-app',
    });
  });
  it('keeps permission_prompt', () => {
    const ev = toEvent('attention', JSON.stringify({ cwd: 'C:\\x\\a', notification_type: 'permission_prompt' }), NOW);
    expect(ev?.type).toBe('attention');
  });
  it('drops idle_prompt', () => {
    expect(toEvent('attention', JSON.stringify({ notification_type: 'idle_prompt' }), NOW)).toBeNull();
  });
  it('drops untyped "waiting for your input" message', () => {
    expect(toEvent('attention', JSON.stringify({ message: 'Claude is waiting for your input' }), NOW)).toBeNull();
  });
  it('keeps other untyped messages', () => {
    expect(toEvent('attention', JSON.stringify({ message: 'Claude needs your permission' }), NOW)).not.toBeNull();
  });
  it('tolerates a leading BOM', () => {
    expect(toEvent('done', '\uFEFF' + JSON.stringify({ cwd: 'C:\\a\\b' }), NOW)?.project).toBe('b');
  });
  it('bad JSON gives empty project', () => {
    expect(toEvent('done', 'not json', NOW)).toEqual({ type: 'done', at: NOW.toISOString(), project: '' });
    expect(toEvent('done', 'null', NOW)?.project).toBe('');
  });
});

describe('writeShim', () => {
  it('writes arcade.cmd', () => {
    const bin = path.join(tmp, 'bin');
    writeShim(bin, 'C:\\plug');
    expect(fs.readFileSync(path.join(bin, 'arcade.cmd'), 'utf8')).toBe('@node "C:\\plug\\dist\\arcade.js" %*\r\n');
  });
});

describe('readNewEvents', () => {
  it('missing file', () => {
    expect(readNewEvents(file, 5)).toEqual({ events: [], offset: 0 });
  });
  it('returns only lines after offset', () => {
    fs.writeFileSync(file, line('done', 'a') + line('done', 'b'));
    const first = readNewEvents(file, 0);
    expect(first.events.map((e) => e.at)).toEqual(['a', 'b']);
    fs.appendFileSync(file, line('attention', 'c'));
    const second = readNewEvents(file, first.offset);
    expect(second.events.map((e) => e.at)).toEqual(['c']);
  });
  it('waits for partial lines', () => {
    fs.writeFileSync(file, '{"type":"done"');
    expect(readNewEvents(file, 0)).toEqual({ events: [], offset: 0 });
    fs.appendFileSync(file, ',"at":"x","project":"p"}\n');
    const r = readNewEvents(file, 0);
    expect(r.events).toHaveLength(1);
    expect(r.offset).toBe(fs.statSync(file).size);
  });
  it('reads from 0 when truncated', () => {
    fs.writeFileSync(file, line('done', 'a') + line('done', 'b'));
    const r = readNewEvents(file, 10000);
    expect(r.events).toHaveLength(2);
  });
  it('skips invalid lines and counts bytes for non-ASCII', () => {
    fs.writeFileSync(file, 'garbage\n{"type":"nope","at":"x","project":"p"}\n[1]\n' + line('done', 'a', 'prøject-é'));
    const r = readNewEvents(file, 0);
    expect(r.events).toEqual([{ type: 'done', at: 'a', project: 'prøject-é' }]);
    expect(r.offset).toBe(fs.statSync(file).size);
    fs.appendFileSync(file, line('done', 'b'));
    expect(readNewEvents(file, r.offset).events.map((e) => e.at)).toEqual(['b']);
  });
});

describe('appendEvent / trimEvents', () => {
  it('append creates dir and trim keeps last 100 of 150', () => {
    const f = path.join(tmp, 'deep', 'e.jsonl');
    for (let i = 0; i < 150; i++) appendEvent(f, { type: 'done', at: String(i), project: 'p' });
    trimEvents(f);
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(100);
    expect((JSON.parse(lines[0]) as ClaudeEvent).at).toBe('50');
    expect((JSON.parse(lines[99]) as ClaudeEvent).at).toBe('149');
  });
  it('trim on missing file is a no-op', () => {
    expect(() => trimEvents(file)).not.toThrow();
  });
});

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}
const fresh = () => new Date(Date.now() + 1000).toISOString();

describe('EventWatcher', () => {
  let w: EventWatcher | undefined;
  afterEach(() => w?.stop());

  it('starts at end of file and reports new events', async () => {
    fs.writeFileSync(file, line('done', '2000-01-01T00:00:00Z'));
    const got: ClaudeEvent[] = [];
    w = new EventWatcher(file, (e) => got.push(e), 20);
    w.start();
    fs.appendFileSync(file, line('attention', fresh(), 'new'));
    await until(() => got.length > 0);
    expect(got.map((e) => e.project)).toEqual(['new']);
  });

  it('ignores stale events after truncate+rewrite, then fires on a new one', async () => {
    fs.writeFileSync(file, line('done', '2000-01-01T00:00:00Z') + line('done', '2000-01-02T00:00:00Z'));
    const got: ClaudeEvent[] = [];
    w = new EventWatcher(file, (e) => got.push(e), 20);
    w.start();
    fs.writeFileSync(file, line('done', '2000-01-03T00:00:00Z'));
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toEqual([]);
    fs.appendFileSync(file, line('done', fresh(), 'fresh'));
    await until(() => got.length > 0);
    expect(got.map((e) => e.project)).toEqual(['fresh']);
  });

  it('does not replay an already delivered event after another window trims the file', async () => {
    const got: ClaudeEvent[] = [];
    w = new EventWatcher(file, (e) => got.push(e), 20);
    w.start();
    const t1 = fresh();
    fs.appendFileSync(file, line('done', t1, 'one'));
    await until(() => got.length > 0);
    const t0 = new Date(Date.parse(t1) - 500).toISOString();
    fs.writeFileSync(file, line('done', t0, 'older') + line('done', t1, 'one'));
    await new Promise((r) => setTimeout(r, 150));
    expect(got.map((e) => e.project)).toEqual(['one']);
    fs.appendFileSync(file, line('done', new Date(Date.parse(t1) + 500).toISOString(), 'newer'));
    await until(() => got.length > 1);
    expect(got.map((e) => e.project)).toEqual(['one', 'newer']);
  });

  it('tolerates a missing dir and fs.watch throwing; poll still works', async () => {
    const f = path.join(tmp, 'nope', 'sub', 'events.jsonl');
    vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw new Error('boom');
    });
    const got: ClaudeEvent[] = [];
    w = new EventWatcher(f, (e) => got.push(e), 20);
    expect(() => w!.start()).not.toThrow();
    appendEvent(f, { type: 'done', at: fresh(), project: 'late' });
    await until(() => got.length > 0);
    expect(got.map((e) => e.project)).toEqual(['late']);
  });

  it('stop halts delivery', async () => {
    const got: ClaudeEvent[] = [];
    w = new EventWatcher(file, (e) => got.push(e), 20);
    w.start();
    w.stop();
    fs.appendFileSync(file, line('done', fresh()));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual([]);
  });
});
