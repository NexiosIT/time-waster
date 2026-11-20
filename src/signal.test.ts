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
  it('start appends a start event', () => {
    main(['start'], '', home);
    const ev = JSON.parse(fs.readFileSync(eventsFile(home), 'utf8').trim());
    expect(ev).toMatchObject({ type: 'start', project: path.win32.basename(process.cwd()) });
  });
  it('estimate writes minutes', () => {
    main(['estimate', '5'], '', home);
    const ev = JSON.parse(fs.readFileSync(eventsFile(home), 'utf8').trim());
    expect(ev).toMatchObject({ type: 'estimate', minutes: 5 });
  });
  it('estimate rejects bad values', () => {
    for (const a of [['estimate', '0'], ['estimate', '121'], ['estimate', 'x'], ['estimate', '1.5'], ['estimate']]) {
      expect(() => main(a, '', home)).not.toThrow();
    }
    expect(fs.existsSync(eventsFile(home))).toBe(false);
  });
  it('--cwd sets the project for start and estimate, anywhere after the command', () => {
    main(['start', '--cwd', 'C:\\x\\demo'], '', home);
    main(['estimate', '--cwd', 'C:\\x\\other', '7'], '', home);
    main(['estimate', '8', '--cwd', 'C:\\x\\third'], '', home);
    const evs = fs.readFileSync(eventsFile(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(evs[0]).toMatchObject({ type: 'start', project: 'demo' });
    expect(evs[1]).toMatchObject({ type: 'estimate', minutes: 7, project: 'other' });
    expect(evs[2]).toMatchObject({ type: 'estimate', minutes: 8, project: 'third' });
  });
  it('done --cwd sets the project from the path, with empty stdin', () => {
    main(['done', '--cwd', 'C:\\x\\demo'], '', home);
    const ev = JSON.parse(fs.readFileSync(eventsFile(home), 'utf8').trim());
    expect(ev).toMatchObject({ type: 'done', project: 'demo' });
  });
  it('done --cwd wins over a stdin cwd; without --cwd the stdin cwd stands', () => {
    main(['done', '--cwd', 'C:\\x\\flag'], JSON.stringify({ cwd: 'C:\\x\\stdin' }), home);
    main(['done'], JSON.stringify({ cwd: 'C:\\x\\stdin' }), home);
    const evs = fs.readFileSync(eventsFile(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(evs[0]).toMatchObject({ type: 'done', project: 'flag' });
    expect(evs[1]).toMatchObject({ type: 'done', project: 'stdin' });
  });
  it('done with no usable stdin and no --cwd still writes, for the process folder like start', () => {
    main(['done'], 'not json', home);
    main(['start'], '', home);
    const evs = fs.readFileSync(eventsFile(home), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(evs[0]).toMatchObject({ type: 'done', project: path.win32.basename(process.cwd()) });
    expect(evs[0].project).toBe(evs[1].project);
  });
});
