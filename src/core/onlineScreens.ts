import type { CellBuffer } from './buffer';
import type { BoardView, SignIn } from './online/online';
import { GAME_WIDTH } from './types';
import type { Color } from './types';

const LOGIN_MAX = 39; // GitHub's limit

function clip(s: string, n: number): string {
  return n <= 0 ? '' : s.length > n ? s.slice(0, n) : s;
}

/** Text from the network: no control characters (they would reach the terminal), bounded length. */
function clean(s: string, max = GAME_WIDTH): string {
  return clip(String(s).replace(/\p{Cc}+/gu, ' '), max);
}

function centre(area: CellBuffer, y: number, s: string, c: Color = 'white'): void {
  area.text(Math.max(0, Math.floor((GAME_WIDTH - s.length) / 2)), y, clip(s, GAME_WIDTH), c);
}

/** Bottom row of the menu area. */
export function drawMenuHint(area: CellBuffer, account: { login: string } | null): void {
  const s = account ? `Online as ${clip(clean(account.login), GAME_WIDTH - 23)} · O: account` : 'O: share scores online';
  centre(area, 19, s, 'gray');
}

export function drawSignIn(area: CellBuffer, s: SignIn): void {
  if (s.phase === 'code') {
    centre(area, 6, `Open ${clean(s.verificationUri)}`, 'brightWhite');
    centre(area, 8, `and enter the code  ${clean(s.userCode)}`, 'brightWhite');
    centre(area, 11, 'Waiting for GitHub...', 'gray');
  } else if (s.phase === 'done') centre(area, 8, `Signed in as ${clean(s.login, LOGIN_MAX)}`, 'brightGreen');
  else if (s.phase === 'failed') centre(area, 8, clean(s.message), 'brightRed');
  else centre(area, 8, 'Asking GitHub...', 'gray');
  centre(area, 18, 'Esc: back', 'gray');
}

export function drawAccount(area: CellBuffer, login: string, confirming: boolean, message: string | null = null): void {
  centre(area, 6, `Signed in as ${clean(login, LOGIN_MAX)}`, 'brightWhite');
  // The hint is wider than the area: break it before its last item.
  centre(area, 9, 'S: sign out · D: sign out and delete my online scores', 'gray');
  centre(area, 10, 'Esc: back', 'gray');
  if (confirming) centre(area, 13, 'Delete all your online scores? Y/N', 'brightYellow');
  else if (message) {
    // One sentence per row: the messages are wider than the area.
    clean(message, 200).split(/(?<=\.) /).slice(0, 3).forEach((line, i) => centre(area, 13 + i, line, 'brightYellow'));
  }
}

/** Rows 5..17 of the results area. */
export function drawWorld(area: CellBuffer, view: BoardView, signedIn: boolean): void {
  if (view.status === 'loading') centre(area, 5, 'loading...', 'gray');
  else if (view.status === 'offline') centre(area, 5, 'offline', 'gray');
  else {
    const top = view.top.slice(0, 10);
    const me = view.me;
    const width = Math.max(0, ...top.map((r) => clean(r.login, LOGIN_MAX).length));
    top.forEach((r, i) => {
      const line = `${String(r.rank).padStart(2)}. ${clean(r.login, LOGIN_MAX).padEnd(width)} ${r.score}`;
      area.text(4, 5 + i, clip(line, GAME_WIDTH - 4), me && r.rank === me.rank ? 'brightYellow' : 'white');
    });
    if (me && !top.some((r) => r.rank === me.rank)) centre(area, 16, `Your rank: ${me.rank}`, 'brightYellow');
  }
  if (!signedIn) centre(area, 17, 'O in the menu to join', 'gray');
}
