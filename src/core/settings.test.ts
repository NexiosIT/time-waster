import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { loadSettings, saveSettings } from './settings';

let dir: string, file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-')); file = path.join(dir, 'sub', 'settings.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const DEFAULTS = { heckle: true, sound: true };

describe('settings', () => {
  it('defaults to heckling and sound on when the file is missing, corrupt or the wrong shape', () => {
    expect(loadSettings(file)).toEqual(DEFAULTS);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    expect(loadSettings(file)).toEqual(DEFAULTS);
    fs.writeFileSync(file, JSON.stringify({ heckle: 'yes' }));
    expect(loadSettings(file)).toEqual(DEFAULTS);
    fs.writeFileSync(file, JSON.stringify({ sound: 1 }));
    expect(loadSettings(file)).toEqual(DEFAULTS);
  });

  it('an older file without the sound setting keeps its heckle choice and gets sound on', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ heckle: false }));
    expect(loadSettings(file)).toEqual({ heckle: false, sound: true });
  });

  it('round-trips', () => {
    saveSettings(file, { heckle: false, sound: false });
    expect(loadSettings(file)).toEqual({ heckle: false, sound: false });
    saveSettings(file, { heckle: true, sound: false });
    expect(loadSettings(file)).toEqual({ heckle: true, sound: false });
  });
});
