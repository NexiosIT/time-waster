import type { OutboxEntry } from './store';

export type BoardRow = { rank: number; login: string; score: number; at: string };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number | 'network' };

const NETWORK = { ok: false, status: 'network' } as const;

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
      map: (j) => (Array.isArray(j?.top) ? { top: j.top as BoardRow[], me: j.me ?? null } : null),
    });
  }

  boards(): Promise<ApiResult<Record<string, { login: string; score: number }>>> {
    return this.call('GET', '/v1/boards', {
      map: (j) => (typeof j?.boards === 'object' && j.boards !== null ? j.boards : null),
    });
  }

  deleteMe(token: string): Promise<ApiResult<null>> {
    return this.call('DELETE', '/v1/me', { token, map: () => null });
  }
}
