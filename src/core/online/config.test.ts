import { describe, it, expect } from 'vitest';
import { GITHUB_CLIENT_ID, SERVER_URL, onlineConfig } from './config';

describe('onlineConfig', () => {
  it('points at the Nexios score server and GitHub App by default', () => {
    expect(SERVER_URL).toBe('https://lobster-app-di8o6.ondigitalocean.app');
    expect(GITHUB_CLIENT_ID).toBe('Iv23liYZorBnLFMYLrsG');
    expect(onlineConfig({})).toEqual({ serverUrl: SERVER_URL, clientId: GITHUB_CLIENT_ID });
  });

  it('is null while either value is empty, from the constants or the environment', () => {
    const builtIn = SERVER_URL && GITHUB_CLIENT_ID ? { serverUrl: SERVER_URL, clientId: GITHUB_CLIENT_ID } : null;
    expect(onlineConfig({})).toEqual(builtIn);
    expect(onlineConfig({ TIME_WASTER_GITHUB_CLIENT_ID: 'abc' })).toEqual({ serverUrl: SERVER_URL, clientId: 'abc' });
  });

  it('environment overrides win and a trailing slash is stripped', () => {
    expect(onlineConfig({ TIME_WASTER_SERVER: 'https://x.test/', TIME_WASTER_GITHUB_CLIENT_ID: 'abc' })).toEqual({
      serverUrl: 'https://x.test',
      clientId: 'abc',
    });
  });
});
