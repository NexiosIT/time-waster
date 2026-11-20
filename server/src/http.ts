import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  board, createSession, deletePlayer, deleteSession, playerForToken, submitScore, upsertPlayer, worldBests, type Db,
} from './db';
import { verifyGithubToken } from './github';
import {
  AT_MAX_AGE_MS, AT_MAX_FUTURE_MS, BOARD_LIMIT, GAME_ID, MAX_BOARD_GAMES, MAX_BODY_BYTES, MAX_GITHUB_INFLIGHT, RATE,
  maxScoreFor,
} from './limits';
import { RateLimiter } from './ratelimit';
import { knownGames, renderBoard, renderIndex, renderNotFound } from './pages';

export type HandlerDeps = { db: Db; fetchFn: typeof fetch; now: () => Date; trustProxy: boolean };

/** `html` replies are pages; everything else is JSON. */
type Reply = { status: number; body?: unknown; html?: string };
class TooLarge extends Error {}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  // No scripts, no external anything: the pages are static HTML with inline styles.
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function send(res: ServerResponse, { status, body, html }: Reply, extra: Record<string, string> = {}): void {
  if (html !== undefined) {
    res.writeHead(status, { ...PAGE_HEADERS, ...extra });
    res.end(html);
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) return reject(new TooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        req.resume();
        reject(new TooLarge());
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const text = await readBody(req);
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

function bearerToken(req: IncomingMessage): string | null {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

/**
 * With TRUST_PROXY=1 exactly one trusted proxy is in front: the last X-Forwarded-For entry is the one it
 * added (the client's address); anything before it was sent by the client and may be forged.
 */
function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  const last = raw?.split(',').pop()?.trim();
  return last || req.socket.remoteAddress || 'unknown';
}

/** The game ids in `?games=a,b,c`, undefined when absent, or null when the list is invalid. */
function gamesParam(url: URL): string[] | null | undefined {
  const raw = url.searchParams.get('games');
  if (raw === null) return undefined;
  const ids = raw.split(',');
  if (ids.length > MAX_BOARD_GAMES || !ids.every((id) => GAME_ID.test(id))) return null;
  return ids;
}

/** Returns the error message for an invalid submission, or null if it may be stored. */
function invalidScore(body: Record<string, unknown>, nowMs: number): string | null {
  const { game, score, at } = body;
  if (typeof game !== 'string' || !GAME_ID.test(game)) return 'bad game id';
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0) return 'score must be a non-negative integer';
  if (score > maxScoreFor(game)) return 'score is above the maximum for this game';
  const atMs = typeof at === 'string' ? Date.parse(at) : NaN;
  if (Number.isNaN(atMs)) return 'bad at';
  if (atMs > nowMs + AT_MAX_FUTURE_MS) return 'at is in the future';
  if (atMs < nowMs - AT_MAX_AGE_MS) return 'at is too old';
  return null;
}

export function createHandler(deps: HandlerDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { db, fetchFn, now, trustProxy } = deps;
  const limit = (r: { limit: number; windowMs: number }) => new RateLimiter(r.limit, r.windowMs);
  const submitLimit = limit(RATE.submitPerPlayer);
  const loginIdLimit = limit(RATE.loginPerGithubId);
  const loginGlobalLimit = limit(RATE.loginGlobal);
  const loginIpLimit = limit(RATE.loginPerIp);
  let githubInFlight = 0;

  const sessionPlayer = (req: IncomingMessage) => {
    const token = bearerToken(req);
    return token ? playerForToken(db, sha256(token)) : null;
  };

  async function login(req: IncomingMessage): Promise<Reply> {
    const body = await readJson(req);
    const githubToken = body?.githubToken;
    if (typeof githubToken !== 'string' || githubToken === '') return { status: 400, body: { error: 'githubToken required' } };
    const date = now();
    const ms = date.getTime();
    if (trustProxy && !loginIpLimit.hit(clientIp(req), ms)) return { status: 429, body: { error: 'too many logins' } };
    if (githubInFlight >= MAX_GITHUB_INFLIGHT) return { status: 503, body: { error: 'busy, try again later' } };
    let gh: { id: number; login: string } | null;
    githubInFlight++;
    try {
      gh = await verifyGithubToken(githubToken, fetchFn);
    } catch {
      return { status: 502, body: { error: 'GitHub unreachable' } };
    } finally {
      githubInFlight--;
    }
    if (!gh) return { status: 401, body: { error: 'GitHub rejected the token' } };
    if (!loginIdLimit.hit(String(gh.id), ms)) return { status: 429, body: { error: 'too many logins' } };
    // Global limit counts only logins GitHub accepted, so junk tokens cannot lock everyone out.
    if (!loginGlobalLimit.hit('*', ms)) return { status: 429, body: { error: 'too many logins' } };
    if (upsertPlayer(db, gh, date).blocked) return { status: 403, body: { error: 'blocked' } };
    const token = randomBytes(32).toString('base64url');
    createSession(db, gh.id, sha256(token), date);
    return { status: 200, body: { token, login: gh.login } };
  }

  async function scores(req: IncomingMessage): Promise<Reply> {
    const player = sessionPlayer(req);
    if (!player) return { status: 401, body: { error: 'sign in required' } };
    if (player.blocked) return { status: 403, body: { error: 'blocked' } };
    const date = now();
    if (!submitLimit.hit(String(player.id), date.getTime())) return { status: 429, body: { error: 'too many submissions' } };
    const body = await readJson(req);
    if (!body) return { status: 400, body: { error: 'bad body' } };
    const error = invalidScore(body, date.getTime());
    if (error) return { status: 400, body: { error } };
    const at = new Date(body.at as string).toISOString();
    const result = submitScore(db, player.id, body.game as string, body.score as number, at, date);
    // null: the player was deleted while the body was being read.
    if (!result) return { status: 401, body: { error: 'sign in required' } };
    return { status: 200, body: result };
  }

  async function route(req: IncomingMessage): Promise<Reply> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/v1/health') return { status: 200, body: { ok: true } };
    if (method === 'GET' && path === '/') {
      const games = knownGames();
      return { status: 200, html: renderIndex(games, games.length ? worldBests(db, games.map((g) => g.id)) : {}) };
    }
    if (method === 'GET' && path.startsWith('/games/')) {
      const game = knownGames().find((g) => g.id === path.slice('/games/'.length));
      if (!game) return { status: 404, html: renderNotFound() };
      return { status: 200, html: renderBoard(game, board(db, game.id, BOARD_LIMIT).top) };
    }
    if (method === 'POST' && path === '/v1/login') return login(req);
    if (method === 'POST' && path === '/v1/scores') return scores(req);
    if (method === 'GET' && path === '/v1/boards') {
      const games = gamesParam(url);
      if (games === null) return { status: 400, body: { error: `games must be 1 to ${MAX_BOARD_GAMES} game ids` } };
      return { status: 200, body: { boards: worldBests(db, games) } };
    }
    if (method === 'GET' && path.startsWith('/v1/boards/')) {
      const game = path.slice('/v1/boards/'.length);
      if (!GAME_ID.test(game)) return { status: 400, body: { error: 'bad game id' } };
      const me = sessionPlayer(req);
      const meId = me && !me.blocked ? me.id : undefined;
      return { status: 200, body: { game, ...board(db, game, BOARD_LIMIT, meId) } };
    }
    if (method === 'DELETE' && path === '/v1/session') {
      const token = bearerToken(req);
      if (!token || !deleteSession(db, sha256(token))) return { status: 401, body: { error: 'sign in required' } };
      return { status: 204 };
    }
    if (method === 'DELETE' && path === '/v1/me') {
      const player = sessionPlayer(req);
      if (!player) return { status: 401, body: { error: 'sign in required' } };
      if (player.blocked) return { status: 403, body: { error: 'blocked; ask the admin to erase your data' } };
      deletePlayer(db, player.id);
      return { status: 204 };
    }
    return { status: 404, body: { error: 'not found' } };
  }

  return (req, res) => {
    route(req).then(
      (reply) => send(res, reply),
      (err: unknown) => {
        if (err instanceof TooLarge) send(res, { status: 413, body: { error: 'body too large' } }, { connection: 'close' });
        else send(res, { status: 500, body: { error: 'internal error' } });
      },
    );
  };
}
