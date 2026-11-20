# Drift: a drifting coin-run game - design

Date: 2026-11-20
Status: draft, awaiting approval

## Intent

A new arcade game for time-waster. You steer a car that is always moving, sliding
around an arena and collecting coins. Hitting a wall or a pillar ends the run. The fun
is **pressure from rising speed**: the same turn that is easy at the start becomes a
long, barely-controlled slide later in the run.

## Goals

- Steering is the only input. The car moves on its own.
- A believable drift: the car's nose (heading) and its direction of travel can differ,
  and travel catches up with the nose more slowly the faster you go.
- Speed rises smoothly over the run, so every run ends in increasingly scary slides.
- Each run feels a little different (random pillar layout).
- Fits the existing game contract: one folder, `src/games/drift/`, no shared files touched.

## Non-goals

- Throttle or brake controls.
- Fixed tracks, laps, or multiple levels.
- Score bonuses for drifting, combos, power-ups (possible later, not now).
- Multiple coins at once.

## Anti-goals (failure even if it works)

- Unfair deaths: a pillar spawned on or right in front of the car at start, a coin
  spawned inside or flush against a pillar or wall, or the car passing *through* a
  pillar at high speed (or dying on one it visibly never touched).
- Drift that feels random rather than learnable: the same inputs from the same state
  must always give the same slide.
- Late-game speed so high that the run is impossible rather than hard.

## Constraints (from the repo, see docs/adding-a-game.md)

- Press-only input: no held keys, no two keys at once.
- A 60 x 20 cell play area; single-width characters only.
- Pure functions over plain-data state; `ctx.random()` for randomness, no `Date.now()`.
- Host owns P, Esc and Ctrl+C.
- Terminal cells are roughly twice as tall as they are wide.

## Approaches considered

1. **Continuous physics, grid display (chosen).** Float position, heading and velocity;
   each tick the velocity direction turns toward the heading at a rate that falls with
   speed. Collisions and pickups are checked on grid cells. Smooth, natural slides and a
   smooth speed ramp; needs fixed-seed tests and care with sub-cell motion.
2. **Pure grid rules.** The car moves one cell per step and keeps the old direction for
   N cells after a turn. Simpler and fully predictable, but a slide reads as a lane
   change rather than a drift, and speed can only rise in steps.

Chosen: 1, because the point of the game is the feel of a slide getting away from you.

## Design

### Arena

- The outer border of the 60 x 20 area is the wall (drawn with box-drawing characters).
  Driving into it ends the run.
- **Pillars**: a handful (about 5-7) of solid rectangular blocks, roughly 2-4 cells wide
  and 1-2 tall, placed at random each run with `ctx.random()`. Touching one ends the run.
- Pillars never appear within a safe zone around the start position and its forward
  path, and leave at least a 2-cell gap to the wall and to each other, so no area is
  sealed off.

### Car and controls

- The car starts at the left middle of the arena, heading right, already moving at the
  starting speed.
- **Left / Right** (presses) rotate the heading by 45 degrees. 8 headings, shown by the
  car glyph: `↑ ↗ → ↘ ↓ ↙ ← ↖` (these are single-width in Windows Terminal and conhost,
  like the arrows Worm already uses in its controls hint).
- Up / Down and all other keys do nothing. Controls hint: `←→ steer`.

### Drift physics

- State holds position (floats, in cells), heading (one of 8), speed (cells per second),
  and travel direction (an angle, float).
- Every tick, the travel direction rotates toward the heading by at most a **grip** angle.
  Grip falls as speed rises, so at high speed a 90-degree turn produces a long sideways
  slide before the car is pointing where it travels.
- Movement uses the travel direction and the speed. Vertical motion is scaled by 0.5 so
  that cells-per-second looks the same horizontally and vertically on screen (cells are
  about 2:1).
- `tickMs` around 50 for smooth motion.
- **No tunnelling**: if the car would move more than one cell in a tick, the move is
  split into sub-steps of at most one cell and every cell passed through is checked for
  walls, pillars and the coin.
- A short skid trail (last few cells visited) is drawn behind the car in a dim colour
  while the travel direction differs from the heading by more than a small angle, so you
  can see the slide.

### Speed ramp

- Speed rises smoothly with elapsed run time (using `ctx.elapsedMs`) from a gentle start
  to a maximum reached after about two minutes, then holds at that maximum.
- Collecting coins does not change speed.

### Coins and score

- One coin on the map at a time, drawn as `●` in yellow (like Worm's dot).
- A coin spawns on a free cell that is not a pillar, not adjacent to a pillar or wall,
  and at least some minimum distance from the car.
- Driving through the coin's cell collects it: +10 points, a new coin spawns.
- `score` is the points total; `isOver` is true once the car touches a wall or pillar.

### Tests

Through the contract with a fixed seed, as in `src/games/worm/worm.test.ts`: initial
state; `onKey` and `update` don't mutate input; left/right rotate the heading by one step
and other keys do nothing; travel direction converges to heading and does so more slowly
at higher speed; speed rises with elapsed time and caps; collecting a coin adds 10 and
respawns it in a valid cell; hitting the wall or a pillar ends the run; a fast car
cannot pass through a 1-cell pillar; generated pillars respect the start safe zone and
gaps.

### Edge cases (designer's calls, settled after review)

- The car's cell is its position rounded to the nearest cell, and the same rounding is
  used for drawing and for collisions, so you never die on something the car did not
  visibly touch.
- Only the cells the car actually enters count; a diagonal move that passes between two
  pillar corners without entering either is not a hit.
- If the car enters the coin's cell and a wall/pillar in the same sub-step, the crash
  wins (the coin is not counted).
- If the heading is exactly opposite the travel direction, travel turns the same way as
  the last steering press.
- Speed is driven by `ctx.elapsedMs`; under heavy lag the host may drop ticks while time
  keeps counting. Accepted: the effect is negligible in normal play.

## Left to the builder

- Exact tuning numbers: start/max speed, ramp duration (about two minutes), grip curve,
  number and size of pillars, safe-zone size, minimum coin distance, trail length and
  drift-angle threshold. Aim: the first 20-30 seconds feel relaxed, and runs past two
  minutes are rare but possible.
- Colours (keep to the 16 ANSI names), and the glyphs for pillars and trail.
- Internal code structure within `src/games/drift/`.
