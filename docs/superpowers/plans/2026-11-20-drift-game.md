# Drift Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Drift" game to the arcade: an always-moving car that slides around a pillar arena collecting coins, getting faster with every coin, until it hits something.

**Architecture:** One folder, `src/games/drift/`, split into pure physics helpers, pure arena helpers (pillars, coin spawning, collision cells) and the `Game` object that wires them together. Speed is derived from coins collected, so it is not stored in state.

**Tech Stack:** TypeScript, vitest, the existing `Game` contract in `src/core/types.ts`.

**Spec:** `docs/superpowers/specs/2026-11-20-drift-game-design.md`

## Global Constraints

- Touch only `src/games/drift/` (plus this plan). No edits to `src/core/`, other games, `package.json`. Do **not** commit `dist/`.
- Game id `drift`, title `Drift`, controls hint `←→ steer`.
- Single-width characters only. Car glyphs `→ ↘ ↓ ↙ ← ↖ ↑ ↗`, coin `●` yellow.
- Pure functions, plain-data state, never mutate inputs. Randomness only via `ctx.random()`. No `Math.random()`, no `Date.now()`.
- Do not bind P, Esc, Ctrl+C. Only `left` / `right` do anything.
- Play area is 60 x 20 (`GAME_WIDTH`, `GAME_HEIGHT`); the border cells (x 0 or 59, y 0 or 19) are the wall.
- Score = 10 per coin. Speed changes only when a coin is collected; max speed reached at 20 coins.
- Run `npm test` and `npm run typecheck` green before each commit.

## Review Focus

1. **Heading wrap on repeated presses**: pressing left from heading 0 must give 7, not -1 (JS `%` keeps the sign). Pinned in Task 1 (`rotateHeading`).
2. **Travel angle over many spins**: steering in circles for a long run must not make the angle grow unbounded or pick the long way round. Pinned in Task 1 (`angleDiff` range test) and Task 3 (spin test).
3. **Tunnelling at max speed, diagonal travel**: a car at 20+ coins must still crash into a 1-row pillar it crosses diagonally. Pinned in Task 3.
4. **Coin spawn always valid**: for any seed and any car position, a coin spawns in a legal cell (fallback when the distance rule can't be met). Pinned in Task 2.
5. **Pillar generation always terminates with 5-7 legal pillars**: bounded attempts, never inside the start safe zone. Pinned in Task 2.

---

## Shared types and constants

`Point = { x: number; y: number }` (integer cell), `Rect = { x: number; y: number; w: number; h: number }` (top-left cell, size in cells). Both exported from `arena.ts`.

Angles are radians; 0 = right, positive = clockwise on screen (y grows downward). Heading index `h` in 0..7 maps to angle `h * Math.PI / 4` (0 right, 2 down, 4 left, 6 up).

Starting tuning values (spec leaves exact tuning to the builder; adjust after playtesting, keep tests on behaviour, not on these exact numbers):

| Constant | Value | File |
|---|---|---|
| `TICK_MS` | 50 | physics.ts |
| `START_SPEED` | 8 (cells/s) | physics.ts |
| `MAX_SPEED` | 24 (cells/s) | physics.ts |
| `COINS_TO_MAX` | 20 | physics.ts |
| `GRIP_SLOW` | 0.35 (rad/tick at START_SPEED) | physics.ts |
| `GRIP_FAST` | 0.10 (rad/tick at MAX_SPEED) | physics.ts |
| `DRIFT_THRESHOLD` | 0.3 (rad) | physics.ts |
| `TRAIL_LEN` | 6 | index.ts |
| `START` | `{ x: 6, y: 10 }` | arena.ts |
| `SAFE_ZONE` | `{ x: 1, y: 7, w: 20, h: 7 }` | arena.ts |
| `MIN_COIN_DIST` | 10 | arena.ts |

---

### Task 1: Physics helpers

**Files:**
- Create: `src/games/drift/physics.ts`
- Test: `src/games/drift/physics.test.ts`

**Interfaces:**
- Produces:
  - constants from the table above
  - `headingAngle(h: number): number`
  - `rotateHeading(h: number, dir: 1 | -1): number` — result in 0..7
  - `speedForCoins(coins: number): number`
  - `gripFor(speed: number): number`
  - `angleDiff(from: number, to: number): number` — shortest signed difference, in (-π, π]
  - `turnToward(travel: number, target: number, maxStep: number, lastTurn: 1 | -1): number` — result normalised to [0, 2π)
  - `isDrifting(travel: number, heading: number): boolean` — `|angleDiff(travel, headingAngle(heading))| > DRIFT_THRESHOLD`

- [ ] **Step 1: Write the failing tests** in `physics.test.ts`

```ts
it('rotateHeading wraps both ways', () => {
  expect(rotateHeading(0, -1)).toBe(7);
  expect(rotateHeading(7, 1)).toBe(0);
  expect(rotateHeading(3, 1)).toBe(4);
});
it('speedForCoins starts slow, rises with shrinking steps, caps at 20 coins', () => {
  expect(speedForCoins(0)).toBe(START_SPEED);
  expect(speedForCoins(COINS_TO_MAX)).toBe(MAX_SPEED);
  expect(speedForCoins(50)).toBe(MAX_SPEED);
  const step1 = speedForCoins(1) - speedForCoins(0);
  const step19 = speedForCoins(20) - speedForCoins(19);
  expect(step1).toBeGreaterThan(step19);
  expect(step19).toBeGreaterThan(0);
});
it('grip falls as speed rises', () => {
  expect(gripFor(START_SPEED)).toBeCloseTo(GRIP_SLOW);
  expect(gripFor(MAX_SPEED)).toBeCloseTo(GRIP_FAST);
  expect(gripFor(16)).toBeLessThan(gripFor(10));
});
it('angleDiff takes the short way and stays in (-π, π]', () => {
  expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2);
  expect(angleDiff(0, Math.PI)).toBeCloseTo(Math.PI);
  for (const [a, b] of [[50, -3], [-20, 7], [0, 100]]) {
    const d = angleDiff(a, b);
    expect(d).toBeGreaterThan(-Math.PI);
    expect(d).toBeLessThanOrEqual(Math.PI);
  }
});
it('turnToward moves at most maxStep and lands exactly when close', () => {
  expect(turnToward(0, Math.PI / 2, 0.2, 1)).toBeCloseTo(0.2);
  expect(turnToward(0, 0.1, 0.2, 1)).toBeCloseTo(0.1);
  expect(turnToward(0.1, 2 * Math.PI - 0.1, 0.5, 1)).toBeCloseTo(2 * Math.PI - 0.1); // short way, wraps
});
it('turnToward uses lastTurn when target is exactly opposite', () => {
  expect(turnToward(0, Math.PI, 0.2, 1)).toBeCloseTo(0.2);
  expect(turnToward(0, Math.PI, 0.2, -1)).toBeCloseTo(2 * Math.PI - 0.2);
});
it('isDrifting compares travel with heading', () => {
  expect(isDrifting(0, 0)).toBe(false);
  expect(isDrifting(0, 2)).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run src/games/drift/physics.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `physics.ts`**

`speedForCoins(n) = START_SPEED + (MAX_SPEED - START_SPEED) * Math.sqrt(Math.min(n, COINS_TO_MAX) / COINS_TO_MAX)` (concave: steps shrink, exact max at 20).
`gripFor` interpolates linearly between `GRIP_SLOW` at `START_SPEED` and `GRIP_FAST` at `MAX_SPEED`, clamped.
`turnToward`: `d = angleDiff(travel, target)`; if `|d|` is within `1e-9` of π, use `d = π * lastTurn`; step `clamp(d, -maxStep, maxStep)`; normalise to [0, 2π).

- [ ] **Step 4: Run** `npx vitest run src/games/drift/physics.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/games/drift/physics.ts src/games/drift/physics.test.ts
git commit -m "feat(drift): physics helpers"
```

---

### Task 2: Arena: pillars, walls, coin spawning

**Files:**
- Create: `src/games/drift/arena.ts`
- Test: `src/games/drift/arena.test.ts`

**Interfaces:**
- Consumes: `GAME_WIDTH`, `GAME_HEIGHT`, `GameContext` from `src/core/types.ts`.
- Produces:
  - `Point`, `Rect`, `START`, `SAFE_ZONE`, `MIN_COIN_DIST`
  - `isWall(p: Point): boolean` — border cell or outside the grid
  - `inRect(p: Point, r: Rect): boolean`
  - `isBlocked(p: Point, pillars: Rect[]): boolean` — wall or inside any pillar
  - `generatePillars(ctx: GameContext): Rect[]`
  - `spawnCoin(car: Point, pillars: Rect[], ctx: GameContext): Point`

Rules (from the spec):
- `generatePillars`: count `5 + floor(random*3)` (5-7); each `w` 2-4, `h` 1-2. A pillar is legal when every cell is at least 2 cells from the wall (x in 3..56, y in 3..16), it does not intersect `SAFE_ZONE`, and it does not come within 2 cells of another pillar (the pillar grown by 2 on each side doesn't intersect it). Rejection-sample with a bounded number of attempts (e.g. 500 per pillar); it must always terminate.
- `spawnCoin`: candidates are cells where the cell and all 8 neighbours are not blocked. Prefer candidates with `Math.hypot(dx, 2 * dy) >= MIN_COIN_DIST` from `car` (dy doubled because cells are about 2:1); if there are none, use any candidate. Pick uniformly with `ctx.random()`.

- [ ] **Step 1: Write the failing tests** in `arena.test.ts` (use `createRandom(seed)` contexts as in `worm.test.ts`)

```ts
it('walls are the border', () => {
  expect(isWall({ x: 0, y: 5 })).toBe(true);
  expect(isWall({ x: 59, y: 5 })).toBe(true);
  expect(isWall({ x: 5, y: 19 })).toBe(true);
  expect(isWall({ x: 1, y: 1 })).toBe(false);
});
it('generates 5-7 legal pillars for every seed', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const ps = generatePillars(ctx(seed));
    expect(ps.length).toBeGreaterThanOrEqual(5);
    expect(ps.length).toBeLessThanOrEqual(7);
    for (const p of ps) {
      expect(p.w).toBeGreaterThanOrEqual(2); expect(p.w).toBeLessThanOrEqual(4);
      expect(p.h).toBeGreaterThanOrEqual(1); expect(p.h).toBeLessThanOrEqual(2);
      expect(p.x).toBeGreaterThanOrEqual(3); expect(p.x + p.w - 1).toBeLessThanOrEqual(56);
      expect(p.y).toBeGreaterThanOrEqual(3); expect(p.y + p.h - 1).toBeLessThanOrEqual(16);
      // no cell inside SAFE_ZONE
      // no other pillar within 2 cells (grown rect check)
    }
  }
});
it('coin spawns on a legal cell, far from the car, for every seed', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const c = ctx(seed);
    const pillars = generatePillars(c);
    const car = { x: 30, y: 10 };
    const coin = spawnCoin(car, pillars, c);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      expect(isBlocked({ x: coin.x + dx, y: coin.y + dy }, pillars)).toBe(false);
    expect(Math.hypot(coin.x - car.x, 2 * (coin.y - car.y))).toBeGreaterThanOrEqual(MIN_COIN_DIST);
  }
});
it('coin still spawns when no cell meets the distance rule', () => {
  // pillars filling everything except a small pocket next to the car
  // -> expect a legal (unblocked, no blocked neighbours) cell, distance ignored
});
```

Fill in the two commented checks and the pocket test's setup (e.g. pillars covering x 1..58 except a 5 x 5 pocket around the car).

- [ ] **Step 2: Run** `npx vitest run src/games/drift/arena.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `arena.ts`** per the rules above.

- [ ] **Step 4: Run** `npx vitest run src/games/drift/arena.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/games/drift/arena.ts src/games/drift/arena.test.ts
git commit -m "feat(drift): arena, pillars and coin spawning"
```

---

### Task 3: The Drift game

**Files:**
- Create: `src/games/drift/index.ts`
- Test: `src/games/drift/drift.test.ts`

**Interfaces:**
- Consumes: everything Task 1 and Task 2 produce; `Game`, `GameContext`, `Key`, `Screen` from `src/core/types.ts`.
- Produces: default export `drift: Game<DriftState>`, and exported

```ts
export interface DriftState {
  x: number; y: number;      // float position, in cells
  heading: number;           // 0..7
  travel: number;            // radians, [0, 2π)
  lastTurn: 1 | -1;          // last steering press: 1 = right (clockwise), -1 = left
  coins: number;
  coin: Point;
  pillars: Rect[];
  trail: Point[];            // most recent cell first, at most TRAIL_LEN, no consecutive duplicates
  crashed: boolean;
}
export function cellOf(s: { x: number; y: number }): Point; // Math.round of each coordinate
```

Behaviour:
- `init`: car at `START`, heading 0, travel 0, lastTurn 1, coins 0, `pillars = generatePillars(ctx)`, `coin = spawnCoin(START, pillars, ctx)`, empty trail, not crashed.
- `onKey`: `right` → `rotateHeading(h, 1)`, lastTurn 1; `left` → `rotateHeading(h, -1)`, lastTurn -1; anything else returns the same state. Ignore keys once crashed.
- `update` (no-op once crashed):
  1. `speed = speedForCoins(coins)`; `travel = turnToward(travel, headingAngle(heading), gripFor(speed), lastTurn)`.
  2. `dx = cos(travel) * speed * TICK_MS / 1000`, `dy = sin(travel) * speed * TICK_MS / 1000 * 0.5`.
  3. Split into `n = max(1, ceil(max(|dx|, |dy|)))` equal sub-steps. After each sub-step, take `cellOf`: if blocked → crashed, stop (crash wins over coin in the same sub-step); else if it equals `coin` → coins + 1, `coin = spawnCoin(cell, pillars, ctx)`; push the cell onto the trail if it differs from the trail's head. Speed for the rest of this tick stays as computed in step 1.
- `draw`: wall border with `┌ ┐ └ ┘ ─ │`; pillars as `█`; trail cells as `·` in `gray` only while `isDrifting(travel, heading)` (skip the car's own cell); coin `●` `yellow`; car glyph `['→','↘','↓','↙','←','↖','↑','↗'][heading]` at `cellOf(state)`. Other colours are the builder's choice.
- `score = coins * 10`; `isOver = crashed`; `tickMs = TICK_MS`; description: `"Drift for coins. Every coin is faster. Don't touch the walls."`

- [ ] **Step 1: Write the failing tests** in `drift.test.ts`. Build states by spreading `drift.init(ctx())` and overriding fields (`pillars: []`, a far-away `coin`) so tests are independent of random layout.

```ts
it('starts at START, score 0, not over, valid coin', ...);           // cellOf = {6,10}, heading 0
it('onKey rotates heading, sets lastTurn, ignores other keys, does not mutate', ...);
  // left from 0 -> heading 7, lastTurn -1; 'up','a','space' return identical state; original unchanged
it('update moves right at start speed without mutating input', ...);
  // x increases by START_SPEED*0.05 (=0.4); input state x unchanged
it('after a 90° turn, travel converges to heading, slower at higher speed', ...);
  // press right twice (heading 2, down). count ticks until |angleDiff| < 1e-6
  // at coins 0 vs coins 20 (in an open arena, car mid-field); expect fewer ticks at coins 0
it('speed stays constant between coins and rises when a coin is collected', ...);
  // x delta per tick equal across 5 ticks with no coin; place coin one cell ahead,
  // after collection coins = 1, score 10, next tick's x delta is larger, new coin legal
it('hitting the right wall ends the run', ...);   // car at x 57.8 heading right
it('hitting a pillar ends the run', ...);
it('max speed diagonal cannot tunnel through a 1-row pillar', ...);
  // coins 20, heading/travel 1 (down-right), pillar {x: 17, y: 12, w: 8, h: 1} across its path from (16, 10) (path crosses row 12 near x 19)
  // run ticks until crashed or x > 30; expect crashed and car cell never past the pillar row
it('crash wins over a coin in the same cell', ...); // coin placed inside the wall cell ahead
it('travel stays in [0, 2π) after many spins', ...); // press right 1 time per tick for 400 ticks, open arena
it('draws car glyph, coin and walls; trail only while drifting', ...);
  // capture put() calls as in worm.test.ts: '6,10,→,…', a ',●,yellow' call, '0,0,┌'
  // a drifting state (heading 2, travel 0, trail of 3 cells) draws '·'; a non-drifting one doesn't
```

For the open-arena tests set `pillars: []`, place the car mid-field (e.g. `x: 30, y: 10`), and put the coin out of the way (e.g. `{ x: 2, y: 2 }`). Where a test runs many ticks, keep the car away from the walls by choosing the start position or tick count accordingly.

- [ ] **Step 2: Run** `npx vitest run src/games/drift/drift.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `index.ts`** per the behaviour above.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: all tests pass (including the existing worm/core/discover tests), typecheck clean.

- [ ] **Step 5: Play it**: `npm run dev -- drift`. Check: the game is listed as "Drift" in the menu; the first few coins feel relaxed; sharp turns at 15+ coins slide visibly with a trail; you only crash on cells you visibly touched. Tune the constants in `physics.ts` / `arena.ts` if needed, then re-run `npm test`.

- [ ] **Step 6: Commit** (no `dist/`, no `.dev/`)

```bash
git add src/games/drift/
git status   # confirm dist/ is not staged
git commit -m "feat(drift): drift game"
```
