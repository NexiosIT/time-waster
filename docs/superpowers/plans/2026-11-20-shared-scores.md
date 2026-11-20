# Shared Online High Scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public online leaderboard per game (GitHub sign-in, opt-in), served by one Docker image, shown inside the arcade.

**Architecture:** `server/` is a dependency-free Node service (`node:http` + `node:sqlite`) bundled with esbuild into one image that GitHub Actions pushes to GHCR. The arcade gets a self-contained `src/core/online/` module (config, file store, API client, GitHub device flow, and an `Online` state object) that the `App` reads synchronously while all network work runs in the background. With no server URL or client id configured, `Online` is not created and the arcade behaves exactly as today.

**Tech Stack:** TypeScript, Node 24 (server image) / Node 20+ (arcade, global `fetch`), `node:sqlite`, esbuild, Vitest, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-20-shared-scores-design.md` (read it first; this plan argues from it).

## Global Constraints

- Arcade side: **no runtime dependencies**, Node 20+ built-ins only (global `fetch`, `AbortSignal.timeout`). Never block the render loop on the network.
- Server side: no npm runtime dependencies; `node:http`, `node:sqlite`, `node:crypto`. Image base `node:24-alpine`. Server tests need Node ≥ 22.13 locally (CI uses 24).
- No secret in the repo or plugin. Only the GitHub OAuth App **client id** ships (empty until Nexios creates the app).
- Server never stores GitHub tokens; session tokens are `randomBytes(32)` base64url, stored as SHA-256 hex.
- Stored personal data: GitHub numeric id and login only.
- Game ids: `/^[a-z0-9-]+$/`. Scores: non-negative integers ≤ the game's `maxScore` (default `1_000_000`).
- `at`: refused if more than 5 minutes in the future or more than 30 days old. Ties rank by server receive time.
- Submissions: at most 60 per player per hour. Login: at most 10 per GitHub id per hour, 600 per hour globally, and 30 per IP per hour only when `TRUST_PROXY=1` (first `X-Forwarded-For` entry).
- Request bodies: at most 4 KB JSON. All network calls from the arcade time out after 5 s.
- Outbox capped at the last 50 entries. World bests refreshed at most once per 60 s.
- Online UI hidden while `SERVER_URL` or `GITHUB_CLIENT_ID` is empty and no env override (`TIME_WASTER_SERVER`, `TIME_WASTER_GITHUB_CLIENT_ID`) is set.
- `dist/` rule unchanged: never commit `dist/` on this branch. `server/dist/` is git-ignored.
- Files on the player's PC: `%USERPROFILE%\.time-waster\online.json` (`{ serverUrl, token, login }`) and `%USERPROFILE%\.time-waster\outbox.jsonl` (`{ game, score, at }` per line).

## Review Focus

1. **Service down or hanging** during sign-in, at the results screen or on menu refresh: the arcade keeps rendering and shows `offline` / `-`; nothing throws. Pinned in Task 5 (hanging fetch → offline) and Task 6 (render with a failing `Online`).
2. **Corrupt `online.json` or `outbox.jsonl`** (hand-edited, half-written): treated as signed out / empty, never a crash. Pinned in Task 4.
3. **Session token revoked** (admin block or delete-me from another PC → 401): account file cleared, menu shows signed out, outbox dropped, no retry loop. Pinned in Task 5.
4. **Same run sent twice** (two arcade windows, retry after a timeout that actually succeeded): server keeps one best, rank unchanged. Pinned in Task 1.
5. **Long GitHub logins** (up to 39 chars) in the 60-column board and menu: clipped, layout intact. Pinned in Task 6.

---

### Task 1: Server database layer

**Files:**
- Create: `server/src/db.ts`
- Test: `server/src/db.test.ts`
- Modify: `vitest.config.mts` (add `'server/**/*.test.ts'` to `include`), `tsconfig.json` (add `"server/src"` to `include`), `.gitignore` (add `server/dist/`)

**Interfaces:**
- Produces:
  - `type Db` (opaque wrapper around `DatabaseSync`)
  - `openDb(path: string): Db` — `':memory:'` for tests; creates tables if missing (migrations via `PRAGMA user_version`).
  - `upsertPlayer(db, p: { id: number; login: string }, now: Date): { blocked: boolean }`
  - `createSession(db, playerId: number, tokenHash: string, now: Date): void`
  - `playerForToken(db, tokenHash: string): { id: number; login: string; blocked: boolean } | null`
  - `submitScore(db, playerId: number, game: string, score: number, at: string, now: Date): { best: number; rank: number }`
  - `board(db, game: string, limit: number, meId?: number): { top: BoardRow[]; me: { rank: number; score: number } | null }` with `type BoardRow = { rank: number; login: string; score: number; at: string }`
  - `worldBests(db): Record<string, { login: string; score: number }>`
  - `deletePlayer(db, playerId: number): void` (player, sessions, scores)
  - `setBlocked(db, login: string, blocked: boolean): boolean` (false when no such login)
  - `deleteScore(db, login: string, game: string): boolean`
  - `playerIdByLogin(db, login: string): number | null`
- Tables: `players(id INTEGER PK, login TEXT, blocked INTEGER, created_at, updated_at)`, `sessions(token_hash TEXT PK, player_id, created_at)`, `best(player_id, game, score, at TEXT, received_at TEXT, submissions INTEGER, PK(player_id, game))`.

- [ ] **Step 1: Write the failing tests** in `server/src/db.test.ts`:

```ts
test('keeps only the best score per player and game, counting submissions', ...)
  // submit 100, then 50, then 150 → best 150; row submissions === 3
test('ranks by score, ties by who reached it first on the server', ...)
  // A 200 at t1, B 200 at t2, C 300 → board top: C rank 1, A rank 2, B rank 3
test('submitting the same run twice keeps one best and the same rank', ...)   // Review Focus 4
test('board returns at most limit rows and my rank even outside the top', ...)
  // 12 players; me = 12th → top.length 10, me.rank 12
test('blocked players are hidden from boards, ranks and world bests', ...)
test('worldBests gives the top player per game', ...)
test('deletePlayer removes sessions and scores; the token no longer resolves', ...)
test('upsertPlayer updates the login on rename and reports blocked', ...)
test('deleteScore and setBlocked report false for an unknown login', ...)
```

- [ ] **Step 2: Run** `npx vitest run server/src/db.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement `server/src/db.ts`** with `node:sqlite` `DatabaseSync` and prepared statements. Rank is `1 + count(non-blocked rows with score > mine OR (score = mine AND received_at < mine))`. `received_at` changes only when the best improves.
- [ ] **Step 4: Run** `npx vitest run server/src/db.test.ts` and `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** `feat(server): SQLite store for players, sessions and best scores`.

---

### Task 2: Server HTTP API

**Files:**
- Create: `server/src/github.ts`, `server/src/ratelimit.ts`, `server/src/limits.ts`, `server/src/http.ts`
- Test: `server/src/http.test.ts`, `server/src/ratelimit.test.ts`
- Modify: `src/core/types.ts` (add optional `maxScore?: number` to `Game`), `src/games/worm/index.ts` (`maxScore: 5220`: 29×18 cells × 10), `docs/adding-a-game.md` (one paragraph on `maxScore`)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `verifyGithubToken(token: string, fetchFn: typeof fetch): Promise<{ id: number; login: string } | null>` — `GET https://api.github.com/user` with `Authorization: Bearer`, `User-Agent: time-waster-server`; null on non-200.
  - `class RateLimiter { constructor(limit: number, windowMs: number); hit(key: string, nowMs: number): boolean }` — true = allowed (sliding window, in memory).
  - `maxScoreFor(game: string): number` — from `games` in `src/games/registry.generated.ts` (bundled at build time), default `1_000_000`.
  - `createHandler(deps: { db: Db; fetchFn: typeof fetch; now: () => Date; trustProxy: boolean }): (req: IncomingMessage, res: ServerResponse) => void`
- Endpoints and status codes (exact):
  - `POST /v1/login {githubToken}` → 200 `{token, login}` · 400 bad body · 401 GitHub rejected · 403 blocked · 429 limited
  - `POST /v1/scores {game, score, at}` (Bearer) → 200 `{best, rank}` · 400 invalid · 401 no/unknown token · 403 blocked · 429
  - `GET /v1/boards/:game` (optional Bearer) → 200 `{game, top: BoardRow[], me: {rank, score} | null}` · 400 bad id
  - `GET /v1/boards` → 200 `{boards: Record<game, {login, score}>}`
  - `DELETE /v1/me` (Bearer) → 204 · 401
  - `GET /v1/health` → 200 `{ok: true}`
  - Anything else → 404; body > 4 KB → 413; all responses `application/json`.

- [ ] **Step 1: Write the failing tests.** `ratelimit.test.ts`: allows `limit` hits per window, refuses the next, allows again after the window. `http.test.ts` starts the handler on an ephemeral port with `openDb(':memory:')` and a stub `fetchFn` that answers GitHub `/user` for tokens `gh-alice` → `{id: 1, login: 'alice'}`, `gh-bob` → `{id: 2, login: 'bob'}`, else 401:

```ts
test('login with a valid GitHub token returns a session token; a bad one is 401', ...)
test('the GitHub token is not stored anywhere in the database', ...)          // scan all tables for 'gh-alice'
test('scores need a valid session; best and rank come back', ...)
test('invalid scores are 400: bad game id, negative, fraction, over maxScore, at in future (>5 min) or older than 30 days', ...)
test('a 61st submission within an hour is 429', ...)
test('login is limited per GitHub id (11th in an hour is 429)', ...)
test('per-IP login limit applies only with trustProxy and uses the first X-Forwarded-For entry', ...)
test('blocked players get 403 on login and submit', ...)
test('boards work without login; with login they include me', ...)
test('DELETE /v1/me removes the player; the token then gets 401', ...)
test('unknown route is 404, oversized body is 413, health is ok', ...)
```

- [ ] **Step 2: Run** `npx vitest run server/src` — expected FAIL.
- [ ] **Step 3: Implement** `github.ts`, `ratelimit.ts`, `limits.ts`, `http.ts` per the interfaces; add `maxScore` to the `Game` type, worm and the guide.
- [ ] **Step 4: Run** `npx vitest run server/src`, `npm test`, `npm run typecheck` — expected PASS (existing arcade tests unaffected by the optional field).
- [ ] **Step 5: Commit** `feat(server): HTTP API with GitHub login, score limits and rate limits`.

---

### Task 3: Server entry point, admin CLI, image and CI

**Files:**
- Create: `server/src/main.ts`, `server/src/admin.ts`, `server/src/admin.test.ts`, `scripts/build-server.mjs`, `server/Dockerfile`, `server/README.md`, `.dockerignore`, `.github/workflows/server.yml`
- Modify: `package.json` (script `"build:server": "node scripts/build.mjs --outdir .dev && node scripts/build-server.mjs"`)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `main.ts`: reads `PORT` (default `8080`), `DB_PATH` (default `/data/scores.db`), `TRUST_PROXY` (`'1'` = true); starts `createHandler` with global `fetch`; logs one line on start; exits cleanly on SIGTERM.
  - `runAdmin(db: Db, argv: string[], out: (line: string) => void): number` (exit code) with commands `board <game>`, `delete-score <login> <game>`, `delete-player <login>`, `block <login>`, `unblock <login>`; usage text and exit 1 on anything else or an unknown login. `admin.ts` calls it with `process.argv.slice(2)` and `DB_PATH`.
  - `scripts/build-server.mjs`: esbuild bundles `server/src/main.ts` and `server/src/admin.ts` to `server/dist/main.js` and `server/dist/admin.js` (`platform: 'node'`, `target: 'node24'`, `format: 'esm'`, `node:*` external). The arcade build runs first so `registry.generated.ts` exists.
  - Image: multi-stage. Build stage `node:24-alpine`: `npm ci`, `npm run build:server`. Runtime stage `node:24-alpine`: copy `server/dist`, `VOLUME /data`, `EXPOSE 8080`, run as the `node` user, `HEALTHCHECK` on `/v1/health`, `CMD ["node", "server/dist/main.js"]`. Admin usage: `docker exec <ctr> node server/dist/admin.js block <login>`.
  - Workflow `server.yml`: on `pull_request` and on `push` to `main` with paths `server/**`, `src/games/**`, `src/core/types.ts`, `package*.json`, `scripts/build*.mjs`, `.github/workflows/server.yml`. Job: checkout, `actions/setup-node` 24 with npm cache, `npm ci`, `npm test`, `npm run typecheck`. On push to `main` only: `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`, `docker/build-push-action` with `context: .`, `file: server/Dockerfile`, tags `ghcr.io/nexiosit/time-waster-server:latest` and `:${{ github.sha }}`. `permissions: contents: read, packages: write`. Pin action major versions.
  - `server/README.md`: run command with volume and env vars, admin commands, backup with `sqlite3 /data/scores.db "VACUUM INTO '/data/backup.db'"` (or copy while stopped), and that the GHCR package should be made public once.

- [ ] **Step 1: Write the failing test** `server/src/admin.test.ts`:

```ts
test('board prints rank, login and score per line', ...)
test('block hides a player and unblock restores them', ...)
test('delete-score and delete-player remove data', ...)
test('unknown command or unknown login prints usage / error and returns 1', ...)
```

- [ ] **Step 2: Run** `npx vitest run server/src/admin.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** `admin.ts`, `main.ts`, `build-server.mjs`, Dockerfile, `.dockerignore` (`node_modules`, `.dev`, `dist`, `server/dist`, `.git`), README and workflow.
- [ ] **Step 4: Verify.** `npx vitest run server/src` PASS. `npm run build:server` writes `server/dist/main.js`. Smoke: `DB_PATH=<scratch>/t.db PORT=18080 node server/dist/main.js` in the background, then `curl -s localhost:18080/v1/health` prints `{"ok":true}`; stop it. If Docker is available locally, `docker build -f server/Dockerfile .` succeeds; if not, say so in the task report (CI builds it).
- [ ] **Step 5: Commit** `feat(server): entry point, admin CLI, Docker image and GHCR workflow`.

---

### Task 4: Arcade online plumbing (config, files, API client, GitHub device flow)

**Files:**
- Create: `src/core/online/config.ts`, `src/core/online/store.ts`, `src/core/online/api.ts`, `src/core/online/github.ts`
- Test: `src/core/online/store.test.ts`, `src/core/online/api.test.ts`, `src/core/online/github.test.ts`
- Modify: `src/core/paths.ts` (add `accountFile(home?)` → `online.json`, `outboxFile(home?)` → `outbox.jsonl`)

**Interfaces:**
- Produces:
  - `config.ts`: `export const SERVER_URL = ''; export const GITHUB_CLIENT_ID = '';` and `onlineConfig(env: NodeJS.ProcessEnv): { serverUrl: string; clientId: string } | null` (env overrides constants; null if either ends up empty; trailing `/` stripped).
  - `store.ts`: `type Account = { serverUrl: string; token: string; login: string }`; `loadAccount(file): Account | null` (null when missing, corrupt or wrong shape); `saveAccount(file, a)` (atomic write like `scores.ts`); `clearAccount(file)`; `type OutboxEntry = { game: string; score: number; at: string }`; `appendOutbox(file, e)`; `readOutbox(file): OutboxEntry[]` (skips bad lines); `writeOutbox(file, entries)` (keeps the last 50).
  - `api.ts`: `type BoardRow = { rank: number; login: string; score: number; at: string }`; `type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number | 'network' }`; `class Api { constructor(serverUrl: string, fetchFn?: typeof fetch, timeoutMs = 5000) }` with `login(githubToken)`, `submit(token, e: OutboxEntry): ApiResult<{best:number;rank:number}>`, `board(game, token?): ApiResult<{top: BoardRow[]; me: {rank:number;score:number} | null}>`, `boards(): ApiResult<Record<string,{login:string;score:number}>>`, `deleteMe(token): ApiResult<null>` — all `Promise`s that never reject (network errors and timeouts become `{ok:false, status:'network'}`).
  - `github.ts`: `requestDeviceCode(clientId, fetchFn?): Promise<{ deviceCode: string; userCode: string; verificationUri: string; intervalS: number; expiresInS: number } | null>` (`POST https://github.com/login/device/code`, `Accept: application/json`, empty scope); `pollDeviceToken(clientId, deviceCode, fetchFn?): Promise<{ status: 'ok'; token: string } | { status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'error' }>` (`POST https://github.com/login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`; maps `authorization_pending`, `slow_down`, `expired_token`, `access_denied`).

- [ ] **Step 1: Write the failing tests:**

```ts
// store.test.ts
test('account round-trips; missing or corrupt online.json loads as null', ...)       // Review Focus 2
test('outbox appends, skips corrupt lines and keeps only the last 50 on write', ...)  // Review Focus 2
// api.test.ts (fake fetch)
test('submit sends Bearer token and JSON body, returns best and rank', ...)
test('a non-2xx answer is {ok:false,status}', ...)
test('a thrown fetch or a hang past timeoutMs is {ok:false,status:"network"}', ...)   // use timeoutMs: 50
// github.test.ts (fake fetch)
test('requestDeviceCode maps the GitHub response', ...)
test('pollDeviceToken maps pending, slow_down, expired, denied and ok', ...)
// config
test('onlineConfig is null while either value is empty and env overrides win', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/core/online` — expected FAIL.
- [ ] **Step 3: Implement** the four files and the two paths.
- [ ] **Step 4: Run** `npx vitest run src/core/online` and `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** `feat(arcade): online config, files, API client and GitHub device flow`.

---

### Task 5: The `Online` state object

**Files:**
- Create: `src/core/online/online.ts`
- Test: `src/core/online/online.test.ts`

**Interfaces:**
- Consumes: Task 4.
- Produces (everything the `App` uses; all methods synchronous, network in the background):

```ts
type SignIn =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'code'; userCode: string; verificationUri: string }
  | { phase: 'done'; login: string }
  | { phase: 'failed'; message: string };
type BoardView =
  | { status: 'loading' }
  | { status: 'ready'; top: BoardRow[]; me: { rank: number; score: number } | null }
  | { status: 'offline' };
interface OnlinePort {
  account(): { login: string } | null;
  worldBest(game: string): { login: string; score: number } | null;
  refreshWorldBest(nowMs: number): void;        // no-op if refreshed < 60 s ago
  loadBoard(game: string): void;
  board(game: string): BoardView;
  recordRun(game: string, score: number, at: Date): void; // only when signed in: append to outbox, then flush
  flush(): Promise<void>;                        // send outbox in order
  signIn(): SignIn;
  startSignIn(): void;
  cancelSignIn(): void;
  signOut(deleteScores: boolean): void;
}
class Online implements OnlinePort {
  constructor(opts: { serverUrl: string; clientId: string; accountFile: string; outboxFile: string;
    api?: Api; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> });
}
```

- Behaviour fixed by the spec: flush removes an entry on 2xx and on 4xx other than 401/429; keeps it on `'network'`, 5xx and 429 (stop the flush at the first kept entry). On 401: clear the account and the outbox. Sign-in polls at GitHub's interval (+5 s on `slow_down`), then `api.login`; on success saves the account and calls `flush()`. `failed` messages: `Code expired`, `Sign-in denied`, `Couldn't reach GitHub`, `Couldn't reach the score server`. The constructor flushes once (retry on arcade start). `signOut(true)` calls `deleteMe` first, then clears locally regardless of the result.

- [ ] **Step 1: Write the failing tests** (fake `Api`, fake GitHub fetch, `sleep` that resolves immediately):

```ts
test('sign-in goes starting → code → done and saves the account', ...)
test('sign-in reports expired, denied and unreachable as failed with the exact message', ...)
test('cancelSignIn stops polling and returns to idle', ...)
test('recordRun does nothing when signed out', ...)
test('flush removes sent and permanently refused entries, keeps network/5xx/429 ones in order', ...)
test('a 401 on submit clears the account and the outbox and does not retry', ...)     // Review Focus 3
test('a hanging server makes board() offline and leaves the outbox intact', ...)    // Review Focus 1
test('refreshWorldBest is throttled to once per 60 s', ...)
test('signOut(true) deletes online scores then clears the account', ...)
test('the constructor retries the outbox once', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/core/online/online.test.ts` — expected FAIL.
- [ ] **Step 3: Implement `Online`** per the interface; keep at most one flush and one sign-in in flight.
- [ ] **Step 4: Run** `npx vitest run src/core/online` — expected PASS.
- [ ] **Step 5: Commit** `feat(arcade): Online state for sign-in, outbox and boards`.

---

### Task 6: Arcade screens, wiring and README

**Files:**
- Modify: `src/core/app.ts`, `src/arcade.ts`, `README.md`
- Test: `src/core/app.test.ts` (add cases; a `FakeOnline implements OnlinePort` in the test file)

**Interfaces:**
- Consumes: `OnlinePort`, `SignIn`, `BoardView` from Task 5; `onlineConfig`, `accountFile`, `outboxFile` from Task 4.
- Produces: `AppOptions.online?: OnlinePort` (absent = today's behaviour, every existing test unchanged). New `ScreenName`s `'signin'` and `'account'`.
- Screens (layout within the 60×20 area is the builder's call; this copy is fixed):
  - **Menu:** per game `Best <n>` and, when online, `World <n>` (`-` if unknown). Bottom hint row: `O: share scores online` (signed out) or `Online as <login> · O: account` (signed in). Opening the menu calls `refreshWorldBest(now)`.
  - **Sign-in screen** (`O` when signed out): `startSignIn()`, then by phase: `Asking GitHub...`; `Open <verificationUri>` / `and enter the code  <userCode>` / `Waiting for GitHub...`; `Signed in as <login>`; or the failed message. `Esc` cancels and returns to the menu (also after done/failed).
  - **Account screen** (`O` when signed in): `Signed in as <login>`, `S: sign out · D: sign out and delete my online scores · Esc: back`; `D` asks `Delete all your online scores? Y/N`.
  - **Results:** when online, `Tab: You / World` hint. World view: `loading...`, `offline`, or the rows `<rank>. <login> <score>` with the player's own row highlighted and `Your rank: <n>` if outside the top 10; signed out adds `O in the menu to join`. `finish()` calls `recordRun(game.id, score, new Date())` after the local save, and `loadBoard(game.id)`.
- `arcade.ts`: `const cfg = onlineConfig(process.env); const online = cfg ? new Online({ ...cfg, accountFile: accountFile(), outboxFile: outboxFile() }) : undefined;` passed to `App`.
- `README.md`: an "Online high scores" section (opt-in, GitHub sign-in with the code, what is stored: GitHub id and username and scores only, how to sign out and delete, or open an issue) and a line pointing to `server/README.md`.

- [ ] **Step 1: Write the failing tests** in `app.test.ts`:

```ts
test('without online, menu and results look exactly as before', ...)
test('menu shows World bests and the sign-in hint; signed in shows "Online as <login>"', ...)
test('O opens sign-in and shows the code; Esc cancels', ...)
test('O when signed in opens the account screen; D then Y signs out and deletes', ...)
test('a finished run is recorded online and its board loaded', ...)
test('Tab on results switches to World: loading, offline and rows with my rank', ...)
test('a 39-character login is clipped and the layout stays inside 60 columns', ...)  // Review Focus 5
test('render never throws when Online methods return offline/failed states', ...)    // Review Focus 1
```

- [ ] **Step 2: Run** `npx vitest run src/core/app.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the screens in `app.ts`, the wiring in `arcade.ts`, the README section.
- [ ] **Step 4: Verify.** `npm test`, `npm run typecheck`, `npm run build` all pass. Manual smoke with the local server from Task 3: `TIME_WASTER_SERVER=http://localhost:18080 TIME_WASTER_GITHUB_CLIENT_ID=<any> npm run dev -- worm` shows the World column and the sign-in hint; the world tab shows `offline` when the server is stopped. (A real GitHub sign-in needs the OAuth App; skip it if no client id exists yet and say so.)
- [ ] **Step 5: Commit** `feat(arcade): world boards, GitHub sign-in and account screens`.

---

## After the plan (needs Nexios, not code)

1. Create a GitHub OAuth App under NexiosIT with device flow enabled; put its client id in `GITHUB_CLIENT_ID`.
2. Run the image on the Docker host with a volume on `/data` behind HTTPS; put the public URL in `SERVER_URL`.
3. Make the GHCR package public. Merge, rebuild `dist/` on `main`: the feature switches on for everyone.
