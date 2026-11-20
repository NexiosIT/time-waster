import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { openDb, setBlocked, type Db } from './db';
import { createHandler } from './http';

const GH_USERS: Record<string, { id: number; login: string }> = {
  'gh-alice': { id: 1, login: 'alice' },
  'gh-bob': { id: 2, login: 'bob' },
};

const stubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  const user = GH_USERS[auth.replace(/^Bearer /, '')];
  if (url !== 'https://api.github.com/user' || !user) return new Response('{"message":"Bad credentials"}', { status: 401 });
  return Response.json(user);
}) as typeof fetch;

type Ctx = { base: string; db: Db; clock: { ms: number }; server: Server };
const open: Server[] = [];

async function setup(opts: { trustProxy?: boolean; fetchFn?: typeof fetch } = {}): Promise<Ctx> {
  const db = openDb(':memory:');
  const clock = { ms: Date.UTC(2026, 10, 20, 12, 0, 0) };
  const handler = createHandler({ db, fetchFn: opts.fetchFn ?? stubFetch, now: () => new Date(clock.ms), trustProxy: opts.trustProxy ?? false });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  open.push(server);
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, db, clock, server };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function post(c: Ctx, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(c.base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(c: Ctx, githubToken = 'gh-alice'): Promise<string> {
  const res = await post(c, '/v1/login', { githubToken });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const iso = (c: Ctx, offsetMs = 0) => new Date(c.clock.ms + offsetMs).toISOString();
const score = (c: Ctx, token: string, body: Record<string, unknown>) =>
  post(c, '/v1/scores', { game: 'worm', score: 10, at: iso(c), ...body }, bearer(token));

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe('http api', () => {
  test('login with a valid GitHub token returns a session token; a bad one is 401', async () => {
    const c = await setup();
    const res = await post(c, '/v1/login', { githubToken: 'gh-alice' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await res.json()) as { token: string; login: string };
    expect(body.login).toBe('alice');
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect((await post(c, '/v1/login', { githubToken: 'gh-nobody' })).status).toBe(401);
    expect((await post(c, '/v1/login', { githubToken: '' })).status).toBe(400);
    expect((await post(c, '/v1/login', {})).status).toBe(400);
    expect((await post(c, '/v1/login', 'not json')).status).toBe(400);
    expect((await post(c, '/v1/login', [1])).status).toBe(400);
  });

  test('the GitHub token is not stored anywhere in the database', async () => {
    const c = await setup();
    const token = await login(c, 'gh-alice');
    const tables = c.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.length).toBeGreaterThan(0);
    const dump = JSON.stringify(tables.map((t) => c.db.raw.prepare(`SELECT * FROM "${t.name}"`).all()));
    expect(dump).toContain('alice');
    expect(dump).not.toContain('gh-alice');
    expect(dump).not.toContain(token); // only the session token's hash is stored
  });

  test('scores need a valid session; best and rank come back', async () => {
    const c = await setup();
    expect((await post(c, '/v1/scores', { game: 'worm', score: 10, at: iso(c) })).status).toBe(401);
    expect((await score(c, 'not-a-real-token', {})).status).toBe(401);

    const alice = await login(c, 'gh-alice');
    const bob = await login(c, 'gh-bob');
    let res = await score(c, alice, { score: 100 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ best: 100, rank: 1 });

    res = await score(c, bob, { score: 200 });
    expect(await res.json()).toEqual({ best: 200, rank: 1 });
    res = await score(c, alice, { score: 50 });
    expect(await res.json()).toEqual({ best: 100, rank: 2 });
  });

  test('invalid scores are 400: bad game id, negative, fraction, over maxScore, at in future (>5 min) or older than 30 days', async () => {
    const c = await setup();
    const t = await login(c);
    const bad: Record<string, unknown>[] = [
      { game: 'Worm' }, { game: '../x' }, { game: '' }, { game: 7 },
      { score: -1 }, { score: 1.5 }, { score: '10' }, { score: 5221 }, // worm maxScore is 5220
      { game: 'unknown-game', score: 1_000_001 },                       // default maxScore
      { at: iso(c, 5 * MIN + 1000) }, { at: iso(c, -30 * DAY - 1000) }, { at: 'yesterday' }, { at: 123 },
    ];
    for (const b of bad) expect((await score(c, t, b)).status, JSON.stringify(b)).toBe(400);

    const good: Record<string, unknown>[] = [
      { score: 0 }, { score: 5220 }, { game: 'unknown-game', score: 1_000_000 },
      { at: iso(c, 4 * MIN) }, { at: iso(c, -29 * DAY) },
    ];
    for (const g of good) expect((await score(c, t, g)).status, JSON.stringify(g)).toBe(200);
  });

  test('a 61st submission within an hour is 429', async () => {
    const c = await setup();
    const alice = await login(c, 'gh-alice');
    const bob = await login(c, 'gh-bob');
    for (let i = 0; i < 60; i++) expect((await score(c, alice, { score: i })).status).toBe(200);
    expect((await score(c, alice, { score: 99 })).status).toBe(429);
    expect((await score(c, bob, { score: 99 })).status).toBe(200); // per player
    c.clock.ms += HOUR;
    expect((await score(c, alice, { score: 99 })).status).toBe(200);
  });

  test('login is limited per GitHub id (11th in an hour is 429)', async () => {
    const c = await setup();
    for (let i = 0; i < 10; i++) expect((await post(c, '/v1/login', { githubToken: 'gh-alice' })).status).toBe(200);
    expect((await post(c, '/v1/login', { githubToken: 'gh-alice' })).status).toBe(429);
    expect((await post(c, '/v1/login', { githubToken: 'gh-bob' })).status).toBe(200);
    c.clock.ms += HOUR;
    expect((await post(c, '/v1/login', { githubToken: 'gh-alice' })).status).toBe(200);
  });

  test('per-IP login limit applies only with trustProxy and uses the first X-Forwarded-For entry', async () => {
    // Failed logins count too: the per-IP check runs before GitHub is asked.
    const proxied = await setup({ trustProxy: true });
    const from = (ip: string) => ({ 'x-forwarded-for': `${ip}, 10.0.0.1` });
    for (let i = 0; i < 30; i++) {
      expect((await post(proxied, '/v1/login', { githubToken: 'gh-x' }, from('1.1.1.1'))).status).toBe(401);
    }
    expect((await post(proxied, '/v1/login', { githubToken: 'gh-alice' }, from('1.1.1.1'))).status).toBe(429);
    expect((await post(proxied, '/v1/login', { githubToken: 'gh-alice' }, from('2.2.2.2'))).status).toBe(200);

    const direct = await setup({ trustProxy: false });
    for (let i = 0; i < 30; i++) {
      expect((await post(direct, '/v1/login', { githubToken: 'gh-x' }, from('1.1.1.1'))).status).toBe(401);
    }
    expect((await post(direct, '/v1/login', { githubToken: 'gh-alice' }, from('1.1.1.1'))).status).toBe(200);
  });

  test('blocked players get 403 on login and submit', async () => {
    const c = await setup();
    const t = await login(c, 'gh-alice');
    setBlocked(c.db, 'alice', true);
    expect((await score(c, t, {})).status).toBe(403);
    expect((await post(c, '/v1/login', { githubToken: 'gh-alice' })).status).toBe(403);
  });

  test('blocked players get 403 on DELETE /v1/me and stay blocked', async () => {
    const c = await setup();
    const t = await login(c, 'gh-alice');
    setBlocked(c.db, 'alice', true);
    expect((await fetch(`${c.base}/v1/me`, { method: 'DELETE', headers: bearer(t) })).status).toBe(403);
    const row = c.db.raw.prepare('SELECT blocked FROM players WHERE id = 1').get() as { blocked: number } | undefined;
    expect(row?.blocked).toBe(1);
    expect((await post(c, '/v1/login', { githubToken: 'gh-alice' })).status).toBe(403);
  });

  test('GitHub unreachable or timing out during login is 502 with a JSON error', async () => {
    const failing = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const c = await setup({ fetchFn: failing });
    const res = await post(c, '/v1/login', { githubToken: 'gh-alice' });
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ error: expect.any(String) });

    const timingOut = (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch;
    const c2 = await setup({ fetchFn: timingOut });
    expect((await post(c2, '/v1/login', { githubToken: 'gh-alice' })).status).toBe(502);
  });

  test('boards work without login; with login they include me', async () => {
    const c = await setup();
    const alice = await login(c, 'gh-alice');
    const bob = await login(c, 'gh-bob');
    await score(c, alice, { score: 100 });
    await score(c, bob, { score: 300 });
    await score(c, bob, { game: 'drift', score: 7 });

    let res = await fetch(`${c.base}/v1/boards/worm`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    let body = (await res.json()) as { game: string; top: { rank: number; login: string; score: number }[]; me: unknown };
    expect(body.game).toBe('worm');
    expect(body.top.map((r) => [r.rank, r.login, r.score])).toEqual([[1, 'bob', 300], [2, 'alice', 100]]);
    expect(body.me).toBeNull();

    res = await fetch(`${c.base}/v1/boards/worm`, { headers: bearer(alice) });
    body = (await res.json()) as typeof body;
    expect(body.me).toEqual({ rank: 2, score: 100 });

    res = await fetch(`${c.base}/v1/boards/drift`, { headers: bearer(alice) });
    expect(((await res.json()) as typeof body).me).toBeNull();

    expect((await fetch(`${c.base}/v1/boards/Bad_Id`)).status).toBe(400);

    res = await fetch(`${c.base}/v1/boards`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ boards: { worm: { login: 'bob', score: 300 }, drift: { login: 'bob', score: 7 } } });
  });

  test('boards list the top 10 only', async () => {
    const c = await setup();
    const t = await login(c, 'gh-alice');
    for (let i = 0; i < 11; i++) {
      c.db.raw.prepare("INSERT INTO players (id, login, created_at, updated_at) VALUES (?, ?, 'x', 'x')").run(100 + i, `p${i}`);
      c.db.raw.prepare("INSERT INTO best (player_id, game, score, at, received_at) VALUES (?, 'worm', ?, 'x', 'x')").run(100 + i, i + 10);
    }
    await score(c, t, { score: 1 });
    const body = (await (await fetch(`${c.base}/v1/boards/worm`, { headers: bearer(t) })).json()) as any;
    expect(body.top).toHaveLength(10);
    expect(body.me).toEqual({ rank: 12, score: 1 });
  });

  test('DELETE /v1/me removes the player; the token then gets 401', async () => {
    const c = await setup();
    expect((await fetch(`${c.base}/v1/me`, { method: 'DELETE' })).status).toBe(401);
    const t = await login(c, 'gh-alice');
    await score(c, t, { score: 100 });
    const res = await fetch(`${c.base}/v1/me`, { method: 'DELETE', headers: bearer(t) });
    expect(res.status).toBe(204);
    expect((await score(c, t, {})).status).toBe(401);
    expect((await fetch(`${c.base}/v1/me`, { method: 'DELETE', headers: bearer(t) })).status).toBe(401);
    const top = ((await (await fetch(`${c.base}/v1/boards/worm`)).json()) as any).top;
    expect(top).toEqual([]);
  });

  test('unknown route is 404, oversized body is 413, health is ok', async () => {
    const c = await setup();
    let res = await fetch(`${c.base}/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    res = await fetch(`${c.base}/v1/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect((await fetch(`${c.base}/v1/health`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${c.base}/v1/login`)).status).toBe(404);

    res = await post(c, '/v1/login', { githubToken: 'gh-alice', pad: 'x'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });
});
