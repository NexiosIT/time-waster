# Drift: gameplay update (reachable coins, power-ups, growing arena) - design

Date: 2026-11-20
Status: draft, reviewed, awaiting approval
Builds on: `2026-11-20-drift-game-design.md` (everything there still holds unless changed here)

## Intent

Drift works, but two things hold it back:

1. **Unfair coins.** At high speed the car's turning circle is about 12 cells wide and
   6 rows tall, but a coin only needs a 1-cell gap from walls and pillars. A coin
   close to a wall or pillar is often impossible to reach without crashing, and this gets
   worse the better you are doing.
2. **Every run plays the same.** You grab one coin after another until the speed beats
   you. The user wants more gameplay: **short bursts of fun, some with a risk**, and
   **new obstacles appearing over time**.

## Goals

- A coin is always reachable at the car's current speed.
- Power-ups on the floor: brief, exciting, picked up by driving through them. Most are
  pure fun; a few trade risk for reward.
- The arena fills up as you score: new obstacles appear over time, always with a warning.
- Same game contract and folder: only `src/games/drift/` changes.

## Non-goals

- Visual changes. The car stays a single arrow; no new trail, coin or pillar graphics
  (decided by the user). Only what the new features need to be visible
  (power-up letters, obstacle warnings, active-effect readout) is added.
- New controls. Steering (left/right) stays the only input.
- Throttle, brakes, levels, laps.

## Anti-goals (failure even if it works)

- Unfair deaths: an obstacle turning solid on or right in front of the car, or a
  coin / power-up placed where it can't be reached at the current speed.
- An arena that gets sealed off, or so crowded that a run can't go on.
- Power-ups that feel random rather than learnable: each one does the same thing every time.
  (Mystery is random *which* effect, but each effect behaves as usual.)
- Effects you can't read: you must always be able to see what is active and how long it has left.

## Constraints (unchanged, from docs/adding-a-game.md)

- Press-only input, 60 x 20 area, single-width characters, 16 ANSI colours.
- Pure functions over plain data; `ctx.random()` for randomness. All timers count
  **ticks** (`TICK_MS` = 50 ms), not wall-clock time, so pause stops them for free and
  tests are deterministic.
- Cells are about 2:1 (tall); vertical motion is already scaled by 0.5.

## Approaches considered

The user handed over the "how"; these are Claude's calls.

**Effects:**
1. **One active-effects list in state + a single "modifiers" function (chosen).** State
   holds `effects: { kind, ticksLeft }[]`. One pure function turns that list into the
   numbers the tick uses: speed multiplier, grip override, coin value multiplier, shield on/off.
   `update` asks for the modifiers once per tick. Each power-up is a small entry in a table.
2. **Each effect as its own flag and timer field on state** (`doubleTicks`, `nitroTicks`, ...).
   Simpler to read at first, but every new power-up touches state, init, update and draw.
3. **A generic plug-in effect system** (effects as objects with hooks). Overkill for seven
   power-ups in one game.

**Coin reachability:**
1. **Clearance that grows with speed (chosen).** Coins (and power-ups) need a gap from
   walls and pillars that grows from 1 cell at start speed to about 4 cells horizontally
   (2 rows vertically) at top speed. Simple, testable, and close enough to the real turning circle.
2. **Simulate the drive** to check a coin can be reached. Exact, but slow, complex and
   hard to test; the simple rule fixes the actual complaint.

## Design

### 1. Reachable coins

- Required clearance from any wall or pillar cell scales with current speed:
  horizontal clearance `cx` from 1 (start speed) to 4 (max speed), vertical clearance
  `cy` = `ceil(cx / 2)` (cells are 2:1). A candidate cell is legal if no blocked cell is
  within `cx` columns and `cy` rows of it.
- Speed here means the speed **after** the coin that triggered the spawn, including
  Nitro if it is active (Nitro is the fastest the car will be while the coin is live).
- If no cell meets the clearance (very crowded arena), fall back step by step to smaller
  clearances, down to today's 1-cell rule. Never fail to place a coin.
- The same rule applies to power-ups and to the extra coins from Coin rain.

### 2. Power-ups

**On the floor.**
- At most one power-up on the floor at a time.
- A new one spawns once 3-4 coins (random in that range) have been collected since the
  previous power-up was **picked up or expired**; nothing new is scheduled while one is on
  the floor *(Claude's call)*. It spawns on a legal cell (rule above), at least the minimum coin distance from the car.
- It disappears after about 8 seconds (160 ticks) if not taken; it blinks during its last 2 seconds.
- Picked up by driving through its cell, same as a coin (crash wins if both happen in one sub-step).
- Drawn as one coloured letter/symbol.

**Active effects.**
- Taking a power-up starts its effect immediately. Taking the same kind again resets its timer.
  Different kinds stack (e.g. Double + Nitro = coins ×6).
- The top border shows each active effect and its time left, e.g. `─ ×2 ▮▮▮▯ ─ N ▮▯ ─`.
  (Drawing on the border row is inside the 60 x 20 game area.)

**The set.**

| Glyph | Name | Effect | Duration | Kind |
|------|------|--------|----------|------|
| `2` (yellow) | Double | Coins worth ×2 | 10 s | fun |
| `G` (green) | Grip | Grip is set to the start-speed grip: sharp turns even at top speed | 6 s | fun |
| `$` (yellow) | Coin rain | 5 extra coins appear at once (legal cells). They vanish when the effect ends; the normal coin stays | 6 s | fun |
| `N` (red) | Nitro | Speed ×1.5 and coins worth ×3 | 5 s | risk |
| `S` (cyan) | Shield | The next pillar you hit is destroyed instead of ending the run; the shield is then used up. Walls still end the run | 10 s or until used | risk/fun |
| `X` (shuffle, magenta) | Shuffle | Pillars are rearranged (see below) | instant | map |
| `?` (white) | Mystery | A random one of the above, or 4 s of **Slick**: grip almost zero | - | risk |

- Spawn weights are left to the builder; Mystery and Nitro should be a bit rarer.
- Extra coins from Coin rain count like normal coins for points and speed (the speed
  rise is part of the risk), but they do **not** advance the power-up or obstacle
  schedules, so Coin rain doesn't fill the arena or chain into more power-ups. The game
  keeps a separate `scheduleCoins` counter for that *(Claude's call)*. Taking Coin rain while
  it is active only resets its timer; no more extras.
- Score: the game now keeps a `points` total, since coin value varies. `score` returns
  `points`. Base coin value stays 10.

**Grip priority** *(Claude's call)*: the grip used each tick is worked out in this order:
1. Start from `gripFor(speed)`, where speed **includes** Nitro, so Nitro also lowers grip (that's its risk).
2. Grip and Slick cancel each other: taking one removes the other. Whichever is active applies
   (Grip = start-speed grip, Slick = near zero).
3. Oil sets grip to near zero, **unless Grip is active**. Grip is the learnable counter to oil.

**Shuffle.**
- The current pillar count is kept (including pillars added over time); positions are
  regenerated with the existing gap rules, but **without** the start safe zone (that only
  applies to the first layout) *(Claude's call)*.
- If placement can't fit all pillars after the usual retries, it places as many as fit and
  keeps the rest of the old pillars that don't clash, so the count may drop slightly. It
  never fails or freezes *(Claude's call)*.
- New pillars never overlap the car's cell or the cells within ~8 cells ahead of it
  along its travel direction, nor the coin(s) or power-up on the floor.
- The new layout shows as blinking outlines for 1.5 s (30 ticks) while the old pillars stay
  solid, then swaps in at once.

**Shield and the pillar.** When a shielded car hits a pillar, the whole pillar (rectangle)
is removed, the shield ends, and the car carries on unchanged.

### 3. Growing arena (new obstacles over time)

- Every 5 coins, one new obstacle is queued.
- **Warning:** it shows as a blinking outline (pillar) or blinking `≈` (oil) for 2 s
  (40 ticks), and is harmless during that time. Then it turns solid.
- **Placement:** follows the existing gap rules (2-cell gap to walls and other pillars),
  but not the start safe zone, so the whole arena can fill *(Claude's call)*. If no
  legal place exists, that obstacle is skipped. Coins and power-ups never spawn on a
  pending (blinking) obstacle.
  not on or within ~8 cells ahead of the car, not on a coin or power-up. If, at the moment
  it turns solid, the car is on or within 2 cells of it, the obstacle waits until the car
  has moved clear.
- **Types:** a pillar, or from 10 coins on, sometimes an **oil slick**: a patch about
  3-5 cells wide and 1-2 rows tall, drawn as `≈` (gray or blue). While the car is on oil,
  grip is close to zero, so travel barely turns toward the heading. Oil does not crash
  the car. Coins and power-ups never spawn on oil.
- **Caps:** at most 12 pillars and 3 oil slicks in total. Once a cap is hit, no more of that
  type are added (Shield removals free up room again).

### Tests (through the contract, fixed seed, like the existing drift tests)

- Coin clearance grows with speed; a coin placed at top speed respects the larger clearance;
  in an over-crowded arena the fallback still places a coin.
- Power-up spawns on schedule, expires after its time, and is collected by driving through it.
- Each effect: Double/Nitro coin values (and stacking), Nitro speed, Grip grip value, Coin rain
  extras appear and vanish, Shield destroys a pillar once and walls still kill, Slick grip.
- Timers count ticks and do not run when `update` is not called (pause).
- Shuffle keeps pillar count, respects the zone ahead of the car, shows the warning first.
- New obstacles: one per 5 coins, harmless during warning, caps respected, not placed
  ahead of the car, delayed when the car is on top of it.
- `onKey` / `update` still never mutate their input.

## Left to the builder

- Exact tuning: clearance curve, power-up spawn weights and exact interval, Slick and oil grip
  values, oil patch sizes, blink rate, readout layout in the top border.
- Colours (16 ANSI names) for power-ups and outlines.
- Code structure inside `src/games/drift/` (e.g. `powerups.ts`, `obstacles.ts`).
- Aim for the same feel as before: the first ~5 coins relaxed, 20+ coins rare but possible,
  with power-ups making runs feel different from each other.
