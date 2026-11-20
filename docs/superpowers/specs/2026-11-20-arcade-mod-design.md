# Time-waster: terminal arcade for Claude Code — design

Date: 2026-11-20
Status: draft, awaiting approval

## Intent

Three colleagues at Nexios want something fun to do while Claude Code is busy.
They play small arcade games in a terminal window next to Claude. When Claude
finishes (or needs them), a banner appears inside the game. The game never
pauses, closes or steals focus because of it: you finish your run, then switch
back. Each player keeps local high scores per game.

The repo (`NexiosIT/time-waster`, currently only a README) is built in two
phases:

1. **Foundation**: built once, first. Everything games share.
2. **Games**: the three colleagues add games in parallel, each in its own
   folder, without touching shared files.

## Goals

- A Claude Code plugin that, once installed, makes Claude signal the arcade when
  it finishes a turn or needs attention.
- A terminal arcade (menu + games) that shows those signals as a banner over any
  running game without interrupting it.
- Local high scores per game (best + top 10), visible in the menu and in-game.
- A small, fixed game contract so a new game is one folder and a few hundred
  lines, and nobody can break the banner, input or scores from inside a game.
- One example game plus a "how to add a game" guide, so each colleague can build
  games with Claude from the guide and get consistent results.

## Non-goals (first version)

- Shared or online leaderboards. Scores are per machine; you only see your own.
  The score store sits behind one module so a shared one can be added later.
- Player names / accounts.
- macOS / Linux. Windows only (all three run Windows).
- Games that need held keys (see Constraints).
- Saving a half-finished run after closing the arcade. A run survives Claude
  finishing and restarting; closing the arcade ends the run (score is saved).
- Sound.

## Anti-goals (failure even if it "works")

- The banner pauses, ends or resets a run, or takes keyboard focus.
- The arcade window grabs focus or pops up over Claude by itself.
- Visible flicker in Windows Terminal.
- A bug in one game kills the whole arcade or corrupts the score file.
- Adding a game requires editing a shared file that the others also edit
  (merge conflicts every time).

## Constraints

- **Windows Terminal / conhost.** Terminals report key presses, not key
  releases, and key repeat is OS-driven. Games are designed around presses: a
  press changes direction or moves one step (snake-like, grid, turn-based,
  timing games). "Hold to move" is out.
- **Redraw.** Only changed cells are written each frame (double buffer + diff),
  cursor hidden, alternate screen buffer, to avoid flicker.
- **Node.js 20+** must be on PATH (Claude Code's native installer does not
  guarantee this; README states it).
- **No runtime dependencies to install.** The plugin is installed from git with
  no `npm install` step, so the built JS bundle is committed (see Build).
- **Claude Code queues slash commands while it is busy.** So `/arcade` cannot
  be the way to start the game mid-task. The arcade is meant to be opened once
  and left running (menu between runs). It can be started with `/arcade` when
  Claude is idle, or with `arcade` in any terminal at any time (see "The
  `arcade` command" below).
- **Distribution.** `NexiosIT/time-waster` is a public repo (checked
  2026-11-20), so installing the plugin needs no GitHub credentials.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Panel inside Claude Code next to the chat | Most "mod-like", but unclear whether a panel can take real-time key input while the chat input also wants keys; needed a spike. |
| **B** | **Terminal game in its own window, plugin hooks signal it** | **Chosen by the team.** Stays in the terminal, simple, no server. Cost: press-only input, must manage redraw to avoid flicker. |
| C | Browser tab served by a tiny local server | Best graphics and key handling, but a separate browser window and a server process. |

The team picked **B**.

## Design

### Parts

```
Claude Code ──(Stop / Notification hook)──► node dist/signal.js <event>
                                                   │ appends a line
                                                   ▼
                                  %USERPROFILE%\.time-waster\events.jsonl
                                                   │ watched
                                                   ▼
                                 arcade (dist/arcade.js) ── banner over game
                                                   │
                                  %USERPROFILE%\.time-waster\scores.json
```

1. **Plugin** (Claude Code plugin in this repo):
   - `.claude-plugin/plugin.json` and a marketplace entry so colleagues install
     with `/plugin marketplace add NexiosIT/time-waster` then `/plugin install`.
   - Hooks: `Stop` → `signal.js done`; `Notification` → `signal.js attention`.
     The hook passes its JSON input (stdin) through; `signal.js` records the
     event type, timestamp, and the session's `cwd` folder name.
   - *Decision (designer's call):* "attention" means Claude is **blocked on
     you** (a permission prompt or a question). The idle reminder that
     `Notification` also fires about 60 s after every finished turn is
     **ignored**; otherwise every "done" banner would be replaced a minute
     later by a redundant "needs you". Filter with the hook matcher on the
     notification type where Claude Code supports it, and also in `signal.js`
     (drop idle-reminder notifications), with a unit test. Builder verifies the
     exact notification-type values in the current docs.
   - `SessionStart` hook → `signal.js shim`: (re)writes the `arcade` launcher
     (see below) so it always points at the current plugin install path.
   - `/arcade` command: opens a new Windows Terminal tab running the arcade
     (`wt -w 0 nt node <plugin-root>\dist\arcade.js`), falling back to
     `start "" cmd /c node ...` if `wt` is not available.
   - The builder must verify hook names, hook input fields and the plugin /
     marketplace layout against the current Claude Code plugin docs.
2. **Signal file**: `%USERPROFILE%\.time-waster\events.jsonl`, one JSON object
   per line: `{"type":"done"|"attention","at":<ISO time>,"project":"<folder>"}`.
   Append-only; the arcade trims it to the last 100 lines on start.
   `signal.js` must never fail the hook: any error is swallowed, exit code 0,
   and it finishes fast (< 200 ms).
3. **Arcade** (`dist/arcade.js`): menu, game host, banner, scores.

### The `arcade` command (designer's call)

The plugin lives in Claude Code's plugin cache, at a path that can change on
updates, and there is no `npm install` step to create a PATH shim. So:

- Every `SessionStart`, `signal.js shim` writes
  `%USERPROFILE%\.time-waster\bin\arcade.cmd` containing
  `@node "<current plugin root>\dist\arcade.js" %*`. Cheap, idempotent, and it
  self-heals after plugin updates.
- One-time setup (README): add `%USERPROFILE%\.time-waster\bin` to the user
  PATH. `/arcade` checks whether it is on PATH and, if not, prints the one-line
  PowerShell command to do it. It does not change PATH by itself.
- After that, `arcade` works in any terminal, including while Claude is busy.

### Banner behaviour

- On start, the arcade remembers the file's current end; only newer events show.
- It watches the file (`fs.watch`, plus a 1 s poll fallback since `fs.watch`
  can miss events on Windows).
- New event → a one-line banner across the top row, over whatever is on screen
  (menu or game): `✓ Claude is done — <project>` or
  `! Claude needs you — <project>`.
- The banner never pauses the game and never consumes keys. It stays for
  10 s, then collapses to a small marker in the status line (`● Claude done`)
  until the run ends or you return to the menu.
- Several events in a row: the newest one wins.
- The top row is reserved for the banner: games never draw there.

### Screen layout

- Fixed play area of **60 × 20** cells for games, centred. Row 0 = banner,
  last row = status line (game name, score, best, key hints).
- If the terminal is smaller than the minimum (62 × 23), show
  "Make the window bigger" and pause the *game* until it fits (this is the one
  allowed pause; resize events are handled live).
- Colours: 16-colour ANSI only, so it looks the same in conhost and Windows
  Terminal.

### Keys (host-level, a game can't override these)

- Menu: ↑/↓ select, Enter play, Q quit arcade.
- In game: P pause/resume, Esc end the run (score still saved, back to menu).
- Ctrl+C anywhere: restore the terminal and exit cleanly.
- All other keys are passed to the game.

### Game contract

Each game is a folder `src/games/<id>/` with an `index.ts` that exports a
default object of this shape (TypeScript):

```ts
export interface Game<S> {
  id: string;            // folder name, used as the high-score key
  title: string;         // shown in the menu
  description: string;   // one line in the menu
  tickMs: number;        // how often update() runs, e.g. 100
  controls: string;      // short help shown in the status line
  init(ctx: GameContext): S;                 // new run
  onKey(state: S, key: Key): S;              // a key press
  update(state: S, ctx: GameContext): S;     // one tick
  draw(state: S, screen: Screen): void;      // draw onto the 60×20 area
  score(state: S): number;
  isOver(state: S): boolean;
}
```

- `GameContext` gives a seeded random generator (`ctx.random()`) and the
  elapsed time, so game logic is deterministic and testable.
- `Screen` offers `put(x, y, char, color?)`, `text(x, y, string, color?)` and
  `clear()` within the 60 × 20 area; anything outside is clipped.
- `Key` is a normalised name: `up | down | left | right | space | enter |`
  single letters/digits.
- The host owns the loop, timing, input, drawing to the terminal, the banner,
  pause, and saving the score when `isOver` becomes true or the player presses
  Esc.
- Isolation: every call into a game is wrapped in try/catch. A throw ends that
  run with a short error message and returns to the menu; the arcade keeps
  running and saves nothing for the crashed run.

### Game discovery (no shared registry file)

The build scans `src/games/*/index.ts` and generates the game list, so adding a
game touches only its own folder. Menu order: alphabetical by title.

### High scores

- File: `%USERPROFILE%\.time-waster\scores.json`,
  `{ "<gameId>": [{ "score": n, "at": "<ISO time>" }, ...] }`, top 10 per
  game, highest first.
- Written atomically (write temp file, then rename). A corrupt or missing file
  is treated as empty (corrupt one is renamed to `scores.json.bak`).
- Shown: best score in the menu next to each game, best in the in-game status
  line, and the top 10 after a run ends ("New best!" when beaten).
- Accessed only through one `scores` module, so a shared store can replace it
  later without touching games.

### Example game

The foundation ships one original example game, a snake-like game (working
title "Worm"): arrow keys turn, eat dots to grow, hitting a wall or yourself ends
the run. It doubles as the reference implementation for the guide.

### Repo layout

```
.claude-plugin/plugin.json      plugin manifest (+ marketplace.json)
hooks/hooks.json                Stop + Notification hooks
commands/arcade.md              /arcade launcher
src/core/                       host: loop, input, screen, banner, menu, scores
src/signal.ts                   hook entry point
src/arcade.ts                   arcade entry point
src/games/<id>/index.ts         one folder per game
src/games/<id>/*.test.ts        that game's tests
dist/                           committed build output (arcade.js, signal.js)
docs/adding-a-game.md           the guide
```

### Build, test, workflow

- TypeScript, bundled with esbuild into `dist/arcade.js` and `dist/signal.js`
  (single files, no runtime dependencies). Dev dependencies only: TypeScript,
  esbuild, Vitest.
- `npm run build`, `npm test`, `npm run dev` (runs the arcade from source).
- `dist/` is committed. To avoid merge conflicts on it, game branches don't
  commit `dist/`; it is rebuilt and committed on `main` after merges (a CI
  check that `dist/` is up to date is a nice-to-have, builder's call).
- Tests: the core (diffing renderer, banner timing, score store, key parsing,
  game-crash isolation) is unit-tested. Games test their logic through the
  contract (`init` → `onKey` / `update` → `score` / `isOver`) with a fixed seed.

### The guide (`docs/adding-a-game.md`)

Short and written so a colleague can hand it to Claude: the contract, the
press-only input rule, the 60 × 20 area, the reserved banner row, how to test,
how to run your game alone (`npm run dev -- <id>`), and "copy the example game
folder to start".

## Left to the builder

- Exact plugin manifest / marketplace / hooks file format (check current docs).
- Internal structure of `src/core/`.
- Which ANSI escape sequences and how key input is decoded on Windows.
- Exact banner colours and wording within the spirit above.
- Whether to add the CI check for `dist/`.
