import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from './signal';
import { eventsFile, binDir } from './core/paths';

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('signal main', () => {
  it('done appends an event', () => {
    main(['done'], JSON.stringify({ cwd: 'C:\\x\\demo' }), home);
    const ev = JSON.parse(fs.readFileSync(eventsFile(home), 'utf8').trim());
    expect(ev).toMatchObject({ type: 'done', project: 'demo' });
  });
  it('dropped attention writes nothing', () => {
    main(['attention'], JSON.stringify({ notification_type: 'idle_prompt' }), home);
    expect(fs.existsSync(eventsFile(home))).toBe(false);
  });
  it('unknown or missing argv writes nothing and never throws', () => {
    expect(() => main(['nonsense'], '', home)).not.toThrow();
    expect(() => main([], '', home)).not.toThrow();
    expect(fs.existsSync(path.join(home, '.time-waster'))).toBe(false);
  });
  it('shim writes arcade.cmd', () => {
    main(['shim'], '', home);
    expect(fs.existsSync(path.join(binDir(home), 'arcade.cmd'))).toBe(true);
  });
  it('swallows I/O errors', () => {
    fs.writeFileSync(path.join(home, '.time-waster'), 'a file, not a dir');
    expect(() => main(['done'], '{}', home)).not.toThrow();
  });
});
