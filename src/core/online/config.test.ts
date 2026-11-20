import { describe, it, expect } from 'vitest';
import { onlineConfig } from './config';

describe('onlineConfig', () => {
  it('is null while either value is empty and env overrides win', () => {
    expect(onlineConfig({})).toBeNull();
    expect(onlineConfig({ TIME_WASTER_SERVER: 'https://x.test' })).toBeNull();
    expect(onlineConfig({ TIME_WASTER_GITHUB_CLIENT_ID: 'abc' })).toBeNull();
    expect(onlineConfig({ TIME_WASTER_SERVER: 'https://x.test/', TIME_WASTER_GITHUB_CLIENT_ID: 'abc' })).toEqual({
      serverUrl: 'https://x.test',
      clientId: 'abc',
    });
  });
});
