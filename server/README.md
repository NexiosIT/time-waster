# time-waster-server

Shared high-score service for the Time Waster arcade. No npm runtime dependencies; Node 24, `node:sqlite`.

## Deployment requirements

The service speaks plain HTTP. It must sit behind a reverse proxy that terminates HTTPS;
publish only the proxy's port.

Set `TRUST_PROXY=1` only when exactly one trusted proxy is in front of the service. The
per-IP login limit then uses the **last** `X-Forwarded-For` entry, the one that proxy added;
earlier entries come from the client and are ignored. With more than one proxy in a chain,
the last entry is the inner proxy's address and the limit would be shared by everyone.

The server keeps no IP addresses: they are held only in memory for rate limiting.

## Run

```sh
docker run -d --name time-waster-server --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v time-waster-data:/data \
  -e TRUST_PROXY=1 \
  ghcr.io/nexiosit/time-waster-server:latest
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | listen port |
| `DB_PATH` | `/data/scores.db` | SQLite file (keep it on the volume) |
| `TRUST_PROXY` | unset | `1` = use the last `X-Forwarded-For` entry as client IP (see above) |

`.github/workflows/server.yml` builds and pushes the image to GHCR on pushes to `main` that
touch the paths listed in the workflow (`server/`, `src/games/`, `src/core/types.ts`,
`package*.json`, `scripts/build*.mjs`, the workflow itself). Pull requests run the tests and
build the image without pushing it.
Make the GHCR package public once (package settings, change visibility) so it can be pulled without credentials.

## Leaderboard pages

Besides the JSON API under `/v1`, the service serves plain HTML pages (no scripts, strict
Content-Security-Policy):

- `/` lists the games with their current leader
- `/games/<game id>` shows that game's top 10, with a passive-aggressive line next to the
  leader (from `LEADER` in `src/core/heckles.ts`; the same leader and score always get the same line)

Only games bundled into the image are listed; blocked players are hidden like everywhere else.

## Admin

Logins are matched case-insensitively. A login that matches more than one player is refused.

```sh
docker exec time-waster-server node server/dist/admin.js board <game>
docker exec time-waster-server node server/dist/admin.js delete-score <login> <game>
docker exec time-waster-server node server/dist/admin.js delete-player <login>
docker exec time-waster-server node server/dist/admin.js block <login>
docker exec time-waster-server node server/dist/admin.js unblock <login>
```

## Backup

The image has no `sqlite3` binary; Node's built-in SQLite makes a consistent copy while the
server runs:

```sh
docker exec <ctr> node -e "new (require('node:sqlite').DatabaseSync)('/data/scores.db').exec(\"VACUUM INTO '/data/backup.db'\")"
```

`VACUUM INTO` fails if `/data/backup.db` already exists: remove the old one first
(`docker exec <ctr> rm -f /data/backup.db`). Then copy `/data/backup.db` off the host
(`docker cp <ctr>:/data/backup.db ./scores-backup.db`, then to other storage), since a backup
on the same volume does not survive losing it.

Or copy `scores.db` while the container is stopped.
