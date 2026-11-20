// Score server and the client id of the Nexios GitHub App (device flow). Public values, not secrets.
export const SERVER_URL = 'https://lobster-app-di8o6.ondigitalocean.app';
export const GITHUB_CLIENT_ID = 'Iv23liYZorBnLFMYLrsG';

export function onlineConfig(env: NodeJS.ProcessEnv): { serverUrl: string; clientId: string } | null {
  const serverUrl = (env.TIME_WASTER_SERVER || SERVER_URL).replace(/\/+$/, '');
  const clientId = env.TIME_WASTER_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID;
  return serverUrl && clientId ? { serverUrl, clientId } : null;
}
