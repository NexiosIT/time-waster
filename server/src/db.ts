import { DatabaseSync } from 'node:sqlite';
import { BOARD_LIMIT } from './limits';

export type Db = { raw: DatabaseSync };
export type BoardRow = { rank: number; login: string; score: number; at: string };
/** A score posted from the browser under a typed name; never linked to a player. */
export type WebRow = { rank: number; name: string; score: number; at: string };

export function openDb(path: string): Db {
  const raw = new DatabaseSync(path);
  const { user_version } = raw.prepare('PRAGMA user_version').get() as { user_version: number };
  // A newer schema (user_version > 1) is left as it is: never downgrade.
  if (user_version < 1) migrate(raw, 1, `
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
  if (user_version < 2) migrate(raw, 2, `
      CREATE TABLE web_best (
        game TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        score INTEGER NOT NULL,
        at TEXT NOT NULL,
        submissions INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (game, name_key)
      );
      CREATE INDEX web_best_game_score ON web_best(game, score DESC, at);
    `);
  return { raw };
}

/** Runs one migration step and sets user_version to `version`, all or nothing. */
function migrate(raw: DatabaseSync, version: number, sql: string): void {
  inTransaction(raw, () => {
    raw.exec(sql);
    raw.exec(`PRAGMA user_version = ${version}`);
  });
}

function inTransaction<T>(raw: DatabaseSync, fn: () => T): T {
  raw.exec('BEGIN');
  try {
    const out = fn();
    raw.exec('COMMIT');
    return out;
  } catch (err) {
    raw.exec('ROLLBACK');
    throw err;
  }
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

/** Ends one session (sign-out). Returns false if it did not exist. */
export function deleteSession(db: Db, tokenHash: string): boolean {
  return Number(db.raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash).changes) > 0;
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
): { best: number; rank: number } | null {
  const ts = now.toISOString();
  const cur = db.raw
    .prepare('SELECT score, received_at FROM best WHERE player_id = ? AND game = ?')
    .get(playerId, game) as { score: number; received_at: string } | undefined;
  let best: number;
  let receivedAt: string;
  if (!cur) {
    // Only for a player that still exists: DELETE /v1/me may have run since the session was checked.
    const res = db.raw
      .prepare(
        `INSERT INTO best (player_id, game, score, at, received_at, submissions)
         SELECT ?, ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM players WHERE id = ?)`,
      )
      .run(playerId, game, score, at, ts, playerId);
    if (Number(res.changes) === 0) return null;
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

/** The top player per game; only the listed games when `games` is given. */
export function worldBests(db: Db, games?: string[]): Record<string, { login: string; score: number }> {
  const only = games ? `AND b.game IN (${games.map(() => '?').join(', ')})` : '';
  const rows = db.raw
    .prepare(
      `SELECT game, login, score FROM (
         SELECT b.game, p.login, b.score,
                ROW_NUMBER() OVER (PARTITION BY b.game ORDER BY b.score DESC, b.received_at ASC, p.id ASC) AS rn
         FROM best b JOIN players p ON p.id = b.player_id WHERE p.blocked = 0 ${only}
       ) WHERE rn = 1`,
    )
    .all(...(games ?? [])) as { game: string; login: string; score: number }[];
  const out: Record<string, { login: string; score: number }> = {};
  for (const r of rows) out[r.game] = { login: r.login, score: r.score };
  return out;
}

export function deletePlayer(db: Db, playerId: number): void {
  inTransaction(db.raw, () => {
    db.raw.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
    db.raw.prepare('DELETE FROM best WHERE player_id = ?').run(playerId);
    db.raw.prepare('DELETE FROM players WHERE id = ?').run(playerId);
  });
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

/** The web top `limit` for `game`: best score first, older entry first on a tie. */
export function webBoard(db: Db, game: string, limit: number): WebRow[] {
  const rows = db.raw
    .prepare('SELECT name, score, at FROM web_best WHERE game = ? ORDER BY score DESC, at ASC, name_key ASC LIMIT ?')
    .all(game, limit) as { name: string; score: number; at: string }[];
  return rows.map((r, i) => ({ rank: i + 1, name: r.name, score: r.score, at: r.at }));
}

/**
 * Records a web score under `name` (already normalised). A higher score than the name's
 * best replaces score, time and display casing; anything else only counts the submission.
 */
export function submitWebScore(
  db: Db, game: string, name: string, score: number, now: Date,
): { rank: number | null; best: number; top: WebRow[] } {
  const key = name.toLowerCase();
  const at = now.toISOString();
  const best = inTransaction(db.raw, () => {
    const cur = db.raw
      .prepare('SELECT score FROM web_best WHERE game = ? AND name_key = ?')
      .get(game, key) as { score: number } | undefined;
    if (!cur) {
      db.raw
        .prepare('INSERT INTO web_best (game, name, name_key, score, at, submissions) VALUES (?, ?, ?, ?, ?, 1)')
        .run(game, name, key, score, at);
      return score;
    }
    if (score > cur.score) {
      db.raw
        .prepare('UPDATE web_best SET name = ?, score = ?, at = ?, submissions = submissions + 1 WHERE game = ? AND name_key = ?')
        .run(name, score, at, game, key);
      return score;
    }
    db.raw.prepare('UPDATE web_best SET submissions = submissions + 1 WHERE game = ? AND name_key = ?').run(game, key);
    return cur.score;
  });
  const top = webBoard(db, game, BOARD_LIMIT);
  const mine = top.find((r) => r.name.toLowerCase() === key);
  return { rank: mine ? mine.rank : null, best, top };
}

export function deleteWebScore(db: Db, name: string, game: string): boolean {
  const res = db.raw.prepare('DELETE FROM web_best WHERE game = ? AND name_key = ?').run(game, name.toLowerCase());
  return Number(res.changes) > 0;
}
