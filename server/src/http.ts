import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  board, createSession, deletePlayer, playerForToken, submitScore, upsertPlayer, worldBests, type Db,
} from './db';
import { verifyGithubToken } from './github';
import {
  AT_MAX_AGE_MS, AT_MAX_FUTURE_MS, BOARD_LIMIT, GAME_ID, MAX_BODY_BYTES, RATE, maxScoreFor,
} from './limits';
import { RateLimiter } from './ratelimit';

export type HandlerDeps = { db: Db; fetchFn: typeof fetch; now: () => Date; trustProxy: boolean };

type Reply = { status: number; body?: unknown };
class TooLarge extends Error {}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function send(res: ServerResponse, { status, body }: Reply, extra: Record<string, string> = {}): void {
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

function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0].trim();
  return first || req.socket.remoteAddress || 'unknown';
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
    if (!loginGlobalLimit.hit('*', ms)) return { status: 429, body: { error: 'too many logins' } };
    if (trustProxy && !loginIpLimit.hit(clientIp(req), ms)) return { status: 429, body: { error: 'too many logins' } };
    const gh = await verifyGithubToken(githubToken, fetchFn);
    if (!gh) return { status: 401, body: { error: 'GitHub rejected the token' } };
    if (!loginIdLimit.hit(String(gh.id), ms)) return { status: 429, body: { error: 'too many logins' } };
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
    return { status: 200, body: submitScore(db, player.id, body.game as string, body.score as number, at, date) };
  }

  async function route(req: IncomingMessage): Promise<Reply> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === '/v1/health') return { status: 200, body: { ok: true } };
    if (method === 'POST' && path === '/v1/login') return login(req);
    if (method === 'POST' && path === '/v1/scores') return scores(req);
    if (method === 'GET' && path === '/v1/boards') return { status: 200, body: { boards: worldBests(db) } };
    if (method === 'GET' && path.startsWith('/v1/boards/')) {
      const game = path.slice('/v1/boards/'.length);
      if (!GAME_ID.test(game)) return { status: 400, body: { error: 'bad game id' } };
      const me = sessionPlayer(req);
      const meId = me && !me.blocked ? me.id : undefined;
      return { status: 200, body: { game, ...board(db, game, BOARD_LIMIT, meId) } };
    }
    if (method === 'DELETE' && path === '/v1/me') {
      const player = sessionPlayer(req);
      if (!player) return { status: 401, body: { error: 'sign in required' } };
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
