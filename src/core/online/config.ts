// Both stay empty until the Nexios GitHub OAuth App and server exist; the online UI is hidden until then.
export const SERVER_URL = '';
export const GITHUB_CLIENT_ID = '';

export function onlineConfig(env: NodeJS.ProcessEnv): { serverUrl: string; clientId: string } | null {
  const serverUrl = (env.TIME_WASTER_SERVER || SERVER_URL).replace(/\/+$/, '');
  const clientId = env.TIME_WASTER_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID;
  return serverUrl && clientId ? { serverUrl, clientId } : null;
}
