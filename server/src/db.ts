import { DatabaseSync } from 'node:sqlite';

export type Db = { raw: DatabaseSync };
export type BoardRow = { rank: number; login: string; score: number; at: string };

const SCHEMA_VERSION = 1;

export function openDb(path: string): Db {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  const { user_version } = raw.prepare('PRAGMA user_version').get() as { user_version: number };
  if (user_version < 1) {
    raw.exec(`
      CREATE TABLE players (
        id INTEGER PRIMARY KEY,
        login TEXT NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX players_login ON players(login);
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE best (
        player_id INTEGER NOT NULL,
        game TEXT NOT NULL,
        score INTEGER NOT NULL,
        at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        submissions INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (player_id, game)
      );
      CREATE INDEX best_game_score ON best(game, score DESC, received_at);
    `);
  }
  raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return { raw };
}

export function upsertPlayer(db: Db, p: { id: number; login: string }, now: Date): { blocked: boolean } {
  const ts = now.toISOString();
  db.raw
    .prepare(
      `INSERT INTO players (id, login, blocked, created_at, updated_at) VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET login = excluded.login, updated_at = excluded.updated_at`,
    )
    .run(p.id, p.login, ts, ts);
  const row = db.raw.prepare('SELECT blocked FROM players WHERE id = ?').get(p.id) as { blocked: number };
  return { blocked: row.blocked === 1 };
}

export function createSession(db: Db, playerId: number, tokenHash: string, now: Date): void {
  db.raw
    .prepare('INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)')
    .run(tokenHash, playerId, now.toISOString());
}

export function playerForToken(db: Db, tokenHash: string): { id: number; login: string; blocked: boolean } | null {
  const row = db.raw
    .prepare(
      `SELECT p.id, p.login, p.blocked FROM sessions s JOIN players p ON p.id = s.player_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as { id: number; login: string; blocked: number } | undefined;
  return row ? { id: row.id, login: row.login, blocked: row.blocked === 1 } : null;
}

function rankOf(db: Db, game: string, score: number, receivedAt: string): number {
  const row = db.raw
    .prepare(
      `SELECT COUNT(*) AS n FROM best b JOIN players p ON p.id = b.player_id
       WHERE b.game = ? AND p.blocked = 0
         AND (b.score > ? OR (b.score = ? AND b.received_at < ?))`,
    )
    .get(game, score, score, receivedAt) as { n: number };
  return row.n + 1;
}

export function submitScore(
  db: Db, playerId: number, game: string, score: number, at: string, now: Date,
): { best: number; rank: number } {
  const ts = now.toISOString();
  const cur = db.raw
    .prepare('SELECT score, received_at FROM best WHERE player_id = ? AND game = ?')
    .get(playerId, game) as { score: number; received_at: string } | undefined;
  let best: number;
  let receivedAt: string;
  if (!cur) {
    db.raw
      .prepare('INSERT INTO best (player_id, game, score, at, received_at, submissions) VALUES (?, ?, ?, ?, ?, 1)')
      .run(playerId, game, score, at, ts);
    best = score;
    receivedAt = ts;
  } else if (score > cur.score) {
    db.raw
      .prepare(
        `UPDATE best SET score = ?, at = ?, received_at = ?, submissions = submissions + 1
         WHERE player_id = ? AND game = ?`,
      )
      .run(score, at, ts, playerId, game);
    best = score;
    receivedAt = ts;
  } else {
    db.raw
      .prepare('UPDATE best SET submissions = submissions + 1 WHERE player_id = ? AND game = ?')
      .run(playerId, game);
    best = cur.score;
    receivedAt = cur.received_at;
  }
  return { best, rank: rankOf(db, game, best, receivedAt) };
}

export function board(
  db: Db, game: string, limit: number, meId?: number,
): { top: BoardRow[]; me: { rank: number; score: number } | null } {
  const rows = db.raw
    .prepare(
      `SELECT p.login, b.score, b.at FROM best b JOIN players p ON p.id = b.player_id
       WHERE b.game = ? AND p.blocked = 0
       ORDER BY b.score DESC, b.received_at ASC, p.id ASC LIMIT ?`,
    )
    .all(game, limit) as { login: string; score: number; at: string }[];
  const top = rows.map((r, i) => ({ rank: i + 1, login: r.login, score: r.score, at: r.at }));
  let me: { rank: number; score: number } | null = null;
  if (meId !== undefined) {
    const mine = db.raw
      .prepare(
        `SELECT b.score, b.received_at FROM best b JOIN players p ON p.id = b.player_id
         WHERE b.game = ? AND b.player_id = ? AND p.blocked = 0`,
      )
      .get(game, meId) as { score: number; received_at: string } | undefined;
    if (mine) me = { rank: rankOf(db, game, mine.score, mine.received_at), score: mine.score };
  }
  return { top, me };
}

export function worldBests(db: Db): Record<string, { login: string; score: number }> {
  const rows = db.raw
    .prepare(
      `SELECT game, login, score FROM (
         SELECT b.game, p.login, b.score,
                ROW_NUMBER() OVER (PARTITION BY b.game ORDER BY b.score DESC, b.received_at ASC, p.id ASC) AS rn
         FROM best b JOIN players p ON p.id = b.player_id WHERE p.blocked = 0
       ) WHERE rn = 1`,
    )
    .all() as { game: string; login: string; score: number }[];
  const out: Record<string, { login: string; score: number }> = {};
  for (const r of rows) out[r.game] = { login: r.login, score: r.score };
  return out;
}

export function deletePlayer(db: Db, playerId: number): void {
  db.raw.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
  db.raw.prepare('DELETE FROM best WHERE player_id = ?').run(playerId);
  db.raw.prepare('DELETE FROM players WHERE id = ?').run(playerId);
}

// GitHub logins are case-insensitive, so the admin lookups compare with lower().
export function playersWithLogin(db: Db, login: string): number {
  const row = db.raw.prepare('SELECT COUNT(*) AS n FROM players WHERE lower(login) = lower(?)').get(login) as { n: number };
  return row.n;
}

export function playerIdByLogin(db: Db, login: string): number | null {
  const row = db.raw
    .prepare('SELECT id FROM players WHERE lower(login) = lower(?) ORDER BY updated_at DESC LIMIT 1')
    .get(login) as { id: number } | undefined;
  return row ? row.id : null;
}

export function setBlocked(db: Db, login: string, blocked: boolean): boolean {
  const res = db.raw.prepare('UPDATE players SET blocked = ? WHERE lower(login) = lower(?)').run(blocked ? 1 : 0, login);
  return Number(res.changes) > 0;
}

export function deleteScore(db: Db, login: string, game: string): boolean {
  const res = db.raw
    .prepare('DELETE FROM best WHERE game = ? AND player_id IN (SELECT id FROM players WHERE lower(login) = lower(?))')
    .run(game, login);
  return Number(res.changes) > 0;
}
