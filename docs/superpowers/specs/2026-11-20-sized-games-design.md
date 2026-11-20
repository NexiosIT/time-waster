# Games sized to Claude's work: estimate, suggestion, game lengths, Reflex — design

Date: 2026-11-20
Status: draft, awaiting approval
Builds on: `2026-11-20-arcade-mod-design.md` (including its auto-open addendum)

## Intent

Engineers play in the arcade while Claude works. The risk is that they keep playing
long after Claude is done and the prompt is available again. So when Claude starts
working, the arcade **suggests a game that ends before Claude is expected to finish**.
It is only a suggestion: the player can always pick another game, and the arcade
never ends a run because Claude finished (the original "banner never interrupts"
rule stays).

To make suggestions possible, every game gets a known length: either fixed by the
game, or learned from how long that player's runs usually last.

## Goals

- Claude gives a rough estimate of how long its current task will take, at low
  overhead (no extra tool call, no permission prompt).
- The arcade (already opened automatically on prompt submit) shows the time left
  and highlights a game that fits inside it.
- When the player comes back to the menu, the suggestion is recomputed from the
  time left (play a 4 min game with 6 min estimated, get a ~2 min suggestion after).
- Two kinds of games:
  - **fixed-length**: the game ends itself after a set time or number of rounds;
  - **open-ended** (like Worm): length learned from this player's past runs.
- New games filling the length slots, starting with **Reflex** (~1 min).

## Non-goals

- Accurate estimates. Rough is the point.
- Ending, pausing or shortening a run when Claude finishes.
- Sharing run-time history between machines or players.
- Learning from Claude's past accuracy (could come later).

## Anti-goals (failure even if it works)

- The estimate noticeably slows Claude down or adds a tool call / permission prompt.
- The suggested game regularly runs *past* the estimate (we bias short on purpose).
- The suggestion forces a choice: the player cannot easily pick another game.
- A game's length rule makes it impossible to add a game without touching shared files
  (game authors still only touch `src/games/<id>/`).

## Constraints

- Everything in the original design still applies (Windows, press-only input,
  60 x 20 play area, pure game functions, no shared-file edits per game, `dist/` rule).
- The arcade opens on `prompt.submit` via `hooks/register.ts`, before any estimate
  exists. The estimate arrives later and must reach an already-running arcade.
- `scores.json` keeps only the top 10 scores per game. Those are the longest runs, so
  they are not a usable basis for run length.

## Approaches considered

**Where the estimate comes from**

| | Approach | Trade-off |
|---|---|---|
| 1 | Past tasks: time between prompt submit and Stop, averaged | Free and invisible, but blind to whether this task is a quick question or a big refactor. |
| **2** | **Claude estimates each task** | **Chosen by the team.** Task-specific. Costs a few output words per reply; Claude's self-estimates are rough. |
| 3 | Both: Claude's estimate, falling back to history | Most robust, most to build. Can be added later on top of 2. |

**How Claude delivers the estimate** (my call, within approach 2)

| | Approach | Trade-off |
|---|---|---|
| a | Claude runs a command (`signal.js estimate 5`) | Exact, but an extra tool call per task and possibly a permission prompt. Rejected: overhead. |
| **b** | **Claude starts its reply with one line `Estimate: ~5 min`; the plugin reads it** | No tool call, no prompt, a handful of tokens. The line is visible in the chat. |
| c | A separate cheap model call estimates from the prompt text | Invisible in chat, but adds latency, cost and credentials to every prompt. |

**Basis for open-ended games' length**

| | Approach | Trade-off |
|---|---|---|
| a | Derive from high scores | Indirect, and top-10 scores are the longest runs (biased long). |
| **b** | **Record each run's play time; use this player's history** | Direct. Needs a small new run-history store. |

## Design

### 1. Asking Claude for an estimate

- The `prompt.submit` handler in `hooks/register.ts` (which already launches the arcade)
  also appends a short instruction to the prompt text it returns, along the lines of:
  "Before doing anything else, start your reply with exactly one line
  `Estimate: ~N min`, N one of 1, 2, 5, 10, 15, a rough guess of how long this task will
  take you. Then continue normally."
- Only for real prompts (`e.command === undefined`), same as the launch, and only when
  `autoOpen` is on (or a new `suggestGames` option; builder's call, default on).
- Coarse steps (1, 2, 5, 10, 15 meaning 15+) keep it rough and cheap.

### 2. Getting the estimate to the arcade

- When the estimate line exists, a hook reads it and appends an event to
  `events.jsonl`: `{ "type": "estimate", "minutes": 5, "at": ..., "project": ... }`.
- Reading point: the first tool use of the turn (classic `PreToolUse` hook, which gets
  `transcript_path`, or the equivalent mod event). If Claude answers without any tool
  use, the turn was short and no estimate is needed; the `Stop` event arrives anyway.
- `prompt.submit` also writes a `start` event so the arcade knows a new task began
  (and can show "Claude: estimating…" until the estimate arrives).
- Hooks must never fail or block Claude (same rule as `signal.js` today).
- `ClaudeEvent` gains the `start` and `estimate` types; the event reader must keep
  ignoring types it doesn't know.

### 3. Time left

- `timeLeft = estimate − (now − start)` for the most recent task.
- A `done` event clears it (Claude finished; nothing to fill).
- If the estimate is already exceeded, time left is "overdue": no suggestion, the menu
  says Claude is running over.
- Several Claude sessions can write to the same events file. Rule: the most recent
  `start`/`estimate` wins; a `done` from that same project clears it. Good enough for
  the first version.

### 4. Game lengths

`Game` gets one new optional field:

```ts
length?: { kind: 'fixed'; minutes: number }      // game ends itself after about this long
       | { kind: 'open'; typicalMinutes: number } // runs until you lose; author's starting guess
```

- No `length` = never suggested (still playable). Worm gets
  `{ kind: 'open', typicalMinutes: 3 }`.
- A fixed-length game is responsible for ending itself on time (`isOver`), using
  `ctx.elapsedMs` (which already excludes pause).

### 5. Learned length for open-ended games

- The host records each finished run's play time (session `elapsedMs`, excludes pause)
  in a new store `%USERPROFILE%\.time-waster\runs.json`: last 20 runs per game, same
  safe-write approach as `scores.json`. Recorded for all games (cheap, and useful later).
- A game's expected length for this player:
  - fewer than 3 recorded runs: the author's `typicalMinutes`;
  - otherwise the 75th percentile of recent run times (3 out of 4 runs are shorter),
    biased long on purpose so the suggestion ends before Claude does.

### 6. The suggestion

- Candidates: games whose expected length ≤ time left.
- Pick the longest candidate (fills the time best). Ties: the one played least recently,
  so suggestions rotate.
- No candidate (time left under the shortest game) or no active task: no suggestion.
- Recomputed whenever the menu is shown and when a new estimate arrives while in the menu.

### 7. Menu

```
 Claude ~6 min left  ·  suggested: Lander (~4 min)

 > Lander         ~4 min   ★ suggested
   Commit Rush    ~2 min
   Reflex         ~1 min
   Worm           ~5 min (you)
   Dodge          ~2 min (you)
   Deep Dive      ~8 min
```

- The suggested game is pre-selected (cursor starts on it) and marked; Up/Down picks any
  other game as before.
- Every game with a length shows it; learned lengths are marked "(you)".
- While waiting for the estimate: `Claude: estimating…`. No active task: the line is
  empty and the menu behaves as today.
- Menu sort: today it is by title. Builder's call whether to keep that or sort by length;
  the pre-selection works either way.

### 8. Game lineup (lengths are slots, games are proposals)

| Length | Game | Kind |
|---|---|---|
| ~1 min | **Reflex** (designed below) | fixed, 60 s |
| ~2 min | Commit Rush: type falling dev words before they land | fixed, 2 min |
| ~4 min | Lander: 5 landings with thrust taps | fixed, 5 rounds |
| ~8 min | Deep Dive: turn-based dungeon, 8 floors | fixed, 8 floors |
| learned | Worm (existing) | open |
| learned | Dodge: endless lane-switching runner that speeds up | open |

Only Reflex is designed here; the others get their own short design when someone picks
them up. Colleagues may swap in their own games for any slot.

## Reflex (first new game)

**Pitch:** a key appears somewhere on the board; press it before it fades. 60 seconds,
get faster as your streak grows.

- **id / title:** `reflex` / `Reflex`. **Description:** "Press the key before it fades. 60 seconds."
- **length:** `{ kind: 'fixed', minutes: 1 }`; `isOver` when `ctx.elapsedMs ≥ 60 000`.
- **tickMs:** 50 (smooth fade and timer).
- **Keys used as targets:** the four arrows and the letters `a s d f j k l` (home row,
  easy to find without looking). Never `p` (host pause), never Esc.
- **One target at a time.** It appears at a random spot (via `ctx.random()`), drawn as the
  key's symbol inside a 3 x 3 box (`←`, `↑`, `→`, `↓` or the letter), away from the edges
  and not on the previous spot.
- **Lifetime:** starts at 1500 ms. Each hit shortens the next lifetime by 40 ms, down to a
  floor of 450 ms. A miss lengthens it by 200 ms (capped at 1500 ms).
- **Fade:** the box colour steps from `brightWhite` → `white` → `gray` → `black`-ish as
  lifetime runs out, so you can see urgency without a number.
- **Hit:** correct key while the target is live. Score
  `10 + speed bonus (0..10, by remaining lifetime) `, times the streak multiplier
  (×1, ×2 from 10 hits, ×3 from 25). Brief `+N` flash at the spot.
- **Miss:** wrong key, or the target fades out. Streak resets to 0, short red flash.
  A new target appears after a 250 ms gap (also after a hit).
- **HUD (inside the 60 x 20 area, top row):** `Time 0:42   Streak 12 ×2   Hits 31  Misses 4`.
  The host status line still shows score and best.
- **End:** at 60 s the run ends; the host's results screen shows the score as usual.
- **Tests** (through the contract, fixed seed): initial state; `onKey`/`update` don't
  mutate; correct key scores and extends streak; wrong key resets streak; fade-out counts
  as a miss; lifetime floor and cap; `isOver` exactly at 60 s and not before;
  `length` is fixed 1 min.

## Left to the builder

- Exact instruction wording for the estimate, and whether to read it via classic
  `PreToolUse` or a mod event; both must never block Claude.
- New option name (`suggestGames`) vs. reusing `autoOpen`.
- Menu sort order, exact menu text and colours within the sketch above.
- Run-history file format details.
- Reflex colours, flash timings and exact box drawing.
