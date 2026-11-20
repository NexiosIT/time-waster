import { loadJson, writeAtomic } from './jsonfile';

export type Settings = { heckle: boolean };

const DEFAULTS: Settings = { heckle: true };

function isSettings(d: unknown): d is Partial<Settings> {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return false;
  const h = (d as { heckle?: unknown }).heckle;
  return h === undefined || typeof h === 'boolean';
}

/** Player settings; missing, corrupt or unreadable means the defaults. */
export function loadSettings(file: string): Settings {
  try {
    return { ...DEFAULTS, ...(loadJson(file, isSettings) ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(file: string, s: Settings): void {
  writeAtomic(file, s);
}
