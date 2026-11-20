import { describe, it, expect } from 'vitest';
import { launchCommand, isOnPath } from './launch';

describe('launchCommand', () => {
  it('uses Windows Terminal when available, arcade path as one argv element', () => {
    expect(launchCommand('C:\\plugins\\tw', true)).toEqual({
      file: 'wt',
      args: ['-w', '0', 'nt', 'node', 'C:\\plugins\\tw\\dist\\arcade.js'],
      verbatim: false,
    });
  });

  it('keeps a root with spaces as a single unquoted element for wt (spawn quotes it)', () => {
    const { args } = launchCommand('C:\\Program Files\\tw', true);
    expect(args[args.length - 1]).toBe('C:\\Program Files\\tw\\dist\\arcade.js');
    expect(args).toHaveLength(5);
  });

  it('falls back to cmd start with an empty title and explicit quotes', () => {
    expect(launchCommand('C:\\plugins\\tw', false)).toEqual({
      file: 'cmd',
      args: ['/c', 'start "" cmd /c node "C:\\plugins\\tw\\dist\\arcade.js"'],
      verbatim: true,
    });
  });

  it('quotes a root with spaces in the cmd fallback', () => {
    const { args } = launchCommand('C:\\Program Files\\tw', false);
    expect(args[1]).toBe('start "" cmd /c node "C:\\Program Files\\tw\\dist\\arcade.js"');
  });

  it('normalises a forward-slash root to backslashes', () => {
    const { args } = launchCommand('C:/plugins/tw', true);
    expect(args[4]).toBe('C:\\plugins\\tw\\dist\\arcade.js');
  });
});

describe('isOnPath', () => {
  const dir = 'C:\\Users\\me\\.time-waster\\bin';
  it('matches an entry', () => {
    expect(isOnPath(dir, `C:\\Windows;${dir};C:\\x`)).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isOnPath(dir, 'c:\\users\\ME\\.TIME-WASTER\\bin')).toBe(true);
  });
  it('ignores a trailing backslash on either side', () => {
    expect(isOnPath(dir, `C:\\x;${dir}\\`)).toBe(true);
    expect(isOnPath(dir + '\\', `C:\\x;${dir}`)).toBe(true);
  });
  it('is false when absent, and ignores empty entries', () => {
    expect(isOnPath(dir, 'C:\\Windows;;C:\\x;')).toBe(false);
    expect(isOnPath(dir, '')).toBe(false);
  });
});
