import type { Key } from '../../src/core/types';

const NAMED: Record<string, Key> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  ' ': 'space', Enter: 'enter', Escape: 'escape', Backspace: 'backspace', Tab: 'tab',
};

/** The arcade key for a browser key event, or null when the browser should keep it. */
export function keyFromEvent(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Key | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const named = NAMED[e.key];
  if (named) return named;
  return [...e.key].length === 1 ? e.key.toLowerCase() : null;
}
