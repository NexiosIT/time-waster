# Shared online high scores — design

Date: 2026-11-20
Status: approved 2026-11-20

## Intent

Today every player only competes with themselves: scores live per machine in
`%USERPROFILE%\.time-waster\scores.json`. The plugin is public, and the goal is that
**anyone who installs it, inside or outside Nexios, can compare high scores with
everyone else** through a real online service, seen **inside the arcade**.

## Goals

- A public leaderboard per game: each player's best score, top 10 plus your own rank.
- Players are identified by their **GitHub account** (sign in once with GitHub's
  device login; the GitHub username is the display name).
- **Opt-in**: nothing is sent and nobody is signed in until the player chooses to.
- Shown in the arcade: the world best next to your best in the menu, and a You / World
  switch on the results screen after a run.
- A small service in **one Docker image** with **SQLite on a persistent volume**, run by
  Nexios on its own Docker host.
- Basic protection: impossible scores and floods are refused; an admin can delete
  scores and block players.

## Non-goals (first version)

- A public web page with the leaderboards. The API is designed so one can be added
  later without changes (read endpoints need no login).
- Nicknames or logins other than GitHub.
- Strong anti-cheat (signed replays, server-side simulation). The client is open
  source, so a determined cheater can always submit a fake score; we only make it
  harder and make cleanup easy.
- Friends lists, weekly boards, seasons, chat.
- Scaling past one server.
- Corporate HTTP proxy support in the arcade (nobody in the team uses one; players
  behind a proxy just see the online parts as offline).

## Anti-goals (failure even if it "works")

- The arcade waits on the network, stutters, or breaks when the service or the
  internet is down. Local scores must keep working exactly as today.
- Any secret (API key, client secret, database password) shipped in the plugin or
  committed to the public repo.
- Scores or names sent online without the player having signed in.
- Storing more personal data than the GitHub username and numeric id.
- Storing GitHub tokens on the server.

## Constraints

- The plugin installs straight from the public repo with no install step, so the
  arcade side has **no runtime dependencies**: Node 20+ built-ins only (global `fetch`).
  The built `dist/` rule stays as it is (committed on `main` only).
- Windows-only arcade (as today). The service runs in Linux Docker.
- The Docker host keeps a persistent volume (confirmed) and is reached over HTTPS.
  TLS is terminated by the host or a proxy in front of the container, not by the
  service itself.
- Games are added by colleagues in their own folders without touching shared files.
  A new game must work on the leaderboard without a server change.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A** | **One Node/TypeScript service, SQLite file on a volume** | **Chosen.** One container, one file to back up, same language and tooling as the arcade. Can't run on several servers at once, which this scale never needs. |
| B | Node service + Postgres (container or managed) | Sturdier at large scale, but two things to run, secure and back up from day one. Kept as the fallback if a persistent volume had not been available. |
| — | Scores stored in GitHub (repo or gists) | Dropped: players would need write access to a shared place, or the bookkeeping gets complicated. |
| — | Hosted backend (Supabase, Firebase) | Dropped: Nexios prefers its own Docker host. |

Identity options considered: chosen nickname with a local key (simplest, but
impersonation and spam), GitHub sign-in (chosen: real accounts, fits an audience that
installs plugins from GitHub), or both (most work).

## Design

### Parts

```
arcade (player's PC)                       service (Docker, Nexios host)
  src/core/online.ts  ──HTTPS JSON──►        server/  (Node + SQLite on /data)
  ~/.time-waster/online.json  (login)          ├─ verifies GitHub tokens once
  ~/.time-waster/outbox.jsonl (unsent runs)    ├─ stores best score per player per game
                                               └─ admin CLI (docker exec)
  GitHub device login ◄──► github.com
```

The service lives in `server/` in this repo, so the arcade and the service can share
types and one PR can change both. It is not part of `dist/` and is not loaded by the
plugin.

### Signing in (GitHub device flow)

- Nexios registers a **GitHub OAuth App** (owned by the NexiosIT org) with *device flow*
  enabled. Only its **client id** ships in the plugin; device flow needs no client
  secret. No scopes are requested (public profile only).
- In the arcade menu, **O** starts sign-in. The arcade asks GitHub for a device code
  and shows a sign-in screen:

  ```
           Share your scores online
     Open  https://github.com/login/device
     and enter the code   WDJB-MJHT

     Waiting for GitHub...          Esc: cancel
  ```

  It polls GitHub at the interval GitHub gives until the player approves, the code
  expires, or Esc is pressed. The arcade keeps running and drawing meanwhile; nothing
  blocks. (Opening the browser for the player is a nice-to-have, builder's call.)
- With the GitHub access token, the arcade calls the service's `POST /v1/login`. The
  service calls GitHub `GET /user` with that token, takes `id` and `login`, creates or
  updates the player, and returns **its own session token** (random, at least 32
  bytes). The service stores only a hash of the session token and never stores the
  GitHub token. The arcade then forgets the GitHub token.
- The arcade stores `{ serverUrl, token, login }` in `%USERPROFILE%\.time-waster\online.json`.
- Session tokens don't expire on their own; they end on sign-out, account deletion or
  a block. A GitHub rename is picked up the next time the player signs in.
- In the menu, **O** when signed in offers: sign out, or sign out **and delete my
  online scores** (`DELETE /v1/me`), with a Y/N confirmation.

### Sending scores

- After every finished run (when signed in), the run is appended to
  `%USERPROFILE%\.time-waster\outbox.jsonl` (`{ game, score, at }`) and the arcade
  tries to send the outbox in the background. Successfully sent or permanently refused
  entries are removed; on network errors they stay and are retried on the next run
  and on arcade start. Local `scores.json` is written exactly as today, first.
- Runs played before signing in are **not** uploaded (opt-in means from now on).
- The outbox is capped (e.g. the last 50 entries) so it can't grow without bound.

### What the service stores

- `players`: GitHub numeric id (key), login, created/updated time, blocked flag.
- `sessions`: token hash, player id, created time.
- `best`: player id + game id (key), best score, when it was set, submission count.
  Only each player's best per game is kept: one player can't fill the board.
- Game ids are any string matching `/^[a-z0-9-]+$/` (the arcade's existing rule), so a
  new game works on the board without a server change.

### Protection

- **Score limits**: each game may declare an optional `maxScore` in its definition (a
  new, optional field in the `Game` contract). The build writes the known game ids and
  limits to a generated file the server reads at build time. Unknown game ids get a
  generous default limit. Scores must be non-negative integers.
- **Rate limits**: per player, e.g. at most 60 submissions per hour. Login flood
  protection (designer's call) does not depend on client IPs alone: a limit per GitHub
  id after verification plus a global limit on `POST /v1/login`; a per-IP limit is
  added only when a `TRUST_PROXY` setting says the forwarded client address can be
  trusted. Exact numbers are the builder's call.
- Request bodies are small and validated; anything else is refused with 400.
- **Admin CLI** inside the container (`docker exec <ctr> node admin.js ...`): list a
  game's board, delete one score, delete a player, block / unblock a player. No admin
  HTTP endpoints, so there is nothing to attack remotely. Blocked players' scores are
  hidden and their submissions refused.

### API (JSON over HTTPS, versioned under `/v1`)

| Endpoint | Login | What it does |
|---|---|---|
| `POST /v1/login` `{ githubToken }` | — | verify with GitHub, return `{ token, login }` |
| `POST /v1/scores` `{ game, score, at }` | yes | keep it if it beats the player's best; return `{ best, rank }` |
| `GET /v1/boards/:game?me=1` | optional | top 10 `[{ rank, login, score, at }]`, plus `me: { rank, score }` when logged in |
| `GET /v1/boards` | — | world best per game `{ [game]: { login, score } }`, for the menu |
| `DELETE /v1/me` | yes | delete the player, their sessions and scores |
| `GET /v1/health` | — | for the host's health check |

Read endpoints need no login, so a public web page can use them later.

**Times and ties** (designer's call): `at` is the client's time of the run (late outbox
entries keep their real time) and is what the board shows. It is refused if it is in
the future (beyond a small clock-skew allowance) or more than 30 days old. Ties are
ranked by the **server's receive time** of that best score, so a backdated `at` can't
win a tie. The `best` table stores both times.

### In the arcade

- **Menu**: per game, next to `Best 655`, the world best (`World 910`). A line at the
  bottom shows `O: share scores online` or `Online as rokeppen · O: account`. World
  bests are fetched in the background when the menu opens (and at most once a minute);
  until they arrive, or when offline, the column shows `-`.
- **Results screen**: Tab switches between **You** (today's local top 10) and
  **World** (top 10 plus your rank if you're signed in). World shows `loading...`,
  then the board, or `offline` on failure.
- **Not signed in**: the World view still shows the board (reading needs no login)
  with a hint `O in the menu to join`.
- Network calls have short timeouts (a few seconds) and run off the render loop. All
  online state lives in one new module, `src/core/online.ts`, next to `scores.ts`.
- The service URL and the OAuth App client id are constants in the plugin, overridable
  with environment variables (`TIME_WASTER_SERVER`, `TIME_WASTER_GITHUB_CLIENT_ID`) for
  development and testing.
- **Release order** (designer's call): while either constant is empty (and no override
  is set), all online UI is hidden and the arcade behaves exactly as today. So the arcade
  side can merge before the service and the OAuth App exist; filling in the two
  constants is the switch that turns the feature on for everyone.

### Privacy

- Stored: GitHub numeric id and username, scores with timestamps. Nothing else; no
  email, no IP addresses kept beyond rate limiting in memory.
- A short privacy section in the README says this, that sharing is opt-in, and how to
  delete your data (in the arcade, or by opening an issue).

### Running it

- `server/Dockerfile` builds one image. A **GitHub Actions workflow** in this repo
  (decided) runs the server tests and builds and pushes the image to the GitHub
  Container Registry as `ghcr.io/nexiosit/time-waster-server`, tagged `latest` and with
  the commit SHA, on every push to `main` that touches `server/` or the generated game
  limits. The image holds no secrets, so the package can be public. The Docker host
  pulls the new image and restarts the container (by hand, or with an auto-updater;
  that is the host's choice). Config via environment variables: the database
  path (default `/data/scores.db` on the volume) and the port.
- The service applies its database migrations on start.
- Backups: copying the SQLite file (with SQLite's backup or `VACUUM INTO`) on the
  Docker host; the README for the server explains it.

### Tests

- Server: unit and HTTP tests against an in-memory SQLite database, with GitHub
  `/user` stubbed (login, best-only scoring, ranks and ties, limits, rate limits,
  blocked players, delete-me).
- Arcade: `online.ts` tested against a fake service (outbox retry, offline behaviour,
  timeouts) and the device-login state machine with a stubbed GitHub. The existing
  rule stays: the arcade never blocks on the network.

## Left to the builder

- HTTP framework and SQLite driver for the service (prefer few dependencies;
  Node's built-in `node:sqlite` if the image's Node version has it).
- Exact rate-limit numbers, the default score limit, outbox size, timeouts.
- How the menu and results screens are laid out within the spirit above.
- Whether sign-in opens the browser automatically.
- Image base, health check details, migration mechanism.
- Folder layout inside `server/` and how the generated game-limits file is produced.
