import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Online } from './online';
import { Api, type ApiResult } from './api';
import { loadAccount, saveAccount, readOutbox, writeOutbox, type OutboxEntry } from './store';

const SERVER = 'https://scores.test';
let tmp: string;
let accountFile: string;
let outboxFile: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'online-state-'));
  accountFile = path.join(tmp, 'online.json');
  outboxFile = path.join(tmp, 'outbox.jsonl');
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
const fail = (status: number | 'network'): ApiResult<never> => ({ ok: false, status });
const immediate = () => Promise.resolve();
/** Lets queued background promises run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

type FakeApi = Partial<Record<keyof Api, (...args: any[]) => Promise<ApiResult<any>>>>;
function fakeApi(f: FakeApi): Api {
  const network = async () => fail('network');
  return {
    login: f.login ?? network,
    submit: f.submit ?? network,
    board: f.board ?? network,
    boards: f.boards ?? network,
    deleteMe: f.deleteMe ?? network,
    signOutSession: f.signOutSession ?? network,
  } as unknown as Api;
}

/** GitHub fetch: device code, then the given poll replies in order (last one repeats). */
function githubFetch(polls: unknown[], calls: string[] = [], code: unknown = defaultCode): typeof fetch {
  let i = 0;
  return (async (url: string) => {
    calls.push(url);
    if (url.endsWith('/login/device/code')) return new Response(JSON.stringify(code));
    const body = polls[Math.min(i++, polls.length - 1)];
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
}
const defaultCode = {
  device_code: 'dc',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  interval: 5,
  expires_in: 900,
};

function signedIn(token = 'tok', login = 'bob'): void {
  saveAccount(accountFile, { serverUrl: SERVER, token, login });
}
const entry = (score: number): OutboxEntry => ({ game: 'snake', score, at: '2026-11-20T10:00:00.000Z' });

function make(opts: { api: Api; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Online {
  return new Online({ serverUrl: SERVER, clientId: 'cid', accountFile, outboxFile, sleep: immediate, ...opts });
}

describe('Online', () => {
  it('sign-in goes starting → code → done and saves the account', async () => {
    const slept: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const logins: string[] = [];
    const o = make({
      api: fakeApi({
        login: async (gh: string) => {
          logins.push(gh);
          return ok({ token: 'session', login: 'octocat' });
        },
      }),
      fetchFn: githubFetch([{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'gho_x' }]),
      sleep: async (ms) => {
        slept.push(ms);
        await gate;
      },
    });
    expect(o.signIn()).toEqual({ phase: 'idle' });
    expect(o.account()).toBeNull();
    o.startSignIn();
    expect(o.signIn()).toEqual({ phase: 'starting' });
    await settle();
    expect(o.signIn()).toEqual({ phase: 'code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' });
    release();
    await settle();
    expect(o.signIn()).toEqual({ phase: 'done', login: 'octocat' });
    expect(slept).toEqual([5000, 5000, 10000]);
    expect(logins).toEqual(['gho_x']);
    expect(o.account()).toEqual({ login: 'octocat' });
    expect(loadAccount(accountFile)).toEqual({ serverUrl: SERVER, token: 'session', login: 'octocat' });
  });

  it('sign-in reports expired, denied and unreachable as failed with the exact message', async () => {
    const loginOk = fakeApi({ login: async () => ok({ token: 's', login: 'x' }) });
    const cases: { fetchFn: typeof fetch; api: Api; message: string }[] = [
      { fetchFn: githubFetch([{ error: 'expired_token' }]), api: loginOk, message: 'Code expired' },
      { fetchFn: githubFetch([{ error: 'access_denied' }]), api: loginOk, message: 'Sign-in denied' },
      { fetchFn: githubFetch([], [], { nope: 1 }), api: loginOk, message: "Couldn't reach GitHub" },
      { fetchFn: githubFetch([{ error: 'weird' }]), api: loginOk, message: "Couldn't reach GitHub" },
      {
        fetchFn: githubFetch([{ access_token: 'gho' }]),
        api: fakeApi({ login: async () => fail('network') }),
        message: "Couldn't reach the score server",
      },
      {
        fetchFn: githubFetch([{ access_token: 'gho' }]),
        api: fakeApi({ login: async () => fail(500) }),
        message: "Couldn't reach the score server",
      },
      {
        fetchFn: githubFetch([{ access_token: 'gho' }]),
        api: fakeApi({ login: async () => fail(403) }),
        message: 'This GitHub account is blocked',
      },
      {
        fetchFn: githubFetch([{ access_token: 'gho' }]),
        api: fakeApi({ login: async () => fail(429) }),
        message: 'Too many sign-ins, try again later',
      },
      {
        fetchFn: githubFetch([{ error: 'authorization_pending' }], [], { ...defaultCode, interval: 5, expires_in: 12 }),
        api: loginOk,
        message: 'Code expired',
      },
    ];
    for (const c of cases) {
      const o = make(c);
      o.startSignIn();
      await settle();
      expect(o.signIn()).toEqual({ phase: 'failed', message: c.message });
      expect(o.account()).toBeNull();
      expect(loadAccount(accountFile)).toBeNull();
    }
  });

  it('cancelSignIn stops polling and returns to idle', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const o = make({
      api: fakeApi({ login: async () => ok({ token: 's', login: 'x' }) }),
      fetchFn: githubFetch([{ access_token: 'gho' }], calls),
      sleep: () => gate,
    });
    o.startSignIn();
    o.startSignIn(); // second start while one is in flight is ignored
    await settle();
    expect(o.signIn().phase).toBe('code');
    expect(calls).toHaveLength(1);
    o.cancelSignIn();
    expect(o.signIn()).toEqual({ phase: 'idle' });
    release();
    await settle();
    expect(calls).toHaveLength(1); // no poll after cancel
    expect(o.signIn()).toEqual({ phase: 'idle' });
    expect(o.account()).toBeNull();
  });

  it('recordRun does nothing when signed out', async () => {
    let submits = 0;
    const o = make({ api: fakeApi({ submit: async () => (submits++, ok({ best: 1, rank: 1 })) }) });
    o.recordRun('snake', 10, new Date('2026-11-20T10:00:00Z'));
    await settle();
    expect(submits).toBe(0);
    expect(fs.existsSync(outboxFile)).toBe(false);
  });

  it('recordRun appends to the outbox and sends it when signed in', async () => {
    signedIn();
    const sent: [string, OutboxEntry][] = [];
    const o = make({ api: fakeApi({ submit: async (t: string, e: OutboxEntry) => (sent.push([t, e]), ok({ best: 1, rank: 1 })) }) });
    o.recordRun('snake', 10, new Date('2026-11-20T10:00:00Z'));
    await settle();
    expect(sent).toEqual([['tok', { game: 'snake', score: 10, at: '2026-11-20T10:00:00.000Z' }]]);
    expect(readOutbox(outboxFile)).toEqual([]);
  });

  it('flush removes sent and permanently refused entries, keeps network/5xx/429 ones in order', async () => {
    signedIn();
    const replies = new Map<number, ApiResult<any>>([
      [1, ok({ best: 1, rank: 1 })],
      [2, fail(400)],
      [3, fail(403)],
      [4, fail('network')],
    ]);
    const sent: number[] = [];
    const api = fakeApi({
      submit: async (_t: string, e: OutboxEntry) => {
        sent.push(e.score);
        return replies.get(e.score) ?? ok({ best: 1, rank: 1 });
      },
    });
    writeOutbox(outboxFile, [entry(1), entry(2), entry(3), entry(4), entry(5)]);
    const o = make({ api });
    await o.flush();
    expect(sent).toEqual([1, 2, 3, 4]); // stops at the first kept entry
    expect(readOutbox(outboxFile)).toEqual([entry(4), entry(5)]);

    for (const status of [500, 503, 429] as const) {
      replies.set(4, fail(status));
      sent.length = 0;
      await o.flush();
      expect(sent).toEqual([4]);
      expect(readOutbox(outboxFile)).toEqual([entry(4), entry(5)]);
    }

    replies.delete(4);
    await o.flush();
    expect(readOutbox(outboxFile)).toEqual([]);
  });

  it('a run recorded while a flush is in flight is still sent', async () => {
    signedIn();
    writeOutbox(outboxFile, [entry(1)]);
    const sent: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const o = make({
      api: fakeApi({
        submit: async (_t: string, e: OutboxEntry) => {
          sent.push(e.score);
          await gate;
          return ok({ best: 1, rank: 1 });
        },
      }),
    });
    await settle();
    o.recordRun('snake', 2, new Date('2026-11-20T10:00:00Z'));
    release();
    await settle();
    expect(sent).toEqual([1, 2]);
    expect(readOutbox(outboxFile)).toEqual([]);
  });

  it('a 401 on submit clears the account and the outbox and does not retry', async () => {
    signedIn();
    writeOutbox(outboxFile, [entry(1), entry(2)]);
    let submits = 0;
    const o = make({ api: fakeApi({ submit: async () => (submits++, fail(401)) }) });
    await settle();
    expect(submits).toBe(1);
    expect(o.account()).toBeNull();
    expect(loadAccount(accountFile)).toBeNull();
    expect(readOutbox(outboxFile)).toEqual([]);
    o.recordRun('snake', 3, new Date());
    await o.flush();
    await settle();
    expect(submits).toBe(1);
    expect(readOutbox(outboxFile)).toEqual([]);
  });

  it('a hanging server makes board() offline and leaves the outbox intact', async () => {
    signedIn();
    writeOutbox(outboxFile, [entry(1)]);
    // Never answers; only gives up when the request's abort signal fires, like real fetch.
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const o = make({ api: new Api(SERVER, hanging, 50) });
    o.loadBoard('snake');
    o.refreshWorldBest(0, ['snake']);
    const t0 = Date.now();
    expect(o.board('snake')).toEqual({ status: 'loading' });
    expect(o.worldBest('snake')).toBeNull();
    expect(Date.now() - t0).toBeLessThan(20); // nothing blocks
    await o.flush();
    await new Promise((r) => setTimeout(r, 120));
    expect(o.board('snake')).toEqual({ status: 'offline' });
    expect(o.worldBest('snake')).toBeNull();
    expect(readOutbox(outboxFile)).toEqual([entry(1)]);
    expect(o.account()).toEqual({ login: 'bob' });
  });

  it('board() is loading before any load, then ready with the server rows', async () => {
    signedIn();
    const tokens: (string | undefined)[] = [];
    const top = [{ rank: 1, login: 'amy', score: 9, at: '2026-11-20T10:00:00.000Z' }];
    const o = make({
      api: fakeApi({ board: async (_g: string, token?: string) => (tokens.push(token), ok({ top, me: { rank: 4, score: 2 } })) }),
    });
    expect(o.board('tetris')).toEqual({ status: 'loading' });
    o.loadBoard('tetris');
    expect(o.board('tetris')).toEqual({ status: 'loading' });
    await settle();
    expect(o.board('tetris')).toEqual({ status: 'ready', top, me: { rank: 4, score: 2 } });
    expect(tokens).toEqual(['tok']);
  });

  it('refreshWorldBest is throttled to once per 60 s and asks only for the given games', async () => {
    let calls = 0;
    const asked: string[][] = [];
    const o = make({
      api: fakeApi({ boards: async (games: string[]) => (calls++, asked.push(games), ok({ snake: { login: 'amy', score: 42 } })) }),
    });
    expect(o.worldBest('snake')).toBeNull();
    o.refreshWorldBest(1_000, ['snake', 'tetris']);
    await settle();
    expect(o.worldBest('snake')).toEqual({ login: 'amy', score: 42 });
    expect(o.worldBest('tetris')).toBeNull();
    o.refreshWorldBest(1_000 + 59_999, ['snake']);
    expect(calls).toBe(1);
    o.refreshWorldBest(1_000 + 60_000, ['snake']);
    expect(calls).toBe(2);
    expect(asked).toEqual([['snake', 'tetris'], ['snake']]);
  });

  it('refreshWorldBest with no games asks nothing', async () => {
    let calls = 0;
    const o = make({ api: fakeApi({ boards: async () => (calls++, ok({})) }) });
    o.refreshWorldBest(0, []);
    await settle();
    expect(calls).toBe(0);
  });

  it('a failed refresh keeps the last known world bests', async () => {
    let n = 0;
    const o = make({
      api: fakeApi({ boards: async () => (n++ === 0 ? ok({ snake: { login: 'amy', score: 42 } }) : fail('network')) }),
    });
    o.refreshWorldBest(0, ['snake']);
    await settle();
    o.refreshWorldBest(60_000, ['snake']);
    await settle();
    expect(o.worldBest('snake')).toEqual({ login: 'amy', score: 42 });
  });

  it('signOut(true) deletes online scores, then clears the account on success (or 401: already gone)', async () => {
    for (const answer of [ok(null), fail(401)] as ApiResult<null>[]) {
      signedIn();
      writeOutbox(outboxFile, [entry(1)]);
      const order: string[] = [];
      let finishDelete!: (r: ApiResult<null>) => void;
      const o = make({
        api: fakeApi({
          submit: async () => fail(503),
          deleteMe: (token: string) => {
            order.push(`delete ${token}`);
            return new Promise((r) => (finishDelete = r));
          },
        }),
      });
      await settle();
      o.signOut(true);
      expect(order).toEqual(['delete tok']);
      // Still signed in until the server answers.
      expect(o.account()).toEqual({ login: 'bob' });
      expect(o.accountMessage()).toBe('Deleting your online scores...');
      o.signOut(true); // a second request while one is running is ignored
      expect(order).toEqual(['delete tok']);
      finishDelete(answer);
      await settle();
      expect(o.account()).toBeNull();
      expect(o.accountMessage()).toBeNull();
      expect(loadAccount(accountFile)).toBeNull();
      expect(readOutbox(outboxFile)).toEqual([]);
    }
  });

  it('a failed delete keeps the account and outbox and says why', async () => {
    const cases: [ApiResult<null>, string][] = [
      [fail('network'), "Couldn't reach the score server. Your scores were not deleted."],
      [fail(500), "Couldn't reach the score server. Your scores were not deleted."],
      [fail(429), "Couldn't reach the score server. Your scores were not deleted."],
      [fail(403), 'This account is blocked. Ask the admin to delete your scores.'],
    ];
    for (const [answer, message] of cases) {
      signedIn();
      writeOutbox(outboxFile, [entry(1)]);
      const o = make({ api: fakeApi({ submit: async () => fail(503), deleteMe: async () => answer }) });
      await settle();
      o.signOut(true);
      await settle();
      expect(o.account()).toEqual({ login: 'bob' });
      expect(o.accountMessage()).toBe(message);
      expect(loadAccount(accountFile)).toEqual({ serverUrl: SERVER, token: 'tok', login: 'bob' });
      expect(readOutbox(outboxFile)).toEqual([entry(1)]);
      o.clearAccountMessage();
      expect(o.accountMessage()).toBeNull();
    }
  });

  it('no runs are sent while a delete is running', async () => {
    signedIn();
    let finishDelete!: (r: ApiResult<null>) => void;
    const sent: number[] = [];
    const o = make({
      api: fakeApi({
        submit: async (_t: string, e: OutboxEntry) => (sent.push(e.score), ok({ best: 1, rank: 1 })),
        deleteMe: () => new Promise((r) => (finishDelete = r)),
      }),
    });
    await settle();
    o.signOut(true);
    o.recordRun('snake', 7, new Date());
    await settle();
    expect(sent).toEqual([]);
    finishDelete(fail('network'));
    await settle();
    await o.flush();
    expect(sent).toEqual([7]);
  });

  it('signOut(false) ends the server session and clears the account without deleting scores', async () => {
    signedIn();
    let deletes = 0;
    const ended: string[] = [];
    const o = make({
      api: fakeApi({
        deleteMe: async () => (deletes++, ok(null)),
        submit: async () => fail(503),
        signOutSession: (token: string) => (ended.push(token), new Promise(() => {})), // never answers
      }),
    });
    o.signOut(false);
    expect(ended).toEqual(['tok']);
    expect(loadAccount(accountFile)).toBeNull(); // does not wait for the server
    await settle();
    expect(deletes).toBe(0);
    expect(o.account()).toBeNull();
    expect(loadAccount(accountFile)).toBeNull();
  });

  it('the constructor retries the outbox once', async () => {
    signedIn();
    writeOutbox(outboxFile, [entry(1), entry(2)]);
    const sent: number[] = [];
    make({ api: fakeApi({ submit: async (_t: string, e: OutboxEntry) => (sent.push(e.score), ok({ best: 1, rank: 1 })) }) });
    await settle();
    expect(sent).toEqual([1, 2]);
    expect(readOutbox(outboxFile)).toEqual([]);
  });

  it('an account saved for another server counts as signed out', async () => {
    saveAccount(accountFile, { serverUrl: 'https://other.test', token: 't', login: 'bob' });
    writeOutbox(outboxFile, [entry(1)]);
    let submits = 0;
    const o = make({ api: fakeApi({ submit: async () => (submits++, ok({ best: 1, rank: 1 })) }) });
    await settle();
    expect(o.account()).toBeNull();
    expect(submits).toBe(0);
  });

  it('unwritable files never throw from any method', async () => {
    // A directory where the files should be makes every read and write fail.
    fs.mkdirSync(accountFile);
    fs.mkdirSync(outboxFile);
    const o = make({
      api: fakeApi({ login: async () => ok({ token: 's', login: 'x' }), deleteMe: async () => ok(null) }),
      fetchFn: githubFetch([{ access_token: 'g' }]),
    });
    o.recordRun('snake', 1, new Date());
    o.startSignIn();
    await settle();
    expect(o.signIn()).toEqual({ phase: 'done', login: 'x' });
    o.recordRun('snake', 1, new Date());
    await o.flush();
    o.signOut(true);
    await settle();
    expect(o.account()).toBeNull();
  });

  it('a throwing api never makes sign-out throw', async () => {
    signedIn();
    const boom = () => { throw new Error('boom'); };
    const o = make({ api: fakeApi({ signOutSession: boom, submit: async () => fail(503) }) });
    expect(() => o.signOut(false)).not.toThrow();
    expect(o.account()).toBeNull();
    signedIn();
    const o2 = make({ api: fakeApi({ deleteMe: boom, submit: async () => fail(503) }) });
    expect(() => o2.signOut(true)).not.toThrow();
    await settle();
    expect(o2.account()).toEqual({ login: 'bob' });
    expect(o2.accountMessage()).toBe("Couldn't reach the score server. Your scores were not deleted.");
  });
});
