# Play in the browser: design

Date: 2026-11-20
Status: draft, awaiting approval
Builds on: `server/README.md`, `docs/adding-a-game.md`

## Intent

The server container (the time-waster web app, deployed on DigitalOcean App Platform)
today only shows high scores. It should also let anyone **play the arcade's games in
the browser**, then type a name and have the score saved on the server, on a **separate
web board** so the GitHub-verified arcade board stays trustworthy.

## Goals

- `/play/<game>` plays any bundled game in the page, with the same rules, speed, pause and
  end-of-run behaviour as the terminal arcade.
- After a run, the player types a name; the score is stored in the server's database.
- Each game page shows two top-10s: **Arcade** (GitHub players, as today) and **Web**
  (typed names). The home page links to play each game.
- Every future game becomes playable in the browser with no extra work.

## Non-goals

- GitHub sign-in in the browser; web scores on the arcade board or in the terminal
  arcade's online board.
- Touch controls / phone play (keyboard only), sound, the Claude estimate/suggestion.
- Fixing persistence on App Platform (separate, with the deployment team; see Constraints).

## Anti-goals

- Web names appear on the Arcade board, or anywhere the terminal arcade reads.
- A browser game behaves differently from the terminal (speed, rules, keys).
- Typing a name moves the ship / keys typed into the page scroll it or leak to the game.
- The existing no-script leaderboard pages lose their strict security policy.
- One person can flood the web board (unbounded submissions).

## Constraints

- **Persistence:** App Platform has no persistent disk; `/data/scores.db` is lost on every
  redeploy. Web scores share that fate until the deployment team moves to a Droplet with a
  volume or a managed database. This design does not change storage.
- Server: Node 24, no npm runtime dependencies, `node:sqlite`, plain HTML pages; the
  esbuild build in `scripts/build-server.mjs` already bundles all games.
- Games and `src/core/session.ts` / `src/core/buffer.ts` are browser-safe (no Node imports).
- The server is behind App Platform's proxy: per-IP limits need `TRUST_PROXY=1` (already
  documented); without it the web limit falls back to the global limit only.
- Anyone can type any name and anyone can post a score without playing: accepted. Checks
  are the game's `maxScore`, name rules and rate limits.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **1** | **Browser script runs the arcade's own `GameSession` and draws the 60 x 20 grid as coloured text** | **Chosen.** Identical behaviour to the terminal, no new libraries, every game works automatically. Looks like the terminal. |
| 2 | Draw on a `<canvas>` | Could look smoother later; block/box characters render less reliably; no gameplay gain. |
| 3 | Whole terminal arcade in an in-browser terminal emulator | Menu reads score files from disk; large outside dependency. Ruled out. |

Scores, chosen by the team: **typed name + score stored on the server**, on a
**separate web board per game** (over mixing them into the arcade board, or keeping
scores only in the browser).

## Design

### Pages and routes

| Route | What |
|---|---|
| `GET /` | as today, plus a `▶ Play` link per game |
| `GET /games/<id>` | as today (Arcade top 10 with the heckle line), plus a `▶ Play` link and a **Web** top 10 below it |
| `GET /play/<id>` | new play page for a bundled game; unknown id → the existing 404 page |
| `GET /assets/play.js` | the browser bundle (static, `content-type: text/javascript`, long cache with a build-hash query `?v=<hash>` in the page) |
| `POST /v1/web-scores` | new: `{ game, name, score }` → stores if it is that name's best |
| `GET /v1/web-boards/<id>` | new: web top 10 as JSON (the play page refreshes it after a submit) |

Security headers: the existing pages keep their no-script policy. Only `/play/<id>` gets
`script-src 'self'; connect-src 'self'` added; no inline scripts anywhere.

### Play page

```
 TIME WASTER                                          Leaderboard
 ┌────────────────────────────────────────────────────────────┐
 │                 (game's 60 x 20 grid here)                 │
 └────────────────────────────────────────────────────────────┘
 Galaxy  Score 0  Your best 1240  ←→ move  Space fire  P pause · Esc end
 Press Enter to start
```

- Grid drawn as a `<pre>` of 20 lines; each run of same-coloured cells is a `<span>` with
  one of 16 CSS colour classes matching the arcade's ANSI names; only changed lines are
  re-rendered each frame.
- Loop: `requestAnimationFrame` calling `session.tick(performance.now())`. *Builder call:* a
  hidden tab pauses a playing run by sending `p` only when the session is `playing`, and
  resumes on return only if it was the page that paused it; `src/core/session.ts` is not
  changed. Each run is seeded from `crypto.getRandomValues`.
- Keys: `ArrowUp/Down/Left/Right` → `up/down/left/right`, `' '` → `space`, `Enter`,
  `Escape`, `Backspace`, `Tab`, single letters/digits/symbols lower-cased → same `Key` names
  as the terminal's `parseKeys` (*builder call:* from `event.key`; any key with Ctrl, Alt or
  Meta held is left to the browser, so shortcuts keep working). Keys the game uses get `preventDefault()` (no scrolling).
  P pauses, Esc ends the run, as in the terminal.
- States: **ready** (`Press Enter to start`) → **playing** → **results**: score, "New best!"
  when beating the browser's own best, the name form, the Web top 10. Enter in results
  (outside the name field) plays again; Esc goes back to `/games/<id>`.
- Name form: one text input (prefilled with the last name used, from `localStorage`) and
  a Save button; while the input has focus no key reaches the game. After saving: "Saved"
  plus the refreshed Web board, or the server's error message. A run can be saved once
  (*builder call:* enforced in the page only, by disabling the form after a successful save;
  the server can't tell runs apart).
- "Your best" per game is kept in `localStorage` (`tw-best-<id>`); storage failures are ignored.
- A crash in a game shows "<Title> crashed" like the terminal and offers Enter to restart.

### Web scores on the server

- New table, schema version 2 (`SCHEMA_VERSION` 1 → 2, an added migration step; existing
  databases upgrade in place, never downgrade):
  `web_best(game TEXT, name TEXT, name_key TEXT, score INTEGER, at TEXT, submissions INTEGER, PRIMARY KEY(game, name_key))`
  plus index `(game, score DESC, at)`. `name_key` = lower-cased name; one row per name per
  game holding that name's best; `submissions` counts every accepted post.
- `POST /v1/web-scores` validation (400 with an error message, like `/v1/scores`):
  `game` is a bundled game; `score` is an integer `0..maxScoreFor(game)`; `name` trimmed,
  inner whitespace collapsed, 1–20 characters from letters, digits, space, `_ - .`.
- Rate limits (429): 30 posts per IP per hour (only with `TRUST_PROXY=1`), 600 posts per hour
  globally.
- Response (200 for every valid post): `{ rank: number | null, best: number, top: WebRow[] }`.
  *Builder call:* a post scoring higher than the name's stored best replaces score, `at`
  and the name's display casing; an equal or lower score leaves the row as it is (ties keep
  the older entry) but still counts in `submissions`. `best` is the name's stored best after
  the post; `rank` is that best's position in the game's web top 10, or `null` when outside it.
- *Builder call:* games without `maxScore` keep the 1,000,000 default cap; fake scores are
  the accepted risk, removed with the admin command.
- Admin (`server/dist/admin.js`): `web-board <game>`, `delete-web-score <name> <game>`.
- `DELETE /v1/me` and `delete-player` don't touch `web_best` (web names aren't linked to players).
- Web names are never shown on the Arcade board or returned by the existing `/v1/boards`
  endpoints the terminal arcade uses.

### Build

- `scripts/build-server.mjs` also builds `server/web/play.ts` → `server/dist/public/play.js`
  (esbuild, `platform: 'browser'`, `format: 'iife'`, minified) *before* the server bundle, and
  passes the file's content hash into the server bundle with esbuild `define`, for the `?v=`
  query (*builder call*). The server reads `public/play.js` next to `main.js` once at startup
  and serves it from memory; `send()` takes per-route headers so `/play/<id>` gets its own CSP. The Dockerfile copies `server/dist` as today, so it ships automatically.

## Left to the builder

Exact CSS (colours for the 16 classes, sizes, layout at narrow widths), the play page's
copy, how the bundle hash is passed to the page, file names inside `server/web/`, the
exact key list that gets `preventDefault`, migration code shape.
