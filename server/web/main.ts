// The play page's DOM glue: everything testable lives in controller.ts, keys.ts and grid.ts.
import { games } from '../../src/games/registry.generated';
import { PlayController } from './controller';
import { gridLines } from './grid';
import { keyFromEvent } from './keys';

type WebRow = { rank: number; name: string; score: number };

const PREVENT = new Set(['up', 'down', 'left', 'right', 'space', 'enter', 'escape', 'tab', 'backspace']);

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode or blocked: ignore */ }
}

function start(): void {
  const id = document.body.dataset.game ?? '';
  const game = games.find((g) => g.id === id);
  const grid = document.getElementById('grid') as HTMLPreElement;
  const status = document.getElementById('status') as HTMLElement;
  const form = document.getElementById('save') as HTMLFormElement;
  const nameInput = document.getElementById('name') as HTMLInputElement;
  const button = form.querySelector('button') as HTMLButtonElement;
  const msg = document.getElementById('save-msg') as HTMLElement;
  const board = document.getElementById('web-board') as HTMLElement;
  if (!game) { status.textContent = 'This game is not available.'; return; }

  const bestKey = `tw-best-${id}`;
  const c = new PlayController({
    game,
    nowMs: performance.now(),
    seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
    loadBest: () => {
      const v = Number(storageGet(bestKey));
      return storageGet(bestKey) !== null && Number.isFinite(v) ? v : null;
    },
    saveBest: (n) => storageSet(bestKey, String(n)),
  });
  c.onExit = () => { location.href = `/games/${encodeURIComponent(id)}`; };

  nameInput.value = storageGet('tw-name') ?? '';
  // Any focus inside the form (the name field or the Save button) keeps keys away from the game.
  form.addEventListener('focusin', () => { c.nameFocused = true; });
  form.addEventListener('focusout', () => { c.nameFocused = false; });

  let savedRun: object | null = null;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = c.result;
    if (!result || savedRun === result) return;
    const name = nameInput.value;
    button.disabled = true;
    msg.textContent = 'Saving…';
    fetch('/v1/web-scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: id, name, score: result.score }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { error?: string; top?: WebRow[] };
        if (!res.ok) throw new Error(body.error ?? `error ${res.status}`);
        savedRun = result;
        storageSet('tw-name', name.trim());
        msg.textContent = 'Saved';
        nameInput.disabled = true;
        if (body.top) renderBoard(board, body.top);
        nameInput.blur();
        grid.focus();
      })
      .catch((err: unknown) => {
        msg.textContent = err instanceof Error ? err.message : 'Could not save';
        button.disabled = false;
      });
  });

  document.addEventListener('keydown', (e) => {
    if (c.nameFocused) return;
    const k = keyFromEvent(e);
    if (k === null) return;
    if (PREVENT.has(k)) e.preventDefault();
    c.key(k, performance.now());
  });
  document.addEventListener('visibilitychange', () => c.setHidden(document.hidden, performance.now()));

  const shown: string[] = [];
  let lastState = '';
  let lastStatus = '';
  const frame = () => {
    const now = performance.now();
    c.tick(now);
    const lines = gridLines(c.frame());
    if (grid.childNodes.length !== lines.length) {
      grid.replaceChildren(...lines.map(() => document.createElement('div')));
      shown.length = 0;
    }
    lines.forEach((html, y) => {
      if (shown[y] !== html) {
        (grid.childNodes[y] as HTMLElement).innerHTML = html; // gridLines escapes every character
        shown[y] = html;
      }
    });
    const text = c.status();
    if (text !== lastStatus) { status.textContent = text; lastStatus = text; }
    if (c.state !== lastState) {
      lastState = c.state;
      const results = c.state === 'results';
      form.hidden = !results;
      if (results) {
        nameInput.disabled = false;
        button.disabled = false;
        msg.textContent = '';
      }
    }
    requestAnimationFrame(frame);
  };
  grid.focus();
  requestAnimationFrame(frame);
}

function renderBoard(el: HTMLElement, top: WebRow[]): void {
  if (!top.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No web scores yet.';
    el.replaceChildren(empty);
    return;
  }
  el.replaceChildren(...top.map((r) => {
    const row = document.createElement('div');
    row.className = 'row';
    for (const [cls, text] of [['rank', `${r.rank}.`], ['who', r.name], ['score', String(r.score)]]) {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = text;
      row.append(span);
    }
    return row;
  }));
}

start();
