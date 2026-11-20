# Heckler: passive-aggressive "motivation" while you play — design

Date: 2026-11-20
Status: approved 2026-11-20 (small change); louder and earlier 2026-11-20

## Intent

Fun. While you play any game, the arcade now and then jabs at you about doing better,
passive-aggressively, with the occasional mild swear. It reacts to *your* score, so the
jabs land.

## Goals / non-goals / anti-goals

- Goal: works for every game without game changes (host feature).
- Goal: reacts to how you're doing: behind your best pace, stuck, and at run end.
- Non-goals: per-game custom lines, sounds.
- Anti-goals: covering gameplay, pausing, eating key presses, hiding a Claude banner;
  insults about the person (only performance); slurs; spam.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | Random line on a timer | Simple, but jabs don't relate to how you're doing. |
| **B** | **React to score vs your best, stuck, run end** | **Chosen.** Uses data the arcade already has; lines are about you. |
| C | B plus a background trickle | More noise for little gain. |

## Design

- **Where:** top row (row 0) during play, only while the Claude banner is not showing
  (Claude always wins). Shown for 5 s; at most one line per 12 s.
- **Opening jab:** 8 s into every run (so short runs get heckled in-game too).
- **Ahead of pace:** at a checkpoint, at or above your best pace, half the time: a good run
  gets no peace either.
- **Behind pace:** every 20 s of play time, if you have a best for this game and your
  score is below 60 % of where your best would be by now: `best × min(1, played / expected)`
  where *expected* is the game's expected length (sized-games feature) when known, else
  `best × 0.5`.
- **Stuck:** score unchanged for 20 s of play time.
- **No best yet:** at a checkpoint, a generic line (half the time).
- **Run over:** one line on the results screen comparing the run to your best; a new best
  gets a backhanded compliment.
- **Lines:** ~64 templates in `src/core/heckles.ts` with `{score}`, `{best}`, `{game}`,
  `{time}` filled in. About half swear (fuck, shit, damn, hell, ass, crap…). About how you
  play, never insults at the person, no slurs. In-game lines fit a 62-column window.
- **Off switch:** `H` in the menu toggles it (`H: heckling on/off` shown in the menu). On by
  default; saved in `%USERPROFILE%\.time-waster\settings.json`.
- Deterministic in tests: the heckler takes the arcade's seeded random.
