import type { OutboxEntry } from './store';

export type BoardRow = { rank: number; login: string; score: number; at: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number | 'network' };

const NETWORK = { ok: false, status: 'network' } as const;

// Everything from the server is checked before use: a bad row is dropped, never drawn.
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
const GAME_RE = /^[a-z0-9-]{1,32}$/;
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isLogin = (v: unknown): v is string => typeof v === 'string' && LOGIN_RE.test(v);

function boardRow(r: any): BoardRow | null {
  if (!count(r?.rank) || !count(r?.score) || !isLogin(r?.login)) return null;
  return { rank: r.rank, login: r.login, score: r.score, at: typeof r.at === 'string' ? r.at : '' };
}

function rankAndScore(me: any): { rank: number; score: number } | null {
  return count(me?.rank) && count(me?.score) ? { rank: me.rank, score: me.score } : null;
}

function worldBests(boards: unknown): Record<string, { login: string; score: number }> | null {
  if (typeof boards !== 'object' || boards === null || Array.isArray(boards)) return null;
  const out: Record<string, { login: string; score: number }> = {};
  for (const [game, b] of Object.entries(boards as Record<string, any>)) {
    if (GAME_RE.test(game) && isLogin(b?.login) && count(b?.score)) out[game] = { login: b.login, score: b.score };
  }
  return out;
}

export class Api {
  private readonly base: string;

  constructor(
    serverUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 5000,
  ) {
    this.base = serverUrl.replace(/\/+$/, '');
  }

  // Never rejects: network errors, timeouts and unexpected bodies all become a failed result.
  private async call<T>(
    method: string,
    route: string,
    opts: { token?: string; body?: unknown; map: (json: any) => T | null },
  ): Promise<ApiResult<T>> {
    try {
      const headers: Record<string, string> = {};
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await this.fetchFn(this.base + route, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const json = res.status === 204 ? null : await res.json();
      const value = opts.map(json);
      return value === null && res.status !== 204 ? NETWORK : { ok: true, value: value as T };
    } catch {
      return NETWORK;
    }
  }

  login(githubToken: string): Promise<ApiResult<{ token: string; login: string }>> {
    return this.call('POST', '/v1/login', {
      body: { githubToken },
      map: (j) => (typeof j?.token === 'string' && typeof j?.login === 'string' ? { token: j.token, login: j.login } : null),
    });
  }

  submit(token: string, e: OutboxEntry): Promise<ApiResult<{ best: number; rank: number }>> {
    return this.call('POST', '/v1/scores', {
      token,
      body: { game: e.game, score: e.score, at: e.at },
      map: (j) => (typeof j?.best === 'number' && typeof j?.rank === 'number' ? { best: j.best, rank: j.rank } : null),
    });
  }

  board(
    game: string,
    token?: string,
  ): Promise<ApiResult<{ top: BoardRow[]; me: { rank: number; score: number } | null }>> {
    return this.call('GET', `/v1/boards/${encodeURIComponent(game)}`, {
      token,
      map: (j) =>
        Array.isArray(j?.top)
          ? { top: (j.top as unknown[]).map(boardRow).filter((r): r is BoardRow => r !== null), me: rankAndScore(j.me) }
          : null,
    });
  }

  /** World bests for `games` only (the server takes up to 50 ids). */
  boards(games: string[]): Promise<ApiResult<Record<string, { login: string; score: number }>>> {
    return this.call('GET', `/v1/boards?games=${games.map(encodeURIComponent).join(',')}`, {
      map: (j) => worldBests(j?.boards),
    });
  }

  /** Ends this session on the server (sign-out). */
  signOutSession(token: string): Promise<ApiResult<null>> {
    return this.call('DELETE', '/v1/session', { token, map: () => null });
  }

  deleteMe(token: string): Promise<ApiResult<null>> {
    return this.call('DELETE', '/v1/me', { token, map: () => null });
  }
}
