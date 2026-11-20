import { createServer } from 'node:http';
import { openDb } from './db';
import { createHandler } from './http';

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? '/data/scores.db';
const trustProxy = process.env.TRUST_PROXY === '1';

const db = openDb(dbPath);
const server = createServer(createHandler({ db, fetchFn: fetch, now: () => new Date(), trustProxy }));
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
