import { describe, expect, test } from 'vitest';
import { openDb, upsertPlayer, submitScore, board, playerIdByLogin } from './db';
import { runAdmin } from './admin';

const AT = '2026-01-01T00:00:00.000Z';
const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

function setup() {
  const db = openDb(':memory:');
  upsertPlayer(db, { id: 1, login: 'Alice' }, t(0));
  upsertPlayer(db, { id: 2, login: 'bob' }, t(0));
  submitScore(db, 1, 'snake', 300, AT, t(1));
  submitScore(db, 2, 'snake', 200, AT, t(2));
  const lines: string[] = [];
  const run = (...argv: string[]) => runAdmin(db, argv, (l) => lines.push(l));
  return { db, lines, run };
}

describe('admin', () => {
  test('board prints rank, login and score per line', () => {
    const { lines, run } = setup();
    expect(run('board', 'snake')).toBe(0);
    expect(lines).toEqual(['1 Alice 300', '2 bob 200']);
  });

  test('block hides a player and unblock restores them', () => {
    const { db, lines, run } = setup();
    expect(run('block', 'alice')).toBe(0);
    expect(board(db, 'snake', 10).top.map((r) => r.login)).toEqual(['bob']);
    expect(run('unblock', 'ALICE')).toBe(0);
    expect(board(db, 'snake', 10).top.map((r) => r.login)).toEqual(['Alice', 'bob']);
    expect(lines.length).toBe(2);
  });

  test('delete-score and delete-player remove data', () => {
    const { db, run } = setup();
    expect(run('delete-score', 'bob', 'snake')).toBe(0);
    expect(board(db, 'snake', 10).top.map((r) => r.login)).toEqual(['Alice']);
    expect(run('delete-player', 'alice')).toBe(0);
    expect(playerIdByLogin(db, 'Alice')).toBeNull();
    expect(board(db, 'snake', 10).top).toEqual([]);
  });

  test('unknown command or unknown login prints usage / error and returns 1', () => {
    const { lines, run } = setup();
    expect(run('frobnicate')).toBe(1);
    expect(lines.join('\n')).toContain('Usage');
    expect(run()).toBe(1);
    expect(run('block')).toBe(1);
    lines.length = 0;
    expect(run('block', 'nobody')).toBe(1);
    expect(lines[0]).toContain('nobody');
    expect(run('delete-score', 'bob', 'nogame')).toBe(1);
  });

  test('a login matching several players is an error and changes nothing', () => {
    const { db, lines, run } = setup();
    upsertPlayer(db, { id: 3, login: 'ALICE' }, t(3));
    expect(run('block', 'alice')).toBe(1);
    expect(run('delete-player', 'alice')).toBe(1);
    expect(run('delete-score', 'alice', 'snake')).toBe(1);
    expect(lines.every((l) => l.includes('more than one'))).toBe(true);
    expect(board(db, 'snake', 10).top.length).toBe(2);
    expect(playerIdByLogin(db, 'bob')).toBe(2);
  });
});

describe('admin web scores', () => {
  test('web-board prints the web top and delete-web-score removes a name', async () => {
    const { submitWebScore } = await import('./db');
    const { db, lines, run } = setup();
    submitWebScore(db, 'snake', 'Kim B', 50, t(3));
    expect(run('web-board', 'snake')).toBe(0);
    expect(lines).toEqual(['1 Kim B 50']);
    lines.length = 0;
    expect(run('delete-web-score', '  kim   b ', 'snake')).toBe(0);
    expect(lines).toEqual(['deleted Kim B snake']);
    lines.length = 0;
    expect(run('delete-web-score', 'kim b', 'snake')).toBe(1);
    expect(lines).toEqual(['no web score for kim b on snake']);
    lines.length = 0;
    expect(run('delete-web-score', '<b>', 'snake')).toBe(1);
    expect(lines).toEqual(['bad name: <b>']);
  });

  test('usage lists the web commands', () => {
    const { lines, run } = setup();
    expect(run('nope')).toBe(1);
    expect(lines).toContain('  web-board <game>');
    expect(lines).toContain('  delete-web-score <name> <game>');
  });
});
