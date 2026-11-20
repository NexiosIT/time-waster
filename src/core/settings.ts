import { loadJson, writeAtomic } from './jsonfile';

export type Settings = { heckle: boolean; sound: boolean };

const DEFAULTS: Settings = { heckle: true, sound: true };

function isSettings(d: unknown): d is Partial<Settings> {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return false;
  const { heckle, sound } = d as { heckle?: unknown; sound?: unknown };
  return (heckle === undefined || typeof heckle === 'boolean') && (sound === undefined || typeof sound === 'boolean');
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
