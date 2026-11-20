import { describe, it, expect } from 'vitest';
import { Api } from './api';

type Call = { url: string; init: RequestInit };
function fake(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

describe('Api', () => {
  it('submit sends Bearer token and JSON body, returns best and rank', async () => {
    const calls: Call[] = [];
    const api = new Api('https://x.test', fake(200, { best: 9, rank: 2 }, calls));
    const r = await api.submit('tok', { game: 'snake', score: 9, at: 'now' });
    expect(r).toEqual({ ok: true, value: { best: 9, rank: 2 } });
    expect(calls[0].url).toBe('https://x.test/v1/scores');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ game: 'snake', score: 9, at: 'now' });
  });

  it('login, board, boards and deleteMe map the server shapes', async () => {
    expect(await new Api('https://x.test', fake(200, { token: 't', login: 'bob' })).login('gh')).toEqual({
      ok: true,
      value: { token: 't', login: 'bob' },
    });
    const calls: Call[] = [];
    const top = [{ rank: 1, login: 'a', score: 5, at: 'z' }];
    const b = await new Api('https://x.test', fake(200, { game: 'snake', top, me: null }, calls)).board('snake', 'tok');
    expect(b).toEqual({ ok: true, value: { top, me: null } });
    expect(calls[0].url).toBe('https://x.test/v1/boards/snake');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(await new Api('https://x.test', fake(200, { boards: { snake: { login: 'a', score: 5 } } })).boards(['snake'])).toEqual({
      ok: true,
      value: { snake: { login: 'a', score: 5 } },
    });
    const dcalls: Call[] = [];
    expect(await new Api('https://x.test', fake(204, null, dcalls)).deleteMe('tok')).toEqual({ ok: true, value: null });
    expect(dcalls[0].init.method).toBe('DELETE');
    expect(dcalls[0].url).toBe('https://x.test/v1/me');
  });

  it('a non-2xx answer is {ok:false,status}', async () => {
    const api = new Api('https://x.test', fake(401, { error: 'no' }));
    expect(await api.submit('t', { game: 'g', score: 1, at: 'a' })).toEqual({ ok: false, status: 401 });
    expect(await api.boards(['g'])).toEqual({ ok: false, status: 401 });
  });

  it('a thrown fetch or a hang past timeoutMs is {ok:false,status:"network"}', async () => {
    const thrower = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await new Api('https://x.test', thrower).boards(['g'])).toEqual({ ok: false, status: 'network' });
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as unknown as typeof fetch;
    expect(await new Api('https://x.test', hang, 50).boards(['g'])).toEqual({ ok: false, status: 'network' });
  });

  it('a 200 with an unexpected body is not a success', async () => {
    const api = new Api('https://x.test', fake(200, { nope: 1 }));
    expect(await api.submit('t', { game: 'g', score: 1, at: 'a' })).toEqual({ ok: false, status: 'network' });
  });

  it('board keeps only well-formed rows and a well-formed me', async () => {
    const good = { rank: 1, login: 'ok', score: 5, at: '2026-11-20T10:00:00.000Z' };
    const top = [
      null, { login: 1, score: 'x' }, good,
      { rank: 2, login: 'has space', score: 3, at: 'a' }, { rank: 3, login: 'x'.repeat(40), score: 3, at: 'a' },
      { rank: 4, login: 'evil[2J', score: 3, at: 'a' }, { rank: 5, login: 'neg', score: -1, at: 'a' },
      { rank: 6, login: 'frac', score: 1.5, at: 'a' }, { rank: 1.5, login: 'r', score: 1, at: 'a' },
      { rank: 7, login: 'big', score: 2 ** 53, at: 'a' }, 'row',
    ];
    const r = await new Api('https://x.test', fake(200, { top, me: { rank: 'x', score: 1 } })).board('snake');
    expect(r).toEqual({ ok: true, value: { top: [good], me: null } });
    for (const me of [{ rank: 1.5, score: 1 }, { rank: 1, score: '2' }, 'me', 7, { rank: -1, score: 1 }]) {
      const m = await new Api('https://x.test', fake(200, { top: [], me })).board('snake');
      expect(m).toEqual({ ok: true, value: { top: [], me: null } });
    }
    const m = await new Api('https://x.test', fake(200, { top: [], me: { rank: 3, score: 9, extra: 1 } })).board('snake');
    expect(m).toEqual({ ok: true, value: { top: [], me: { rank: 3, score: 9 } } });
  });

  it('boards drops bad entries and asks only for the given games', async () => {
    const boards = {
      snake: { login: 'a', score: 5 },
      bad1: { login: 'a b', score: 5 },
      bad2: { login: 'a', score: -2 },
      bad3: null,
      bad4: { login: 7, score: 1 },
      bad5: { login: 'a', score: 'x' },
      Bad_Key: { login: 'a', score: 1 },
    };
    const calls: Call[] = [];
    const r = await new Api('https://x.test', fake(200, { boards }, calls)).boards(['snake', 'tank-duel']);
    expect(r).toEqual({ ok: true, value: { snake: { login: 'a', score: 5 } } });
    expect(calls[0].url).toBe('https://x.test/v1/boards?games=snake,tank-duel');
    expect(await new Api('https://x.test', fake(200, { boards: [1] })).boards(['snake'])).toEqual({ ok: false, status: 'network' });
  });

  it('signOutSession sends DELETE /v1/session with the token and never rejects', async () => {
    const calls: Call[] = [];
    expect(await new Api('https://x.test', fake(204, null, calls)).signOutSession('tok')).toEqual({ ok: true, value: null });
    expect(calls[0].url).toBe('https://x.test/v1/session');
    expect(calls[0].init.method).toBe('DELETE');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const thrower = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await new Api('https://x.test', thrower).signOutSession('tok')).toEqual({ ok: false, status: 'network' });
  });
});
