import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openDb } from './db';
import { createHandler } from './http';

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? '/data/scores.db';
const trustProxy = process.env.TRUST_PROXY === '1';

// The browser play bundle sits next to main.js (scripts/build-server.mjs); without it /assets/play.js is 404.
let playJs: string | undefined;
try {
  playJs = readFileSync(join(__dirname, 'public', 'play.js'), 'utf8');
} catch {
  console.log('public/play.js not found: browser play is unavailable');
}

const db = openDb(dbPath);
const server = createServer(createHandler({ db, fetchFn: fetch, now: () => new Date(), trustProxy, playJs }));
server.listen(port, () => {
  console.log(`time-waster-server listening on :${port} db=${dbPath} trustProxy=${trustProxy}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    db.raw.close();
    process.exit(0);
  });
  server.closeAllConnections();
});
