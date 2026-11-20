import { Api, type ApiResult, type BoardRow } from './api';
import { pollDeviceToken, requestDeviceCode } from './github';
import {
  appendOutbox,
  clearAccount,
  loadAccount,
  readOutbox,
  saveAccount,
  writeOutbox,
  type Account,
  type OutboxEntry,
} from './store';

export type SignIn =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'code'; userCode: string; verificationUri: string }
  | { phase: 'done'; login: string }
  | { phase: 'failed'; message: string };

export type BoardView =
  | { status: 'loading' }
  | { status: 'ready'; top: BoardRow[]; me: { rank: number; score: number } | null }
  | { status: 'offline' };

/** Everything the arcade App uses. Every method returns at once; network work runs in the background. */
export interface OnlinePort {
  account(): { login: string } | null;
  worldBest(game: string): { login: string; score: number } | null;
  /** Fetches the world bests of `games` (the ids the arcade shows), at most once a minute. */
  refreshWorldBest(nowMs: number, games: string[]): void;
  loadBoard(game: string): void;
  board(game: string): BoardView;
  recordRun(game: string, score: number, at: Date): void;
  flush(): Promise<void>;
  signIn(): SignIn;
  startSignIn(): void;
  cancelSignIn(): void;
  /**
   * Signs out. With deleteScores, stays signed in until the server confirms the delete; if it fails,
   * the account and unsent runs are kept and accountMessage() says why.
   */
  signOut(deleteScores: boolean): void;
  /** A line for the account screen (delete in progress or failed), or null. */
  accountMessage(): string | null;
  /** Forgets a failed-delete message (the account screen calls this when it opens). */
  clearAccountMessage(): void;
}

const REFRESH_MS = 60_000;
const MAX_BOARD_GAMES = 50; // the server's limit for one GET /v1/boards
const DELETING = 'Deleting your online scores...';
const DELETE_FAILED = "Couldn't reach the score server. Your scores were not deleted.";
const DELETE_BLOCKED = 'This account is blocked. Ask the admin to delete your scores.';
const SLOW_DOWN_S = 5;

/** Swallows any error from a file operation; online state must never crash the arcade. */
function safely<T>(op: () => T, fallback: T): T {
  try {
    return op();
  } catch {
    return fallback;
  }
}

function sameEntry(a: OutboxEntry | undefined, b: OutboxEntry): boolean {
  return !!a && a.game === b.game && a.score === b.score && a.at === b.at;
}

/** Runs an Api call so that nothing escapes: a throw or rejection becomes a network failure. */
function background<T>(call: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return call().catch(() => NETWORK_FAIL);
  } catch {
    return Promise.resolve(NETWORK_FAIL);
  }
}
const NETWORK_FAIL = { ok: false, status: 'network' } as const;

function loginFailure(status: number | 'network'): string {
  if (status === 403) return 'This GitHub account is blocked';
  if (status === 429) return 'Too many sign-ins, try again later';
  return "Couldn't reach the score server";
}

/** Worth retrying later (kept in the outbox). Any other answer means sent or refused for good. */
function keep(status: number | 'network'): boolean {
  return status === 'network' || status === 429 || status >= 500;
}

export class Online implements OnlinePort {
  private readonly serverUrl: string;
  private readonly clientId: string;
  private readonly accountFile: string;
  private readonly outboxFile: string;
  private readonly api: Api;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  private acct: Account | null;
  private bests: Record<string, { login: string; score: number }> = {};
  private lastRefreshMs: number | null = null;
  private readonly boardViews = new Map<string, BoardView>();
  private readonly boardSeq = new Map<string, number>();
  private signInState: SignIn = { phase: 'idle' };
  private signInGen = 0;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private deleting: Account | null = null;
  private acctMessage: string | null = null;

  constructor(opts: {
    serverUrl: string;
    clientId: string;
    accountFile: string;
    outboxFile: string;
    api?: Api;
    fetchFn?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.serverUrl = opts.serverUrl;
    this.clientId = opts.clientId;
    this.accountFile = opts.accountFile;
    this.outboxFile = opts.outboxFile;
    this.fetchFn = opts.fetchFn;
    this.api = opts.api ?? new Api(opts.serverUrl, opts.fetchFn);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const saved = safely(() => loadAccount(this.accountFile), null);
    // A session belongs to the server that issued it.
    this.acct = saved && saved.serverUrl === this.serverUrl ? saved : null;
    void this.flush();
  }

  account(): { login: string } | null {
    return this.acct ? { login: this.acct.login } : null;
  }

  worldBest(game: string): { login: string; score: number } | null {
    const b = Object.hasOwn(this.bests, game) ? this.bests[game] : undefined;
    return b && typeof b.login === 'string' && typeof b.score === 'number' ? { login: b.login, score: b.score } : null;
  }

  refreshWorldBest(nowMs: number, games: string[]): void {
    if (!games.length) return;
    if (this.lastRefreshMs !== null && nowMs - this.lastRefreshMs < REFRESH_MS) return;
    this.lastRefreshMs = nowMs;
    background(() => this.api.boards(games.slice(0, MAX_BOARD_GAMES))).then((r) => {
      if (r.ok) this.bests = r.value;
    });
  }

  loadBoard(game: string): void {
    const seq = (this.boardSeq.get(game) ?? 0) + 1;
    this.boardSeq.set(game, seq);
    this.boardViews.set(game, { status: 'loading' });
    this.api.board(game, this.acct?.token).then(
      (r) => {
        if (this.boardSeq.get(game) !== seq) return; // a newer load owns the view
        this.boardViews.set(game, r.ok ? { status: 'ready', top: r.value.top, me: r.value.me } : { status: 'offline' });
      },
      () => {
        if (this.boardSeq.get(game) === seq) this.boardViews.set(game, { status: 'offline' });
      },
    );
  }

  board(game: string): BoardView {
    return this.boardViews.get(game) ?? { status: 'loading' };
  }

  recordRun(game: string, score: number, at: Date): void {
    if (!this.acct) return;
    safely(() => appendOutbox(this.outboxFile, { game, score, at: at.toISOString() }), undefined);
    // A flush already running may have read the outbox before this entry: give it one more pass.
    if (this.flushing) this.flushAgain = true;
    void this.flush();
  }

  flush(): Promise<void> {
    // One flush at a time; recordRun asks a running one for another pass.
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        do {
          this.flushAgain = false;
          await this.flushOnce();
        } while (this.flushAgain);
      } catch {
        // never surface background errors
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async flushOnce(): Promise<void> {
    const acct = this.acct;
    if (!acct) return;
    for (;;) {
      if (this.acct !== acct) return; // signed out meanwhile
      if (this.deleting) return; // runs wait until the delete is done (kept if it fails)
      const head = safely(() => readOutbox(this.outboxFile), [])[0];
      if (!head) return;
      const r = await this.api.submit(acct.token, head);
      if (this.acct !== acct) return;
      if (!r.ok && r.status === 401) {
        // Session revoked: drop it and the unsent runs, and stop.
        this.clearLocal();
        return;
      }
      if (!r.ok && keep(r.status)) return;
      // Re-read: recordRun may have appended while the request was out.
      const now = readOutbox(this.outboxFile);
      if (sameEntry(now[0], head)) writeOutbox(this.outboxFile, now.slice(1));
    }
  }

  signIn(): SignIn {
    return this.signInState;
  }

  startSignIn(): void {
    if (this.signInState.phase === 'starting' || this.signInState.phase === 'code') return;
    const gen = ++this.signInGen;
    this.signInState = { phase: 'starting' };
    this.runSignIn(gen).catch(() => {
      if (gen === this.signInGen) this.signInState = { phase: 'failed', message: "Couldn't reach GitHub" };
    });
  }

  private async runSignIn(gen: number): Promise<void> {
    const live = () => gen === this.signInGen;
    const failed = (message: string) => {
      if (live()) this.signInState = { phase: 'failed', message };
    };
    const code = await requestDeviceCode(this.clientId, this.fetchFn);
    if (!live()) return;
    if (!code) return failed("Couldn't reach GitHub");
    this.signInState = { phase: 'code', userCode: code.userCode, verificationUri: code.verificationUri };

    let intervalS = code.intervalS;
    let elapsedS = 0;
    for (;;) {
      await this.sleep(intervalS * 1000);
      if (!live()) return;
      elapsedS += intervalS;
      const poll = await pollDeviceToken(this.clientId, code.deviceCode, this.fetchFn);
      if (!live()) return;
      if (poll.status === 'ok') {
        const r = await this.api.login(poll.token);
        if (!live()) return;
        if (!r.ok) return failed(loginFailure(r.status));
        const acct: Account = { serverUrl: this.serverUrl, token: r.value.token, login: r.value.login };
        safely(() => saveAccount(this.accountFile, acct), undefined);
        this.acct = acct;
        this.signInState = { phase: 'done', login: acct.login };
        void this.flush();
        return;
      }
      if (poll.status === 'expired') return failed('Code expired');
      if (poll.status === 'denied') return failed('Sign-in denied');
      if (poll.status === 'error') return failed("Couldn't reach GitHub");
      if (poll.status === 'slow_down') intervalS += SLOW_DOWN_S;
      if (elapsedS >= code.expiresInS) return failed('Code expired');
    }
  }

  cancelSignIn(): void {
    this.signInGen++;
    this.signInState = { phase: 'idle' };
  }

  signOut(deleteScores: boolean): void {
    const acct = this.acct;
    if (!acct) return;
    if (!deleteScores) {
      this.acct = null; // signed out for the UI right away
      this.deleting = null;
      this.acctMessage = null;
      // End the session on the server too; nobody waits for the answer.
      void background(() => this.api.signOutSession(acct.token));
      this.clearFiles(acct);
      return;
    }
    if (this.deleting) return;
    this.deleting = acct;
    this.acctMessage = null;
    background(() => this.api.deleteMe(acct.token)).then((r) => {
      if (this.deleting !== acct) return; // signed out (S) meanwhile
      this.deleting = null;
      // 401: the session or account is already gone, which is what was asked for.
      if (r.ok || r.status === 401) {
        if (this.acct === acct) this.clearLocal();
        return;
      }
      this.acctMessage = r.status === 403 ? DELETE_BLOCKED : DELETE_FAILED;
      void this.flush(); // runs held back during the delete
    });
  }

  accountMessage(): string | null {
    return this.deleting ? DELETING : this.acctMessage;
  }

  clearAccountMessage(): void {
    this.acctMessage = null;
  }

  private clearLocal(): void {
    const acct = this.acct;
    this.acct = null;
    if (acct) this.clearFiles(acct);
  }

  /** Removes the saved session and unsent runs, unless a newer sign-in has replaced that session. */
  private clearFiles(acct: Account): void {
    if (this.acct && this.acct !== acct) return;
    safely(() => clearAccount(this.accountFile), undefined);
    safely(() => writeOutbox(this.outboxFile, []), undefined);
  }
}
