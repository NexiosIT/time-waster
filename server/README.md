# time-waster-server

Shared high-score service for the Time Waster arcade. No npm runtime dependencies; Node 24, `node:sqlite`.

## Deployment requirements

The service speaks plain HTTP. It must sit behind a reverse proxy that terminates HTTPS;
publish only the proxy's port.

Set `TRUST_PROXY=1` only when that proxy **overwrites** (does not append to) the
`X-Forwarded-For` header. The per-IP login limit uses the first `X-Forwarded-For`
entry; if the proxy appends, clients can forge it and dodge or abuse the limit.

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
| `TRUST_PROXY` | unset | `1` = use the first `X-Forwarded-For` entry as client IP (see above) |

The image is built and pushed to GHCR by `.github/workflows/server.yml` on every push to `main`.
Make the GHCR package public once (package settings, change visibility) so it can be pulled without credentials.

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

With `sqlite3` available where the database file is reachable (for example on the volume's host path):

```sh
sqlite3 /data/scores.db "VACUUM INTO '/data/backup.db'"
```

Or copy `scores.db` while the container is stopped.
