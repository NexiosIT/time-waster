export const WEB_NAME_MAX = 20;
const NAME = new RegExp(`^[\\p{L}\\p{N} _.-]{1,${WEB_NAME_MAX}}$`, 'u');

/** A typed web name, trimmed with inner whitespace collapsed, or null when it isn't allowed. */
export function normalizeWebName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/[^\S ]/.test(raw.trim())) return null; // tabs, newlines and other non-space whitespace inside
  const name = raw.trim().replace(/ +/g, ' ');
  return NAME.test(name) ? name : null;
}
