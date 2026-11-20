import { describe, expect, test } from 'vitest';
import {
  openDb, upsertPlayer, createSession, playerForToken, submitScore, board, worldBests,
  deletePlayer, setBlocked, deleteScore, playerIdByLogin, playersWithLogin,
} from './db';

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
    expect(r.best).toBe(150);
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
    expect(a.rank).toBe(2);
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
});
