import { describe, expect, test } from 'vitest';
import {
  openDb, upsertPlayer, createSession, playerForToken, submitScore, board, worldBests,
  deletePlayer, setBlocked, deleteScore, playerIdByLogin, playersWithLogin, deleteSession,
  submitWebScore, webBoard, deleteWebScore,
} from './db';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
const AT = '2026-01-01T00:00:00.000Z';

function player(db: ReturnType<typeof openDb>, id: number, login = `p${id}`) {
  upsertPlayer(db, { id, login }, t(0));
}

describe('db', () => {
  test('keeps only the best score per player and game, counting submissions', () => {
    const db = openDb(':memory:');
    player(db, 1);
    submitScore(db, 1, 'snake', 100, AT, t(1));
    submitScore(db, 1, 'snake', 50, AT, t(2));
    const r = submitScore(db, 1, 'snake', 150, AT, t(3));
    expect(r?.best).toBe(150);
    const row = db.raw.prepare('SELECT * FROM best WHERE player_id = 1').get() as any;
    expect(row.submissions).toBe(3);
    expect(row.score).toBe(150);
  });

  test('ranks by score, ties by who reached it first on the server', () => {
    const db = openDb(':memory:');
    [1, 2, 3].forEach((i) => player(db, i, 'ABC'[i - 1]));
    submitScore(db, 1, 'g', 200, AT, t(1));
    submitScore(db, 2, 'g', 200, AT, t(2));
    submitScore(db, 3, 'g', 300, AT, t(3));
    const { top } = board(db, 'g', 10);
    expect(top.map((r) => [r.login, r.rank])).toEqual([['C', 1], ['A', 2], ['B', 3]]);
  });

  test('submitting the same run twice keeps one best and the same rank', () => {
    const db = openDb(':memory:');
    player(db, 1); player(db, 2);
    submitScore(db, 2, 'g', 100, AT, t(1));
    const a = submitScore(db, 1, 'g', 100, AT, t(2));
    const b = submitScore(db, 1, 'g', 100, AT, t(3));
    expect(b).toEqual(a);
    expect(a?.rank).toBe(2);
    expect(board(db, 'g', 10).top).toHaveLength(2);
  });

  test('board returns at most limit rows and my rank even outside the top', () => {
    const db = openDb(':memory:');
    for (let i = 1; i <= 12; i++) {
      player(db, i);
      submitScore(db, i, 'g', 1000 - i, AT, t(i));
    }
    const res = board(db, 'g', 10, 12);
    expect(res.top).toHaveLength(10);
    expect(res.me?.rank).toBe(12);
    expect(res.me?.score).toBe(988);
    expect(board(db, 'g', 10).me).toBeNull();
  });

  test('blocked players are hidden from boards, ranks and world bests', () => {
    const db = openDb(':memory:');
    player(db, 1, 'cheat'); player(db, 2, 'fair');
    submitScore(db, 1, 'g', 999, AT, t(1));
    submitScore(db, 2, 'g', 10, AT, t(2));
    expect(setBlocked(db, 'cheat', true)).toBe(true);
    const res = board(db, 'g', 10, 2);
    expect(res.top.map((r) => r.login)).toEqual(['fair']);
    expect(res.me?.rank).toBe(1);
    expect(worldBests(db)).toEqual({ g: { login: 'fair', score: 10 } });
  });

  test('worldBests gives the top player per game', () => {
    const db = openDb(':memory:');
    player(db, 1, 'a'); player(db, 2, 'b');
    submitScore(db, 1, 'x', 5, AT, t(1));
    submitScore(db, 2, 'x', 9, AT, t(2));
    submitScore(db, 1, 'y', 7, AT, t(3));
    expect(worldBests(db)).toEqual({ x: { login: 'b', score: 9 }, y: { login: 'a', score: 7 } });
  });

  test('deletePlayer removes sessions and scores; the token no longer resolves', () => {
    const db = openDb(':memory:');
    player(db, 1);
    createSession(db, 1, 'hash', t(1));
    submitScore(db, 1, 'g', 5, AT, t(2));
    expect(playerForToken(db, 'hash')).toEqual({ id: 1, login: 'p1', blocked: false });
    deletePlayer(db, 1);
    expect(playerForToken(db, 'hash')).toBeNull();
    expect(board(db, 'g', 10).top).toEqual([]);
    expect(playerIdByLogin(db, 'p1')).toBeNull();
  });

  test('upsertPlayer updates the login on rename and reports blocked', () => {
    const db = openDb(':memory:');
    expect(upsertPlayer(db, { id: 1, login: 'old' }, t(0))).toEqual({ blocked: false });
    upsertPlayer(db, { id: 1, login: 'new' }, t(1));
    expect(playerIdByLogin(db, 'new')).toBe(1);
    expect(playerIdByLogin(db, 'old')).toBeNull();
    setBlocked(db, 'new', true);
    expect(upsertPlayer(db, { id: 1, login: 'new' }, t(2))).toEqual({ blocked: true });
  });

  test('deleteScore and setBlocked report false for an unknown login', () => {
    const db = openDb(':memory:');
    expect(deleteScore(db, 'nobody', 'g')).toBe(false);
    expect(setBlocked(db, 'nobody', true)).toBe(false);
    player(db, 1);
    submitScore(db, 1, 'g', 5, AT, t(1));
    expect(deleteScore(db, 'p1', 'g')).toBe(true);
    expect(deleteScore(db, 'p1', 'g')).toBe(false);
  });

  test('admin lookups by login ignore case', () => {
    const db = openDb(':memory:');
    player(db, 1, 'Alice');
    submitScore(db, 1, 'g', 5, AT, t(1));
    expect(playerIdByLogin(db, 'aLICE')).toBe(1);
    expect(playersWithLogin(db, 'ALICE')).toBe(1);
    expect(setBlocked(db, 'alice', true)).toBe(true);
    expect(deleteScore(db, 'ALICE', 'g')).toBe(true);
  });

  test('opening a database from a newer schema version never downgrades user_version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-db-'));
    try {
      const path = join(dir, 'scores.db');
      openDb(path).raw.close();
      const raw = new DatabaseSync(path);
      raw.exec('PRAGMA user_version = 3');
      raw.close();
      const db = openDb(path);
      expect((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3);
      db.raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a fresh database is migrated to version 2', () => {
    const db = openDb(':memory:');
    expect((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
  });

  test('deleteSession ends only that session', () => {
    const db = openDb(':memory:');
    player(db, 1);
    createSession(db, 1, 'h1', t(1));
    createSession(db, 1, 'h2', t(2));
    expect(deleteSession(db, 'h1')).toBe(true);
    expect(playerForToken(db, 'h1')).toBeNull();
    expect(playerForToken(db, 'h2')).not.toBeNull();
    expect(deleteSession(db, 'h1')).toBe(false);
  });

  test('submitting for a deleted player stores nothing', () => {
    const db = openDb(':memory:');
    player(db, 1);
    deletePlayer(db, 1);
    expect(submitScore(db, 1, 'g', 5, AT, t(1))).toBeNull();
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM best').get()).toEqual({ n: 0 });
  });
});

const V1_SQL = `
  CREATE TABLE players (id INTEGER PRIMARY KEY, login TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX players_login ON players(login);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, player_id INTEGER NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE best (player_id INTEGER NOT NULL, game TEXT NOT NULL, score INTEGER NOT NULL, at TEXT NOT NULL,
    received_at TEXT NOT NULL, submissions INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (player_id, game));
  CREATE INDEX best_game_score ON best(game, score DESC, received_at);
  PRAGMA user_version = 1;
`;

describe('web scores', () => {
  const version = (db: ReturnType<typeof openDb>) =>
    (db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

  test('a fresh database has the web_best table', () => {
    const db = openDb(':memory:');
    expect(version(db)).toBe(2);
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'web_best'").get()).toBeTruthy();
  });

  test('a version 1 database upgrades in place and keeps its arcade scores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tw-db-'));
    try {
      const path = join(dir, 'scores.db');
      const raw = new DatabaseSync(path);
      raw.exec(V1_SQL);
      raw.prepare("INSERT INTO players VALUES (1, 'alice', 0, ?, ?)").run(AT, AT);
      raw.prepare("INSERT INTO best VALUES (1, 'g', 42, ?, ?, 1)").run(AT, AT);
      raw.close();
      const db = openDb(path);
      expect(version(db)).toBe(2);
      expect(board(db, 'g', 10).top).toEqual([{ rank: 1, login: 'alice', score: 42, at: AT }]);
      expect(submitWebScore(db, 'g', 'Kim', 5, t(1)).best).toBe(5);
      db.raw.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the first score for a name is stored and ranked', () => {
    const db = openDb(':memory:');
    expect(submitWebScore(db, 'g', 'Kim', 500, t(1))).toEqual({
      rank: 1, best: 500, top: [{ rank: 1, name: 'Kim', score: 500, at: t(1).toISOString() }],
    });
  });

  test('one row per name regardless of case; a higher score replaces score and casing', () => {
    const db = openDb(':memory:');
    submitWebScore(db, 'g', 'Kim B', 500, t(1));
    const lower = submitWebScore(db, 'g', 'kim b', 400, t(2));
    expect(lower.best).toBe(500);
    let row = db.raw.prepare('SELECT * FROM web_best').all() as any[];
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ name: 'Kim B', name_key: 'kim b', score: 500, submissions: 2 });
    const higher = submitWebScore(db, 'g', 'KIM B', 700, t(3));
    expect(higher).toMatchObject({ rank: 1, best: 700 });
    row = db.raw.prepare('SELECT * FROM web_best').all() as any[];
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ name: 'KIM B', score: 700, submissions: 3, at: t(3).toISOString() });
  });

  test('an equal score keeps the older entry and its place', () => {
    const db = openDb(':memory:');
    submitWebScore(db, 'g', 'Ann', 100, t(1));
    submitWebScore(db, 'g', 'Bo', 100, t(2));
    submitWebScore(db, 'g', 'ann', 100, t(3));
    expect(webBoard(db, 'g', 10).map((r) => [r.name, r.at])).toEqual([
      ['Ann', t(1).toISOString()], ['Bo', t(2).toISOString()],
    ]);
  });

  test('top is limited to 10 and a name outside it has rank null', () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 10; i++) submitWebScore(db, 'g', `P${i}`, 100 + i, t(i));
    const r = submitWebScore(db, 'g', 'Late', 1, t(20));
    expect(r.top).toHaveLength(10);
    expect(r.rank).toBeNull();
    expect(r.best).toBe(1);
    expect(submitWebScore(db, 'g', 'Late', 200, t(21)).rank).toBe(1);
  });

  test('web boards are per game', () => {
    const db = openDb(':memory:');
    submitWebScore(db, 'a', 'Kim', 1, t(1));
    expect(webBoard(db, 'b', 10)).toEqual([]);
  });

  test('deleteWebScore removes by name, case-insensitively', () => {
    const db = openDb(':memory:');
    submitWebScore(db, 'g', 'Kim B', 1, t(1));
    expect(deleteWebScore(db, 'kim b', 'g')).toBe(true);
    expect(deleteWebScore(db, 'kim b', 'g')).toBe(false);
    expect(webBoard(db, 'g', 10)).toEqual([]);
  });

  test('web scores never reach the arcade board, and deleting a player leaves them', () => {
    const db = openDb(':memory:');
    player(db, 1, 'alice');
    submitScore(db, 1, 'g', 10, AT, t(1));
    submitWebScore(db, 'g', 'alice', 999, t(2));
    expect(board(db, 'g', 10).top.map((r) => r.login)).toEqual(['alice']);
    expect(board(db, 'g', 10).top[0].score).toBe(10);
    expect(worldBests(db, ['g'])).toEqual({ g: { login: 'alice', score: 10 } });
    deletePlayer(db, 1);
    expect(webBoard(db, 'g', 10)).toHaveLength(1);
  });
});
