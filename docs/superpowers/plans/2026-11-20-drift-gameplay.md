# Drift Gameplay Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every coin reachable at the current speed, add seven floor power-ups, and make the arena grow new obstacles as the score rises.

**Architecture:** Everything stays in `src/games/drift/`. A new pure `effects.ts` turns the list of active effects into the numbers a tick uses (speed multiplier, coin multiplier, grip). A new `powerups.ts` holds the power-up table and spawn rules, and a new `obstacles.ts` holds pending obstacles, oil and Shuffle. `arena.ts` gains speed-scaled coin clearance and a reusable rectangle placer. `index.ts` stays the orchestrator: state, `update`, `draw`. All timers count ticks.

**Tech Stack:** TypeScript, vitest, esbuild (existing).

**Spec:** `docs/superpowers/specs/2026-11-20-drift-gameplay-design.md` (builds on `2026-11-20-drift-game-design.md`)

## Global Constraints

- Touch only `src/games/drift/` (and this plan). No `src/core/`, no `dist/`, no `package.json`.
- Pure functions over plain data; `onKey`/`update` never mutate their input.
- `ctx.random()` only, no `Math.random()`/`Date.now()`. All timers are tick counts (`TICK_MS` = 50).
- Single-width characters only; colours from the 16 ANSI names in `Color`.
- Car graphics unchanged (single arrow); trail unchanged.
- Base coin value 10; `score` returns `points`.
- Run `npm test` and `npm run typecheck` before every commit; both must pass.

## Review Focus

1. **Nitro at top speed** (24 × 1.5 = 36 cells/s): sub-stepping must still stop tunnelling through a 1-row pillar. Test in Task 3.
2. **Shield used, then a second pillar in the same tick:** the second pillar must crash the car. Test in Task 4.
3. **Crowded arena** (12 pillars + 3 oil + 5 Coin rain extras): coin, extra and power-up spawns must never throw or land on anything blocked. Test in Task 5.
4. **A pickup and a crash in the same sub-step** (power-up next to a wall): the crash wins and the power-up is not taken. Test in Task 3.
5. **A Shuffle swap landing on the car** (the car moved during the 1.5 s warning): any new pillar that clashes with the car's zone at swap time is dropped, never placed on the car. Test in Task 6.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `arena.ts` (modify) | walls, pillar generation, `clearanceFor`, `spawnCoin` with clearance + avoid list, `placeRect`, `carZone` |
| `effects.ts` (create) | effect kinds, durations, add/tick/remove, `modifiers`, `gripNow` |
| `powerups.ts` (create) | power-up kinds, glyph/colour table, weighted pick, Mystery resolve, schedule helper |
| `obstacles.ts` (create) | pending obstacles, oil, caps, solidify rule, Shuffle layout |
| `index.ts` (modify) | state, `update` orchestration, `draw`, top-border readout |
| `*.test.ts` | `arena.test.ts`, `effects.test.ts`, `powerups.test.ts`, `obstacles.test.ts`, `drift.test.ts` |

Shared test helpers (already in `drift.test.ts`): `ctx(seed)`, `open(over)` (empty arena, car at 30,10 heading right, coin at 2,2). `open()` must keep working as fields are added: new fields come from `init`.

---

### Task 1: Reachable coins

**Files:**
- Modify: `src/games/drift/arena.ts`, `src/games/drift/index.ts`
- Test: `src/games/drift/arena.test.ts`, `src/games/drift/drift.test.ts`

**Interfaces:**
- Produces:
  - `clearanceFor(speed: number): { cx: number; cy: number }`, where `cx = clamp(round(1 + 3·(speed − START_SPEED)/(MAX_SPEED − START_SPEED)), 1, 4)` and `cy = ceil(cx / 2)`. Speeds above `MAX_SPEED` (Nitro) clamp to 4.
  - `spawnCoin(car: Point, pillars: Rect[], ctx: GameContext, opts?: { speed?: number; avoid?: Rect[] }): Point`. `speed` defaults to `START_SPEED`. `avoid` lists rects the coin must not sit inside (no clearance needed from them). Clearance applies to walls and pillars only.
  - `export const pointRect = (p: Point): Rect => ({ x: p.x, y: p.y, w: 1, h: 1 })`

- [ ] **Step 1: Write the failing tests** (in `arena.test.ts`)

```ts
it('clearance grows with speed and clamps', () => {
  expect(clearanceFor(START_SPEED)).toEqual({ cx: 1, cy: 1 });
  expect(clearanceFor(MAX_SPEED)).toEqual({ cx: 4, cy: 2 });
  expect(clearanceFor(MAX_SPEED * 1.5)).toEqual({ cx: 4, cy: 2 });
});

it('at top speed a coin keeps 4 columns / 2 rows from walls and pillars, for every seed', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const c = ctx(seed); const pillars = generatePillars(c);
    const coin = spawnCoin(START, pillars, c, { speed: MAX_SPEED });
    for (let dy = -2; dy <= 2; dy++) for (let dx = -4; dx <= 4; dx++)
      expect(isBlocked({ x: coin.x + dx, y: coin.y + dy }, pillars)).toBe(false);
  }
});

it('falls back to smaller clearance when the arena is crowded', () => {
  const wall: Rect[] = [{ x: 1, y: 4, w: 58, h: 12 }]; // leaves rows 1-3 and 16-18 only
  const coin = spawnCoin({ x: 30, y: 2 }, wall, ctx(), { speed: MAX_SPEED });
  expect(isBlocked(coin, wall)).toBe(false);
});

it('never spawns inside an avoid rect', () => {
  const avoid: Rect[] = [{ x: 1, y: 1, w: 58, h: 16 }]; // rows 17-18 free; only row 17 meets clearance 1
  for (let seed = 1; seed <= 20; seed++) {
    const coin = spawnCoin({ x: 30, y: 10 }, [], ctx(seed), { avoid });
    expect(avoid.some((r) => inRect(coin, r))).toBe(false);
    expect(isBlocked(coin, [])).toBe(false);
  }
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `npx vitest run src/games/drift/arena.test.ts`. Expected: FAIL (`clearanceFor` not exported).

- [ ] **Step 3: Implement it.** Candidate cells must be outside every `avoid` rect and have no blocked cell within `cx` columns / `cy` rows. Try `cx` from `clearanceFor(speed).cx` down to 1 (with `cy = ceil(cx/2)`), and take the first `cx` that has any candidate. Then apply the existing `MIN_COIN_DIST` filter and its fallback unchanged. If even `cx = 1` gives nothing, use any free non-avoided cell.

- [ ] **Step 4: Wire it in `index.ts`.** Call `spawnCoin(cell, pillars, ctx, { speed: speedForCoins(coins) })` with the coin count after the pickup (`init` uses `START_SPEED`). Add a test to `drift.test.ts`: `'respawned coin respects clearance for the new speed'`. Set `coins: 19` with the coin right in front of the car, run `update`, and assert every blocked check within `clearanceFor(speedForCoins(20))` around `s.coin` is false.

- [ ] **Step 5: Run `npm test` and `npm run typecheck`.** Expected: all pass, existing tests included.

- [ ] **Step 6: Commit** `feat(drift): coin clearance grows with speed`.

---

### Task 2: Effects module

**Files:**
- Create: `src/games/drift/effects.ts`
- Test: `src/games/drift/effects.test.ts`

**Interfaces:**
- Produces:
```ts
export type EffectKind = 'double' | 'grip' | 'rain' | 'nitro' | 'shield' | 'slick';
export interface Effect { kind: EffectKind; ticksLeft: number }
export const DURATION: Record<EffectKind, number> =
  { double: 200, grip: 120, rain: 120, nitro: 100, shield: 200, slick: 80 };
export const NITRO_SPEED = 1.5, NITRO_VALUE = 3, DOUBLE_VALUE = 2, LOW_GRIP = 0.02;
export function addEffect(effects: Effect[], kind: EffectKind): Effect[];   // reset timer if present; grip removes slick, slick removes grip
export function removeEffect(effects: Effect[], kind: EffectKind): Effect[];
export function hasEffect(effects: Effect[], kind: EffectKind): boolean;
export function tickEffects(effects: Effect[]): Effect[];                   // −1 each, drop those reaching 0
export function modifiers(effects: Effect[]): { speedMul: number; coinMul: number }; // product of active multipliers
export function gripNow(speed: number, effects: Effect[], onOil: boolean): number;
```
`gripNow` order (spec): base `gripFor(speed)`, where speed already includes Nitro. Grip active → `GRIP_SLOW`. Else Slick active → `LOW_GRIP`. Else on oil → `LOW_GRIP`. Else base.

- [ ] **Step 1: Write the failing tests.**
  - `addEffect resets an existing timer instead of duplicating`: add double, tick 50×, add double → one entry, `ticksLeft === 200`.
  - `grip and slick cancel each other`: add grip then slick → only slick; and the reverse.
  - `tickEffects drops expired effects and does not mutate`: nitro after 100 ticks is gone, and the input array is unchanged.
  - `modifiers stack`: `[]` → `{1,1}`; double → coinMul 2; nitro → speedMul 1.5, coinMul 3; both → coinMul 6.
  - `gripNow priority`: base = `gripFor(speed)`; on oil → `LOW_GRIP`; grip + oil → `GRIP_SLOW`; slick → `LOW_GRIP`; `gripNow(MAX_SPEED, [], false) === GRIP_FAST`.
- [ ] **Step 2: Run `npx vitest run src/games/drift/effects.test.ts`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `effects.ts`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(drift): active effects and modifiers`.

---

### Task 3: Power-ups on the floor + points + Double / Nitro / Grip / Mystery

**Files:**
- Create: `src/games/drift/powerups.ts`
- Modify: `src/games/drift/index.ts`
- Test: `src/games/drift/powerups.test.ts`, `src/games/drift/drift.test.ts`

**Interfaces:**
- Consumes: Task 2's effects API, Task 1's `spawnCoin`/`pointRect`.
- Produces (`powerups.ts`):
```ts
export type PowerKind = 'double' | 'grip' | 'rain' | 'nitro' | 'shield' | 'shuffle' | 'mystery';
export interface PowerUp { kind: PowerKind; at: Point; ticksLeft: number }
export const POWER_LIFE = 160, POWER_BLINK = 40;
export const POWER_LOOK: Record<PowerKind, { ch: string; color: Color }> = {
  double: { ch: '2', color: 'brightYellow' }, grip: { ch: 'G', color: 'brightGreen' },
  rain: { ch: '$', color: 'yellow' }, nitro: { ch: 'N', color: 'brightRed' },
  shield: { ch: 'S', color: 'brightCyan' }, shuffle: { ch: 'X', color: 'brightMagenta' },
  mystery: { ch: '?', color: 'brightWhite' } };
export const POWER_WEIGHTS: Record<PowerKind, number> =
  { double: 3, grip: 3, rain: 3, shield: 3, shuffle: 2, nitro: 2, mystery: 2 };
export function pickPower(ctx: GameContext): PowerKind;                 // weighted
export function resolveMystery(ctx: GameContext): Exclude<PowerKind, 'mystery'> | 'slick'; // 7 equal options
export function nextPowerGap(ctx: GameContext): number;                 // 3 or 4
```
- Produces (`DriftState` additions, all set by `init`):
```ts
points: number;              // score
scheduleCoins: number;       // coins that drive schedules (Coin rain extras excluded)
nextPowerAt: number | null;  // scheduleCoins at which the next power-up spawns; null while one is on the floor
powerUp: PowerUp | null;
effects: Effect[];
tick: number;                // +1 per update, used for blinking
```
`init`: `points 0, scheduleCoins 0, nextPowerAt = nextPowerGap(ctx), powerUp null, effects [], tick 0`.

**Rules for `update`, in order each tick:**
1. `effects = tickEffects(effects)`.
2. `speed = speedForCoins(coins) * modifiers(effects).speedMul`, then `grip = gripNow(speed, effects, false)`. Oil comes in Task 5.
3. Sub-step as today. When the car enters the coin cell: `coins += 1`, `scheduleCoins += 1`, `points += 10 * coinMul`, then respawn the coin with speed `speedForCoins(coins) * speedMul`. When it enters `powerUp.at`, call `applyPower(state, kind, ctx)`: double/grip/nitro/shield/rain add their effect, mystery resolves first (`slick` → `addEffect(…,'slick')`), shuffle is a no-op until Task 6. Then set `powerUp = null` and `nextPowerAt = scheduleCoins + nextPowerGap(ctx)`. A crash in the same sub-step wins, as it does for coins.
4. After moving: `powerUp.ticksLeft -= 1`. At 0 it expires (`powerUp = null`, `nextPowerAt = scheduleCoins + nextPowerGap(ctx)`).
5. If `powerUp === null && nextPowerAt !== null && scheduleCoins >= nextPowerAt`, spawn one with `pickPower`, at `spawnCoin(carCell, pillars, ctx, { speed, avoid: spawnAvoid(state) })`. `ticksLeft = POWER_LIFE`, `nextPowerAt = null`.
6. `tick += 1`.

`spawnAvoid(state): Rect[]` in `index.ts` returns the coin, power-up and extra coins as `pointRect`s. Tasks 5 and 6 add more. Coins use it too.

**Drawing:**
- The power-up glyph uses `POWER_LOOK`. When `ticksLeft <= POWER_BLINK`, draw it only when `Math.floor(tick / 4) % 2 === 0`.
- The readout goes on the top border from x = 2, one entry per active effect: `label + ' ' + bar + ' '`. Labels: double `×2`, grip `G`, rain `$`, nitro `N`, shield `S`, slick `SLICK`. `bar` is 4 cells: `ceil(4 · ticksLeft / DURATION[kind])` × `█`, the rest `░`. Colour comes from `POWER_LOOK`, and slick is `brightRed`. Clip at x = 57.

- [ ] **Step 1: Write the failing tests.**
  - `powerups.test.ts`: `pickPower` returns only `PowerKind`s, and every kind shows up over 2,000 seeded draws. `resolveMystery` never returns `'mystery'` and can return `'slick'`. `nextPowerGap` ∈ {3, 4}.
  - `drift.test.ts`:
    - `'coin gives 10 points; double gives 20; double+nitro gives 60'`: coin straight ahead of the car (`coin: {x:31,y:10}`), with `effects` set directly.
    - `'power-up spawns once scheduleCoins reaches nextPowerAt, on a legal non-avoided cell'`: `open({ nextPowerAt: 0 })` → after one update, `powerUp !== null` and `nextPowerAt === null`.
    - `'power-up expires after POWER_LIFE ticks and reschedules'`.
    - `'driving through a power-up applies it and reschedules'`: `powerUp: { kind:'double', at:{x:31,y:10}, ticksLeft:100 }` → `hasEffect(double)`, `powerUp === null`, `nextPowerAt` is `scheduleCoins + 3` or `+ 4`.
    - `'nitro moves 1.5× as far per tick'`.
    - `'grip effect turns at GRIP_SLOW at max speed'`: `coins: 20`, grip active, heading turned 90°, so after one tick `|angleDiff|` shrinks by `GRIP_SLOW`.
    - **Review Focus 1:** `'nitro at max speed cannot tunnel through a 1-row pillar'`. Copy the existing max-speed diagonal tunnelling test, add `effects: [{kind:'nitro', ticksLeft: 100}]`, and assert `crashed`.
    - **Review Focus 4:** `'crash wins over a power-up in the same cell'`. Mirror the existing coin version with `powerUp.at` on a wall-adjacent path.
    - `'readout shows active effects on the top border'`: `capture()` includes a `×` at y = 0 when double is active.
- [ ] **Step 2: Run `npx vitest run src/games/drift`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement `powerups.ts`, then the state, `update` and `draw` changes in `index.ts`.** Change `score` to `s => s.points`.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: pass. Update the existing `score` assertions only if they relied on `coins * 10`. They should still hold.
- [ ] **Step 5: Commit** `feat(drift): floor power-ups with double, nitro, grip and mystery`.

---

### Task 4: Coin rain and Shield

**Files:**
- Modify: `src/games/drift/index.ts`
- Test: `src/games/drift/drift.test.ts`

**Interfaces:**
- Consumes: Task 3's `applyPower`, `spawnAvoid`, effects.
- Produces: `DriftState.extraCoins: Point[]` (init `[]`), and `export const RAIN_COUNT = 5`.

**Rules:**
- Rain pickup: if rain is already active, only reset its timer. Otherwise add the effect and spawn `RAIN_COUNT` extras one at a time with `spawnCoin`, using the current speed and adding each new extra to `avoid`.
- When the car enters an extra coin: `coins += 1`, `points += 10 * coinMul`, remove that extra. `scheduleCoins` stays unchanged.
- After `tickEffects`, if rain is no longer active, set `extraCoins = []`.
- Shield: in the sub-step, a cell inside a pillar while shield is active removes that whole pillar from `pillars`, calls `removeEffect(…,'shield')`, and the car keeps going. Walls still crash. Without a shield, it crashes as before.
- Draw extras as `●` yellow.

- [ ] **Step 1: Write the failing tests.**
  - `'coin rain spawns 5 extras on legal distinct cells; they vanish when rain ends'`.
  - `'extra coins add points and speed but not scheduleCoins'`.
  - `'taking coin rain while active resets the timer without new extras'`.
  - `'shield destroys the pillar it hits, once'`: pillar `{x:32,y:10,w:1,h:1}` ahead with shield → not crashed, `pillars.length === 0`, shield gone.
  - `'shield does not save you from walls'`.
  - **Review Focus 2:** `'after the shield is used, a second pillar in the same tick crashes'`. Use `coins: 20` with Nitro so one tick covers more than 2 cells, and pillars at x = 31 and x = 32.
- [ ] **Step 2: Run `npx vitest run src/games/drift/drift.test.ts`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(drift): coin rain and shield`.

---

### Task 5: Growing arena (pending obstacles, oil, caps)

**Files:**
- Create: `src/games/drift/obstacles.ts`
- Modify: `src/games/drift/arena.ts`, `src/games/drift/index.ts`
- Test: `src/games/drift/obstacles.test.ts`, `src/games/drift/arena.test.ts`, `src/games/drift/drift.test.ts`

**Interfaces:**
- Produces (`arena.ts`):
  - `placeRect(existing: Rect[], avoid: Rect[], size: { w: [number, number]; h: [number, number] }, ctx: GameContext, attempts = 500): Rect | null`: random size and position with a 2-cell gap to the walls (x ∈ [3, 57−w], y ∈ [3, 17−h], as today) and to `existing`, never intersecting `avoid`. Refactor `tryPlace` to use it with `avoid = [SAFE_ZONE]`. The existing generator tests must still pass.
  - `carZone(x: number, y: number, travel: number): Rect[]`: a 5×5 rect centred on the car cell, plus 1×1 rects for the cells along `travel` for 8 cells ahead (step `cos`, `0.5·sin`, rounded).
- Produces (`obstacles.ts`):
```ts
export interface Pending { kind: 'pillar' | 'oil'; rect: Rect; ticksLeft: number }
export const OBSTACLE_EVERY = 5, WARN_TICKS = 40, MAX_PILLARS = 12, MAX_OIL = 3, OIL_FROM = 10;
export const OIL_SIZE = { w: [3, 5] as [number, number], h: [1, 2] as [number, number] };
export function newObstacle(args: { pillars: Rect[]; oil: Rect[]; pending: Pending[]; avoid: Rect[]; coins: number }, ctx: GameContext): Pending | null;
```
`newObstacle` picks oil with probability 1/3 when `coins >= OIL_FROM` and oil is under its cap, otherwise a pillar if pillars are under their cap. Counts include pending items. Pillar size is the same as today (w 2–4, h 1–2). It returns null when both caps are reached or `placeRect` fails, and that obstacle is skipped. `existing` for the gap is pillars + oil + pending rects.
- Produces (`DriftState`): `oil: Rect[]`, `pending: Pending[]` (init `[]`).

**Rules in `update`:**
- When a schedule coin is collected and `scheduleCoins % OBSTACLE_EVERY === 0`, push `newObstacle(...)` if it isn't null. `avoid` = `carZone` + `spawnAvoid`.
- Each tick, `pending.ticksLeft -= 1` (floor 0). At 0 it turns solid, unless its rect intersects `carZone(x, y, travel)`. Then it waits and is re-checked every tick. Solid pillars go to `pillars`, solid oil to `oil`.
- Pending items are harmless.
- `onOil` = the car's current cell is inside any `oil` rect, and it feeds `gripNow`.
- `spawnAvoid` adds `oil` and every `pending.rect`.
- Draw: pending pillars `░` gray and pending oil `≈` gray, both blinking (`Math.floor(tick / 4) % 2 === 0`). Solid oil is `≈` blue. Draw oil before the car and coins.

- [ ] **Step 1: Write the failing tests.**
  - `arena.test.ts`: `'placeRect respects gap, walls and avoid'` (100 seeds). `'carZone covers the car and 8 cells ahead'`.
  - `obstacles.test.ts`: `'no oil before OIL_FROM coins'`. `'caps are respected (pending counted)'`. `'returns null when full'`.
  - `drift.test.ts`:
    - `'every 5th schedule coin queues an obstacle that is harmless while pending'`: drive through a pending rect → not crashed.
    - `'pending obstacle turns solid after WARN_TICKS'`.
    - `'pending obstacle waits while the car is in its zone'`: place it in front of the car with `ticksLeft: 0` → still pending after an update.
    - `'oil drops grip to LOW_GRIP; grip effect overrides it'`.
    - `'coins and power-ups never spawn on oil or pending rects'`.
    - **Review Focus 3:** `'crowded arena: 60 coins of growth never throws and spawns stay legal'`. Start from `init(ctx(7))`. Loop 60 times: set the coin directly ahead of the car, call `update`, then put the car back at a free cell from `carZone`-free space (pick a cell via `spawnCoin`). Also trigger rain once. Assert pillars (excluding pending) ≤ 12, oil ≤ 3, and that the coin, every extra and the power-up are neither blocked nor on oil.
- [ ] **Step 2: Run `npx vitest run src/games/drift`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement `placeRect`/`carZone`, then `obstacles.ts`, then wire into `index.ts`.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: pass, including the old `generatePillars` tests.
- [ ] **Step 5: Commit** `feat(drift): new obstacles and oil appear as you score`.

---

### Task 6: Shuffle

**Files:**
- Modify: `src/games/drift/obstacles.ts`, `src/games/drift/index.ts`
- Test: `src/games/drift/obstacles.test.ts`, `src/games/drift/drift.test.ts`

**Interfaces:**
- Consumes: `placeRect`, `carZone`, `spawnAvoid`.
- Produces:
```ts
export const SHUFFLE_TICKS = 30;
export function shuffleLayout(old: Rect[], avoid: Rect[], ctx: GameContext): Rect[];
```
`shuffleLayout` places `old.length` new pillars with `placeRect` (gap to each other and to `avoid`; the safe zone is not used). If it can't fit them all after 20 restarts, it takes its best attempt and tops it up with old pillars that don't clash (intersect or within the 2-cell gap). It never returns more than `old.length`.
- Produces (`DriftState`): `shuffle: { pillars: Rect[]; ticksLeft: number } | null` (init `null`).

**Rules:**
- Shuffle pickup (direct or via Mystery): `shuffle = { pillars: shuffleLayout(pillars, [...carZone, ...spawnAvoid, ...oil], ctx), ticksLeft: SHUFFLE_TICKS }`. Taking it while a shuffle is pending replaces that shuffle.
- Each tick: `ticksLeft -= 1`. At 0, `pillars = shuffle.pillars` minus any that intersect the current `carZone` or the coin, extras or power-up. Then `shuffle = null`.
- While pending, the old pillars stay solid, the new ones are harmless, and `spawnAvoid` includes `shuffle.pillars`.
- Draw: pending new pillars as blinking `░` in magenta.

- [ ] **Step 1: Write the failing tests.**
  - `obstacles.test.ts`: `'shuffleLayout keeps the count and gaps, avoids the avoid rects'` (50 seeds, 7 pillars). `'shuffleLayout never exceeds the old count when space is tight'`.
  - `drift.test.ts`:
    - `'shuffle shows new layout for SHUFFLE_TICKS then swaps'`: old pillars still crash during the warning, new ones don't.
    - `'mystery can resolve to shuffle'`: find a seed where `resolveMystery` returns `'shuffle'`, use it, and assert `shuffle !== null`.
    - **Review Focus 5:** `'swap drops new pillars that clash with the car zone at swap time'`: set `shuffle: { pillars: [{x:31,y:9,w:2,h:2}], ticksLeft: 1 }` with the car at 30,10 → after the update, `pillars` doesn't include that rect and the car hasn't crashed.
- [ ] **Step 2: Run `npx vitest run src/games/drift`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: pass.
- [ ] **Step 5: Commit** `feat(drift): shuffle power-up rearranges pillars`.

---

### Task 7: Playtest and tune

**Files:**
- Modify (constants only): `effects.ts`, `powerups.ts`, `obstacles.ts`, `arena.ts`

- [ ] **Step 1: Build and play.** Close any running arcade first. Run `npm run dev -- drift` and play 3–4 runs. Check that the first ~5 coins feel relaxed, that coins are reachable at high speed, that power-ups are readable in the top border, and that blinking warnings are visible before obstacles turn solid.
- [ ] **Step 2: Tune.** Change constants only, and only where play shows a problem. Keep tests green; if a test pins a constant that changed, update the test to import the constant.
- [ ] **Step 3: Run `npm test` and `npm run typecheck`.** Expected: pass.
- [ ] **Step 4: Commit** `chore(drift): tune gameplay constants`. Skip this if nothing changed.
