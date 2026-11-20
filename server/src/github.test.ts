import { describe, expect, test } from 'vitest';
import { verifyGithubToken } from './github';

describe('verifyGithubToken', () => {
  test('cancels the response body when GitHub does not answer 200', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const fetchFn = (async () => new Response(body, { status: 401 })) as typeof fetch;
    expect(await verifyGithubToken('t', fetchFn)).toBeNull();
    expect(cancelled).toBe(true);
  });

  test('returns id and login on 200', async () => {
    const fetchFn = (async () => Response.json({ id: 7, login: 'al' })) as typeof fetch;
    expect(await verifyGithubToken('t', fetchFn)).toEqual({ id: 7, login: 'al' });
  });
});
