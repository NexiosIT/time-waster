# Games sized to Claude's work: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The arcade shows how long Claude's current task has left (from Claude's own rough
estimate) and pre-selects a game that ends before then, preferring games new to the player;
games declare a length (timed, or learned per player); ships the first timed game, Reflex.

**Architecture:** The mod (`hooks/register.ts`) adds an estimate request as hidden prompt
context, reads `Estimate: ~N min` from the first streamed text of the turn, and writes
`start` / `estimate` events through `dist/signal.js` into `events.jsonl`. The arcade turns
those events into a `TaskClock` (time left), keeps a per-game run-time history in
`runs.json`, and uses pure functions in `src/core/length.ts` to compute each game's
expected length and the suggestion shown in the menu.

**Tech Stack:** TypeScript, Node 20+, vitest (arcade), `claude plugin test` with
`claude-code/testing` (mod), esbuild (`npm run build`).

**Spec:** `docs/superpowers/specs/2026-11-20-sized-games-design.md`

## Global Constraints

- Windows only; Node 20+; no runtime dependencies (the plugin installs from git, no `npm install`).
- `dist/` is **not committed on this branch**; it is rebuilt and committed on `main` after merge.
- Hooks never fail or block Claude: every hook/`signal.js` path swallows errors; a non-zero Stop hook exit would block Claude.
- Games touch only `src/games/<id>/`; game state is plain data, functions pure, randomness via `ctx.random()`, time via `ctx.elapsedMs`; single-width characters only; never bind `p`, Esc, Ctrl+C.
- Play area is 60 x 20 (`GAME_WIDTH`, `GAME_HEIGHT`); menu and game draw only there.
- Estimate steps Claude chooses from: 1, 2, 5, 10, 15 (15 means 15+).
- Learned length: fewer than 3 recorded runs → author's `minutes` × 1.5; otherwise 75th percentile of the last 20 runs.
- Only runs that finished on their own (`isOver`) are recorded; Esc, quit, crash are not.
- New to you: `rounds`/`open` game with < 3 recorded runs, or a `timed` game with 0 recorded runs.
- Suggestion: candidates have expected length ≤ time left; any new candidate wins (longest new one); else longest candidate; ties → least recently played.
- The estimate instruction goes in `prompt.submit`'s `context`, never into the prompt `text`.

## Review Focus

1. **Arcade opened after the `start` event was written** (auto-open races the hook): expect the menu to show the task anyway — replayed from `events.jsonl` on startup. Test in Task 6.
2. **Claude replies without an `Estimate:` line, or with a malformed one** (`Estimate: soon`, `Estimate: ~0 min`, `Estimate: ~999 min`): expect no estimate event, the menu stays at `Claude: estimating…` until `done`. Tests in Tasks 4 and 7.
3. **Two Claude sessions in different projects**: a `done` from project B must not clear project A's newer task. Test in Task 4.
4. **Corrupt or hand-edited `runs.json`**: expect it treated as empty (backed up to `.bak` like `scores.json`), arcade keeps working. Test in Task 2.
5. **Estimate exceeded / task overdue, or time left shorter than every game**: expect no suggestion and no cursor jump; overdue shows `Claude is running over`. Tests in Tasks 3 and 6.

---

### Task 1: Game length in the contract

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/app.ts` (`wellFormed`)
- Modify: `src/games/worm/index.ts`
- Test: `src/core/app.test.ts`, `src/games/worm/worm.test.ts`

**Interfaces:**
- Produces: `type GameLength = { kind: 'timed' | 'rounds' | 'open'; minutes: number }` exported from `src/core/types.ts`; `Game<S>.length?: GameLength`.

- [ ] **Step 1: Write the failing tests**

```ts
// app.test.ts
it('skips a game whose length is malformed, keeps one without length', () => {
  const app = mk([
    fake('a', 'Alpha', { length: { kind: 'timed', minutes: 1 } }),
    fake('b', 'Bravo', { length: { kind: 'sometimes', minutes: 1 } as any }),
    fake('c', 'Charlie', { length: { kind: 'open', minutes: 0 } }),
    fake('d', 'Delta'),
  ]);
  const r = rows(app);
  expect(has(r, 'Alpha')).toBe(true);
  expect(has(r, 'Bravo')).toBe(false);
  expect(has(r, 'Charlie')).toBe(false);
  expect(has(r, 'Delta')).toBe(true);
});
// worm.test.ts
it('declares an open length of 3 minutes', () => {
  expect(game.length).toEqual({ kind: 'open', minutes: 3 });
});
```

- [ ] **Step 2: Run `npx vitest run src/core/app.test.ts src/games/worm` — expect FAIL** (type error / Bravo listed / length undefined).
- [ ] **Step 3: Implement.** Add `GameLength` and optional `length` to `Game`. In `wellFormed`, accept `length === undefined` or `kind` in `['timed','rounds','open']` with `Number.isFinite(minutes) && minutes > 0`. Worm: `length: { kind: 'open', minutes: 3 }`.
- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.**
- [ ] **Step 5: Commit** `feat: games can declare a length`.

### Task 2: Run-time history store

**Files:**
- Create: `src/core/jsonfile.ts` (moved from `scores.ts`: `withRetry`, `readText`, `writeAtomic(file, data: unknown)`, plus `loadJson<T>(file, isValid): T | null` with the corrupt-file `.bak` logic now in `loadScores`)
- Modify: `src/core/scores.ts` (use `jsonfile.ts`; behaviour unchanged)
- Create: `src/core/runs.ts`
- Modify: `src/core/paths.ts` (`runsFile(home?)` → `<dataDir>/runs.json`)
- Test: `src/core/runs.test.ts` (existing `scores.test.ts` must still pass untouched)

**Interfaces:**
- Produces: `type RunEntry = { ms: number; at: string }`; `type Runs = Record<string, RunEntry[]>`; `loadRuns(file: string): Runs`; `addRun(file: string, gameId: string, ms: number, at?: Date): RunEntry[]` (returns that game's list, newest last, at most 20); `RUNS_KEPT = 20`; `runsFile(home?: string): string`.

- [ ] **Step 1: Write the failing tests** in `runs.test.ts` (temp dir per test, like `scores.test.ts`):
  - `addRun` then `loadRuns` returns `{ worm: [{ ms: 61000, at }] }`.
  - after 25 `addRun` calls only the last 20 remain, oldest dropped (check `ms` 5000..24000 when adding 0..24 × 1000).
  - missing file → `{}`.
  - corrupt file (`'{nope'`) → `{}` and a `runs.json.bak` exists; a later `addRun` works.
  - entries with non-finite or negative `ms` make the file invalid (→ `{}`).
  - `addRun` with `ms` NaN or negative throws and leaves the file unchanged.
- [ ] **Step 2: Run `npx vitest run src/core/runs.test.ts` — expect FAIL** (module not found).
- [ ] **Step 3: Implement** `jsonfile.ts`, refactor `scores.ts` onto it, implement `runs.ts` and `runsFile`.
- [ ] **Step 4: Run `npm test` — expect PASS** (runs and scores tests).
- [ ] **Step 5: Commit** `feat: run-time history store`.

### Task 3: Expected length and the suggestion (pure)

**Files:**
- Create: `src/core/length.ts`
- Test: `src/core/length.test.ts`

**Interfaces:**
- Consumes: `GameLength`, `Game` (Task 1); `RunEntry` (Task 2).
- Produces:
  - `type Expected = { ms: number; basis: 'timed' | 'you' | 'est'; isNew: boolean }`
  - `expectedLength(length: GameLength, runs: RunEntry[]): Expected`
  - `suggest(games: Game<any>[], runs: Runs, leftMs: number): string | null` (a game id)
  - `formatMinutes(ms: number): string` → `` `~${Math.max(1, Math.ceil(ms / 60000))} min` ``
  - constants `NEW_MARGIN = 1.5`, `MIN_RUNS = 3`, `PERCENTILE = 0.75`

Rules (from the spec):
- `timed`: `ms = minutes·60000`, `basis 'timed'`, `isNew = runs.length === 0`.
- `rounds`/`open` with `< 3` runs: `ms = minutes·60000·1.5`, `basis 'est'`, `isNew true`.
- otherwise: `basis 'you'`, `isNew false`, `ms` = 75th percentile of the run `ms` values, nearest-rank: sort ascending, take index `Math.ceil(0.75 · n) − 1`.
- `suggest`: ignore games without `length`; candidates `ms ≤ leftMs`; if any candidate `isNew`, pick the new one with the largest `ms`; else the largest `ms`; ties → the game whose latest run `at` is oldest (never played counts as oldest); then by title. `leftMs ≤ 0` → `null`.

- [ ] **Step 1: Write the failing tests:**
  - timed 1 min, no runs → `{ ms: 60000, basis: 'timed', isNew: true }`; with one run → `isNew false`.
  - open 2 min, 2 runs → `{ ms: 180000, basis: 'est', isNew: true }`.
  - open, runs `[60,120,180,240]` s → `ms 180000`, `basis 'you'`; runs `[60,120,180]` s → `180000`; one run of 600 s among 10 of 60 s → `60000`.
  - `suggest` with Reflex (timed 1, played), Lander (rounds 4, 3 runs of 240 s), Dodge (open 2, no runs → 3 min est.), Worm (open, 3 runs of 300 s): `leftMs 6 min` → `'dodge'`; `leftMs 2.5 min` → `'reflex'`; `leftMs 30 s` → `null`; `leftMs 0` → `null`.
  - with Dodge removed, `leftMs 6 min` → `'worm'` (longest fit); tie between two 4-min games → the one played longer ago.
  - a game without `length` is never suggested.
  - `formatMinutes(90000) === '~2 min'`, `formatMinutes(1000) === '~1 min'`.
- [ ] **Step 2: Run `npx vitest run src/core/length.test.ts` — expect FAIL.**
- [ ] **Step 3: Implement `length.ts`.**
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat: expected game length and suggestion`.

### Task 4: `start` / `estimate` events and the task clock

**Files:**
- Modify: `src/core/events.ts` (types, `parseEvent`, new `readRecentEvents`)
- Modify: `src/signal.ts` (commands `start`, `estimate <n>`)
- Create: `src/core/task.ts`
- Test: `src/core/events.test.ts`, `src/signal.test.ts`, `src/core/task.test.ts`

**Interfaces:**
- Produces:
  - `type ClaudeEvent = { type: 'done' | 'attention' | 'start'; at: string; project: string } | { type: 'estimate'; minutes: number; at: string; project: string }`
  - `readRecentEvents(file: string, sinceMs: number): ClaudeEvent[]` — all valid events with `Date.parse(at) >= sinceMs`, file order; missing file → `[]`.
  - `signal.js start` / `signal.js estimate <n>`: no stdin needed; `project = path.win32.basename(process.cwd())`; `estimate` writes only for an integer `1 ≤ n ≤ 120`.
  - `class TaskClock { apply(ev: ClaudeEvent): void; view(nowMs: number): TaskView }`
  - `type TaskView = { state: 'none' } | { state: 'estimating' } | { state: 'running'; leftMs: number } | { state: 'overdue' }`
  - `TASK_MAX_AGE_MS = 30 * 60_000` (a start with no estimate older than this reads as `none`).

TaskClock rules (all times from `ev.at`, so replayed events give the same result):
- `start` newer than the current start → new task `{ project, startMs, estimateMs: null }`; older or equal → ignored.
- `estimate` for the current task's project with `at ≥ startMs` → `estimateMs = minutes·60000`.
- `done` for the current task's project with `at ≥ startMs` → no task. `attention` → no change.
- `view`: no task → `none`; no estimate → `estimating` (or `none` after `TASK_MAX_AGE_MS`); `left = startMs + estimateMs − nowMs`; `left > 0` → `running`, else `overdue`.

- [ ] **Step 1: Write the failing tests:**
  - `parseEvent`/`readNewEvents` accept `{type:'start',...}` and `{type:'estimate',minutes:5,...}`, reject `estimate` without numeric `minutes`, still skip unknown types.
  - `readRecentEvents` returns only events at/after `sinceMs`.
  - `main(['start'], '', home)` writes `{type:'start'}`; `main(['estimate','5'], '', home)` writes `minutes: 5`; `estimate` with `'0'`, `'121'`, `'x'`, missing → writes nothing; never throws.
  - TaskClock: start@0 + estimate 5 → `running` 300000 at 0, 120000 at 180000; `overdue` at 300000; `done` same project → `none`; `done` from another project → unchanged; an older `start` after a newer one → ignored; start then nothing for 31 min → `none`; estimate from another project → ignored; applying the same `start` twice → same view.
- [ ] **Step 2: Run the three test files — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: start and estimate events, task clock`.

### Task 5: Record natural run lengths

**Files:**
- Modify: `src/core/session.ts` (public `playedMs` getter = internal `elapsedMs`; `endedEarly: boolean`, set `true` in `end()`)
- Modify: `src/core/app.ts` (`AppOptions.runsFile?: string`; record in the natural-end path)
- Modify: `src/arcade.ts` (pass `runsFile: runsFile()`)
- Test: `src/core/session.test.ts`, `src/core/app.test.ts`

**Interfaces:**
- Consumes: `addRun`, `loadRuns` (Task 2).
- Produces: `GameSession.playedMs: number`, `GameSession.endedEarly: boolean`; `App` records `addRun(runsFile, id, session.playedMs)` only when the run ended with `isOver` (`!endedEarly`), before `finish`. A failing `addRun` is swallowed.

- [ ] **Step 1: Write the failing tests:**
  - session: `playedMs` grows with ticks and not while paused; `endedEarly` false after a natural end, true after `escape`.
  - app (with `runsFile` in temp dir): a natural end records one run with `ms` equal to the played time (fake game over after 3 ticks of 100 ms → `ms 300`); Esc-ended, `quit()`-ended and crashed runs record nothing; an unwritable `runsFile` (a directory path) still shows results.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.**
- [ ] **Step 5: Commit** `feat: record how long finished runs take`.

### Task 6: Menu shows time left, lengths and the suggestion

**Files:**
- Modify: `src/core/app.ts` (route events, `TaskClock`, menu drawing, pre-select)
- Modify: `src/arcade.ts` (startup replay)
- Test: `src/core/app.test.ts`

**Interfaces:**
- Consumes: `TaskClock`, `readRecentEvents`, `TASK_MAX_AGE_MS` (Task 4); `expectedLength`, `suggest`, `formatMinutes` (Task 3); `loadRuns` (Task 2).
- Produces: `App.onEvent(ev, nowMs)` sends `done`/`attention` to the banner (as today) and every event to the `TaskClock`; `start`/`estimate` never reach the banner. `App.replay(events: ClaudeEvent[], nowMs)` applies events to the `TaskClock` only.

Menu (inside the 60 x 20 area; exact columns are the builder's within this):
- Row 2, centred: `running` → `Claude ~N min left · suggested: <Title> (~M min[, new])` (or without the suggested part when `suggest` is null); `estimating` → `Claude: estimating…`; `overdue` → `Claude is running over`; `none` → empty. Colour `brightYellow`.
- Each game row: cursor, title, length (`1 min` for timed, `~M min (you)` / `~M min (est.)` otherwise, nothing without `length`), `NEW` when `isNew`, `★` on the suggested game, `Best N` as today.
- Pre-select: when entering the menu (constructor, `toMenu`) and when an `estimate` or `start` event changes the suggestion while on the menu, move the cursor to the suggested game. Nothing suggested → cursor stays. Up/Down/Enter unchanged.
- Runs are re-read (`loadRuns`) whenever the menu is entered, with `refreshBest`.

Startup (`arcade.ts`): after `watcher.start()`, call `app.replay(readRecentEvents(eventsFile(), Date.now() − TASK_MAX_AGE_MS), Date.now())` in a try/catch.

- [ ] **Step 1: Write the failing tests** (fake games with lengths; `nowMs` and `at` aligned, e.g. `at: new Date(0).toISOString()`):
  - start + estimate 6 min → row shows `Claude ~6 min left`, the suggested game's line shows `★`, and Enter starts the suggested game (cursor was moved).
  - start only → `Claude: estimating…`; then `done` → line empty and banner shows `✓ Claude is done`.
  - a `start` or `estimate` event never shows on row 0 (banner).
  - `replay([start, estimate])` on a fresh App → menu shows time left (Review Focus 1).
  - 7 min after a 5 min estimate → `Claude is running over` and no `★` (Review Focus 5).
  - a new open game shows `NEW` and `(est.)`; after 3 recorded runs it shows `(you)` and no `NEW`.
  - user moves cursor away; a later tick without new events does not move it back.
- [ ] **Step 2: Run `npx vitest run src/core/app.test.ts` — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.** Then `npm run dev` and check the menu by eye at 62 x 23 (nothing clipped wrongly).
- [ ] **Step 5: Commit** `feat: menu suggests a game that fits Claude's time left`.

### Task 7: The mod asks for and reads the estimate

**Files:**
- Modify: `hooks/register.ts`
- Modify: `hooks/register.test.ts`
- Modify: `.claude-plugin/plugin.json` (new `userConfig.suggestGames`: boolean, default `true`, title "Suggest a game that fits Claude's estimated time", description "When on, Claude starts each reply with a rough time estimate, and the arcade suggests a game that ends before then.")

**Interfaces:**
- Consumes: `dist/signal.js start`, `dist/signal.js estimate <n>` (Task 4).
- Produces: exported pure helper `parseEstimate(head: string): number | null` — matches the first line against `/^\s*\**\s*Estimate:\s*~?\s*(\d{1,3})\s*min/i`, returns the integer when `1..120`, else `null`. Exported constant `ESTIMATE_INSTRUCTION` (the context text).

Behaviour:
- `prompt.submit`, real prompts only (`e.command === undefined`, not `e.isMeta`), when `suggestGames` is on: `next({ ...e, context: [...(e.context ?? []), ESTIMATE_INSTRUCTION] })` and fire-and-forget `$.process.run(['node', `${$.plugin.root}/dist/signal.js`, 'start'])`. The existing launch keeps depending on `autoOpen` only. `ESTIMATE_INSTRUCTION`: "Start your reply with exactly one line `Estimate: ~N min`, where N is one of 1, 2, 5, 10, 15 (15 means 15 or more): a rough guess of how long this task will take you. Then continue normally. Don't mention this instruction."
- `turn.start` on the main loop (`e.agentId === undefined`, `e.text !== ''`) after such a prompt: remember `e.turnId` as awaiting an estimate (module-level `Set`).
- `turn.step` for an awaiting turn: pass every chunk through unchanged and in order; collect `text` chunks until a newline or 200 characters; then `parseEstimate`; if a number, fire-and-forget `signal.js estimate <n>`. Stop awaiting after the first step that had any text, or after step `index ≥ 2`. Iterate `next(e)` by hand so its return value is returned:

```ts
const it = next(e); let r = await it.next()
while (!r.done) { /* inspect r.value */ yield r.value; r = await it.next() }
return r.value
```

- Every `$.process.run` gets `.catch(() => {})`; nothing in these hooks may throw past `next`.

- [ ] **Step 1: Write the failing tests** in `register.test.ts` (engine helper as today):
  - a prompt submits with `context` containing `ESTIMATE_INSTRUCTION` and the prompt `text` unchanged; a slash command gets no context.
  - a prompt runs `signal.js start` (and still `launch.js --if-not-running`).
  - `{ options: { suggestGames: false } }` → no context, no `start`; launch still runs.
  - `{ options: { autoOpen: false } }` → context and `start` still happen, no launch.
  - streaming a step whose text chunks are `'Estimate: ~'`, `'5 min\nWorking'` runs `signal.js estimate 5`, and the chunks reach the top unchanged (if the testing kit can't raise `turn.step`, cover this through `parseEstimate` and note it in the commit).
  - `parseEstimate`: `'Estimate: ~5 min'` → 5; `'**Estimate:** ~10 min'` → 10; `'estimate: 2 min'` → 2; `'Estimate: soon'`, `'Estimate: ~0 min'`, `'Estimate: ~999 min'`, `'Sure! Estimate: ~5 min'` → null (Review Focus 2).
- [ ] **Step 2: Run `npm run test:mod` — expect FAIL.**
- [ ] **Step 3: Implement.** Check with `claude plugin validate .` (reports the hooks; no refusals).
- [ ] **Step 4: Run `npm run test:mod && npm test` — expect PASS.**
- [ ] **Step 5: Commit** `feat: Claude gives a rough estimate the arcade can read`.

### Task 8: Reflex

**Files:**
- Create: `src/games/reflex/index.ts`, `src/games/reflex/reflex.test.ts`

**Interfaces:**
- Consumes: `Game`, `GameLength` (Task 1).
- Produces: default export `Game<ReflexState>` with `id 'reflex'`, `title 'Reflex'`, `description 'Press the key before it fades. 60 seconds.'`, `tickMs 50`, `length { kind: 'timed', minutes: 1 }`, `controls '←↑→↓ a s d f j k l'`.

Values (from the spec): targets `up down left right a s d f j k l`; lifetime starts 1500 ms, −40 ms per hit, floor 450 ms, +200 ms per miss, cap 1500 ms; 250 ms gap after each hit or miss; hit score `(10 + bonus) × multiplier`, `bonus = Math.round(10 × remaining/lifetime)`, multiplier ×1, ×2 from streak 10, ×3 from streak 25 (streak counted including this hit); wrong key or fade = miss, streak 0; `isOver` when `elapsedMs ≥ 60000`; target drawn as its symbol (`← ↑ → ↓` or the letter) in a 3 x 3 box, at a random spot not touching the edges and not the previous spot; fade colours `brightWhite` → `white` → `gray` over the lifetime; HUD on row 0: `Time 0:42   Streak 12 ×2   Hits 31  Misses 4`. Keys during the gap are ignored (not misses).

- [ ] **Step 1: Write the failing tests** (fixed seed, through the contract): initial state (score 0, not over, a target exists after the first gap); `onKey`/`update` don't mutate input (`structuredClone` compare); the correct key adds ≥ 10 and increments the streak; a wrong key resets the streak and adds 0; letting a target expire counts a miss; lifetime never below 450 or above 1500 after long hit/miss sequences; multiplier ×2 at streak 10 and ×3 at 25; not over at 59 950 ms, over at 60 000 ms; `length` is `{ kind: 'timed', minutes: 1 }`; `draw` writes only inside 60 x 20.
- [ ] **Step 2: Run `npx vitest run src/games/reflex` — expect FAIL.**
- [ ] **Step 3: Implement** (copy the Worm structure).
- [ ] **Step 4: Run `npm test && npm run typecheck` — expect PASS.** Then `npm run dev -- reflex` and play one run.
- [ ] **Step 5: Commit** `feat: Reflex, a 60-second key game` (only `src/games/reflex/`).

### Task 9: Docs and final check

**Files:**
- Modify: `docs/adding-a-game.md` (the `length` field and its three kinds; the rule "for `rounds`/`open` games, play at least 5 complete runs in the dev build and use your typical run time as `minutes`"; `timed` games must end themselves at `minutes` using `ctx.elapsedMs`; where to read your own times: `%USERPROFILE%\.time-waster\runs.json`, also written by dev builds)
- Modify: `README.md` (what the estimate line is, the suggestion, `suggestGames` in `/config`, `runs.json` under "Where data lives")

- [ ] **Step 1: Update both docs.**
- [ ] **Step 2: Run `npm test && npm run typecheck && npm run test:mod && npm run build` — expect all PASS** and the build lists `reflex, worm`. Then `git status` must show no `dist/` changes staged; discard them with `git checkout -- dist`.
- [ ] **Step 3: Commit** `docs: game lengths, estimates and suggestions`.
