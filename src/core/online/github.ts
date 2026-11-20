const CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const TIMEOUT_MS = 5000;

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalS: number;
  expiresInS: number;
};

export type PollResult = { status: 'ok'; token: string } | { status: 'pending' | 'slow_down' | 'expired' | 'denied' | 'error' };

async function postForm(url: string, form: Record<string, string>, fetchFn: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function requestDeviceCode(clientId: string, fetchFn: typeof fetch = fetch): Promise<DeviceCode | null> {
  const j = await postForm(CODE_URL, { client_id: clientId, scope: '' }, fetchFn);
  if (
    typeof j?.device_code !== 'string' ||
    typeof j?.user_code !== 'string' ||
    typeof j?.verification_uri !== 'string' ||
    typeof j?.interval !== 'number' ||
    typeof j?.expires_in !== 'number'
  ) {
    return null;
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    intervalS: j.interval,
    expiresInS: j.expires_in,
  };
}

export async function pollDeviceToken(
  clientId: string,
  deviceCode: string,
  fetchFn: typeof fetch = fetch,
): Promise<PollResult> {
  const j = await postForm(
    TOKEN_URL,
    { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
    fetchFn,
  );
  if (typeof j?.access_token === 'string') return { status: 'ok', token: j.access_token };
  switch (j?.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down' };
    case 'expired_token':
      return { status: 'expired' };
    case 'access_denied':
      return { status: 'denied' };
    default:
      return { status: 'error' };
  }
}
