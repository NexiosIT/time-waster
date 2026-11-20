import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import { loadSettings, saveSettings } from './settings';

let dir: string, file: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-')); file = path.join(dir, 'sub', 'settings.json'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('settings', () => {
  it('defaults to heckling on when the file is missing, corrupt or the wrong shape', () => {
    expect(loadSettings(file)).toEqual({ heckle: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');
    expect(loadSettings(file)).toEqual({ heckle: true });
    fs.writeFileSync(file, JSON.stringify({ heckle: 'yes' }));
    expect(loadSettings(file)).toEqual({ heckle: true });
  });

  it('round-trips', () => {
    saveSettings(file, { heckle: false });
    expect(loadSettings(file)).toEqual({ heckle: false });
  });
});
