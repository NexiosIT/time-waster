import { describe, it, expect } from 'vitest';
import { requestDeviceCode, pollDeviceToken } from './github';

type Call = { url: string; init: RequestInit };
function fake(body: unknown, calls: Call[] = [], status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}
const thrower = (async () => {
  throw new Error('x');
}) as unknown as typeof fetch;

describe('github device flow', () => {
  it('requestDeviceCode maps the GitHub response', async () => {
    const calls: Call[] = [];
    const r = await requestDeviceCode(
      'cid',
      fake(
        { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 },
        calls,
      ),
    );
    expect(r).toEqual({
      deviceCode: 'dc',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      intervalS: 5,
      expiresInS: 900,
    });
    expect(calls[0].url).toBe('https://github.com/login/device/code');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe('application/json');
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('scope')).toBe('');
  });

  it('requestDeviceCode is null on failure or bad shape', async () => {
    expect(await requestDeviceCode('c', fake({}, [], 500))).toBeNull();
    expect(await requestDeviceCode('c', fake({ foo: 1 }))).toBeNull();
    expect(await requestDeviceCode('c', thrower)).toBeNull();
  });

  it('pollDeviceToken maps pending, slow_down, expired, denied and ok', async () => {
    const calls: Call[] = [];
    expect(await pollDeviceToken('cid', 'dc', fake({ access_token: 'gho_x' }, calls))).toEqual({ status: 'ok', token: 'gho_x' });
    expect(calls[0].url).toBe('https://github.com/login/oauth/access_token');
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('device_code')).toBe('dc');
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    const st = async (error: string) => (await pollDeviceToken('c', 'd', fake({ error }))).status;
    expect(await st('authorization_pending')).toBe('pending');
    expect(await st('slow_down')).toBe('slow_down');
    expect(await st('expired_token')).toBe('expired');
    expect(await st('access_denied')).toBe('denied');
    expect(await st('whatever')).toBe('error');
    expect(await pollDeviceToken('c', 'd', thrower)).toEqual({ status: 'error' });
  });
});
