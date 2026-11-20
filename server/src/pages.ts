import { createHash } from 'node:crypto';
import { LEADER, fill } from '../../src/core/heckles';
import { games as registry } from '../../src/games/registry.generated';
import type { BoardRow, WebRow } from './db';

declare const PLAY_JS_HASH: string | undefined;
/** Content hash of the browser bundle, set by scripts/build-server.mjs; 'dev' in tests. */
const PLAY_HASH = typeof PLAY_JS_HASH === 'string' ? PLAY_JS_HASH : 'dev';

export type GameInfo = { id: string; title: string };

/** The games bundled at build time, sorted by title. */
export function knownGames(): GameInfo[] {
  return registry.map((g) => ({ id: g.id, title: g.title })).sort((a, b) => a.title.localeCompare(b.title));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** A passive-aggressive line about the leader; the same leader and score always get the same line. */
export function leaderQuote(game: string, leader: string, score: number): string {
  const n = createHash('sha256').update(`${game}:${leader}:${score}`).digest().readUInt32BE(0);
  return fill(LEADER[n % LEADER.length], { score, best: score, game, time: '', leader });
}

const STYLE = `
:root { color-scheme: dark; --bg:#0b0f14; --panel:#111821; --line:#233040; --text:#d7e0ea; --dim:#7d8b99;
  --accent:#4fd1c5; --gold:#f6c945; --magenta:#e879f9; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
main { max-width:720px; margin:0 auto; padding:24px 16px 48px; }
header a { color:var(--accent); text-decoration:none; }
h1 { font-size:1.5rem; margin:8px 0 4px; letter-spacing:.04em; }
.sub { color:var(--dim); margin:0 0 24px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:4px 0; }
.row { display:grid; grid-template-columns:3.5ch 1fr auto; gap:12px; padding:10px 16px; align-items:baseline; border-top:1px solid var(--line); }
.row:first-child { border-top:0; }
.rank { color:var(--dim); text-align:right; }
.score { font-variant-numeric:tabular-nums; }
.leader .rank, .leader .score { color:var(--gold); }
.leader .who { color:var(--gold); font-weight:700; }
.quote { grid-column:2 / -1; color:var(--magenta); font-style:italic; margin-top:2px; }
a.game { display:grid; grid-template-columns:1fr auto; gap:12px; padding:12px 16px; border-top:1px solid var(--line); color:var(--text); text-decoration:none; }
a.game:first-child { border-top:0; }
a.game:hover, a.game:focus-visible { background:#16202b; outline:none; }
.best { color:var(--dim); text-align:right; }
.best b { color:var(--gold); font-weight:400; }
.empty { padding:16px; color:var(--dim); }
footer { margin-top:32px; color:var(--dim); font-size:.875rem; }
footer code { color:var(--text); }
footer a { color:var(--accent); }
.play-link { color:var(--accent); text-decoration:none; white-space:nowrap; }
.game-row { display:grid; grid-template-columns:1fr auto auto; gap:16px; padding:12px 16px; border-top:1px solid var(--line); align-items:baseline; }
.game-row:first-child { border-top:0; }
.game-row a.title { color:var(--text); text-decoration:none; }
.game-row a.title:hover, .game-row a.title:focus-visible { color:var(--accent); }
h2 { font-size:1.1rem; margin:28px 0 8px; }
.actions { margin:0 0 20px; }
.grid { background:#000; border:1px solid var(--line); border-radius:6px; padding:8px; margin:0; overflow-x:auto;
  font:15px/1.15 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; outline:none; }
.grid:focus-visible { border-color:var(--accent); }
.status { color:var(--dim); margin:8px 0 12px; min-height:1.5em; white-space:pre-wrap; }
#save { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:0 0 8px; }
#save[hidden] { display:none; }
#save input { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:6px 10px; font:inherit; }
#save button { background:var(--accent); color:#04131a; border:0; border-radius:6px; padding:7px 14px; font:inherit; cursor:pointer; }
#save button:disabled, #save input:disabled { opacity:.5; cursor:default; }
#save-msg { color:var(--dim); }
.c-black{color:#3b4252}.c-red{color:#cd3131}.c-green{color:#0dbc79}.c-yellow{color:#e5e510}
.c-blue{color:#2472c8}.c-magenta{color:#bc3fbc}.c-cyan{color:#11a8cd}.c-white{color:#e5e5e5}
.c-gray{color:#767676}.c-brightRed{color:#f14c4c}.c-brightGreen{color:#23d18b}.c-brightYellow{color:#f5f543}
.c-brightBlue{color:#3b8eea}.c-brightMagenta{color:#d670d6}.c-brightCyan{color:#29b8db}.c-brightWhite{color:#ffffff}
`;

function page(title: string, body: string, opts: { bodyAttrs?: string; tail?: string } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body${opts.bodyAttrs ? ' ' + opts.bodyAttrs : ''}>
<main>
<header><a href="/">◂ Time-waster arcade</a></header>
${body}
<footer>
Scores from the time-waster arcade, a terminal arcade for while Claude Code is busy.
Play: <code>/plugin marketplace add NexiosIT/time-waster</code> ·
<a href="https://github.com/NexiosIT/time-waster">GitHub</a>
</footer>
</main>${opts.tail ?? ''}
</body>
</html>
`;
}

export function renderIndex(games: GameInfo[], bests: Record<string, { login: string; score: number }>): string {
  const sorted = [...games].sort((a, b) => a.title.localeCompare(b.title));
  const rows = sorted
    .map((g) => {
      const b = bests[g.id];
      const best = b ? `<b>${b.score}</b> · ${escapeHtml(b.login)}` : 'No scores yet';
      const id = escapeHtml(g.id);
      return `<div class="game-row"><a class="title" href="/games/${id}">${escapeHtml(g.title)}</a><span class="best">${best}</span><a class="play-link" href="/play/${id}">▶ Play</a></div>`;
    })
    .join('\n');
  return page(
    'Time-waster high scores',
    `<h1>High scores</h1>
<p class="sub">Pick a game. Try not to be disappointed.</p>
<div class="card">
${rows || '<div class="empty">No games yet.</div>'}
</div>`,
  );
}

/** Rows of a web top 10, or the empty message. */
export function webRows(top: WebRow[]): string {
  if (!top.length) return '<div class="empty">No web scores yet.</div>';
  return top
    .map((r) => `<div class="row"><span class="rank">${r.rank}.</span><span class="who">${escapeHtml(r.name)}</span><span class="score">${r.score}</span></div>`)
    .join('\n');
}

export function renderPlay(game: GameInfo, webTop: WebRow[]): string {
  const id = escapeHtml(game.id);
  return page(
    `Play ${game.title} · Time-waster`,
    `<h1>${escapeHtml(game.title)}</h1>
<p class="actions"><a class="play-link" href="/games/${id}">Leaderboard</a></p>
<pre id="grid" class="grid" tabindex="0" aria-label="${escapeHtml(game.title)} game screen"></pre>
<div id="status" class="status" aria-live="polite">Loading…</div>
<form id="save" hidden>
<label for="name">Your name</label>
<input id="name" name="name" maxlength="20" autocomplete="nickname" spellcheck="false">
<button type="submit">Save score</button>
<span id="save-msg" aria-live="polite"></span>
</form>
<h2>Web top 10</h2>
<div id="web-board" class="card">
${webRows(webTop)}
</div>`,
    { bodyAttrs: `data-game="${id}"`, tail: `\n<script src="/assets/play.js?v=${escapeHtml(PLAY_HASH)}" defer></script>` },
  );
}

export function renderBoard(game: GameInfo, top: BoardRow[], webTop: WebRow[] = []): string {
  const rows = top
    .map((r, i) => {
      const quote = i === 0 ? `<div class="quote">${escapeHtml(leaderQuote(game.title, r.login, r.score))}</div>` : '';
      return `<div class="row${i === 0 ? ' leader' : ''}"><span class="rank">${r.rank}.</span><span class="who">${escapeHtml(r.login)}</span><span class="score">${r.score}</span>${quote}</div>`;
    })
    .join('\n');
  return page(
    `${game.title} · Time-waster high scores`,
    `<h1>${escapeHtml(game.title)}</h1>
<p class="sub">Top 10, best score per player.</p>
<p class="actions"><a class="play-link" href="/play/${escapeHtml(game.id)}">▶ Play in the browser</a></p>
<h2>Arcade</h2>
<div class="card">
${rows || '<div class="empty">No scores yet. The bar is on the floor.</div>'}
</div>
<h2>Web</h2>
<p class="sub">Typed names, not verified.</p>
<div class="card">
${webRows(webTop)}
</div>`,
  );
}

export function renderNotFound(): string {
  return page('Not found · Time-waster high scores', `<h1>Not found</h1>
<p class="sub">No such game. Maybe it was too hard for you too.</p>`);
}
