# Arcade Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared foundation of the time-waster terminal arcade (host, banner, scores, plugin hooks, launcher) plus the example game "Worm", so three people can add games in parallel.

**Architecture:** A Node CLI (`dist/arcade.js`) owns the terminal, game loop, menu, banner and score store; games are plain objects implementing `Game<S>` in `src/games/<id>/`. A Claude Code plugin in the same repo runs `dist/signal.js` from hooks, which appends events to `%USERPROFILE%\.time-waster\events.jsonl`; the arcade watches that file and shows a banner. Pure logic (keys, buffers, diffing, banner, session, scores) is unit-tested; the thin terminal I/O layer is verified by hand.

**Tech Stack:** Node 20+, TypeScript 5, esbuild (bundle to CommonJS), Vitest. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-arcade-mod-design.md`

## Global Constraints

- Windows only; Node 20+ on PATH. `package.json` `"engines": { "node": ">=20" }`.
- Zero runtime dependencies; dev deps only: `typescript`, `esbuild`, `vitest`, `@types/node`.
- Game play area exactly **60 × 20**; minimum terminal **62 × 23**; row 0 = banner, last row = status line; games never draw on row 0.
- 16-colour ANSI only.
- Banner visible **10 s**, then collapses to a status-line marker until the run ends or you return to the menu; newest event wins; banner never pauses the game or consumes keys.
- Host keys: menu ↑/↓/Enter/Q; in game P = pause/resume, Esc = end run (score saved); Ctrl+C = restore terminal and exit.
- Data dir `%USERPROFILE%\.time-waster\` (`path.join(os.homedir(), '.time-waster')`): `events.jsonl`, `scores.json`, `bin\arcade.cmd`.
- Scores: top 10 per game, highest first; atomic write (temp + rename); corrupt file → renamed `scores.json.bak`, treated as empty.
- Events: `{"type":"done"|"attention","at":"<ISO>","project":"<cwd basename>"}` one per line; trimmed to last 100 lines on arcade start; only events after arcade start are shown.
- "attention" only for permission prompts / questions; the idle reminder is dropped.
- `signal.js` always exits 0, swallows all errors, finishes < 200 ms.
- `dist/` is committed on `main`; game branches don't commit `dist/`.
- Adding a game must only touch `src/games/<id>/`.

## Review Focus

1. **Terminal resized below 62 × 23 mid-run** → game paused with "Make the window bigger", resumes when big enough, no crash or garbage (Task 7 test `pauses while too small`).
2. **Events file missing, deleted, or read while a hook is mid-write (partial last line)** → no crash; partial line kept until complete (Task 5 tests `missing file`, `partial line`).
3. **`scores.json` corrupt or data dir missing** → empty scores, `.bak` created, next save works (Task 4 test `corrupt file`).
4. **Two arcade windows saving at once** → each save re-reads the file right before writing, so a score from the other window isn't dropped (Task 4 test `re-reads before write`).
5. **A game throws in `draw`/`onKey`/`update`/`init`, or the process dies unexpectedly** → that run ends with an error message and the menu returns; on fatal errors the terminal is restored (cursor shown, alt screen left) (Task 7 test `crash isolation`; Task 8 manual check).

---

### Task 1: Project scaffold, shared types, build with game discovery

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `vitest.config.ts`
- Create: `src/core/types.ts`
- Create: `scripts/discover.mjs`, `scripts/discover.test.mjs`, `scripts/build.mjs`
- Generated (gitignored): `src/games/registry.generated.ts`

**Interfaces:**
- Produces (`src/core/types.ts`):
  ```ts
  export type Color = 'black'|'red'|'green'|'yellow'|'blue'|'magenta'|'cyan'|'white'
    |'gray'|'brightRed'|'brightGreen'|'brightYellow'|'brightBlue'|'brightMagenta'|'brightCyan'|'brightWhite';
  export type Key = 'up'|'down'|'left'|'right'|'space'|'enter'|'escape'|'backspace'|'tab'|'ctrl-c'|string; // string = single lowercase letter/digit/symbol
  export interface Screen { width: number; height: number;
    put(x: number, y: number, ch: string, color?: Color): void;
    text(x: number, y: number, s: string, color?: Color): void;
    clear(): void; }
  export interface GameContext { random(): number; elapsedMs: number; }
  export interface Game<S> { id: string; title: string; description: string; tickMs: number; controls: string;
    init(ctx: GameContext): S; onKey(state: S, key: Key): S; update(state: S, ctx: GameContext): S;
    draw(state: S, screen: Screen): void; score(state: S): number; isOver(state: S): boolean; }
  export const GAME_WIDTH = 60, GAME_HEIGHT = 20, MIN_COLS = 62, MIN_ROWS = 23;
  ```
- Produces (`scripts/discover.mjs`): `discoverGames(gamesDir: string): string[]` — sorted folder names containing `index.ts`.
- Produces: `registry.generated.ts` exporting `export const games: Game<any>[]` (imports each `./<id>/index` default).
- npm scripts: `build` (`node scripts/build.mjs`), `test` (`vitest run`), `dev` (`node scripts/build.mjs && node dist/arcade.js`; extra args passed through, e.g. `npm run dev -- worm`).

- [ ] **Step 1: Write failing tests** in `scripts/discover.test.mjs` using a temp dir: folders `worm/index.ts`, `bricks/index.ts`, `notes/` (no index), file `registry.generated.ts` → `expect(discoverGames(dir)).toEqual(['bricks','worm'])`; empty dir → `[]`.
- [ ] **Step 2: Run** `npx vitest run scripts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `discoverGames`, then `build.mjs`: write the registry file, then esbuild `src/arcade.ts`, `src/signal.ts`, `src/launch.ts` → `dist/*.js` (`bundle: true, platform: 'node', target: 'node20', format: 'cjs'`). Until later tasks add them, entry points may be stubs that print nothing. `.gitignore`: `node_modules/`, `src/games/registry.generated.ts`.
- [ ] **Step 4: Run** `npm test` and `npm run build` — Expected: tests PASS; `dist/arcade.js`, `dist/signal.js`, `dist/launch.js` exist.
- [ ] **Step 5: Commit** `chore: scaffold project, shared game types and build with game discovery`

### Task 2: Key parsing

**Files:** Create `src/core/keys.ts`, `src/core/keys.test.ts`

**Interfaces:** Produces `parseKeys(data: string): Key[]`.

- [ ] **Step 1: Failing tests:** `'\x1b[A'`→`['up']`, `'\x1b[B'`→`['down']`, `'\x1b[C'`→`['right']`, `'\x1b[D'`→`['left']`, `'\x1bOA'`→`['up']`, `'\x1b'`→`['escape']`, `'\r'`→`['enter']`, `' '`→`['space']`, `'\x03'`→`['ctrl-c']`, `'P'`→`['p']`, `'\x1b[A\x1b[Ca'`→`['up','right','a']` (several keys in one chunk), unknown sequence `'\x1b[99~'`→`[]`.
- [ ] **Step 2: Run** `npx vitest run src/core/keys.test.ts` — FAIL.
- [ ] **Step 3: Implement** a left-to-right scanner over the string.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: parse terminal key input`

### Task 3: Cell buffer and diff renderer

**Files:** Create `src/core/buffer.ts`, `src/core/render.ts`, tests beside each.

**Interfaces:**
- Produces `class CellBuffer implements Screen` — `constructor(width: number, height: number)`; `get(x, y): { ch: string; color: Color }`; `blit(src: CellBuffer, ox: number, oy: number): void`; out-of-range `put`/`text` silently clipped; empty cell = `{ ch: ' ', color: 'white' }`.
- Produces `renderDiff(prev: CellBuffer | null, next: CellBuffer): string` — ANSI string that turns `prev` into `next`; `prev === null` or a different size → full redraw starting with `\x1b[2J`.
- Produces ANSI helpers in `render.ts`: `ENTER_ALT = '\x1b[?1049h\x1b[?25l'`, `LEAVE_ALT = '\x1b[0m\x1b[?25h\x1b[?1049l'`.

- [ ] **Step 1: Failing tests:** `text(58,0,'abcd')` writes only `a`,`b` (clip); `put(-1,0,'x')` no throw; `blit` copies at offset; `renderDiff(a, a)` → `''`; changing one cell → output contains exactly one cursor move `\x1b[<row+1>;<col+1>H` and the char; adjacent changed cells on one row → one cursor move; null prev → starts with `\x1b[2J`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** Colours: 30–37 for the 8 base names, 90–97 for `gray` + bright ones; only emit an SGR when colour changes.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: cell buffer with clipping and diff renderer`

### Task 4: Score store

**Files:** Create `src/core/paths.ts`, `src/core/scores.ts`, `src/core/scores.test.ts`

**Interfaces:**
- Produces `dataDir(home?: string): string` (default `os.homedir()`), `eventsFile(home?)`, `scoresFile(home?)`, `binDir(home?)`.
- Produces `type ScoreEntry = { score: number; at: string }`;
  `loadScores(file: string): Record<string, ScoreEntry[]>`;
  `bestScore(file: string, gameId: string): number | null`;
  `addScore(file: string, gameId: string, score: number, at?: Date): { rank: number | null; isBest: boolean; top: ScoreEntry[] }` (`rank` 1-based within top 10, `null` if not in top 10).

- [ ] **Step 1: Failing tests** (temp dir): missing dir/file → `{}` and `addScore` creates the dir; top 10 kept sorted desc, 11th lower score → `rank: null`; first score → `isBest: true`; equal to best → `isBest: false`; **corrupt file** (`'{oops'`) → `loadScores` returns `{}` and `scores.json.bak` exists; **re-reads before write**: `addScore(f,'worm',5)`, then write another entry to the file externally, then `addScore(f,'worm',7)` → file contains all three; no `*.tmp` left behind.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: read → merge → write `scores.json.tmp` → `fs.renameSync`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: local high-score store`

### Task 5: Hook signal script and event watcher

**Files:** Create `src/core/events.ts`, `src/core/events.test.ts`, `src/signal.ts`, `src/signal.test.ts`

**Interfaces:**
- Produces `type ClaudeEvent = { type: 'done' | 'attention'; at: string; project: string }`.
- Produces `toEvent(kind: 'done' | 'attention', hookInput: string, now: Date): ClaudeEvent | null` — parses stdin JSON; `project` = basename of `cwd` (or `''`); for `attention`, returns `null` when `notification_type === 'idle_prompt'`, or when `notification_type` is absent and `message` contains `waiting for your input` (case-insensitive); invalid JSON → event with `project: ''`.
- Produces `appendEvent(file: string, ev: ClaudeEvent): void`, `writeShim(binDir: string, pluginRoot: string): void` (writes `arcade.cmd` = `@node "<pluginRoot>\dist\arcade.js" %*\r\n`).
- `src/signal.ts` `main(argv, stdin)`: `done|attention` → `toEvent` + `appendEvent(eventsFile())`; `shim` → `writeShim(binDir(), process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(__dirname, '..'))`. Everything in try/catch, `process.exit(0)`. Read stdin with a 100 ms timeout (stdin may never close).
- Produces `trimEvents(file: string, keep = 100): void`;
  `readNewEvents(file: string, offset: number): { events: ClaudeEvent[]; offset: number }` — returns only complete lines after `offset` and advances `offset` past them only; a missing file → `{ events: [], offset: 0 }`; a file shorter than `offset` (truncated/recreated) → reads from 0;
  `class EventWatcher { constructor(file: string, onEvent: (e: ClaudeEvent) => void); start(): void; stop(): void }` — starts at the current end of file, uses `fs.watch` on the directory plus a 1000 ms `setInterval` poll, both calling the same `readNewEvents`.

- [ ] **Step 1: Failing tests:** `toEvent` cases (done with cwd `C:\\code\\order-app` → project `order-app`; permission_prompt kept; idle_prompt dropped; no type + "Claude is waiting for your input" dropped; bad JSON → project `''`); `writeShim` content; `readNewEvents` **missing file**; two lines then append a third → only the third returned; **partial line** `'{"type":"done"'` without newline → no events, offset unchanged, then completing the line returns it; truncated file → reads from 0; `trimEvents` keeps last 100 of 150.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS. Then `npm run build` and manually: `echo {"cwd":"C:\\x\\demo"} | node dist/signal.js done` → exit code 0, a `demo` line appended to `%USERPROFILE%\.time-waster\events.jsonl`; `node dist/signal.js nonsense` → exit 0, nothing written.
- [ ] **Step 5: Commit** `feat: hook signal script and events watcher`

### Task 6: Banner state

**Files:** Create `src/core/banner.ts`, `src/core/banner.test.ts`

**Interfaces:**
- Produces `class Banner { push(ev: ClaudeEvent, nowMs: number): void; view(nowMs: number): { mode: 'full' | 'marker'; text: string } | null; clearMarker(): void }`.
- Copy (exact): full `✓ Claude is done — <project>` / `! Claude needs you — <project>` (drop ` — <project>` when empty); marker `● Claude done` / `● Claude needs you`.
- Constant `BANNER_MS = 10_000`.

- [ ] **Step 1: Failing tests:** nothing pushed → `null`; push at t=0 → full at 9_999, marker at 10_000; second push at t=5_000 (attention) → full attention text until 15_000 (newest wins); `clearMarker()` during marker → `null`; `clearMarker()` during full → stays full until expiry, then `null`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: banner state with collapse to marker`

### Task 7: Game session (loop, host keys, crash isolation)

**Files:** Create `src/core/random.ts`, `src/core/session.ts`, `src/core/session.test.ts`

**Interfaces:**
- Produces `createRandom(seed: number): () => number` (mulberry32; same seed → same sequence).
- Produces `type SessionStatus = 'playing' | 'paused' | 'over' | 'crashed'`;
  `class GameSession<S> { constructor(game: Game<S>, opts: { seed: number; nowMs: number }); status: SessionStatus; error?: string; score: number;
    key(k: Key): void; tick(nowMs: number): void; setTooSmall(tooSmall: boolean): void; end(): void; draw(screen: Screen): void }`.
  - `key('p')` toggles playing/paused; `key('escape')` → `end()`; other keys → `game.onKey` only while `playing`.
  - `tick` runs `update` once per elapsed `tickMs` (at most 5 catch-up steps per call; paused/too-small time doesn't count), then checks `isOver` → `status = 'over'`.
  - `end()` → `status = 'over'` (score kept).
  - Any throw from `init`/`onKey`/`update`/`draw`/`score`/`isOver` → `status = 'crashed'`, `error` = message.
  - `draw` draws the game into the given 60 × 20 screen, and while paused or too small overlays centred `PAUSED — P to resume` / `Make the window bigger`.
- Owner of saving: the app (Task 8) calls `addScore` when status becomes `over`, never for `crashed`.

- [ ] **Step 1: Failing tests** with a tiny fake game (state = counter; update +1; over at 10): ticks at 0..1000 with `tickMs` 100 → `score` 10, `status` over; `p` then ticks → no progress, `p` again → progress resumes; `escape` → over with score so far; **pauses while too small**: `setTooSmall(true)` → ticks don't advance, draw shows `Make the window bigger`, `setTooSmall(false)` resumes; big time jump → at most 5 updates; **crash isolation**: game whose `onKey` throws `'boom'` → status crashed, error `'boom'`; same for `draw` and `init`; `createRandom(1)` deterministic.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat: game session with pause, end and crash isolation`

### Task 8: App (menu, results, layout) and terminal entry point

**Files:** Create `src/core/app.ts`, `src/core/app.test.ts`, `src/arcade.ts`

**Interfaces:**
- Consumes everything above and `games` from the registry.
- Produces `class App { constructor(opts: { games: Game<any>[]; scoresFile: string; nowMs: number; seed?: number; startGameId?: string }); key(k: Key, nowMs: number): 'quit' | void; tick(nowMs: number): void; onEvent(ev: ClaudeEvent, nowMs: number): void; render(cols: number, rows: number, nowMs: number): CellBuffer }`.
  - Screens: `menu` (title `ARCADE`, games with best score, hints `↑↓ select · Enter play · Q quit`), `playing`, `results` (score, `New best!` when `isBest`, top 10, `Enter: play again · Esc: menu`), crash message (`<title> crashed: <error>` + `Enter: menu`).
  - Layout: banner row 0 (full width, inverse colours); game area 60 × 20 centred horizontally starting at row 1; status line on the last row: `<title>  Score <n>  Best <n>  <controls>  P pause · Esc end` plus banner marker right-aligned.
  - Leaving a run (over/crashed/escape) calls `banner.clearMarker()`. `onEvent` works in every screen.
  - Games whose `id` is not a valid folder-style id (`/^[a-z0-9-]+$/`) or duplicated are left out of the menu.
  - `startGameId` (from `npm run dev -- <id>`) skips the menu.
- `src/arcade.ts` (thin, manual verification only): reads optional `argv[2]` as `startGameId`; enables raw mode, writes `ENTER_ALT`, `trimEvents`, starts `EventWatcher`, a 16 ms interval calling `tick` + `render` + `renderDiff`, `stdout.on('resize')` (full redraw), maps `parseKeys` → `app.key` (`ctrl-c` → quit). On quit, `SIGINT`, `uncaughtException`: write `LEAVE_ALT`, disable raw mode, stop watcher, exit.

- [ ] **Step 1: Failing tests** for `App` with a fake game + temp scores file: menu lists titles alphabetically; Enter starts the selected game; finishing a run saves exactly one score and shows `New best!`; a crash saves nothing and shows the crash text; `onEvent` during play puts `✓ Claude is done` on row 0 and game keys still reach the game; `render(50, 20, …)` → contains `Make the window bigger`; `q` in menu → `'quit'`; invalid/duplicate ids hidden.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `App`, then `arcade.ts`. **Step 4: Run** — PASS.
- [ ] **Step 5: Manual check** in Windows Terminal with `npm run dev`: menu shows; no flicker while idle; resize small → message, back → recovers; append a line to `events.jsonl` by hand → banner within 1 s; Ctrl+C → prompt and cursor back to normal; a thrown error in a game → crash screen, arcade still runs.
- [ ] **Step 6: Commit** `feat: arcade app with menu, results and terminal loop`

### Task 9: Example game "Worm"

**Files:** Create `src/games/worm/index.ts`, `src/games/worm/worm.test.ts`

**Interfaces:** Default export `Game<WormState>` with `id: 'worm'`, `title: 'Worm'`, `description: "Eat dots, grow longer, don't bite yourself."`, `tickMs: 120`, `controls: '←↑→↓ turn'`.

Rules: worm starts length 3 at the centre heading right; arrow keys turn (reversing onto itself is ignored); one dot at a random free cell (via `ctx.random`); eating → +1 length, +10 score, new dot; leaving the 60 × 20 area or hitting itself → over. Draws worm `█` green, head `▓` brightGreen, dot `●` yellow.

- [ ] **Step 1: Failing tests** with a fixed seed: initial length 3, score 0; one `update` moves the head one cell right; `onKey('left')` while heading right is ignored; `onKey('up')` then update moves up; placing the dot in front of the head and updating → score 10, length 4; driving into the right wall → `isOver`; turning back into own body (length ≥ 5) → `isOver`; dot never spawns on the worm (100 spawns with seeds 1..100).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; `npm run dev -- worm` plays.
- [ ] **Step 5: Commit** `feat: add Worm example game`

### Task 10: Plugin packaging, launcher, docs

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `commands/arcade.md`, `src/launch.ts`, `src/launch.test.ts`, `docs/adding-a-game.md`
- Modify: `README.md`
- Commit: `dist/`

**Interfaces:**
- `src/launch.ts`: `launchCommand(pluginRoot: string, hasWt: boolean): { file: string; args: string[] }` → `wt -w 0 nt node "<root>\dist\arcade.js"`, else `cmd /c start "" cmd /c node "<root>\dist\arcade.js"`; `isOnPath(dir: string, pathEnv: string): boolean` (case-insensitive, ignores trailing `\`); `main()` detects `wt` with `where wt`, spawns detached, prints `Arcade opened.` and, if `binDir()` is not on PATH, prints exactly:
  `To start the arcade while Claude is busy, run once in PowerShell, then open a new terminal:` followed by
  `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:USERPROFILE\.time-waster\bin", 'User')`.
- `hooks/hooks.json`: `Stop` → `node "${CLAUDE_PLUGIN_ROOT}/dist/signal.js" done`; `Notification` with matcher for permission prompts and question dialogs → `... signal.js attention`; `SessionStart` → `... signal.js shim`. Verify event names, the `Notification` matcher values (`permission_prompt`, `elicitation_dialog` expected) and the plugin/marketplace layout against the current Claude Code plugin docs before writing.
- `commands/arcade.md`: runs `node "${CLAUDE_PLUGIN_ROOT}/dist/launch.js"` and reports its output; nothing else.

- [ ] **Step 1: Failing tests** for `launchCommand` (both branches, path quoting with spaces in root) and `isOnPath` (match, case difference, trailing backslash, absent).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** launch + plugin files. **Step 4: Run** `npm test` — all PASS.
- [ ] **Step 5: Docs.** README: what it is, requirements (Windows, Node 20+), install (`/plugin marketplace add NexiosIT/time-waster`, `/plugin install time-waster@time-waster`), PATH one-liner, keys, where data lives, the `dist/` rule. `docs/adding-a-game.md`: copy `src/games/worm`, the `Game` contract, press-only input, 60 × 20 area and reserved banner row, use `ctx.random()` only, `npm run dev -- <id>`, write tests through the contract with a fixed seed, don't commit `dist/`.
- [ ] **Step 6: Build and end-to-end check:** `npm run build`; in Claude Code `/plugin marketplace add C:\Users\Thoma\Documents\time-waster` (local path), install, restart; confirm `%USERPROFILE%\.time-waster\bin\arcade.cmd` exists; `/arcade` opens a Windows Terminal tab; start `arcade` from another terminal; give Claude a task → `✓ Claude is done — <project>` banner while playing, run not interrupted; trigger a permission prompt → `! Claude needs you`; wait > 60 s idle → no extra banner.
- [ ] **Step 7: Commit** `feat: Claude Code plugin, launcher and docs` (including `dist/`).
