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
    expect(await new Api('https://x.test', fake(200, { boards: { snake: { login: 'a', score: 5 } } })).boards()).toEqual({
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
    expect(await api.boards()).toEqual({ ok: false, status: 401 });
  });

  it('a thrown fetch or a hang past timeoutMs is {ok:false,status:"network"}', async () => {
    const thrower = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await new Api('https://x.test', thrower).boards()).toEqual({ ok: false, status: 'network' });
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as unknown as typeof fetch;
    expect(await new Api('https://x.test', hang, 50).boards()).toEqual({ ok: false, status: 'network' });
  });

  it('a 200 with an unexpected body is not a success', async () => {
    const api = new Api('https://x.test', fake(200, { nope: 1 }));
    expect(await api.submit('t', { game: 'g', score: 1, at: 'a' })).toEqual({ ok: false, status: 'network' });
  });
});
