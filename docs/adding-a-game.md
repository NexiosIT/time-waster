# Adding a game

A game is one folder, `src/games/<id>/`, with an `index.ts` that default-exports a
`Game` object. The build finds it automatically (it scans `src/games/*/index.ts`), so
you never edit a shared file. This page is written so you can hand it to Claude as
instructions: "Read docs/adding-a-game.md and build me a game called ...".

## Rules (read these first)

- Touch **only** `src/games/<id>/`. No edits to `src/core/`, other games, `dist/`, `package.json`
  or any generated file.
- `<id>` is the folder name and the high-score key. It must match `/^[a-z0-9-]+$/`.
- Start by copying `src/games/worm/` (it is the reference implementation) and renaming.
- Use only **single-width characters**. No emoji and no wide CJK: they take two cells
  and break the column layout. Box-drawing and block characters (`█ ▓ ● ─ │`) are fine.
- State is **plain data** (objects, arrays, numbers, strings) and every function is
  **pure**: return a new state, never mutate the one you were given.
- Never use `Math.random()` or `Date.now()` in game logic. Use `ctx.random()` for
  randomness and `ctx.elapsedMs` for time. This keeps games testable and replayable.
- The host owns **P** (pause), **Esc** (end the run) and **Ctrl+C** (quit). A game never
  receives these keys and cannot override them. Do not bind them.
- Don't throw on purpose. If a game function throws, the host catches it and shows a
  crash screen for your game only; the arcade and the score file are safe.

## The contract

From `src/core/types.ts`:

```ts
interface GameContext { random(): number; elapsedMs: number }

interface Game<S> {
  id: string;            // same as the folder name
  title: string;         // shown in the menu (menu is sorted by title)
  description: string;   // one line, shown in the menu
  tickMs: number;        // how often update() runs, e.g. 120
  controls: string;      // short key hint for the status line, e.g. '←↑→↓ turn'
  init(ctx: GameContext): S;                 // fresh state at the start of a run
  onKey(state: S, key: Key): S;              // one key press
  update(state: S, ctx: GameContext): S;     // one tick (every tickMs)
  draw(state: S, screen: Screen): void;      // paint the current state
  score(state: S): number;                   // current score
  isOver(state: S): boolean;                 // true ends the run; score is saved
}
```

### `maxScore` (optional)

A game may also set `maxScore: number`, the highest score a run can possibly reach. The
online leaderboard refuses any submitted score above it, so set it to a true upper bound
(worm uses `5220`: 29 x 18 cells x 10 points per dot). Leave it out and the server accepts
scores up to `1_000_000`. It has no effect on local play or the local high-score file.

`Key` is a normalised name: `up | down | left | right | space | enter | escape |
backspace | tab`, or a single lowercase letter, digit or symbol (`'a'`, `'1'`, `'-'`).

`Screen` has `width`, `height`, `put(x, y, ch, color?)`, `text(x, y, s, color?)` and
`clear()`. Colours are the 16 ANSI names in `Color` (`'red'`, `'brightGreen'`, `'gray'`,
...), so a game looks the same in conhost and Windows Terminal.

The host calls `init` once, `onKey` per key press, `update` every `tickMs`, then
`isOver`; `draw` paints onto an already-cleared screen.

## Input is press-only

Terminals report key *presses*, not releases, and key repeat is OS-driven. Design for
presses: "press left to turn left", "press space to jump". Don't design anything that
needs a key to be held down or two keys at once.

## The play area

- You draw in a fixed **60 x 20** grid (`GAME_WIDTH`, `GAME_HEIGHT` from
  `src/core/types.ts`), coordinates `(0,0)` top-left to `(59,19)`.
- The host adds its own rows around it: a banner row on top (used when Claude is done or
  needs you) and a status line at the bottom. You never draw in those; just use the 60 x 20
  area.

## Develop and test

```
npm run dev -- <id>     # build into .dev/ (git-ignored), then start the arcade in your game
npm test                # run all tests
npm run typecheck       # type-check before you finish
```

Write `src/games/<id>/<id>.test.ts` and test **through the contract** with a fixed seed,
like `src/games/worm/worm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRandom } from '../../core/random';
import game from './index';

const ctx = { random: createRandom(1), elapsedMs: 0 };

describe('my game', () => {
  it('starts at score 0 and survives a tick', () => {
    const s0 = game.init(ctx);
    const s1 = game.update(game.onKey(s0, 'left'), ctx);
    expect(game.score(s1)).toBe(0);
    expect(game.isOver(s1)).toBe(false);
  });
});
```

Cover: initial state, that `onKey` and `update` don't mutate their input, the scoring
rule, and when `isOver` becomes true.

## Commit

Commit your `src/games/<id>/` folder only. **Do not commit `dist/`** on your branch
(run `npm run build` locally to play). After the branch is merged to `main`, whoever
merges runs `npm run build` and commits the rebuilt `dist/` on `main`; the plugin is
installed straight from git, so `dist/` is committed there and only there.
