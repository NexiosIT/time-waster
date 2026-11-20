"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/core/buffer.ts
var CellBuffer = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.chars = new Array(width * height).fill(" ");
    this.colors = new Array(width * height).fill("white");
  }
  width;
  height;
  chars;
  colors;
  get(x, y) {
    const i = y * this.width + x;
    return { ch: this.chars[i], color: this.colors[i] };
  }
  put(x, y, ch, color = "white") {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    this.chars[i] = ch;
    this.colors[i] = color;
  }
  text(x, y, s, color = "white") {
    let cx = x;
    for (const ch of s) this.put(cx++, y, ch, color);
  }
  clear() {
    this.chars.fill(" ");
    this.colors.fill("white");
  }
  blit(src, ox, oy) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y);
        this.put(ox + x, oy + y, c.ch, c.color);
      }
    }
  }
  rowText(y) {
    return this.chars.slice(y * this.width, (y + 1) * this.width).join("");
  }
};

// src/core/banner.ts
var BANNER_MS = 1e4;
var Banner = class {
  ev = null;
  pushedAt = 0;
  marker = false;
  push(ev, nowMs) {
    this.ev = ev;
    this.pushedAt = nowMs;
    this.marker = true;
  }
  view(nowMs) {
    const ev = this.ev;
    if (!ev) return null;
    if (nowMs - this.pushedAt < BANNER_MS) {
      const base = ev.type === "done" ? "\u2713 Claude is done" : "! Claude needs you";
      return { mode: "full", text: ev.project ? `${base} \u2014 ${ev.project}` : base };
    }
    if (!this.marker) return null;
    return { mode: "marker", text: ev.type === "done" ? "\u25CF Claude done" : "\u25CF Claude needs you" };
  }
  color() {
    return this.ev?.type === "attention" ? "brightYellow" : "brightGreen";
  }
  clearMarker() {
    this.marker = false;
  }
};

// src/core/random.ts
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/core/types.ts
var GAME_WIDTH = 60;
var GAME_HEIGHT = 20;
var MIN_COLS = 62;
var MIN_ROWS = 23;

// src/core/session.ts
var MAX_STEPS = 5;
var PAUSED_TEXT = "PAUSED \u2014 P to resume";
var TOO_SMALL_TEXT = "Make the window bigger";
var GameSession = class {
  constructor(game, opts) {
    this.game = game;
    this.random = createRandom(opts.seed);
    this.lastMs = opts.nowMs;
    this.guard(() => {
      this.state = this.game.init(this.ctx());
      this.refreshScore();
    });
  }
  game;
  status = "playing";
  error;
  score = 0;
  endedEarly = false;
  state;
  tooSmall = false;
  lastMs;
  elapsedMs = 0;
  acc = 0;
  random;
  key(k) {
    if (this.finished() || k === "ctrl-c") return;
    if (k === "escape") {
      this.end();
      return;
    }
    if (k === "p") {
      this.status = this.status === "paused" ? "playing" : "paused";
      return;
    }
    if (this.status !== "playing") return;
    this.guard(() => {
      this.state = this.game.onKey(this.state, k);
      this.refreshScore();
    });
  }
  tick(nowMs) {
    const dt = Math.max(0, nowMs - this.lastMs);
    this.lastMs = nowMs;
    if (this.finished() || this.status !== "playing" || this.tooSmall) return;
    this.elapsedMs += dt;
    this.acc += dt;
    const tickMs = this.game.tickMs;
    const due = Math.floor(this.acc / tickMs);
    const steps = Math.min(due, MAX_STEPS);
    this.acc = due > MAX_STEPS ? 0 : this.acc - steps * tickMs;
    this.guard(() => {
      for (let i = 0; i < steps; i++) {
        this.state = this.game.update(this.state, this.ctx());
        this.refreshScore();
        if (this.game.isOver(this.state)) {
          this.status = "over";
          return;
        }
      }
      if (steps === 0 && this.game.isOver(this.state)) this.status = "over";
    });
  }
  /** Time actually played, excluding pauses and too-small stalls. */
  get playedMs() {
    return this.elapsedMs;
  }
  setTooSmall(tooSmall) {
    this.tooSmall = tooSmall;
  }
  end() {
    if (this.finished()) return;
    this.endedEarly = true;
    this.status = "over";
  }
  draw(screen) {
    screen.clear();
    if (this.status === "crashed") return;
    this.guard(() => this.game.draw(this.state, screen));
    if (this.finished() && this.error !== void 0) {
      screen.clear();
      return;
    }
    const overlay = this.tooSmall ? TOO_SMALL_TEXT : this.status === "paused" ? PAUSED_TEXT : null;
    if (overlay) {
      screen.text(
        Math.floor((GAME_WIDTH - overlay.length) / 2),
        Math.floor(GAME_HEIGHT / 2),
        overlay,
        "brightYellow"
      );
    }
  }
  finished() {
    return this.status === "over" || this.status === "crashed";
  }
  ctx() {
    return { random: this.random, elapsedMs: this.elapsedMs };
  }
  refreshScore() {
    const s = this.game.score(this.state);
    if (typeof s !== "number" || !Number.isFinite(s)) throw new Error("invalid score");
    this.score = s;
  }
  guard(fn) {
    try {
      fn();
    } catch (e) {
      this.status = "crashed";
      this.error = e instanceof Error ? e.message : String(e);
    }
  }
};

// src/core/jsonfile.ts
var import_node_fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var RENAME_TRIES = 5;
var RENAME_DELAY_MS = 20;
var TRANSIENT = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function withRetry(op) {
  for (let attempt = 1; ; attempt++) {
    try {
      return op();
    } catch (err) {
      const code = err.code;
      if (!code || !TRANSIENT.has(code) || attempt >= RENAME_TRIES) throw err;
      sleepSync(RENAME_DELAY_MS);
    }
  }
}
function readText(file) {
  try {
    return withRetry(() => import_node_fs.default.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
function parse(text, isValid3) {
  try {
    const data = JSON.parse(text);
    return isValid3(data) ? data : null;
  } catch {
    return null;
  }
}
function loadJson(file, isValid3) {
  const text = readText(file);
  if (text === null) return null;
  const data = parse(text, isValid3);
  if (data) return data;
  const again = readText(file);
  if (again === null) return null;
  if (again !== text) return parse(again, isValid3);
  try {
    import_node_fs.default.renameSync(file, file + ".bak");
  } catch {
  }
  return null;
}
function writeAtomic(file, data) {
  writeTextAtomic(file, JSON.stringify(data, null, 2));
}
function writeTextAtomic(file, text) {
  import_node_fs.default.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    import_node_fs.default.writeFileSync(tmp, text);
    withRetry(() => import_node_fs.default.renameSync(tmp, file));
  } catch (err) {
    try {
      import_node_fs.default.rmSync(tmp, { force: true });
    } catch {
    }
    throw err;
  }
}

// src/core/runs.ts
var RUNS_KEPT = 20;
function isValid(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return Object.values(data).every(
    (list) => Array.isArray(list) && list.every(
      (e) => typeof e === "object" && e !== null && typeof e.ms === "number" && Number.isFinite(e.ms) && e.ms >= 0 && typeof e.at === "string"
    )
  );
}
function loadRuns(file) {
  return loadJson(file, isValid) ?? {};
}
function addRun(file, gameId, ms, at = /* @__PURE__ */ new Date()) {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`Invalid run time: ${ms}`);
  const all = loadRuns(file);
  const list = [...all[gameId] ?? [], { ms, at: at.toISOString() }].slice(-RUNS_KEPT);
  all[gameId] = list;
  writeAtomic(file, all);
  return list;
}

// src/core/task.ts
var TASK_MAX_AGE_MS = 30 * 6e4;
var OVERDUE_GRACE_MS = 10 * 6e4;
var TaskClock = class {
  task = null;
  // `at` of the newest start ever seen, so a later `done` cannot let an older start resurrect a task
  lastStartMs = -Infinity;
  apply(ev) {
    const t = Date.parse(ev.at);
    if (Number.isNaN(t)) return;
    if (ev.type === "start") {
      if (t > this.lastStartMs) {
        this.lastStartMs = t;
        this.task = { project: ev.project, startMs: t, estimateMs: null };
      }
    } else if (ev.type === "estimate") {
      if (this.task && ev.project === this.task.project && t >= this.task.startMs) {
        this.task.estimateMs = ev.minutes * 6e4;
      }
    } else if (ev.type === "done") {
      if (this.task && ev.project === this.task.project && t >= this.task.startMs) this.task = null;
    }
  }
  view(nowMs) {
    const k = this.task;
    if (!k) return { state: "none" };
    if (k.estimateMs === null) return nowMs - k.startMs > TASK_MAX_AGE_MS ? { state: "none" } : { state: "estimating" };
    const leftMs = k.startMs + k.estimateMs - nowMs;
    if (-leftMs > OVERDUE_GRACE_MS) return { state: "none" };
    return leftMs > 0 ? { state: "running", leftMs } : { state: "overdue" };
  }
};

// src/core/length.ts
var NEW_MARGIN = 1.5;
var MIN_RUNS = 3;
var PERCENTILE = 0.75;
function expectedLength(length, runs) {
  const base = length.minutes * 6e4;
  if (length.kind === "timed") return { ms: base, basis: "timed", isNew: runs.length === 0 };
  if (runs.length < MIN_RUNS) return { ms: base * NEW_MARGIN, basis: "est", isNew: true };
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const ms = sorted[Math.ceil(PERCENTILE * sorted.length) - 1];
  return { ms, basis: "you", isNew: false };
}
function formatMinutes(ms) {
  return `~${Math.max(1, Math.ceil(ms / 6e4))} min`;
}
function suggest(games2, runs, leftMs) {
  if (leftMs <= 0) return null;
  const cands = [];
  for (const game of games2) {
    if (!game.length) continue;
    const list = runs[game.id] ?? [];
    const e = expectedLength(game.length, list);
    if (e.ms > leftMs) continue;
    cands.push({
      id: game.id,
      title: game.title,
      ms: e.ms,
      isNew: e.isNew,
      last: list.length ? list[list.length - 1].at : ""
    });
  }
  if (cands.length === 0) return null;
  const pool = cands.some((c) => c.isNew) ? cands.filter((c) => c.isNew) : cands;
  pool.sort(
    (a, b) => b.ms - a.ms || (a.last < b.last ? -1 : a.last > b.last ? 1 : 0) || a.title.localeCompare(b.title)
  );
  return pool[0].id;
}

// src/core/menu.ts
var TITLE_X = 2;
var TITLE_W = 25;
var LEN_X = 28;
var LEN_W = 14;
var NEW_X = 43;
var STAR_X = 47;
var BEST_X = 49;
var BEST_W = 11;
var ONLINE_BEST_X = 49;
var ONLINE_WORLD_X = 55;
var NUM_W = 5;
function taskLine(view, sugg) {
  switch (view.state) {
    case "none":
      return "";
    case "estimating":
      return "Claude: estimating\u2026";
    case "overdue":
      return "Claude is running over";
    case "running": {
      const left = `Claude ${formatMinutes(view.leftMs)} left`;
      if (!sugg) return left;
      const len = formatMinutes(sugg.expected.ms) + (sugg.expected.isNew ? ", new" : "");
      return `${left} \xB7 suggested: ${sugg.title} (${len})`;
    }
  }
}
function lengthLabel(e) {
  if (!e) return "";
  if (e.basis === "timed") return formatMinutes(e.ms).slice(1);
  return `${formatMinutes(e.ms)} (${e.basis === "you" ? "you" : "est."})`;
}
function rowSegments(r) {
  const segs = [
    { x: TITLE_X, text: clip(`${r.selected ? "> " : "  "}${r.title}`, TITLE_W), color: r.selected ? "brightWhite" : "white" }
  ];
  const len = lengthLabel(r.expected);
  if (len) segs.push({ x: LEN_X, text: clip(len, LEN_W), color: "gray" });
  if (r.expected?.isNew) segs.push({ x: NEW_X, text: "NEW", color: "brightGreen" });
  if (r.suggested) segs.push({ x: STAR_X, text: "\u2605", color: "brightYellow" });
  if (r.world === void 0) {
    segs.push({ x: BEST_X, text: clip(`Best ${r.best}`, BEST_W), color: "gray" });
  } else {
    segs.push({ x: ONLINE_BEST_X, text: shortNumber(r.best), color: "gray" });
    segs.push({ x: ONLINE_WORLD_X, text: shortNumber(r.world), color: "gray" });
  }
  return segs;
}
function shortNumber(s) {
  const n = Number(s);
  if (!/^\d+$/.test(s) || s.length <= NUM_W) return clip(s, NUM_W);
  if (n < 1e6) return `${Math.floor(n / 1e3)}k`;
  return clip(`${(Math.floor(n / 1e5) / 10).toFixed(1)}M`, NUM_W);
}
function onlineHeader() {
  return [
    { x: ONLINE_BEST_X, text: "Best", color: "gray" },
    { x: ONLINE_WORLD_X, text: "World", color: "gray" }
  ];
}
function clip(s, n) {
  return n <= 0 ? "" : s.length > n ? s.slice(0, n) : s;
}

// src/core/scores.ts
var TOP_N = 10;
function isValid2(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return Object.values(data).every(
    (list) => Array.isArray(list) && list.every(
      (e) => typeof e === "object" && e !== null && typeof e.score === "number" && Number.isFinite(e.score) && typeof e.at === "string"
    )
  );
}
function loadScores(file) {
  return loadJson(file, isValid2) ?? {};
}
function addScore(file, gameId, score, at = /* @__PURE__ */ new Date()) {
  if (!Number.isFinite(score)) throw new Error(`Invalid score: ${score}`);
  const all = loadScores(file);
  const previous = all[gameId] ?? [];
  const isBest = previous.every((e) => score > e.score);
  const entry = { score, at: at.toISOString() };
  const sorted = [...previous, entry].sort((a, b) => b.score - a.score);
  const idx = sorted.indexOf(entry);
  const top = sorted.slice(0, TOP_N);
  all[gameId] = top;
  writeAtomic(file, all);
  return { rank: idx < TOP_N ? idx + 1 : null, isBest, top };
}

// src/core/onlineScreens.ts
var LOGIN_MAX = 39;
function clip2(s, n) {
  return n <= 0 ? "" : s.length > n ? s.slice(0, n) : s;
}
function clean(s, max = GAME_WIDTH) {
  return clip2(String(s).replace(new RegExp("\\p{Cc}+", "gu"), " "), max);
}
function centre(area, y, s, c = "white") {
  area.text(Math.max(0, Math.floor((GAME_WIDTH - s.length) / 2)), y, clip2(s, GAME_WIDTH), c);
}
function drawMenuHint(area, account) {
  const s = account ? `Online as ${clip2(clean(account.login), GAME_WIDTH - 23)} \xB7 O: account` : "O: share scores online";
  centre(area, 19, s, "gray");
}
function drawSignIn(area, s) {
  if (s.phase === "code") {
    centre(area, 6, `Open ${clean(s.verificationUri)}`, "brightWhite");
    centre(area, 8, `and enter the code  ${clean(s.userCode)}`, "brightWhite");
    centre(area, 11, "Waiting for GitHub...", "gray");
  } else if (s.phase === "done") centre(area, 8, `Signed in as ${clean(s.login, LOGIN_MAX)}`, "brightGreen");
  else if (s.phase === "failed") centre(area, 8, clean(s.message), "brightRed");
  else centre(area, 8, "Asking GitHub...", "gray");
  centre(area, 18, "Esc: back", "gray");
}
function drawAccount(area, login, confirming, message = null) {
  centre(area, 6, `Signed in as ${clean(login, LOGIN_MAX)}`, "brightWhite");
  centre(area, 9, "S: sign out \xB7 D: sign out and delete my online scores", "gray");
  centre(area, 10, "Esc: back", "gray");
  if (confirming) centre(area, 13, "Delete all your online scores? Y/N", "brightYellow");
  else if (message) {
    clean(message, 200).split(/(?<=\.) /).slice(0, 3).forEach((line, i) => centre(area, 13 + i, line, "brightYellow"));
  }
}
function drawWorld(area, view, signedIn) {
  if (view.status === "loading") centre(area, 5, "loading...", "gray");
  else if (view.status === "offline") centre(area, 5, "offline", "gray");
  else {
    const top = view.top.slice(0, 10);
    const me = view.me;
    const width = Math.max(0, ...top.map((r) => clean(r.login, LOGIN_MAX).length));
    top.forEach((r, i) => {
      const line = `${String(r.rank).padStart(2)}. ${clean(r.login, LOGIN_MAX).padEnd(width)} ${r.score}`;
      area.text(4, 5 + i, clip2(line, GAME_WIDTH - 4), me && r.rank === me.rank ? "brightYellow" : "white");
    });
    if (me && !top.some((r) => r.rank === me.rank)) centre(area, 16, `Your rank: ${me.rank}`, "brightYellow");
  }
  if (!signedIn) centre(area, 17, "O in the menu to join", "gray");
}

// src/core/heckles.ts
var BEHIND = [
  "{time} in and you're at {score}. Your best is {best}. Just saying.",
  "Your best was {best}. This run is... a run.",
  "{score}? Bold strategy. Let's see if it pays off.",
  "At this pace you'll beat {best} sometime next year.",
  "Remember when you scored {best}? Me too. Good times.",
  "Damn. {score}. Is the keyboard upside down?",
  "Not to compare, but past you would be crushing this.",
  "{score} after {time}. I'm not mad, just disappointed.",
  "This is fine. Everything is fine. ({score} vs {best})",
  "Hell of a warm-up. When does the real run start?"
];
var STUCK = [
  "Are you playing or just admiring the graphics?",
  "{time} without a single point. Impressive, in a way.",
  "Still {score}. The score won't go up by staring at it.",
  "Did Claude finish and you forgot to blink?",
  "Shit happens. So could points, any minute now.",
  "Fun fact: points are allowed. Encouraged, even.",
  "Take your time. Claude is only doing all your actual work.",
  "Crap, did it freeze? Oh no, that's just you."
];
var NO_BEST = [
  "First time? It shows.",
  "{game}: easy to learn, apparently hard to master.",
  "No pressure. Well, some pressure.",
  "You're doing great. For a beginner. At {game}.",
  "Hell, everyone starts somewhere. Here, apparently.",
  "Interesting technique. Very... unique.",
  "Keep going. Statistically you have to get better.",
  "Damn, {score} already. Wait, is that good? Who knows."
];
var RUN_WORSE = [
  "{score}. Your best is {best}. Cool cool cool.",
  "{score}. Bold of you to stop there.",
  "Well, that happened. {score}, for the record.",
  "{best} was your best. {score} was... also a number.",
  "Damn, so close to {best}. Not really, but still.",
  "{score}. Maybe Claude should play next time.",
  "Shit. Well. There's always another run.",
  "{score}. I'll pretend I didn't see that."
];
var RUN_BEST = [
  "New best: {score}. Took you long enough.",
  "{score}! Don't let it go to your head.",
  "New best. Even a broken clock, you know.",
  "Finally. {score}. Was that so hard?",
  "Hell yes, {score}. Now do it again, I dare you.",
  "New best. Enjoy it, it won't last."
];
var ALL_LINES = [...BEHIND, ...STUCK, ...NO_BEST, ...RUN_WORSE, ...RUN_BEST];
function fill(template, vars) {
  return template.replace(/\{(score|best|game|time)\}/g, (_, k) => String(vars[k]));
}

// src/core/heckler.ts
var CHECK_MS = 45e3;
var STUCK_MS = 45e3;
var SHOW_MS = 6e3;
var GAP_MS = 2e4;
var BEHIND_RATIO = 0.6;
var NO_BEST_CHANCE = 0.5;
var Heckler = class {
  constructor(rnd) {
    this.rnd = rnd;
  }
  rnd;
  line = null;
  shownAt = -Infinity;
  lastLineAt = -Infinity;
  nextCheck = CHECK_MS;
  lastScore = null;
  lastChange = 0;
  startRun() {
    this.line = null;
    this.shownAt = -Infinity;
    this.nextCheck = CHECK_MS;
    this.lastScore = null;
    this.lastChange = 0;
  }
  tick(i) {
    if (this.lastScore !== null && i.score !== this.lastScore) this.lastChange = i.playedMs;
    this.lastScore = i.score;
    let pool = null;
    if (i.playedMs >= this.nextCheck) {
      while (this.nextCheck <= i.playedMs) this.nextCheck += CHECK_MS;
      if (i.best !== null && i.best > 0) {
        const share = i.expectedMs ? Math.min(1, i.playedMs / i.expectedMs) : 0.5;
        if (i.score < BEHIND_RATIO * i.best * share) pool = BEHIND;
      } else if (i.best === null && this.rnd() >= NO_BEST_CHANCE) pool = NO_BEST;
    }
    if (!pool && i.playedMs - this.lastChange >= STUCK_MS) {
      pool = STUCK;
      this.lastChange = i.playedMs;
    }
    if (!pool || i.nowMs - this.lastLineAt < GAP_MS) return;
    this.line = fill(this.pick(pool), { score: i.score, best: i.best ?? "-", game: i.game, time: duration(i.playedMs) });
    this.shownAt = i.nowMs;
    this.lastLineAt = i.nowMs;
  }
  /** The line to show now, or null. */
  current(nowMs) {
    return this.line !== null && nowMs - this.shownAt < SHOW_MS ? this.line : null;
  }
  /** A line for the results screen. */
  runOver(r) {
    const pool = r.isBest ? RUN_BEST : RUN_WORSE;
    return fill(this.pick(pool), { score: r.score, best: r.best ?? "-", game: r.game, time: "" });
  }
  pick(pool) {
    return pool[Math.min(pool.length - 1, Math.floor(this.rnd() * pool.length))];
  }
};
function duration(ms) {
  const s = Math.floor(ms / 1e3);
  return s < 120 ? `${s}s` : `${Math.floor(s / 60)} min`;
}

// src/core/settings.ts
var DEFAULTS = { heckle: true };
function isSettings(d) {
  if (typeof d !== "object" || d === null || Array.isArray(d)) return false;
  const h = d.heckle;
  return h === void 0 || typeof h === "boolean";
}
function loadSettings(file) {
  try {
    return { ...DEFAULTS, ...loadJson(file, isSettings) ?? {} };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(file, s) {
  writeAtomic(file, s);
}

// src/core/app.ts
var ID_RE = /^[a-z0-9-]{1,32}$/;
var TOO_SMALL = "Make the window bigger";
var MENU_HINTS = "\u2191\u2193 select \xB7 Enter play \xB7 Q quit";
var App = class {
  games;
  scoresFile;
  runsFile;
  seed;
  runs = 0;
  banner = new Banner();
  screen = "menu";
  sel = 0;
  game = null;
  session = null;
  results = null;
  crash = "";
  tooSmall = false;
  best = /* @__PURE__ */ new Map();
  online;
  worldTab = false;
  confirmDelete = false;
  history = {};
  clock = new TaskClock();
  settingsFile;
  heckleOn = false;
  heckler;
  runLine = null;
  constructor(opts) {
    const seen = /* @__PURE__ */ new Set();
    const ok = [];
    for (const g of opts.games) {
      if (!wellFormed(g) || !ID_RE.test(g.id) || seen.has(g.id)) continue;
      seen.add(g.id);
      ok.push(g);
    }
    this.games = ok.sort((a, b) => a.title.localeCompare(b.title));
    this.scoresFile = opts.scoresFile;
    this.runsFile = opts.runsFile;
    this.seed = opts.seed ?? Date.now();
    this.online = opts.online;
    this.heckler = new Heckler(createRandom(this.seed ^ 24301));
    this.settingsFile = opts.settingsFile;
    if (this.settingsFile) this.heckleOn = loadSettings(this.settingsFile).heckle;
    this.refreshBest();
    this.preselect(opts.nowMs);
    const start = opts.startGameId ? this.games.find((g) => g.id === opts.startGameId) : void 0;
    if (start) this.start(start, opts.nowMs);
    else this.online?.refreshWorldBest(opts.nowMs, this.gameIds());
  }
  key(k, nowMs) {
    if (k === "ctrl-c") {
      this.quit();
      return "quit";
    }
    switch (this.screen) {
      case "menu":
        if (k === "q") return "quit";
        if (k === "up" && this.games.length) this.sel = (this.sel + this.games.length - 1) % this.games.length;
        else if (k === "down" && this.games.length) this.sel = (this.sel + 1) % this.games.length;
        else if (k === "enter" && this.games[this.sel]) this.start(this.games[this.sel], nowMs);
        else if (k === "o" && this.online) this.openOnline();
        else if (k === "h" && this.settingsFile) this.toggleHeckling();
        break;
      case "signin":
        if (k === "escape") {
          this.online.cancelSignIn();
          this.toMenu(nowMs);
        }
        break;
      case "account":
        this.accountKey(k, nowMs);
        break;
      case "playing":
        if (this.tooSmall && k !== "p" && k !== "escape") break;
        this.session.key(k);
        if (k === "escape" && this.session.status === "over") {
          this.banner.clearMarker();
          this.finish(this.session.score);
          this.toMenu(nowMs);
        } else this.afterRun();
        break;
      case "results":
        if (k === "enter" && this.game) this.start(this.game, nowMs);
        else if (k === "escape") this.toMenu(nowMs);
        else if (k === "tab" && this.online) {
          this.worldTab = !this.worldTab;
          if (this.worldTab) this.online.loadBoard(this.game.id);
        }
        break;
      case "crashed":
        if (k === "enter" || k === "escape") this.toMenu(nowMs);
        break;
    }
  }
  /** Closing the arcade ends a run in progress and saves its score. */
  quit() {
    const s = this.session;
    if (this.screen !== "playing" || !s || s.status !== "playing" && s.status !== "paused") return;
    s.end();
    this.finish(s.score);
  }
  tick(nowMs) {
    if (this.screen !== "playing") return;
    this.session.tick(nowMs);
    this.heckle(nowMs);
    this.afterRun();
  }
  toggleHeckling() {
    this.heckleOn = !this.heckleOn;
    try {
      saveSettings(this.settingsFile, { heckle: this.heckleOn });
    } catch {
    }
  }
  heckle(nowMs) {
    const s = this.session;
    if (!this.heckleOn || !s || s.status !== "playing") return;
    const g = this.game;
    this.heckler.tick({
      nowMs,
      playedMs: s.playedMs,
      score: s.score,
      best: this.best.get(g.id) ?? null,
      expectedMs: g.length ? expectedLength(g.length, this.history[g.id] ?? []).ms : null,
      game: g.title
    });
  }
  /** done/attention go to the banner; every event feeds the task clock. */
  onEvent(ev, nowMs) {
    if (ev.type === "done" || ev.type === "attention") this.banner.push(ev, nowMs);
    this.applyToClock([ev], nowMs);
  }
  /** Startup catch-up from the events file: task clock only, never the banner. */
  replay(events, nowMs) {
    this.applyToClock(events, nowMs);
  }
  render(cols, rows, nowMs) {
    const buf = new CellBuffer(cols, rows);
    const tooSmall = cols < MIN_COLS || rows < MIN_ROWS;
    this.tooSmall = tooSmall;
    if (this.screen === "playing") this.session.setTooSmall(tooSmall);
    if (tooSmall) {
      buf.text(Math.max(0, Math.floor((cols - TOO_SMALL.length) / 2)), Math.floor(rows / 2), TOO_SMALL, "brightYellow");
      return buf;
    }
    const view = this.banner.view(nowMs);
    const bcolor = this.banner.color();
    if (view?.mode === "full") buf.text(0, 0, clip(view.text, cols), bcolor);
    else if (this.heckleOn && this.screen === "playing") {
      const line = this.heckler.current(nowMs);
      if (line) buf.text(0, 0, clip(line, cols), "brightMagenta");
    }
    if (this.screen === "account" && !this.online.account()) this.toMenu(nowMs);
    const area = new CellBuffer(GAME_WIDTH, GAME_HEIGHT);
    let status = "";
    if (this.screen === "playing") {
      this.session.draw(area);
      this.afterRun();
    }
    if (this.screen === "playing") {
      const g = this.game;
      const best = this.best.has(g.id) ? String(this.best.get(g.id)) : "-";
      status = `${g.title}  Score ${this.session.score}  Best ${best}  ${g.controls}  P pause \xB7 Esc end`;
    } else {
      this.drawScreen(area, nowMs);
      status = this.screen === "menu" ? MENU_HINTS : "";
    }
    buf.blit(area, Math.floor((cols - GAME_WIDTH) / 2), 1);
    const marker = view?.mode === "marker" ? view.text : "";
    const room = marker ? cols - marker.length - 3 : cols;
    buf.text(0, rows - 1, clip(status, room), "white");
    if (marker) buf.text(cols - marker.length - 1, rows - 1, marker, bcolor);
    return buf;
  }
  start(game, nowMs) {
    this.game = game;
    this.results = null;
    this.session = new GameSession(game, { seed: this.seed + this.runs++, nowMs });
    this.heckler.startRun();
    this.screen = "playing";
    this.afterRun();
  }
  toMenu(nowMs) {
    this.banner.clearMarker();
    this.session = null;
    this.results = null;
    this.screen = "menu";
    this.refreshBest();
    this.preselect(nowMs);
    this.online?.refreshWorldBest(nowMs, this.gameIds());
  }
  gameIds() {
    return this.games.map((g) => g.id);
  }
  /** Only `account()` says whether we are signed in; `signIn()` may still hold an old phase. */
  openOnline() {
    const online2 = this.online;
    if (online2.account()) {
      this.confirmDelete = false;
      online2.clearAccountMessage();
      this.screen = "account";
    } else {
      online2.startSignIn();
      this.screen = "signin";
    }
  }
  accountKey(k, nowMs) {
    const online2 = this.online;
    if (this.confirmDelete) {
      if (k === "y") {
        online2.signOut(true);
        this.confirmDelete = false;
      } else if (k === "n" || k === "escape") this.confirmDelete = false;
    } else if (k === "escape") this.toMenu(nowMs);
    else if (k === "s") {
      online2.signOut(false);
      this.toMenu(nowMs);
    } else if (k === "d") this.confirmDelete = true;
  }
  applyToClock(events, nowMs) {
    const before = this.suggestedId(nowMs);
    let moved = false;
    for (const ev of events) {
      this.clock.apply(ev);
      if (ev.type === "start" || ev.type === "estimate") moved = true;
    }
    if (!moved || this.screen !== "menu") return;
    const after = this.suggestedId(nowMs);
    if (after !== null && after !== before) this.preselect(nowMs);
  }
  /** Id of the game that fits Claude's time left, or null. */
  suggestedId(nowMs) {
    const v = this.clock.view(nowMs);
    return v.state === "running" ? suggest(this.games, this.history, v.leftMs) : null;
  }
  preselect(nowMs) {
    const id = this.suggestedId(nowMs);
    const i = id === null ? -1 : this.games.findIndex((g) => g.id === id);
    if (i >= 0) this.sel = i;
  }
  afterRun() {
    const s = this.session;
    if (this.screen !== "playing" || !s) return;
    if (s.status === "crashed") {
      this.banner.clearMarker();
      this.crash = `${this.game.title} crashed: ${(s.error ?? "unknown error").replace(new RegExp("\\p{Cc}+", "gu"), " ")}`;
      this.session = null;
      this.screen = "crashed";
    } else if (s.status === "over") {
      this.banner.clearMarker();
      if (!s.endedEarly) this.recordRun(this.game.id, s.playedMs);
      this.finish(s.score);
    }
  }
  recordRun(id, ms) {
    if (!this.runsFile) return;
    try {
      addRun(this.runsFile, id, ms);
    } catch {
    }
  }
  finish(score) {
    const id = this.game.id;
    const prevBest = this.best.get(id) ?? null;
    this.runLine = null;
    try {
      const r = addScore(this.scoresFile, id, score);
      this.results = { score, isBest: r.isBest, top: r.top, saveFailed: false };
      if (r.top.length) this.best.set(id, Math.max(...r.top.map((e) => e.score)));
      if (this.heckleOn) {
        this.runLine = this.heckler.runOver({ score, best: r.isBest ? score : prevBest, isBest: r.isBest, game: this.game.title });
      }
    } catch {
      this.results = { score, isBest: false, top: [], saveFailed: true };
    }
    this.online?.recordRun(id, score, /* @__PURE__ */ new Date());
    this.online?.loadBoard(id);
    this.worldTab = false;
    this.session = null;
    this.screen = "results";
  }
  refreshBest() {
    this.history = {};
    if (this.runsFile) {
      try {
        this.history = loadRuns(this.runsFile);
      } catch {
      }
    }
    this.best.clear();
    try {
      const all = loadScores(this.scoresFile);
      for (const [id, list] of Object.entries(all)) {
        if (list.length) this.best.set(id, Math.max(...list.map((e) => e.score)));
      }
    } catch {
    }
  }
  drawScreen(area, nowMs) {
    const centre2 = (y, s, c = "white") => area.text(Math.max(0, Math.floor((GAME_WIDTH - s.length) / 2)), y, clip(s, GAME_WIDTH), c);
    if (this.screen === "menu") {
      centre2(1, "ARCADE", "brightCyan");
      if (!this.games.length) {
        centre2(5, "No games yet", "gray");
        return;
      }
      const online2 = this.online;
      const sid = this.suggestedId(nowMs);
      const expected = (g) => g.length ? expectedLength(g.length, this.history[g.id] ?? []) : null;
      const sg = sid === null ? void 0 : this.games.find((g) => g.id === sid);
      const sugg = sg ? { title: sg.title, expected: expected(sg) } : null;
      centre2(2, taskLine(this.clock.view(nowMs), sugg), "brightYellow");
      if (online2) for (const seg of onlineHeader()) area.text(seg.x, 3, seg.text, seg.color);
      this.games.forEach((g, i) => {
        const best = this.best.has(g.id) ? String(this.best.get(g.id)) : "-";
        const wb = online2?.worldBest(g.id);
        const world = online2 ? wb ? String(wb.score) : "-" : void 0;
        const row = { selected: i === this.sel, title: g.title, expected: expected(g), suggested: g.id === sid, best, world };
        for (const seg of rowSegments(row)) area.text(seg.x, 4 + i, seg.text, seg.color);
      });
      area.text(0, 17, clip(this.games[this.sel].description, GAME_WIDTH), "gray");
      if (online2) drawMenuHint(area, online2.account());
      if (this.settingsFile) {
        const hint = `H: heckling ${this.heckleOn ? "on" : "off"}`;
        area.text(GAME_WIDTH - hint.length, 18, hint, "gray");
      }
    } else if (this.screen === "results" && this.results) {
      const r = this.results;
      centre2(1, `${this.game.title} \u2014 Score ${r.score}`, "brightWhite");
      if (r.isBest) centre2(3, "New best!", "brightGreen");
      if (r.saveFailed) centre2(3, "Couldn't save score", "brightRed");
      const online2 = this.online;
      if (online2 && this.worldTab) drawWorld(area, online2.board(this.game.id), !!online2.account());
      else {
        r.top.forEach((e, i) => centre2(5 + i, `${String(i + 1).padStart(2)}. ${e.score}`));
        if (this.runLine) centre2(16, this.runLine, "brightMagenta");
      }
      centre2(18, `Enter: play again \xB7 Esc: menu${online2 ? " \xB7 Tab: You / World" : ""}`, "gray");
    } else if (this.screen === "signin") {
      drawSignIn(area, this.online.signIn());
    } else if (this.screen === "account") {
      drawAccount(area, this.online.account()?.login ?? "", this.confirmDelete, this.online.accountMessage());
    } else if (this.screen === "crashed") {
      centre2(8, this.crash, "brightRed");
      centre2(18, "Enter or Esc: menu", "gray");
    }
  }
};
function wellFormed(g) {
  return typeof g.id === "string" && typeof g.title === "string" && typeof g.description === "string" && typeof g.controls === "string" && typeof g.tickMs === "number" && Number.isFinite(g.tickMs) && g.tickMs > 0 && [g.init, g.onKey, g.update, g.draw, g.score, g.isOver].every((f) => typeof f === "function") && (g.length === void 0 || wellFormedLength(g.length));
}
function wellFormedLength(l) {
  const x = l;
  return typeof x === "object" && x !== null && ["timed", "rounds", "open"].includes(x.kind) && Number.isFinite(x.minutes) && x.minutes > 0;
}

// src/core/keys.ts
var ARROWS = { A: "up", B: "down", C: "right", D: "left" };
function parseKeys(data) {
  const keys = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i];
    if (ch === "\x1B") {
      const next = data[i + 1];
      if (next === "[") {
        let j = i + 2;
        while (j < data.length && data.charCodeAt(j) >= 32 && data.charCodeAt(j) <= 63) j++;
        if (j < data.length) {
          const arrow = j === i + 2 ? ARROWS[data[j]] : void 0;
          if (arrow) keys.push(arrow);
        }
        i = j + 1;
      } else if (next === "O") {
        const arrow = ARROWS[data[i + 2]];
        if (arrow) keys.push(arrow);
        i += 3;
      } else {
        keys.push("escape");
        i += 1;
      }
      continue;
    }
    const cp = data.codePointAt(i);
    const str = String.fromCodePoint(cp);
    i += str.length;
    if (ch === "\r" || ch === "\n") keys.push("enter");
    else if (ch === " ") keys.push("space");
    else if (ch === "") keys.push("ctrl-c");
    else if (ch === "\x7F" || ch === "\b") keys.push("backspace");
    else if (ch === "	") keys.push("tab");
    else if (cp >= 32) keys.push(str.toLowerCase());
  }
  return keys;
}

// src/core/render.ts
var ENTER_ALT = "\x1B[?1049h\x1B[?25l";
var LEAVE_ALT = "\x1B[0m\x1B[?25h\x1B[?1049l";
var SGR = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97
};
function renderDiff(prev2, next) {
  const full = prev2 === null || prev2.width !== next.width || prev2.height !== next.height;
  let out = full ? "\x1B[2J" : "";
  let color = null;
  for (let y = 0; y < next.height; y++) {
    let cursorX = -1;
    for (let x = 0; x < next.width; x++) {
      if (y === next.height - 1 && x === next.width - 1) continue;
      const c = next.get(x, y);
      if (!full) {
        const p = prev2.get(x, y);
        if (p.ch === c.ch && p.color === c.color) continue;
      }
      if (cursorX !== x) out += `\x1B[${y + 1};${x + 1}H`;
      if (c.color !== color) {
        out += `\x1B[${SGR[c.color]}m`;
        color = c.color;
      }
      out += c.ch;
      cursorX = x + 1;
    }
  }
  return out;
}

// src/core/events.ts
var import_node_fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function trimEvents(file, keep2 = 100) {
  let text;
  try {
    text = import_node_fs2.default.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length <= keep2) return;
  import_node_fs2.default.writeFileSync(file, lines.slice(-keep2).join("\n") + "\n");
}
function parseEvent(text) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || typeof v.at !== "string" || typeof v.project !== "string") return null;
    if (v.type === "done" || v.type === "attention" || v.type === "start") {
      return { type: v.type, at: v.at, project: v.project };
    }
    if (v.type === "estimate" && typeof v.minutes === "number" && Number.isFinite(v.minutes)) {
      return { type: "estimate", minutes: v.minutes, at: v.at, project: v.project };
    }
  } catch {
  }
  return null;
}
function readRecentEvents(file, sinceMs) {
  return readNewEvents(file, 0).events.filter((e) => Date.parse(e.at) >= sinceMs);
}
function readNewEvents(file, offset) {
  let fd;
  try {
    fd = import_node_fs2.default.openSync(file, "r");
  } catch {
    return { events: [], offset: 0 };
  }
  try {
    const size = import_node_fs2.default.fstatSync(fd).size;
    const start = size < offset ? 0 : offset;
    const len = size - start;
    if (len <= 0) return { events: [], offset: start };
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const n = import_node_fs2.default.readSync(fd, buf, read, len - read, start + read);
      if (n === 0) break;
      read += n;
    }
    const lastNl = buf.subarray(0, read).lastIndexOf(10);
    if (lastNl < 0) return { events: [], offset: start };
    const events = [];
    for (const l of buf.subarray(0, lastNl).toString("utf8").split("\n")) {
      const ev = l.trim() ? parseEvent(l) : null;
      if (ev) events.push(ev);
    }
    return { events, offset: start + lastNl + 1 };
  } catch {
    return { events: [], offset };
  } finally {
    import_node_fs2.default.closeSync(fd);
  }
}
var EventWatcher = class {
  constructor(file, onEvent, pollMs = 1e3) {
    this.file = file;
    this.onEvent = onEvent;
    this.pollMs = pollMs;
  }
  file;
  onEvent;
  pollMs;
  offset = 0;
  lastAt = 0;
  // `at` of the newest delivered event; older or equal ones are never re-delivered
  watcher = null;
  timer = null;
  start() {
    this.stop();
    this.lastAt = Date.now() - 1;
    try {
      import_node_fs2.default.mkdirSync(path2.dirname(this.file), { recursive: true });
    } catch {
    }
    try {
      this.offset = import_node_fs2.default.statSync(this.file).size;
    } catch {
      this.offset = 0;
    }
    try {
      this.watcher = import_node_fs2.default.watch(path2.dirname(this.file), () => this.poll());
      this.watcher.on("error", () => {
      });
    } catch {
      this.watcher = null;
    }
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }
  stop() {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  poll() {
    if (!this.timer) return;
    const r = readNewEvents(this.file, this.offset);
    this.offset = r.offset;
    for (const e of r.events) {
      const t = Date.parse(e.at);
      if (Number.isNaN(t) || t <= this.lastAt) continue;
      this.lastAt = t;
      this.onEvent(e);
    }
  }
};

// src/core/paths.ts
var os = __toESM(require("node:os"));
var path3 = __toESM(require("node:path"));
function dataDir(home = os.homedir()) {
  return path3.join(home, ".time-waster");
}
function eventsFile(home) {
  return path3.join(dataDir(home), "events.jsonl");
}
function scoresFile(home) {
  return path3.join(dataDir(home), "scores.json");
}
function accountFile(home) {
  return path3.join(dataDir(home), "online.json");
}
function outboxFile(home) {
  return path3.join(dataDir(home), "outbox.jsonl");
}
function aliveFile(home) {
  return path3.join(dataDir(home), "arcade.alive");
}
function runsFile(home) {
  return path3.join(dataDir(home), "runs.json");
}
function settingsFile(home) {
  return path3.join(dataDir(home), "settings.json");
}

// src/core/online/config.ts
var SERVER_URL = "https://lobster-app-di8o6.ondigitalocean.app";
var GITHUB_CLIENT_ID = "Iv23liYZorBnLFMYLrsG";
function onlineConfig(env) {
  const serverUrl = (env.TIME_WASTER_SERVER || SERVER_URL).replace(/\/+$/, "");
  const clientId = env.TIME_WASTER_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID;
  return serverUrl && clientId ? { serverUrl, clientId } : null;
}

// src/core/online/api.ts
var NETWORK = { ok: false, status: "network" };
var LOGIN_RE = /^[A-Za-z0-9-]{1,39}$/;
var GAME_RE = /^[a-z0-9-]{1,32}$/;
var count = (v) => Number.isSafeInteger(v) && v >= 0;
var isLogin = (v) => typeof v === "string" && LOGIN_RE.test(v);
function boardRow(r) {
  if (!count(r?.rank) || !count(r?.score) || !isLogin(r?.login)) return null;
  return { rank: r.rank, login: r.login, score: r.score, at: typeof r.at === "string" ? r.at : "" };
}
function rankAndScore(me) {
  return count(me?.rank) && count(me?.score) ? { rank: me.rank, score: me.score } : null;
}
function worldBests(boards) {
  if (typeof boards !== "object" || boards === null || Array.isArray(boards)) return null;
  const out = {};
  for (const [game, b] of Object.entries(boards)) {
    if (GAME_RE.test(game) && isLogin(b?.login) && count(b?.score)) out[game] = { login: b.login, score: b.score };
  }
  return out;
}
var Api = class {
  constructor(serverUrl, fetchFn = fetch, timeoutMs = 5e3) {
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
    this.base = serverUrl.replace(/\/+$/, "");
  }
  fetchFn;
  timeoutMs;
  base;
  // Never rejects: network errors, timeouts and unexpected bodies all become a failed result.
  async call(method, route, opts) {
    try {
      const headers = {};
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
      if (opts.body !== void 0) headers["Content-Type"] = "application/json";
      const res = await this.fetchFn(this.base + route, {
        method,
        headers,
        body: opts.body === void 0 ? void 0 : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!res.ok) return { ok: false, status: res.status };
      const json = res.status === 204 ? null : await res.json();
      const value = opts.map(json);
      return value === null && res.status !== 204 ? NETWORK : { ok: true, value };
    } catch {
      return NETWORK;
    }
  }
  login(githubToken) {
    return this.call("POST", "/v1/login", {
      body: { githubToken },
      map: (j) => typeof j?.token === "string" && typeof j?.login === "string" ? { token: j.token, login: j.login } : null
    });
  }
  submit(token, e) {
    return this.call("POST", "/v1/scores", {
      token,
      body: { game: e.game, score: e.score, at: e.at },
      map: (j) => typeof j?.best === "number" && typeof j?.rank === "number" ? { best: j.best, rank: j.rank } : null
    });
  }
  board(game, token) {
    return this.call("GET", `/v1/boards/${encodeURIComponent(game)}`, {
      token,
      map: (j) => Array.isArray(j?.top) ? { top: j.top.map(boardRow).filter((r) => r !== null), me: rankAndScore(j.me) } : null
    });
  }
  /** World bests for `games` only (the server takes up to 50 ids). */
  boards(games2) {
    return this.call("GET", `/v1/boards?games=${games2.map(encodeURIComponent).join(",")}`, {
      map: (j) => worldBests(j?.boards)
    });
  }
  /** Ends this session on the server (sign-out). */
  signOutSession(token) {
    return this.call("DELETE", "/v1/session", { token, map: () => null });
  }
  deleteMe(token) {
    return this.call("DELETE", "/v1/me", { token, map: () => null });
  }
};

// src/core/online/github.ts
var CODE_URL = "https://github.com/login/device/code";
var TOKEN_URL = "https://github.com/login/oauth/access_token";
var TIMEOUT_MS = 5e3;
async function postForm(url, form, fetchFn) {
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function requestDeviceCode(clientId, fetchFn = fetch) {
  const j = await postForm(CODE_URL, { client_id: clientId, scope: "" }, fetchFn);
  if (typeof j?.device_code !== "string" || typeof j?.user_code !== "string" || typeof j?.verification_uri !== "string" || typeof j?.interval !== "number" || typeof j?.expires_in !== "number") {
    return null;
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    intervalS: j.interval,
    expiresInS: j.expires_in
  };
}
async function pollDeviceToken(clientId, deviceCode, fetchFn = fetch) {
  const j = await postForm(
    TOKEN_URL,
    { client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
    fetchFn
  );
  if (typeof j?.access_token === "string") return { status: "ok", token: j.access_token };
  switch (j?.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      return { status: "error" };
  }
}

// src/core/online/store.ts
var import_node_fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var OUTBOX_MAX = 50;
function isAccount(d) {
  if (typeof d !== "object" || d === null) return false;
  const a = d;
  return typeof a.serverUrl === "string" && typeof a.token === "string" && typeof a.login === "string";
}
function isEntry(d) {
  if (typeof d !== "object" || d === null) return false;
  const e = d;
  return typeof e.game === "string" && typeof e.score === "number" && Number.isFinite(e.score) && typeof e.at === "string";
}
function loadAccount(file) {
  try {
    const text = readText(file);
    if (text === null) return null;
    const d = JSON.parse(text);
    return isAccount(d) ? { serverUrl: d.serverUrl, token: d.token, login: d.login } : null;
  } catch {
    return null;
  }
}
function saveAccount(file, a) {
  writeAtomic(file, a);
}
function clearAccount(file) {
  withRetry(() => import_node_fs3.default.rmSync(file, { force: true }));
}
function appendOutbox(file, e) {
  import_node_fs3.default.mkdirSync(path4.dirname(file), { recursive: true });
  import_node_fs3.default.appendFileSync(file, JSON.stringify(e) + "\n");
}
function readOutbox(file) {
  let text;
  try {
    text = readText(file);
  } catch {
    return [];
  }
  if (text === null) return [];
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (isEntry(d)) out.push({ game: d.game, score: d.score, at: d.at });
    } catch {
    }
  }
  return out;
}
function writeOutbox(file, entries) {
  const kept = entries.slice(-OUTBOX_MAX);
  writeTextAtomic(file, kept.map((e) => JSON.stringify(e) + "\n").join(""));
}

// src/core/online/online.ts
var REFRESH_MS = 6e4;
var MAX_BOARD_GAMES = 50;
var DELETING = "Deleting your online scores...";
var DELETE_FAILED = "Couldn't reach the score server. Your scores were not deleted.";
var DELETE_BLOCKED = "This account is blocked. Ask the admin to delete your scores.";
var SLOW_DOWN_S = 5;
function safely(op, fallback) {
  try {
    return op();
  } catch {
    return fallback;
  }
}
function sameEntry(a, b) {
  return !!a && a.game === b.game && a.score === b.score && a.at === b.at;
}
function background(call) {
  try {
    return call().catch(() => NETWORK_FAIL);
  } catch {
    return Promise.resolve(NETWORK_FAIL);
  }
}
var NETWORK_FAIL = { ok: false, status: "network" };
function loginFailure(status) {
  if (status === 403) return "This GitHub account is blocked";
  if (status === 429) return "Too many sign-ins, try again later";
  return "Couldn't reach the score server";
}
function keep(status) {
  return status === "network" || status === 429 || status >= 500;
}
var Online = class {
  serverUrl;
  clientId;
  accountFile;
  outboxFile;
  api;
  fetchFn;
  sleep;
  acct;
  bests = {};
  lastRefreshMs = null;
  boardViews = /* @__PURE__ */ new Map();
  boardSeq = /* @__PURE__ */ new Map();
  signInState = { phase: "idle" };
  signInGen = 0;
  flushing = null;
  flushAgain = false;
  deleting = null;
  acctMessage = null;
  constructor(opts) {
    this.serverUrl = opts.serverUrl;
    this.clientId = opts.clientId;
    this.accountFile = opts.accountFile;
    this.outboxFile = opts.outboxFile;
    this.fetchFn = opts.fetchFn;
    this.api = opts.api ?? new Api(opts.serverUrl, opts.fetchFn);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const saved = safely(() => loadAccount(this.accountFile), null);
    this.acct = saved && saved.serverUrl === this.serverUrl ? saved : null;
    void this.flush();
  }
  account() {
    return this.acct ? { login: this.acct.login } : null;
  }
  worldBest(game) {
    const b = Object.hasOwn(this.bests, game) ? this.bests[game] : void 0;
    return b && typeof b.login === "string" && typeof b.score === "number" ? { login: b.login, score: b.score } : null;
  }
  refreshWorldBest(nowMs, games2) {
    if (!games2.length) return;
    if (this.lastRefreshMs !== null && nowMs - this.lastRefreshMs < REFRESH_MS) return;
    this.lastRefreshMs = nowMs;
    background(() => this.api.boards(games2.slice(0, MAX_BOARD_GAMES))).then((r) => {
      if (r.ok) this.bests = r.value;
    });
  }
  loadBoard(game) {
    const seq = (this.boardSeq.get(game) ?? 0) + 1;
    this.boardSeq.set(game, seq);
    this.boardViews.set(game, { status: "loading" });
    this.api.board(game, this.acct?.token).then(
      (r) => {
        if (this.boardSeq.get(game) !== seq) return;
        this.boardViews.set(game, r.ok ? { status: "ready", top: r.value.top, me: r.value.me } : { status: "offline" });
      },
      () => {
        if (this.boardSeq.get(game) === seq) this.boardViews.set(game, { status: "offline" });
      }
    );
  }
  board(game) {
    return this.boardViews.get(game) ?? { status: "loading" };
  }
  recordRun(game, score, at) {
    if (!this.acct) return;
    safely(() => appendOutbox(this.outboxFile, { game, score, at: at.toISOString() }), void 0);
    if (this.flushing) this.flushAgain = true;
    void this.flush();
  }
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        do {
          this.flushAgain = false;
          await this.flushOnce();
        } while (this.flushAgain);
      } catch {
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }
  async flushOnce() {
    const acct = this.acct;
    if (!acct) return;
    for (; ; ) {
      if (this.acct !== acct) return;
      if (this.deleting) return;
      const head = safely(() => readOutbox(this.outboxFile), [])[0];
      if (!head) return;
      const r = await this.api.submit(acct.token, head);
      if (this.acct !== acct) return;
      if (!r.ok && r.status === 401) {
        this.clearLocal();
        return;
      }
      if (!r.ok && keep(r.status)) return;
      const now = readOutbox(this.outboxFile);
      if (sameEntry(now[0], head)) writeOutbox(this.outboxFile, now.slice(1));
    }
  }
  signIn() {
    return this.signInState;
  }
  startSignIn() {
    if (this.signInState.phase === "starting" || this.signInState.phase === "code") return;
    const gen = ++this.signInGen;
    this.signInState = { phase: "starting" };
    this.runSignIn(gen).catch(() => {
      if (gen === this.signInGen) this.signInState = { phase: "failed", message: "Couldn't reach GitHub" };
    });
  }
  async runSignIn(gen) {
    const live = () => gen === this.signInGen;
    const failed = (message) => {
      if (live()) this.signInState = { phase: "failed", message };
    };
    const code = await requestDeviceCode(this.clientId, this.fetchFn);
    if (!live()) return;
    if (!code) return failed("Couldn't reach GitHub");
    this.signInState = { phase: "code", userCode: code.userCode, verificationUri: code.verificationUri };
    let intervalS = code.intervalS;
    let elapsedS = 0;
    for (; ; ) {
      await this.sleep(intervalS * 1e3);
      if (!live()) return;
      elapsedS += intervalS;
      const poll = await pollDeviceToken(this.clientId, code.deviceCode, this.fetchFn);
      if (!live()) return;
      if (poll.status === "ok") {
        const r = await this.api.login(poll.token);
        if (!live()) return;
        if (!r.ok) return failed(loginFailure(r.status));
        const acct = { serverUrl: this.serverUrl, token: r.value.token, login: r.value.login };
        safely(() => saveAccount(this.accountFile, acct), void 0);
        this.acct = acct;
        this.signInState = { phase: "done", login: acct.login };
        void this.flush();
        return;
      }
      if (poll.status === "expired") return failed("Code expired");
      if (poll.status === "denied") return failed("Sign-in denied");
      if (poll.status === "error") return failed("Couldn't reach GitHub");
      if (poll.status === "slow_down") intervalS += SLOW_DOWN_S;
      if (elapsedS >= code.expiresInS) return failed("Code expired");
    }
  }
  cancelSignIn() {
    this.signInGen++;
    this.signInState = { phase: "idle" };
  }
  signOut(deleteScores) {
    const acct = this.acct;
    if (!acct) return;
    if (!deleteScores) {
      this.acct = null;
      this.deleting = null;
      this.acctMessage = null;
      void background(() => this.api.signOutSession(acct.token));
      this.clearFiles(acct);
      return;
    }
    if (this.deleting) return;
    this.deleting = acct;
    this.acctMessage = null;
    background(() => this.api.deleteMe(acct.token)).then((r) => {
      if (this.deleting !== acct) return;
      this.deleting = null;
      if (r.ok || r.status === 401) {
        if (this.acct === acct) this.clearLocal();
        return;
      }
      this.acctMessage = r.status === 403 ? DELETE_BLOCKED : DELETE_FAILED;
      void this.flush();
    });
  }
  accountMessage() {
    return this.deleting ? DELETING : this.acctMessage;
  }
  clearAccountMessage() {
    this.acctMessage = null;
  }
  clearLocal() {
    const acct = this.acct;
    this.acct = null;
    if (acct) this.clearFiles(acct);
  }
  /** Removes the saved session and unsent runs, unless a newer sign-in has replaced that session. */
  clearFiles(acct) {
    if (this.acct && this.acct !== acct) return;
    safely(() => clearAccount(this.accountFile), void 0);
    safely(() => writeOutbox(this.outboxFile, []), void 0);
  }
};

// src/core/alive.ts
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
var BEAT_MS = 2e3;
function touchAlive(file) {
  fs4.mkdirSync(path5.dirname(file), { recursive: true });
  fs4.writeFileSync(file, String(process.pid));
}
function clearAlive(file) {
  try {
    fs4.unlinkSync(file);
  } catch {
  }
}

// src/games/block-drop/index.ts
var BOARD_W = 10;
var BOARD_H = 18;
var ORIGIN_X = 19;
var PANEL_X = ORIGIN_X + BOARD_W * 2 + 4;
var LINE_SCORE = [0, 100, 300, 500, 800];
var KICKS = [0, -1, 1, -2, 2];
var SHAPES = [
  { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], color: "brightRed" },
  // long bar
  { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]], color: "brightBlue" },
  // square
  { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], color: "brightYellow" },
  // T
  { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: "brightMagenta" },
  // S
  { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: "brightCyan" },
  // Z
  { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: "brightGreen" },
  // J
  { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: "white" }
  // L
];
function cellsOf(p) {
  const { n, cells } = SHAPES[p.kind];
  const turns = p.kind === 1 ? 0 : (p.rot % 4 + 4) % 4;
  return cells.map(([cx, cy]) => {
    let x = cx, y = cy;
    for (let i = 0; i < turns; i++) [x, y] = [n - 1 - y, x];
    return { x: p.x + x, y: p.y + y };
  });
}
function emptyBoard() {
  return Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(null));
}
function collides(board, p) {
  return cellsOf(p).some(({ x, y }) => x < 0 || x >= BOARD_W || y >= BOARD_H || y >= 0 && board[y][x] !== null);
}
function dropDistance(board, p) {
  let d = 0;
  while (!collides(board, { ...p, y: p.y + d + 1 })) d++;
  return d;
}
function clearLines(board) {
  const kept = board.filter((row) => row.some((c) => c === null));
  const cleared = BOARD_H - kept.length;
  const fresh = Array.from({ length: cleared }, () => Array(BOARD_W).fill(null));
  return { board: [...fresh, ...kept.map((r) => r.slice())], cleared };
}
function fallTicks(level) {
  return Math.max(2, 18 - 2 * (level - 1));
}
function shuffledSet(rnd) {
  const a = [0, 1, 2, 3, 4, 5, 6];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function spawn(kind) {
  return { kind, rot: 0, x: Math.floor((BOARD_W - SHAPES[kind].n) / 2), y: 0 };
}
function init(ctx) {
  const [first, ...rest] = shuffledSet(ctx.random);
  return {
    board: emptyBoard(),
    piece: spawn(first),
    queue: [...rest, ...shuffledSet(ctx.random)],
    fall: 0,
    score: 0,
    lines: 0,
    level: 1,
    over: false
  };
}
function lock(s, bonus) {
  const filled = s.board.map((r) => r.slice());
  for (const { x, y } of cellsOf(s.piece)) if (y >= 0) filled[y][x] = s.piece.kind;
  const { board, cleared } = clearLines(filled);
  const lines = s.lines + cleared;
  const [kind, ...queue] = s.queue.length > 0 ? s.queue : [0, 1, 2, 3, 4, 5, 6];
  const piece = spawn(kind);
  const toppedOut = cellsOf(s.piece).some((c) => c.y < 0) || collides(board, piece);
  return {
    ...s,
    board,
    piece,
    queue,
    fall: 0,
    lines,
    level: Math.floor(lines / 10) + 1,
    score: s.score + bonus + LINE_SCORE[cleared] * s.level,
    over: toppedOut
  };
}
function tryMove(s, p) {
  return collides(s.board, p) ? s : { ...s, piece: p };
}
function rotate(s, dir) {
  const turned = { ...s.piece, rot: (s.piece.rot + dir + 4) % 4 };
  for (const dx of KICKS) {
    const p = { ...turned, x: turned.x + dx };
    if (!collides(s.board, p)) return { ...s, piece: p };
  }
  return s;
}
function onKey(s, key) {
  if (s.over) return s;
  const p = s.piece;
  switch (key) {
    case "left":
      return tryMove(s, { ...p, x: p.x - 1 });
    case "right":
      return tryMove(s, { ...p, x: p.x + 1 });
    case "up":
      return rotate(s, 1);
    case "z":
      return rotate(s, -1);
    case "down": {
      const down = { ...p, y: p.y + 1 };
      return collides(s.board, down) ? lock(s, 0) : { ...s, piece: down, score: s.score + 1 };
    }
    case "space": {
      const d = dropDistance(s.board, p);
      return lock({ ...s, piece: { ...p, y: p.y + d } }, d * 2);
    }
    default:
      return s;
  }
}
function update(s, ctx) {
  if (s.over) return s;
  const queue = s.queue.length < 7 ? [...s.queue, ...shuffledSet(ctx.random)] : s.queue;
  const fall = s.fall + 1;
  if (fall < fallTicks(s.level)) return { ...s, queue, fall };
  const down = { ...s.piece, y: s.piece.y + 1 };
  if (collides(s.board, down)) return lock({ ...s, queue }, 0);
  return { ...s, queue, fall: 0, piece: down };
}
function block(screen, x, y, chars, color) {
  if (y < 0) return;
  screen.put(ORIGIN_X + 1 + x * 2, 1 + y, chars[0], color);
  screen.put(ORIGIN_X + 2 + x * 2, 1 + y, chars[1], color);
}
function drawBorder(screen) {
  const r = ORIGIN_X + BOARD_W * 2 + 1, b = BOARD_H + 1;
  for (let x = ORIGIN_X + 1; x < r; x++) {
    screen.put(x, 0, "\u2500", "gray");
    screen.put(x, b, "\u2500", "gray");
  }
  for (let y = 1; y < b; y++) {
    screen.put(ORIGIN_X, y, "\u2502", "gray");
    screen.put(r, y, "\u2502", "gray");
  }
  screen.put(ORIGIN_X, 0, "\u250C", "gray");
  screen.put(r, 0, "\u2510", "gray");
  screen.put(ORIGIN_X, b, "\u2514", "gray");
  screen.put(r, b, "\u2518", "gray");
}
function draw(s, screen) {
  drawBorder(screen);
  s.board.forEach((row, y) => row.forEach((c, x) => {
    if (c !== null) block(screen, x, y, "\u2588\u2588", SHAPES[c].color);
  }));
  if (!s.over) {
    const color = SHAPES[s.piece.kind].color;
    const d = dropDistance(s.board, s.piece);
    for (const { x, y } of cellsOf({ ...s.piece, y: s.piece.y + d })) block(screen, x, y, "\u2591\u2591", "gray");
    for (const { x, y } of cellsOf(s.piece)) block(screen, x, y, "\u2588\u2588", color);
  }
  screen.text(PANEL_X, 1, "NEXT", "gray");
  const next = s.queue[0];
  if (next !== void 0) {
    const { cells, color } = SHAPES[next];
    for (const [cx, cy] of cells) {
      screen.put(PANEL_X + cx * 2, 3 + cy, "\u2588", color);
      screen.put(PANEL_X + cx * 2 + 1, 3 + cy, "\u2588", color);
    }
  }
  screen.text(PANEL_X, 8, "LINES", "gray");
  screen.text(PANEL_X, 9, String(s.lines), "white");
  screen.text(PANEL_X, 11, "LEVEL", "gray");
  screen.text(PANEL_X, 12, String(s.level), "white");
  if (s.over) screen.text(ORIGIN_X + BOARD_W - 3, 9, "GAME OVER", "brightRed");
}
var blockDrop = {
  id: "block-drop",
  title: "Block Drop",
  description: "Steer falling blocks, fill rows to clear them.",
  tickMs: 50,
  controls: "\u2190\u2192\u2191\u2193 Spc drop",
  init,
  onKey,
  update,
  draw,
  score: (s) => s.score,
  isOver: (s) => s.over
};
var block_drop_default = blockDrop;

// src/games/drift/physics.ts
var TICK_MS = 50;
var START_SPEED = 8;
var MAX_SPEED = 24;
var COINS_TO_MAX = 20;
var GRIP_SLOW = 0.35;
var GRIP_FAST = 0.1;
var DRIFT_THRESHOLD = 0.3;
var TAU = 2 * Math.PI;
function headingAngle(h) {
  return h * (Math.PI / 4);
}
function rotateHeading(h, dir) {
  return ((h + dir) % 8 + 8) % 8;
}
function speedForCoins(coins) {
  const t = Math.min(coins, COINS_TO_MAX) / COINS_TO_MAX;
  return START_SPEED + (MAX_SPEED - START_SPEED) * Math.sqrt(t);
}
function gripFor(speed) {
  const t = Math.min(Math.max((speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0), 1);
  return GRIP_SLOW + (GRIP_FAST - GRIP_SLOW) * t;
}
function angleDiff(from, to) {
  const x = ((to - from) % TAU + TAU) % TAU;
  return x > Math.PI ? x - TAU : x;
}
function turnToward(travel, target, maxStep, lastTurn) {
  let d = angleDiff(travel, target);
  if (Math.abs(Math.abs(d) - Math.PI) < 1e-9) d = Math.PI * lastTurn;
  const step = Math.min(Math.max(d, -maxStep), maxStep);
  return ((travel + step) % TAU + TAU) % TAU;
}
function isDrifting(travel, heading) {
  return Math.abs(angleDiff(travel, headingAngle(heading))) > DRIFT_THRESHOLD;
}

// src/games/drift/arena.ts
var START = { x: 6, y: 10 };
var SAFE_ZONE = { x: 1, y: 7, w: 20, h: 7 };
var MIN_COIN_DIST = 10;
var ATTEMPTS_PER_PILLAR = 500;
var MAX_RESTARTS = 20;
var FALLBACK_PILLARS = [
  { x: 24, y: 3, w: 3, h: 2 },
  { x: 34, y: 3, w: 3, h: 2 },
  { x: 44, y: 3, w: 3, h: 2 },
  { x: 30, y: 14, w: 3, h: 2 },
  { x: 44, y: 14, w: 3, h: 2 }
];
function isWall(p) {
  return p.x <= 0 || p.y <= 0 || p.x >= GAME_WIDTH - 1 || p.y >= GAME_HEIGHT - 1;
}
function inRect(p, r) {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}
function isBlocked(p, pillars) {
  return isWall(p) || pillars.some((r) => inRect(p, r));
}
var intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
var grown = (r, n) => ({ x: r.x - n, y: r.y - n, w: r.w + 2 * n, h: r.h + 2 * n });
var randInt = (ctx, min, max) => min + Math.floor(ctx.random() * (max - min + 1));
var PILLAR_SIZE = { w: [2, 4], h: [1, 2] };
function placeRect(existing, avoid, size, ctx, attempts = ATTEMPTS_PER_PILLAR) {
  for (let a = 0; a < attempts; a++) {
    const w = randInt(ctx, size.w[0], size.w[1]);
    const h = randInt(ctx, size.h[0], size.h[1]);
    const cand = { x: randInt(ctx, 3, 57 - w), y: randInt(ctx, 3, 17 - h), w, h };
    if (avoid.some((r) => intersects(cand, r))) continue;
    if (existing.some((q) => intersects(grown(cand, 2), q))) continue;
    return cand;
  }
  return null;
}
function carZone(x, y, travel) {
  const zone = [{ x: Math.round(x) - 2, y: Math.round(y) - 2, w: 5, h: 5 }];
  for (let i = 1; i <= 8; i++) {
    zone.push({
      x: Math.round(x + i * Math.cos(travel)),
      y: Math.round(y + i * 0.5 * Math.sin(travel)),
      w: 1,
      h: 1
    });
  }
  return zone;
}
function tryPlace(count2, ctx) {
  const pillars = [];
  while (pillars.length < count2) {
    const r = placeRect(pillars, [SAFE_ZONE], PILLAR_SIZE, ctx);
    if (!r) return null;
    pillars.push(r);
  }
  return pillars;
}
function generatePillars(ctx) {
  const count2 = 5 + Math.floor(ctx.random() * 3);
  for (let r = 0; r < MAX_RESTARTS; r++) {
    const result = tryPlace(count2, ctx);
    if (result) return result;
  }
  return FALLBACK_PILLARS.map((p) => ({ ...p }));
}
var pointRect = (p) => ({ x: p.x, y: p.y, w: 1, h: 1 });
function clearanceFor(speed) {
  const t = (speed - START_SPEED) / (MAX_SPEED - START_SPEED);
  const cx = Math.min(4, Math.max(1, Math.round(1 + 3 * t)));
  return { cx, cy: Math.ceil(cx / 2) };
}
function clearBox(p, speed) {
  const { cx, cy } = clearanceFor(speed);
  return { x: p.x - cx, y: p.y - cy, w: 2 * cx + 1, h: 2 * cy + 1 };
}
function hasClearance(p, cx, cy, pillars) {
  for (let dy = -cy; dy <= cy; dy++)
    for (let dx = -cx; dx <= cx; dx++)
      if (isBlocked({ x: p.x + dx, y: p.y + dy }, pillars)) return false;
  return true;
}
function spawnCoin(car, pillars, ctx, opts = {}) {
  const avoid = opts.avoid ?? [];
  const free = [];
  for (let y = 1; y < GAME_HEIGHT - 1; y++)
    for (let x = 1; x < GAME_WIDTH - 1; x++) {
      const p = { x, y };
      if (!isBlocked(p, pillars) && !avoid.some((r) => inRect(p, r))) free.push(p);
    }
  let candidates = [];
  for (let cx = clearanceFor(opts.speed ?? START_SPEED).cx; cx >= 1 && candidates.length === 0; cx--) {
    const cy = Math.ceil(cx / 2);
    candidates = free.filter((p) => hasClearance(p, cx, cy, pillars));
  }
  if (candidates.length === 0) candidates = free;
  const far = candidates.filter((c) => Math.hypot(c.x - car.x, 2 * (c.y - car.y)) >= MIN_COIN_DIST);
  const pool = far.length > 0 ? far : candidates;
  return pool[Math.floor(ctx.random() * pool.length)];
}

// src/games/drift/effects.ts
var DURATION = { double: 200, grip: 120, rain: 120, nitro: 100, shield: 200, slick: 60 };
var NITRO_SPEED = 1.5;
var NITRO_VALUE = 3;
var DOUBLE_VALUE = 2;
var LOW_GRIP = 0.05;
var CANCELS = { grip: "slick", slick: "grip" };
function addEffect(effects, kind) {
  const cancelled = CANCELS[kind];
  const rest = effects.filter((e) => e.kind !== kind && e.kind !== cancelled);
  return [...rest, { kind, ticksLeft: DURATION[kind] }];
}
function removeEffect(effects, kind) {
  return effects.filter((e) => e.kind !== kind);
}
function hasEffect(effects, kind) {
  return effects.some((e) => e.kind === kind);
}
function tickEffects(effects) {
  return effects.map((e) => ({ kind: e.kind, ticksLeft: e.ticksLeft - 1 })).filter((e) => e.ticksLeft > 0);
}
function modifiers(effects) {
  let speedMul = 1;
  let coinMul = 1;
  if (hasEffect(effects, "nitro")) {
    speedMul *= NITRO_SPEED;
    coinMul *= NITRO_VALUE;
  }
  if (hasEffect(effects, "double")) coinMul *= DOUBLE_VALUE;
  return { speedMul, coinMul };
}
function gripNow(speed, effects, onOil) {
  if (hasEffect(effects, "grip")) return GRIP_SLOW;
  if (hasEffect(effects, "slick") || onOil) return LOW_GRIP;
  return gripFor(speed);
}

// src/games/drift/obstacles.ts
var OBSTACLE_EVERY = 5;
var WARN_TICKS = 40;
var MAX_PILLARS = 12;
var MAX_OIL = 3;
var OIL_FROM = 10;
var SHUFFLE_TICKS = 30;
var OIL_SIZE = { w: [3, 5], h: [1, 2] };
function newObstacle(args, ctx) {
  const { pillars, oil, pending, avoid, coins, gapTo = [] } = args;
  const pillarCount = Math.max(pillars.length, gapTo.length) + pending.filter((p) => p.kind === "pillar").length;
  const oilCount = oil.length + pending.filter((p) => p.kind === "oil").length;
  const pillarOk = pillarCount < MAX_PILLARS;
  const oilOk = coins >= OIL_FROM && oilCount < MAX_OIL;
  if (!pillarOk && !oilOk) return null;
  const kind = oilOk && (!pillarOk || ctx.random() < 1 / 3) ? "oil" : "pillar";
  const existing = [...pillars, ...oil, ...pending.map((p) => p.rect), ...gapTo];
  const rect = placeRect(existing, avoid, kind === "oil" ? OIL_SIZE : PILLAR_SIZE, ctx);
  return rect ? { kind, rect, ticksLeft: WARN_TICKS } : null;
}
var SHUFFLE_RESTARTS = 20;
function shuffleLayout(old, avoid, ctx) {
  let best = [];
  for (let r = 0; r < SHUFFLE_RESTARTS && best.length < old.length; r++) {
    const placed = [];
    while (placed.length < old.length) {
      const rect = placeRect(placed, avoid, PILLAR_SIZE, ctx);
      if (!rect) break;
      placed.push(rect);
    }
    if (placed.length > best.length) best = placed;
  }
  const out = [...best];
  for (const o of old) {
    if (out.length >= old.length) break;
    if (avoid.some((a) => intersects(o, a))) continue;
    if (out.some((q) => intersects(grown(o, 2), q))) continue;
    out.push(o);
  }
  return out;
}

// src/games/drift/powerups.ts
var POWER_LIFE = 160;
var POWER_BLINK = 40;
var POWER_LOOK = {
  double: { ch: "2", color: "brightYellow" },
  grip: { ch: "G", color: "brightGreen" },
  rain: { ch: "$", color: "yellow" },
  nitro: { ch: "N", color: "brightRed" },
  shield: { ch: "S", color: "brightCyan" },
  shuffle: { ch: "X", color: "brightMagenta" },
  mystery: { ch: "?", color: "brightWhite" }
};
var POWER_WEIGHTS = { double: 3, grip: 3, rain: 3, shield: 3, shuffle: 2, nitro: 2, mystery: 2 };
function pickPower(ctx) {
  const kinds = Object.keys(POWER_WEIGHTS);
  let roll = ctx.random() * kinds.reduce((sum, k) => sum + POWER_WEIGHTS[k], 0);
  for (const k of kinds) {
    roll -= POWER_WEIGHTS[k];
    if (roll < 0) return k;
  }
  return kinds[kinds.length - 1];
}
var MYSTERY_OUTCOMES = ["double", "grip", "rain", "nitro", "shield", "shuffle", "slick"];
function resolveMystery(ctx) {
  return MYSTERY_OUTCOMES[Math.floor(ctx.random() * MYSTERY_OUTCOMES.length)];
}
var FIRST_POWER_AT = 2;
function nextPowerGap(ctx) {
  return 3 + Math.floor(ctx.random() * 2);
}

// src/games/drift/index.ts
var TRAIL_LEN = 6;
var BASE_COIN = 10;
var RAIN_COUNT = 5;
var CAR = ["\u2192", "\u2198", "\u2193", "\u2199", "\u2190", "\u2196", "\u2191", "\u2197"];
function cellOf(s) {
  return { x: Math.round(s.x), y: Math.round(s.y) };
}
var samePoint = (a, b) => a.x === b.x && a.y === b.y;
function init2(ctx) {
  const pillars = generatePillars(ctx);
  return {
    x: START.x,
    y: START.y,
    heading: 0,
    travel: 0,
    lastTurn: 1,
    coins: 0,
    coin: spawnCoin(START, pillars, ctx),
    extraCoins: [],
    pillars,
    oil: [],
    shuffle: null,
    pending: [],
    trail: [],
    crashed: false,
    points: 0,
    scheduleCoins: 0,
    nextPowerAt: FIRST_POWER_AT,
    powerUp: null,
    effects: [],
    tick: 0
  };
}
function onKey2(state, key) {
  if (state.crashed) return state;
  if (key === "right") return { ...state, heading: rotateHeading(state.heading, 1), lastTurn: 1 };
  if (key === "left") return { ...state, heading: rotateHeading(state.heading, -1), lastTurn: -1 };
  return state;
}
function applyPower(state, kind, ctx) {
  if (kind === "mystery") {
    const outcome = resolveMystery(ctx);
    return outcome === "slick" ? { ...state, effects: addEffect(state.effects, "slick") } : applyPower(state, outcome, ctx);
  }
  if (kind === "shuffle") {
    const avoid = [
      ...carZone(state.x, state.y, state.travel),
      ...spawnAvoid({ ...state, shuffle: null }),
      ...state.oil,
      ...[...state.oil, ...state.pending.map((p) => p.rect)].map((r) => grown(r, 2)),
      ...pickupBoxes(state)
    ];
    return { ...state, shuffle: { pillars: shuffleLayout(state.pillars, avoid, ctx), ticksLeft: SHUFFLE_TICKS } };
  }
  if (kind === "rain" && !hasEffect(state.effects, "rain")) {
    const speed = speedNow(state);
    const extras = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      const avoid = [...spawnAvoid(state), ...extras.map(pointRect)];
      extras.push(spawnCoin(cellOf(state), clearFrom(state), ctx, { speed, avoid }));
    }
    return { ...state, extraCoins: extras, effects: addEffect(state.effects, kind) };
  }
  return { ...state, effects: addEffect(state.effects, kind) };
}
function spawnAvoid(state) {
  const rects = [pointRect(state.coin), ...state.extraCoins.map(pointRect)];
  if (state.powerUp) rects.push(pointRect(state.powerUp.at));
  rects.push(...state.oil, ...state.pending.map((p) => p.rect));
  if (state.shuffle) rects.push(...state.shuffle.pillars);
  return rects;
}
function dropOne(layout, destroyed) {
  const i = layout.findIndex((r) => r.x === destroyed.x && r.y === destroyed.y && r.w === destroyed.w && r.h === destroyed.h);
  return layout.filter((_, j) => j !== Math.max(i, 0));
}
var speedNow = (s) => speedForCoins(s.coins) * modifiers(s.effects).speedMul;
function clearFrom(s) {
  return [...s.pillars, ...s.pending.filter((p) => p.kind === "pillar").map((p) => p.rect), ...s.shuffle?.pillars ?? []];
}
function pickupBoxes(s) {
  const speed = speedNow(s);
  const points = [s.coin, ...s.extraCoins, ...s.powerUp ? [s.powerUp.at] : []];
  return points.map((p) => clearBox(p, speed));
}
function update2(state, ctx) {
  if (state.crashed) return state;
  const effects = tickEffects(state.effects);
  let st = {
    ...state,
    effects,
    extraCoins: hasEffect(effects, "rain") ? state.extraCoins : []
  };
  const speed = speedForCoins(st.coins) * modifiers(st.effects).speedMul;
  const travel = turnToward(st.travel, headingAngle(st.heading), gripNow(speed, st.effects, st.oil.some((r) => inRect(cellOf(st), r))), st.lastTurn);
  const dx = Math.cos(travel) * speed * TICK_MS / 1e3;
  const dy = Math.sin(travel) * speed * TICK_MS / 1e3 * 0.5;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  let { x, y } = st;
  let crashed = false;
  for (let i = 0; i < n; i++) {
    x += dx / n;
    y += dy / n;
    const cell2 = cellOf({ x, y });
    if (isWall(cell2)) {
      crashed = true;
      break;
    }
    const hit = st.pillars.find((r) => inRect(cell2, r));
    if (hit) {
      if (!hasEffect(st.effects, "shield")) {
        crashed = true;
        break;
      }
      st = {
        ...st,
        pillars: st.pillars.filter((r) => r !== hit),
        effects: removeEffect(st.effects, "shield"),
        shuffle: st.shuffle && { ...st.shuffle, pillars: dropOne(st.shuffle.pillars, hit) }
      };
    }
    const extra = st.extraCoins.findIndex((p) => samePoint(p, cell2));
    if (extra >= 0) {
      st = {
        ...st,
        coins: st.coins + 1,
        points: st.points + BASE_COIN * modifiers(st.effects).coinMul,
        extraCoins: st.extraCoins.filter((_, j) => j !== extra)
      };
    }
    if (samePoint(cell2, st.coin)) {
      const { speedMul, coinMul } = modifiers(st.effects);
      const coins = st.coins + 1;
      st = { ...st, coins, scheduleCoins: st.scheduleCoins + 1, points: st.points + BASE_COIN * coinMul };
      st = { ...st, coin: spawnCoin(cell2, clearFrom(st), ctx, { speed: speedForCoins(coins) * speedMul, avoid: spawnAvoid(st) }) };
      if (st.scheduleCoins % OBSTACLE_EVERY === 0) {
        const avoid = [...carZone(x, y, travel), ...spawnAvoid(st), ...pickupBoxes(st)];
        const ob = newObstacle({ pillars: st.pillars, oil: st.oil, pending: st.pending, avoid, coins: st.coins, gapTo: st.shuffle?.pillars }, ctx);
        if (ob) st = { ...st, pending: [...st.pending, ob] };
      }
    }
    if (st.powerUp && samePoint(cell2, st.powerUp.at)) {
      st = applyPower({ ...st, x, y, travel }, st.powerUp.kind, ctx);
      st = { ...st, powerUp: null, nextPowerAt: st.scheduleCoins + nextPowerGap(ctx) };
    }
    if (st.trail.length === 0 || !samePoint(st.trail[0], cell2)) {
      st = { ...st, trail: [cell2, ...st.trail].slice(0, TRAIL_LEN) };
    }
  }
  st = { ...st, x, y, travel, crashed };
  if (st.powerUp) {
    const ticksLeft = st.powerUp.ticksLeft - 1;
    st = ticksLeft > 0 ? { ...st, powerUp: { ...st.powerUp, ticksLeft } } : { ...st, powerUp: null, nextPowerAt: st.scheduleCoins + nextPowerGap(ctx) };
  }
  if (st.powerUp === null && st.nextPowerAt !== null && st.scheduleCoins >= st.nextPowerAt) {
    const at = spawnCoin(cellOf(st), clearFrom(st), ctx, { speed: speedNow(st), avoid: spawnAvoid(st) });
    st = { ...st, powerUp: { kind: pickPower(ctx), at, ticksLeft: POWER_LIFE }, nextPowerAt: null };
  }
  return { ...resolveShuffle(resolvePending(st)), tick: st.tick + 1 };
}
function resolveShuffle(st) {
  if (!st.shuffle) return st;
  const ticksLeft = st.shuffle.ticksLeft - 1;
  if (ticksLeft > 0) return { ...st, shuffle: { ...st.shuffle, ticksLeft } };
  const blocked = [...carZone(st.x, st.y, st.travel), ...pickupBoxes(st)];
  return { ...st, pillars: st.shuffle.pillars.filter((p) => !blocked.some((b) => intersects(p, b))), shuffle: null };
}
function resolvePending(st) {
  if (st.pending.length === 0) return st;
  const zone = carZone(st.x, st.y, st.travel);
  const pending = [];
  const pillars = [...st.pillars];
  const oil = [...st.oil];
  const solidified = [];
  for (const p of st.pending) {
    const ticksLeft = Math.max(0, p.ticksLeft - 1);
    if (ticksLeft > 0 || zone.some((z) => intersects(z, p.rect))) pending.push({ ...p, ticksLeft });
    else if (p.kind === "pillar") {
      pillars.push(p.rect);
      solidified.push(p.rect);
    } else oil.push(p.rect);
  }
  const shuffle = st.shuffle && solidified.length > 0 ? { ...st.shuffle, pillars: [...st.shuffle.pillars, ...solidified] } : st.shuffle;
  return { ...st, pending, pillars, oil, shuffle };
}
var READOUT_MAX_X = 57;
var LABEL = { double: "\xD72", grip: "G", rain: "$", nitro: "N", shield: "S", slick: "SLICK" };
function drawReadout(effects, screen) {
  let x = 2;
  for (const e of effects) {
    const color = e.kind === "slick" ? "brightRed" : POWER_LOOK[e.kind].color;
    const filled = Math.ceil(4 * e.ticksLeft / DURATION[e.kind]);
    const text = `${LABEL[e.kind]} ${"\u2588".repeat(filled)}${"\u2591".repeat(4 - filled)} `;
    for (const ch of text) {
      if (x > READOUT_MAX_X) return;
      screen.put(x++, 0, ch, color);
    }
  }
}
function fillRect(screen, r, ch, color) {
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) screen.put(x, y, ch, color);
}
function draw2(state, screen) {
  const W2 = GAME_WIDTH - 1, H2 = GAME_HEIGHT - 1;
  for (let x = 1; x < W2; x++) {
    screen.put(x, 0, "\u2500", "gray");
    screen.put(x, H2, "\u2500", "gray");
  }
  for (let y = 1; y < H2; y++) {
    screen.put(0, y, "\u2502", "gray");
    screen.put(W2, y, "\u2502", "gray");
  }
  screen.put(0, 0, "\u250C", "gray");
  screen.put(W2, 0, "\u2510", "gray");
  screen.put(0, H2, "\u2514", "gray");
  screen.put(W2, H2, "\u2518", "gray");
  for (const r of state.pillars) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) screen.put(x, y, "\u2588", "blue");
  }
  for (const r of state.oil) fillRect(screen, r, "\u2248", "blue");
  if (Math.floor(state.tick / 4) % 2 === 0) {
    for (const r of state.shuffle?.pillars ?? []) {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++)
          if (!state.pillars.some((p2) => inRect({ x, y }, p2))) screen.put(x, y, "\u2591", "magenta");
    }
    for (const p2 of state.pending) fillRect(screen, p2.rect, p2.kind === "pillar" ? "\u2591" : "\u2248", "gray");
  }
  const car = cellOf(state);
  if (isDrifting(state.travel, state.heading)) {
    for (const t of state.trail) if (!samePoint(t, car)) screen.put(t.x, t.y, "\xB7", "gray");
  }
  screen.put(state.coin.x, state.coin.y, "\u25CF", "yellow");
  for (const e of state.extraCoins) screen.put(e.x, e.y, "\u25CF", "yellow");
  const p = state.powerUp;
  if (p && (p.ticksLeft > POWER_BLINK || Math.floor(state.tick / 4) % 2 === 0)) {
    screen.put(p.at.x, p.at.y, POWER_LOOK[p.kind].ch, POWER_LOOK[p.kind].color);
  }
  drawReadout(state.effects, screen);
  screen.put(car.x, car.y, CAR[state.heading], state.crashed ? "red" : "brightCyan");
}
var drift = {
  id: "drift",
  title: "Drift",
  description: "Drift for coins. Every coin is faster. Don't touch the walls.",
  tickMs: TICK_MS,
  controls: "\u2190\u2192 steer",
  init: init2,
  onKey: onKey2,
  update: update2,
  draw: draw2,
  score: (s) => s.points,
  isOver: (s) => s.crashed
};
var drift_default = drift;

// src/games/rail-dash/index.ts
var PLAYER_ROW = 17;
var ACTION_TICKS = 22;
var LANES = 3;
var LANE_W = 7;
var ORIGIN_X2 = Math.floor((60 - (LANES * (LANE_W + 1) + 1)) / 2);
var COIN_POINTS = 10;
var SAFE_GAP = 8;
function stepTicks(distance) {
  return Math.max(2, 5 - Math.floor(distance / 200));
}
var covers = (t, row) => row >= t.y && row < t.y + t.len;
var trainAt = (things, lane, row) => things.some((t) => t.kind === "train" && t.lane === lane && covers(t, row));
function init3(_ctx) {
  return { lane: 1, air: 0, roll: 0, up: false, things: [], distance: 0, coins: 0, tick: 0, nextWave: 8, safeLane: 1, over: false };
}
function onKey3(s, key) {
  if (s.over) return s;
  switch (key) {
    case "left":
    case "right": {
      const lane = s.lane + (key === "left" ? -1 : 1);
      if (lane < 0 || lane >= LANES || !s.up && trainAt(s.things, lane, PLAYER_ROW)) return s;
      return { ...s, lane };
    }
    // Pressing again restarts the jump or roll, so close obstacles can be taken one after another.
    case "up":
      return { ...s, air: ACTION_TICKS, roll: 0 };
    case "down":
      return { ...s, roll: ACTION_TICKS, air: 0 };
    default:
      return s;
  }
}
function wave(s, rnd) {
  let safeLane = s.safeLane;
  const roomToMove = s.things.every((t) => t.kind !== "train" || t.y >= SAFE_GAP);
  if (roomToMove && rnd() < 0.6) safeLane = Math.floor(rnd() * LANES);
  const add = [];
  const one = (kind, lane) => add.push({ kind, lane, y: -1, len: 1 });
  for (let lane = 0; lane < LANES; lane++) {
    const r = rnd();
    if (lane === safeLane) {
      if (r < 0.15) one("low", lane);
      else if (r < 0.3) one("high", lane);
      else if (r < 0.65) for (let i = 1; i <= 3; i++) add.push({ kind: "coin", lane, y: -i, len: 1 });
    } else if (r < 0.4) {
      const len = 3 + Math.floor(rnd() * 4);
      if (rnd() < 0.5) {
        add.push({ kind: "train", lane, y: -len - 1, len }, { kind: "ramp", lane, y: -1, len: 1 });
      } else add.push({ kind: "train", lane, y: -len, len });
    } else if (r < 0.55) one("low", lane);
    else if (r < 0.7) one("high", lane);
    else if (r < 0.8) one("coin", lane);
  }
  return { things: [...s.things, ...add], safeLane, nextWave: 5 + Math.floor(rnd() * 4) };
}
function check(s) {
  const under = trainAt(s.things, s.lane, PLAYER_ROW);
  let up = s.up && (under || s.air > 0);
  if (!up && under) return { ...s, over: true };
  let coins = s.coins, roll = s.roll;
  const things = [];
  for (const t of s.things) {
    if (t.lane !== s.lane || !covers(t, PLAYER_ROW) || t.kind === "train") {
      things.push(t);
      continue;
    }
    if (t.kind === "coin") {
      coins++;
      continue;
    }
    things.push(t);
    if (up) continue;
    if (t.kind === "ramp") {
      up = true;
      roll = 0;
      continue;
    }
    if (t.kind === "low" && s.air === 0 || t.kind === "high" && s.roll === 0) return { ...s, over: true };
  }
  return { ...s, up, roll, coins, things };
}
function update3(s, ctx) {
  if (s.over) return s;
  const timed = { ...s, air: Math.max(0, s.air - 1), roll: Math.max(0, s.roll - 1) };
  const tick = s.tick + 1;
  if (tick < stepTicks(s.distance)) return check({ ...timed, tick });
  let next = {
    ...timed,
    tick: 0,
    distance: s.distance + 1,
    things: s.things.map((t) => ({ ...t, y: t.y + 1 })).filter((t) => t.y < 20),
    nextWave: s.nextWave - 1
  };
  if (next.nextWave <= 0) next = { ...next, ...wave(next, ctx.random) };
  return check(next);
}
var laneLeft = (lane) => ORIGIN_X2 + 1 + lane * (LANE_W + 1);
function span(screen, lane, y, ch, color) {
  if (y < 0 || y >= 20) return;
  for (let i = 1; i <= LANE_W - 2; i++) screen.put(laneLeft(lane) + i, y, ch, color);
}
function draw3(s, screen) {
  for (let y = 0; y < 20; y++) {
    for (let l = 0; l <= LANES; l++) {
      const x = ORIGIN_X2 + l * (LANE_W + 1);
      if (l === 0 || l === LANES) screen.put(x, y, "\u2502", "gray");
      else if ((y - s.distance) % 3 !== 0) screen.put(x, y, "\u250A", "gray");
    }
  }
  for (const t of s.things) {
    if (t.kind === "train") {
      for (let y = t.y; y < t.y + t.len; y++) span(screen, t.lane, y, y === t.y + t.len - 1 ? "\u2593" : "\u2588", y === t.y + t.len - 1 ? "brightBlue" : "blue");
    } else if (t.kind === "ramp") span(screen, t.lane, t.y, "^", "brightCyan");
    else if (t.kind === "low") span(screen, t.lane, t.y, "\u2550", "brightYellow");
    else if (t.kind === "high") span(screen, t.lane, t.y, "\u2580", "brightRed");
    else if (t.y >= 0) screen.put(laneLeft(t.lane) + 3, t.y, "\u25CF", "yellow");
  }
  const px = laneLeft(s.lane) + 3;
  if (s.over) screen.put(px, PLAYER_ROW, "X", "brightRed");
  else if (s.air > 0) {
    screen.put(px, PLAYER_ROW - 1, "\u25B2", "brightWhite");
    screen.put(px, PLAYER_ROW, "\xB7", "gray");
  } else if (s.roll > 0) screen.put(px, PLAYER_ROW, "\u2584", "brightGreen");
  else screen.put(px, PLAYER_ROW, "\u25B2", s.up ? "brightMagenta" : "brightGreen");
  screen.text(1, 3, "\u2550 jump  \u2191", "brightYellow");
  screen.text(1, 5, "\u2580 roll  \u2193", "brightRed");
  screen.text(1, 7, "\u2588 train \u2190\u2192", "brightBlue");
  screen.text(1, 9, "^ ramp: roof", "brightCyan");
  screen.text(1, 11, "\u25CF coin", "yellow");
  const right = ORIGIN_X2 + LANES * (LANE_W + 1) + 3;
  screen.text(right, 3, "COINS", "gray");
  screen.text(right, 4, String(s.coins), "yellow");
  screen.text(right, 6, "SPEED", "gray");
  screen.text(right, 7, String(6 - stepTicks(s.distance)), "white");
  screen.text(right, 9, "DISTANCE", "gray");
  screen.text(right, 10, String(s.distance), "white");
  if (s.up) screen.text(right, 13, "ON A ROOF", "brightMagenta");
}
var railDash = {
  id: "rail-dash",
  title: "Rail Dash",
  description: "Switch lanes, jump, roll. Dodge trains, grab coins.",
  tickMs: 40,
  controls: "\u2190\u2192 \u2191jump \u2193roll",
  init: init3,
  onKey: onKey3,
  update: update3,
  draw: draw3,
  score: (s) => s.distance + s.coins * COIN_POINTS,
  isOver: (s) => s.over
};
var rail_dash_default = railDash;

// src/games/reflex/index.ts
var TARGETS = ["up", "down", "left", "right", "a", "s", "d", "f", "j", "k", "l"];
var SYMBOL = { up: "\u2191", down: "\u2193", left: "\u2190", right: "\u2192" };
var TICK_MS2 = 50;
var GAP_MS2 = 250;
var RUN_MS = 6e4;
var LIFE_START = 1500;
var LIFE_MIN = 450;
var LIFE_HIT = 40;
var LIFE_MISS = 200;
var BOX = 3;
var X_MIN = 1;
var X_MAX = GAME_WIDTH - 1 - BOX;
var Y_MIN = 2;
var Y_MAX = 20 - 1 - BOX;
var multiplier = (streak) => streak >= 25 ? 3 : streak >= 10 ? 2 : 1;
function init4(_ctx) {
  return {
    target: null,
    x: 0,
    y: 0,
    prevX: -1,
    prevY: -1,
    gapLeft: GAP_MS2,
    timeLeft: 0,
    lifetime: LIFE_START,
    score: 0,
    streak: 0,
    hits: 0,
    misses: 0,
    elapsedMs: 0,
    over: false,
    flash: null
  };
}
function toGap(s, flash) {
  return { ...s, flash, target: null, prevX: s.x, prevY: s.y, gapLeft: GAP_MS2, timeLeft: 0 };
}
function miss(s) {
  return toGap({
    ...s,
    misses: s.misses + 1,
    streak: 0,
    lifetime: Math.min(LIFE_START, s.lifetime + LIFE_MISS)
  }, { kind: "miss", x: s.x, y: s.y, n: 0, msLeft: GAP_MS2 });
}
function onKey4(s, key) {
  if (s.over || s.target === null) return s;
  if (!TARGETS.includes(key)) return s;
  if (key !== s.target) return miss(s);
  const streak = s.streak + 1;
  const bonus = Math.round(10 * s.timeLeft / s.lifetime);
  const gained = (10 + bonus) * multiplier(streak);
  return toGap({
    ...s,
    streak,
    hits: s.hits + 1,
    score: s.score + gained,
    lifetime: Math.max(LIFE_MIN, s.lifetime - LIFE_HIT)
  }, { kind: "hit", x: s.x, y: s.y, n: gained, msLeft: GAP_MS2 });
}
function spawn2(s, ctx) {
  const target = TARGETS[Math.floor(ctx.random() * TARGETS.length)];
  const spots = [];
  for (let y = Y_MIN; y <= Y_MAX; y++) {
    for (let x = X_MIN; x <= X_MAX; x++) {
      if (x !== s.prevX || y !== s.prevY) spots.push({ x, y });
    }
  }
  const p = spots[Math.floor(ctx.random() * spots.length)];
  return { ...s, target, x: p.x, y: p.y, gapLeft: 0, timeLeft: s.lifetime };
}
function update4(prev2, ctx) {
  let s = { ...prev2, elapsedMs: ctx.elapsedMs };
  if (s.flash) {
    const msLeft = s.flash.msLeft - TICK_MS2;
    s = { ...s, flash: msLeft > 0 ? { ...s.flash, msLeft } : null };
  }
  if (ctx.elapsedMs >= RUN_MS) return { ...s, over: true };
  if (s.over) return s;
  if (s.target === null) {
    s = { ...s, gapLeft: s.gapLeft - TICK_MS2 };
    return s.gapLeft <= 0 ? spawn2(s, ctx) : s;
  }
  s = { ...s, timeLeft: s.timeLeft - TICK_MS2 };
  return s.timeLeft <= 0 ? miss(s) : s;
}
function fadeColor(s) {
  const f = s.timeLeft / s.lifetime;
  return f > 2 / 3 ? "brightWhite" : f > 1 / 3 ? "white" : "gray";
}
function draw4(s, screen) {
  const left = Math.max(0, RUN_MS - s.elapsedMs);
  const secs = Math.ceil(left / 1e3);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  screen.text(
    0,
    0,
    `Time ${clock}   Streak ${s.streak} \xD7${multiplier(s.streak)}   Hits ${s.hits}  Misses ${s.misses}`,
    "white"
  );
  if (s.flash) {
    const { x: x2, y: y2 } = s.flash;
    if (s.flash.kind === "hit") {
      screen.text(x2, y2 + 1, `+${s.flash.n}`.slice(0, BOX).padEnd(BOX), "brightGreen");
    } else {
      screen.text(x2, y2, "\u250C\u2500\u2510", "red");
      screen.text(x2, y2 + 1, "\u2502\u2717\u2502", "red");
      screen.text(x2, y2 + 2, "\u2514\u2500\u2518", "red");
    }
  }
  if (s.target === null) return;
  const c = fadeColor(s);
  const { x, y } = s;
  screen.text(x, y, "\u250C\u2500\u2510", c);
  screen.text(x, y + 1, "\u2502 \u2502", c);
  screen.text(x, y + 2, "\u2514\u2500\u2518", c);
  screen.put(x + 1, y + 1, SYMBOL[s.target] ?? s.target, c);
}
var reflex = {
  id: "reflex",
  title: "Reflex",
  description: "Press the key before it fades. 60 seconds.",
  tickMs: TICK_MS2,
  controls: "\u2190\u2191\u2192\u2193 a s d f j k l",
  length: { kind: "timed", minutes: 1 },
  init: init4,
  onKey: onKey4,
  update: update4,
  draw: draw4,
  score: (s) => s.score,
  isOver: (s) => s.over
};
var reflex_default = reflex;

// src/games/tank-duel/index.ts
var W = GAME_WIDTH;
var H = GAME_HEIGHT;
var MAX_HP = 100;
var BLAST = 3;
var MAX_DAMAGE = 50;
var VMAX = 2.2;
var GRAVITY = 0.035;
var ASPECT = 0.5;
var SUBSTEPS = 4;
var MAX_WIND = 6e-3;
var BOOM_TICKS = 8;
var CPU_WAIT_TICKS = 15;
var WIN_BONUS = 100;
var TRAIL = 10;
var PREVIEW_TICKS = 16;
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var rad = (deg) => deg * Math.PI / 180;
function makeGround(rnd) {
  const p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2;
  const a1 = 1.5 + rnd() * 2, a2 = 0.5 + rnd() * 1.5;
  const f1 = 1 + rnd(), f2 = 2.5 + rnd() * 2;
  const hill = 2 + rnd() * 3;
  return Array.from({ length: W }, (_, x) => {
    const u = x / W;
    const h = 15 - hill * Math.sin(Math.PI * u) + a1 * Math.sin(Math.PI * f1 * u + p1) + a2 * Math.sin(Math.PI * f2 * u + p2);
    return clamp(Math.round(h), 6, H - 2);
  });
}
function flattenUnder(ground, x) {
  const g = ground.slice();
  g[x - 1] = g[x];
  g[x + 1] = g[x];
  return g;
}
function newRound(round, score, rnd, message) {
  const px = 4 + Math.floor(rnd() * 8);
  const cx = W - 5 - Math.floor(rnd() * 8);
  const ground = flattenUnder(flattenUnder(makeGround(rnd), px), cx);
  return {
    ground,
    player: { x: px, hp: MAX_HP, angle: 45, power: 60 },
    cpu: { x: cx, hp: MAX_HP, angle: 135, power: 60 },
    wind: newWind(rnd),
    phase: { kind: "aim" },
    round,
    cpuShots: 0,
    score,
    over: false,
    message
  };
}
var newWind = (rnd) => Math.round((rnd() * 2 - 1) * MAX_WIND * 1e4) / 1e4;
function tankRow(s, t) {
  return Math.min(s.ground[t.x], H) - 1;
}
function launch(s, who, angle, power) {
  const t = s[who];
  const v = power / 100 * VMAX;
  return {
    x: t.x + 0.5,
    y: tankRow(s, t) - 0.5,
    vx: Math.cos(rad(angle)) * v,
    vy: -Math.sin(rad(angle)) * v * ASPECT,
    owner: who,
    age: 0,
    trail: []
  };
}
function collide(s, sh) {
  if (sh.x < 0 || sh.x >= W) return "out";
  if (sh.y >= H) return { x: sh.x, y: H - 0.5 };
  const col = Math.floor(sh.x), row = Math.floor(sh.y);
  if (row >= s.ground[col]) return { x: sh.x, y: sh.y };
  for (const who of ["player", "cpu"]) {
    if (who === sh.owner && sh.age < 6) continue;
    const t = s[who];
    if (row === tankRow(s, t) && Math.abs(col - t.x) <= 1) return { x: sh.x, y: sh.y };
  }
  return null;
}
function advance(s, shell) {
  let sh = shell;
  for (let i = 0; i < SUBSTEPS; i++) {
    const vx = sh.vx + s.wind / SUBSTEPS, vy = sh.vy + GRAVITY / SUBSTEPS;
    sh = { ...sh, vx, vy, x: sh.x + vx / SUBSTEPS, y: sh.y + vy / SUBSTEPS, age: sh.age + 1 };
    const hit = collide(s, sh);
    if (hit) return { shell: sh, hit };
  }
  return { shell: sh, hit: null };
}
function aimPath(s) {
  const path6 = [];
  let sh = launch(s, "player", s.player.angle, s.player.power);
  for (let i = 0; i < PREVIEW_TICKS; i++) {
    const r = advance(s, sh);
    if (r.hit) break;
    sh = r.shell;
    path6.push({ x: sh.x, y: sh.y });
  }
  return path6;
}
function trace(s, who, angle, power) {
  let sh = launch(s, who, angle, power);
  for (let i = 0; i < 400; i++) {
    const r = advance(s, sh);
    if (r.hit === "out") return null;
    if (r.hit) return r.hit;
    sh = r.shell;
  }
  return null;
}
function explode(s, x, y, owner) {
  const ground = s.ground.slice();
  for (let col = Math.floor(x - BLAST); col <= Math.ceil(x + BLAST); col++) {
    if (col < 0 || col >= W) continue;
    const dx = col + 0.5 - x;
    if (Math.abs(dx) > BLAST) continue;
    const ext = Math.sqrt(BLAST * BLAST - dx * dx) * ASPECT;
    if (ground[col] >= y - ext) ground[col] = Math.max(ground[col], Math.min(H, Math.round(y + ext)));
  }
  const hurt = (t) => {
    const d = Math.hypot(t.x + 0.5 - x, (tankRow(s, t) + 0.5 - y) / ASPECT);
    const reach = BLAST + 1.5;
    return d >= reach ? 0 : Math.min(t.hp, Math.round(MAX_DAMAGE * (1 - d / reach)));
  };
  const dp = hurt(s.player), dc = hurt(s.cpu);
  const byPlayer = owner === "player";
  const message = dc > 0 && byPlayer ? `Hit! CPU -${dc}` : dp > 0 && !byPlayer ? `Ouch! You -${dp}` : dp > 0 ? `You hit yourself! -${dp}` : dc > 0 ? `CPU hit itself! -${dc}` : byPlayer ? "Missed." : "CPU missed.";
  return {
    ...s,
    ground,
    player: { ...s.player, hp: s.player.hp - dp },
    cpu: { ...s.cpu, hp: s.cpu.hp - dc },
    score: s.score + (byPlayer ? dc : 0),
    message
  };
}
function aiShot(s, rnd) {
  const target = s.player.x + 0.5;
  let best = { angle: 135, power: 60, miss: Infinity };
  for (let angle = 100; angle <= 165; angle += 5) {
    for (let power = 20; power <= 100; power += 2) {
      const hit = trace(s, "cpu", angle, power);
      if (!hit) continue;
      const miss2 = Math.abs(hit.x - target);
      if (miss2 < best.miss) best = { angle, power, miss: miss2 };
    }
  }
  const err = Math.max(1, 14 - 4 * s.cpuShots - 2 * (s.round - 1));
  return { angle: best.angle, power: clamp(Math.round(best.power + (rnd() * 2 - 1) * err), 5, 100) };
}
function init5(ctx) {
  return newRound(1, 0, ctx.random, "Aim with the arrows, Space to fire.");
}
function onKey5(s, key) {
  if (s.phase.kind !== "aim") return s;
  const p = s.player;
  switch (key) {
    case "left":
      return { ...s, player: { ...p, angle: Math.min(180, p.angle + 2) } };
    case "right":
      return { ...s, player: { ...p, angle: Math.max(0, p.angle - 2) } };
    case "up":
      return { ...s, player: { ...p, power: Math.min(100, p.power + 2) } };
    case "down":
      return { ...s, player: { ...p, power: Math.max(5, p.power - 2) } };
    case "space":
      return { ...s, phase: { kind: "flight", shell: launch(s, "player", p.angle, p.power) }, message: "" };
    default:
      return s;
  }
}
function resolve(s, owner, ctx) {
  if (s.player.hp <= 0) return { ...s, over: true, message: "Your tank is destroyed!" };
  if (s.cpu.hp <= 0) {
    const bonus = WIN_BONUS + s.player.hp;
    return newRound(s.round + 1, s.score + bonus, ctx.random, `CPU destroyed! +${bonus}  Round ${s.round + 1}`);
  }
  if (owner === "player") {
    const shot = aiShot(s, ctx.random);
    return { ...s, cpu: { ...s.cpu, angle: shot.angle }, phase: { kind: "cpuWait", t: CPU_WAIT_TICKS, power: shot.power } };
  }
  return { ...s, phase: { kind: "aim" }, wind: newWind(ctx.random) };
}
function update5(s, ctx) {
  const ph = s.phase;
  switch (ph.kind) {
    case "aim":
      return s;
    case "flight": {
      const { shell, hit } = advance(s, ph.shell);
      const owner = shell.owner;
      if (hit === "out") return { ...s, phase: { kind: "boom", owner, x: null, y: null, t: 1 }, message: owner === "player" ? "Missed." : "CPU missed." };
      if (hit) return { ...explode(s, hit.x, hit.y, owner), phase: { kind: "boom", owner, x: hit.x, y: hit.y, t: BOOM_TICKS } };
      const trail = [...ph.shell.trail, { x: ph.shell.x, y: ph.shell.y }].slice(-TRAIL);
      return { ...s, phase: { kind: "flight", shell: { ...shell, trail } } };
    }
    case "boom":
      return ph.t > 1 ? { ...s, phase: { ...ph, t: ph.t - 1 } } : resolve(s, ph.owner, ctx);
    case "cpuWait": {
      if (ph.t > 1) return { ...s, phase: { ...ph, t: ph.t - 1 }, message: "CPU is aiming..." };
      const cpu = { ...s.cpu, power: ph.power };
      const next = { ...s, cpu, cpuShots: s.cpuShots + 1, message: "" };
      return { ...next, phase: { kind: "flight", shell: launch(next, "cpu", cpu.angle, cpu.power) } };
    }
  }
}
function barrel(angle) {
  if (angle < 30) return { dx: 1, ch: "_" };
  if (angle < 70) return { dx: 1, ch: "/" };
  if (angle <= 110) return { dx: 0, ch: "|" };
  if (angle <= 150) return { dx: -1, ch: "\\" };
  return { dx: -1, ch: "_" };
}
function drawTank(s, t, color, screen) {
  const y = tankRow(s, t);
  screen.put(t.x - 1, y, "\u2584", color);
  screen.put(t.x, y, "\u2588", color);
  screen.put(t.x + 1, y, "\u2584", color);
  const b = barrel(t.angle);
  if (y - 1 >= 1) screen.put(t.x + b.dx, y - 1, b.ch, color);
}
function windText(wind) {
  const n = Math.round(Math.abs(wind) / MAX_WIND * 3);
  if (n === 0) return "Wind -";
  return "Wind " + (wind < 0 ? "<".repeat(n) : ">".repeat(n));
}
function draw5(s, screen) {
  for (let x = 0; x < W; x++) {
    for (let y = Math.max(1, s.ground[x]); y < H; y++) screen.put(x, y, "\u2588", y === s.ground[x] ? "brightGreen" : "green");
  }
  if (s.player.hp > 0) drawTank(s, s.player, "brightCyan", screen);
  if (s.cpu.hp > 0) drawTank(s, s.cpu, "brightRed", screen);
  const ph = s.phase;
  if (ph.kind === "aim") {
    for (const p of aimPath(s)) if (p.y >= 1) screen.put(Math.floor(p.x), Math.floor(p.y), "\xB7", "cyan");
  }
  if (ph.kind === "flight") {
    for (const p of ph.shell.trail) if (p.y >= 1) screen.put(Math.floor(p.x), Math.floor(p.y), "\xB7", "gray");
    if (ph.shell.y >= 1) screen.put(Math.floor(ph.shell.x), Math.floor(ph.shell.y), "\u25CF", "brightWhite");
  }
  if (ph.kind === "boom" && ph.x !== null && ph.y !== null) {
    const r = BLAST * (0.4 + 0.6 * (ph.t / BOOM_TICKS));
    for (let y = Math.floor(ph.y - r); y <= Math.ceil(ph.y + r); y++) {
      for (let x = Math.floor(ph.x - r); x <= Math.ceil(ph.x + r); x++) {
        if (y < 1 || y >= H || x < 0 || x >= W) continue;
        const d = Math.hypot(x + 0.5 - ph.x, (y + 0.5 - ph.y) / ASPECT);
        if (d <= r) screen.put(x, y, d < r / 2 ? "*" : "+", d < r / 2 ? "brightYellow" : "red");
      }
    }
  }
  screen.text(0, 0, `YOU ${s.player.hp}`, "brightCyan");
  screen.text(9, 0, `Angle ${s.player.angle}`, "white");
  screen.text(20, 0, `Power ${s.player.power}`, "white");
  screen.text(31, 0, windText(s.wind), "cyan");
  screen.text(42, 0, `R${s.round}`, "gray");
  const cpu = `CPU ${s.cpu.hp}`;
  screen.text(W - cpu.length, 0, cpu, "brightRed");
  if (s.message) screen.text(Math.floor((W - s.message.length) / 2), 2, s.message, "brightYellow");
}
var tankDuel = {
  id: "tank-duel",
  title: "Tank Duel",
  description: "Aim, set power, fire. The computer shoots back.",
  tickMs: 40,
  controls: "\u2190\u2192\u2191\u2193 Spc fire",
  init: init5,
  onKey: onKey5,
  update: update5,
  draw: draw5,
  score: (s) => s.score,
  isOver: (s) => s.over
};
var tank_duel_default = tankDuel;

// src/games/worm/index.ts
var BOARD_W2 = Math.floor((GAME_WIDTH - 2) / 2);
var BOARD_H2 = GAME_HEIGHT - 2;
var STEP = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
var OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
var same = (a, b) => a.x === b.x && a.y === b.y;
function spawnDot(body, ctx) {
  const free = [];
  for (let y = 0; y < BOARD_H2; y++) {
    for (let x = 0; x < BOARD_W2; x++) {
      if (!body.some((p) => p.x === x && p.y === y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  return free[Math.floor(ctx.random() * free.length)];
}
function init6(ctx) {
  const cx = Math.floor(BOARD_W2 / 2), cy = Math.floor(BOARD_H2 / 2);
  const body = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
  return {
    body,
    moved: "right",
    pending: "right",
    dot: spawnDot(body, ctx),
    score: 0,
    over: false,
    turbo: false,
    tick: 0
  };
}
function onKey6(state, key) {
  if (key === "space") return { ...state, turbo: !state.turbo };
  if (key !== "up" && key !== "down" && key !== "left" && key !== "right") return state;
  if (key === OPPOSITE[state.moved]) return state;
  return { ...state, pending: key };
}
function update6(prev2, ctx) {
  const state = { ...prev2, tick: prev2.tick + 1 };
  if (!state.turbo && state.tick % 2 === 1) return state;
  const head = state.body[0];
  const step = STEP[state.pending];
  const next = { x: head.x + step.x, y: head.y + step.y };
  if (next.x < 0 || next.x >= BOARD_W2 || next.y < 0 || next.y >= BOARD_H2) {
    return { ...state, over: true };
  }
  const eats = state.dot !== null && same(next, state.dot);
  const kept = eats ? state.body : state.body.slice(0, -1);
  if (kept.some((p) => same(p, next))) return { ...state, over: true };
  const body = [next, ...kept];
  if (!eats) return { ...state, body, moved: state.pending };
  const dot = spawnDot(body, ctx);
  return { ...state, body, moved: state.pending, score: state.score + 10, dot, over: dot === null };
}
var BORDER = "gray";
function drawBorder2(state, screen) {
  const r = GAME_WIDTH - 1, b = GAME_HEIGHT - 1;
  for (let x = 1; x < r; x++) {
    screen.put(x, 0, "\u2500", BORDER);
    screen.put(x, b, "\u2500", BORDER);
  }
  for (let y = 1; y < b; y++) {
    screen.put(0, y, "\u2502", BORDER);
    screen.put(r, y, "\u2502", BORDER);
  }
  screen.put(0, 0, "\u250C", BORDER);
  screen.put(r, 0, "\u2510", BORDER);
  screen.put(0, b, "\u2514", BORDER);
  screen.put(r, b, "\u2518", BORDER);
  if (state.turbo) screen.text(GAME_WIDTH - 10, 0, " TURBO ", "brightYellow");
}
function cell(screen, p, chars, color) {
  screen.put(1 + p.x * 2, 1 + p.y, chars[0], color);
  screen.put(2 + p.x * 2, 1 + p.y, chars[1], color);
}
function draw6(state, screen) {
  drawBorder2(state, screen);
  if (state.dot) cell(screen, state.dot, "\u25CF ", "yellow");
  state.body.forEach((p, i) => {
    if (i === 0) cell(screen, p, "\u2593\u2593", "brightGreen");
    else cell(screen, p, "\u2588\u2588", "green");
  });
}
var worm = {
  id: "worm",
  title: "Worm",
  description: "Eat dots, grow longer, don't bite yourself.",
  tickMs: 60,
  // normal speed moves every other tick (120 ms), turbo every tick
  controls: "\u2190\u2191\u2192\u2193 Spc turbo",
  maxScore: 5220,
  // 29 x 18 cells x 10 points per dot (an upper bound; the worm starts on some cells)
  length: { kind: "open", minutes: 3 },
  init: init6,
  onKey: onKey6,
  update: update6,
  draw: draw6,
  score: (s) => s.score,
  isOver: (s) => s.over
};
var worm_default = worm;

// src/games/registry.generated.ts
var games = [block_drop_default, drift_default, rail_dash_default, reflex_default, tank_duel_default, worm_default];

// src/arcade.ts
if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log("The arcade needs an interactive terminal.");
  process.exit(1);
}
try {
  trimEvents(eventsFile());
} catch {
}
var cfg = onlineConfig(process.env);
var online = cfg ? new Online({ ...cfg, accountFile: accountFile(), outboxFile: outboxFile() }) : void 0;
var app = new App({ games, scoresFile: scoresFile(), runsFile: runsFile(), nowMs: Date.now(), startGameId: process.argv[2], online, settingsFile: settingsFile() });
var watcher = new EventWatcher(eventsFile(), (ev) => app.onEvent(ev, Date.now()));
watcher.start();
try {
  const now = Date.now();
  app.replay(readRecentEvents(eventsFile(), now - TASK_MAX_AGE_MS), now);
} catch {
}
var beat = () => {
  try {
    touchAlive(aliveFile());
  } catch {
  }
};
beat();
var beatTimer = setInterval(beat, BEAT_MS);
var prev = null;
var timer = null;
var done = false;
function shutdown(code, err) {
  if (done) return;
  done = true;
  if (err === void 0) try {
    app.quit();
  } catch {
  }
  if (timer) clearInterval(timer);
  clearInterval(beatTimer);
  clearAlive(aliveFile());
  watcher.stop();
  process.stdout.write(LEAVE_ALT);
  try {
    process.stdin.setRawMode(false);
  } catch {
  }
  if (err !== void 0) console.error(err);
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));
process.on("uncaughtException", (e) => shutdown(1, e));
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdout.write(ENTER_ALT);
process.stdin.on("data", (data) => {
  for (const k of parseKeys(data)) {
    if (app.key(k, Date.now()) === "quit") return shutdown(0);
  }
});
process.stdout.on("resize", () => {
  prev = null;
});
timer = setInterval(() => {
  const now = Date.now();
  app.tick(now);
  let buf;
  try {
    buf = app.render(process.stdout.columns || 80, process.stdout.rows || 24, now);
  } catch {
    return;
  }
  const out = renderDiff(prev, buf);
  if (out) process.stdout.write(out);
  prev = buf;
}, 16);
