# Galaxy: design

Date: 2026-11-20
Status: draft, awaiting approval
Builds on: `docs/adding-a-game.md`, `2026-11-20-sized-games-design.md`

## Intent

A new arcade game in the fixed-shooter genre (a formation of enemies marches and
descends; you shoot up from the bottom). It is an **original** game in that genre:
own enemy shapes, colours, waves and scoring. Nothing copied from any existing
arcade game (no recreated sprites, mystery ship or bunker look, no borrowed name).

It fills the ~4-minute slot in the arcade's suggestions, and **clearing wave 5 is
meant to be an achievement**: most runs end before it.

## Goals, non-goals, anti-goals

- Goals: 5 waves, 3 lives; difficulty rises steeply; a typical player reaches wave 3–4.
- Non-goals: endless mode, power-ups, a boss, sound, held-key movement.
- Anti-goals: feels unfair with press-only input (too much enemy fire to dodge by
  tapping); looks like a copy of a specific existing game; touches any file outside
  `src/games/galaxy/`.

## Constraints

- Everything in `docs/adding-a-game.md`: one folder, pure functions on plain-data state,
  `ctx.random()` / `ctx.elapsedMs` only, single-width characters, 60 x 20 area, never
  bind `p` / Esc / Ctrl+C, press-only input.
- Contract fields: `id 'galaxy'`, `title 'Galaxy'`, `length: { kind: 'rounds', minutes: 3 }`,
  `maxScore` = the true highest reachable score (the online leaderboard rejects above it).

## Approaches

One sensible way: a new game folder on the existing contract, like Reflex and Worm.
Rejected: changing the core for held keys / move-and-fire at once (touches every game,
breaks the press-only rule); a separate app outside the arcade (loses menu, scores and
suggestions). Chosen by the team: ends after a fixed 5 waves (over endless), and
challenging to finish (over relaxed).

## Design

```
 Wave 2/5   Lives ♥♥♥                            Score 1240
      <o> <o> <o> <o> <o> <o> <o> <o>
      {#} {#} {#} {#} {#} {#} {#} {#}
      {#} {#} {#} {#} {#} {#} {#} {#}
      /V\ /V\ /V\ /V\ /V\ /V\ /V\ /V\
                  ╎
                                   ¦
        ▓▓▓▓         ▓▓▓▓         ▓▓▓▓
                    /^\
```

- **HUD (row 0):** `Wave N/5`, lives as `♥`, score.
- **Ship `/^\`** on row 18: ← / → move 2 columns per press, clamped to the area; Space
  fires. **One player shot on screen at a time.** Shot moves up 1 row per step.
- **Formation:** 4 rows x 8 enemies, each 3 wide with 1 space between. Top row
  `<o>` drone (10 pts, brightCyan); middle two rows `{#}` brute (20, brightMagenta);
  bottom row `/V\` stinger (30, brightYellow). Steps 1 column sideways; at an edge it
  drops 1 row and reverses. Step interval shrinks as enemies are destroyed (fewer left
  → faster) and per wave.
- **Enemy fire:** the lowest enemy of a random column fires; at most 2 enemy shots on
  screen (3 from wave 4). Enemy shots move down 1 row per step.
- **Debris:** 3 blocks of 4 `▓` cells on row 16. A cell hit by any shot is removed.
  Rebuilt at the start of each wave.
- **Waves 1–5:** each wave increases march speed and enemy fire rate and starts the
  formation 1 row lower (wave 1 starts at row 2). Wave 5 is clearly the hardest.
- **Lives:** 3 for the whole game, no extra lives. Hit by an enemy shot → lose a life,
  short blink, enemy shots cleared. 0 lives, or any enemy reaching row 17 → game over.
- **Scoring:** enemy points as above. Clearing a wave: `+100 × lives left`. Clearing
  wave 5 shows `GALAXY CLEARED` and adds `+500`, then the run ends (`isOver`).
- **maxScore:** 5 waves x (8 x 10 + 16 x 20 + 8 x 30) = 5 x 640 = 3200 for enemies,
  + 5 x 300 wave bonuses (all 3 lives kept) + 500 = **5200**. A test asserts this equals
  the scoring rules' maximum.
- **Code layout in the folder:** `index.ts` (contract), `state.ts` (types, init, update
  rules), `waves.ts` (per-wave difficulty table), `draw.ts`; tests per file with a fixed seed.

## Left to the builder

Exact speed / fire-rate numbers per wave (tuned so wave 3–4 is typical and wave 5 is
hard but fair with press-only input), blink and banner timings, debris shapes within
4 cells, exact colours of shots and HUD.
