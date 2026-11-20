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

type KeyEvent = { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean };
type State = 'ready' | 'playing' | 'results' | 'crashed';

// Keys that would scroll the page or trigger browser behaviour while a game is running. Tab is
// never taken, so the page stays keyboard-navigable.
const PREVENT_PLAYING = new Set<Key>(['up', 'down', 'left', 'right', 'space', 'enter', 'escape', 'backspace']);

/**
 * What the play page does with a key press: the arcade key to hand to the controller (or null to
 * leave it to the browser), and whether to stop the browser's default action. Outside a run only
 * fresh Enter and Esc presses act, so a held key can't skip the results screen.
 */
export function keyAction(e: KeyEvent, state: State, inForm: boolean): { key: Key | null; prevent: boolean } {
  const none = { key: null, prevent: false };
  if (inForm) return none;
  const k = keyFromEvent(e);
  if (k === null || k === 'tab') return none;
  if (state === 'playing') return { key: k, prevent: PREVENT_PLAYING.has(k) };
  if (e.repeat || (k !== 'enter' && k !== 'escape')) return none;
  return { key: k, prevent: true };
}
