# Heckler: passive-aggressive "motivation" while you play — design

Date: 2026-11-20
Status: approved 2026-11-20 (small change)

## Intent

Fun. While you play any game, the arcade now and then jabs at you about doing better,
passive-aggressively, with the occasional mild swear. It reacts to *your* score, so the
jabs land.

## Goals / non-goals / anti-goals

- Goal: works for every game without game changes (host feature).
- Goal: reacts to how you're doing: behind your best pace, stuck, and at run end.
- Non-goals: per-game custom lines, sounds.
- Anti-goals: covering gameplay, pausing, eating key presses, hiding a Claude banner;
  insults about the person (only performance); slurs or harsh swearing; spam.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Random line on a timer | Simple, but jabs don't relate to how you're doing. |
| **B** | **React to score vs your best, stuck, run end** | **Chosen.** Uses data the arcade already has; lines are about you. |
| C | B plus a background trickle | More noise for little gain. |

## Design

- **Where:** top row (row 0) during play, only while the Claude banner is not showing
  (Claude always wins). Shown for 6 s; at most one line per 20 s.
- **Behind pace:** every 45 s of play time, if you have a best for this game and your
  score is below 60 % of where your best would be by now: `best × min(1, played / expected)`
  where *expected* is the game's expected length (sized-games feature) when known, else
  `best × 0.5`.
- **Stuck:** score unchanged for 45 s of play time.
- **No best yet:** at a 45 s checkpoint, a generic line (half the time).
- **Run over:** one line on the results screen comparing the run to your best; a new best
  gets a backhanded compliment.
- **Lines:** ~40 templates in `src/core/heckles.ts` with `{score}`, `{best}`, `{game}`,
  `{time}` filled in. About 1 in 4 has a mild swear (damn, hell, shit, crap). Performance
  only, never the person.
- **Off switch:** `H` in the menu toggles it (`H: heckling on/off` shown in the menu). On by
  default; saved in `%USERPROFILE%\.time-waster\settings.json`.
- Deterministic in tests: the heckler takes the arcade's seeded random.
