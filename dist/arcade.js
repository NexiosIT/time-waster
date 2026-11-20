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
  setTooSmall(tooSmall) {
    this.tooSmall = tooSmall;
  }
  end() {
    if (this.finished()) return;
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

// src/core/scores.ts
var import_node_fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var TOP_N = 10;
var RENAME_TRIES = 5;
var RENAME_DELAY_MS = 20;
function isValid(data) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return Object.values(data).every(
    (list) => Array.isArray(list) && list.every(
      (e) => typeof e === "object" && e !== null && typeof e.score === "number" && Number.isFinite(e.score) && typeof e.at === "string"
    )
  );
}
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
function parse(text) {
  try {
    const data = JSON.parse(text);
    return isValid(data) ? data : null;
  } catch {
    return null;
  }
}
function loadScores(file) {
  const text = readText(file);
  if (text === null) return {};
  const data = parse(text);
  if (data) return data;
  const again = readText(file);
  if (again === null) return {};
  if (again !== text) return parse(again) ?? {};
  try {
    import_node_fs.default.renameSync(file, file + ".bak");
  } catch {
  }
  return {};
}
function writeAtomic(file, data) {
  import_node_fs.default.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    import_node_fs.default.writeFileSync(tmp, JSON.stringify(data, null, 2));
    withRetry(() => import_node_fs.default.renameSync(tmp, file));
  } catch (err) {
    try {
      import_node_fs.default.rmSync(tmp, { force: true });
    } catch {
    }
    throw err;
  }
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

// src/core/app.ts
var ID_RE = /^[a-z0-9-]+$/;
var TOO_SMALL = "Make the window bigger";
var MENU_HINTS = "\u2191\u2193 select \xB7 Enter play \xB7 Q quit";
var App = class {
  games;
  scoresFile;
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
    this.seed = opts.seed ?? Date.now();
    this.refreshBest();
    const start = opts.startGameId ? this.games.find((g) => g.id === opts.startGameId) : void 0;
    if (start) this.start(start, opts.nowMs);
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
        break;
      case "playing":
        if (this.tooSmall && k !== "p" && k !== "escape") break;
        this.session.key(k);
        if (k === "escape" && this.session.status === "over") {
          this.banner.clearMarker();
          this.finish(this.session.score);
          this.toMenu();
        } else this.afterRun();
        break;
      case "results":
        if (k === "enter" && this.game) this.start(this.game, nowMs);
        else if (k === "escape") this.toMenu();
        break;
      case "crashed":
        if (k === "enter" || k === "escape") this.toMenu();
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
    this.afterRun();
  }
  onEvent(ev, nowMs) {
    this.banner.push(ev, nowMs);
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
      this.drawScreen(area);
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
    this.screen = "playing";
    this.afterRun();
  }
  toMenu() {
    this.banner.clearMarker();
    this.session = null;
    this.results = null;
    this.screen = "menu";
    this.refreshBest();
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
      this.finish(s.score);
    }
  }
  finish(score) {
    const id = this.game.id;
    try {
      const r = addScore(this.scoresFile, id, score);
      this.results = { score, isBest: r.isBest, top: r.top, saveFailed: false };
      if (r.top.length) this.best.set(id, Math.max(...r.top.map((e) => e.score)));
    } catch {
      this.results = { score, isBest: false, top: [], saveFailed: true };
    }
    this.session = null;
    this.screen = "results";
  }
  refreshBest() {
    this.best.clear();
    try {
      const all = loadScores(this.scoresFile);
      for (const [id, list] of Object.entries(all)) {
        if (list.length) this.best.set(id, Math.max(...list.map((e) => e.score)));
      }
    } catch {
    }
  }
  drawScreen(area) {
    const centre = (y, s, c = "white") => area.text(Math.max(0, Math.floor((GAME_WIDTH - s.length) / 2)), y, clip(s, GAME_WIDTH), c);
    if (this.screen === "menu") {
      centre(1, "ARCADE", "brightCyan");
      if (!this.games.length) {
        centre(5, "No games yet", "gray");
        return;
      }
      this.games.forEach((g, i) => {
        const best = this.best.has(g.id) ? String(this.best.get(g.id)) : "-";
        const line = `${i === this.sel ? "> " : "  "}${g.title}`;
        area.text(10, 4 + i, clip(line, 36), i === this.sel ? "brightWhite" : "white");
        area.text(48, 4 + i, clip(`Best ${best}`, 12), "gray");
      });
      area.text(0, 17, clip(this.games[this.sel].description, GAME_WIDTH), "gray");
    } else if (this.screen === "results" && this.results) {
      const r = this.results;
      centre(1, `${this.game.title} \u2014 Score ${r.score}`, "brightWhite");
      if (r.isBest) centre(3, "New best!", "brightGreen");
      if (r.saveFailed) centre(3, "Couldn't save score", "brightRed");
      r.top.forEach((e, i) => centre(5 + i, `${String(i + 1).padStart(2)}. ${e.score}`));
      centre(18, "Enter: play again \xB7 Esc: menu", "gray");
    } else if (this.screen === "crashed") {
      centre(8, this.crash, "brightRed");
      centre(18, "Enter or Esc: menu", "gray");
    }
  }
};
function wellFormed(g) {
  return typeof g.id === "string" && typeof g.title === "string" && typeof g.description === "string" && typeof g.controls === "string" && typeof g.tickMs === "number" && Number.isFinite(g.tickMs) && g.tickMs > 0 && [g.init, g.onKey, g.update, g.draw, g.score, g.isOver].every((f) => typeof f === "function");
}
function clip(s, n) {
  return n <= 0 ? "" : s.length > n ? s.slice(0, n) : s;
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
function trimEvents(file, keep = 100) {
  let text;
  try {
    text = import_node_fs2.default.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const lines = text.split("\n").filter((l) => l.length > 0);
  if (lines.length <= keep) return;
  import_node_fs2.default.writeFileSync(file, lines.slice(-keep).join("\n") + "\n");
}
function parseEvent(text) {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && (v.type === "done" || v.type === "attention") && typeof v.at === "string" && typeof v.project === "string") {
      return { type: v.type, at: v.at, project: v.project };
    }
  } catch {
  }
  return null;
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
function aliveFile(home) {
  return path3.join(dataDir(home), "arcade.alive");
}

// src/core/alive.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var BEAT_MS = 2e3;
function touchAlive(file) {
  fs3.mkdirSync(path4.dirname(file), { recursive: true });
  fs3.writeFileSync(file, String(process.pid));
}
function clearAlive(file) {
  try {
    fs3.unlinkSync(file);
  } catch {
  }
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
function tryPlace(count, ctx) {
  const pillars = [];
  while (pillars.length < count) {
    let placed = false;
    for (let a = 0; a < ATTEMPTS_PER_PILLAR && !placed; a++) {
      const w = randInt(ctx, 2, 4);
      const h = randInt(ctx, 1, 2);
      const x = randInt(ctx, 3, 56 - w + 1);
      const y = randInt(ctx, 3, 16 - h + 1);
      const cand = { x, y, w, h };
      if (intersects(cand, SAFE_ZONE)) continue;
      if (pillars.some((q) => intersects(grown(cand, 2), q))) continue;
      pillars.push(cand);
      placed = true;
    }
    if (!placed) return null;
  }
  return pillars;
}
function generatePillars(ctx) {
  const count = 5 + Math.floor(ctx.random() * 3);
  for (let r = 0; r < MAX_RESTARTS; r++) {
    const result = tryPlace(count, ctx);
    if (result) return result;
  }
  return FALLBACK_PILLARS.map((p) => ({ ...p }));
}
function spawnCoin(car, pillars, ctx) {
  const candidates = [];
  for (let y = 1; y < GAME_HEIGHT - 1; y++) {
    for (let x = 1; x < GAME_WIDTH - 1; x++) {
      let clear = true;
      for (let dy = -1; dy <= 1 && clear; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (isBlocked({ x: x + dx, y: y + dy }, pillars)) {
            clear = false;
            break;
          }
      if (clear) candidates.push({ x, y });
    }
  }
  const far = candidates.filter((c) => Math.hypot(c.x - car.x, 2 * (c.y - car.y)) >= MIN_COIN_DIST);
  const pool = far.length > 0 ? far : candidates;
  return pool[Math.floor(ctx.random() * pool.length)];
}

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

// src/games/drift/index.ts
var TRAIL_LEN = 6;
var CAR = ["\u2192", "\u2198", "\u2193", "\u2199", "\u2190", "\u2196", "\u2191", "\u2197"];
function cellOf(s) {
  return { x: Math.round(s.x), y: Math.round(s.y) };
}
var samePoint = (a, b) => a.x === b.x && a.y === b.y;
function init(ctx) {
  const pillars = generatePillars(ctx);
  return {
    x: START.x,
    y: START.y,
    heading: 0,
    travel: 0,
    lastTurn: 1,
    coins: 0,
    coin: spawnCoin(START, pillars, ctx),
    pillars,
    trail: [],
    crashed: false
  };
}
function onKey(state, key) {
  if (state.crashed) return state;
  if (key === "right") return { ...state, heading: rotateHeading(state.heading, 1), lastTurn: 1 };
  if (key === "left") return { ...state, heading: rotateHeading(state.heading, -1), lastTurn: -1 };
  return state;
}
function update(state, ctx) {
  if (state.crashed) return state;
  const speed = speedForCoins(state.coins);
  const travel = turnToward(state.travel, headingAngle(state.heading), gripFor(speed), state.lastTurn);
  const dx = Math.cos(travel) * speed * TICK_MS / 1e3;
  const dy = Math.sin(travel) * speed * TICK_MS / 1e3 * 0.5;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  let { x, y, coins, coin, trail } = state;
  let crashed = false;
  for (let i = 0; i < n; i++) {
    x += dx / n;
    y += dy / n;
    const cell2 = cellOf({ x, y });
    if (isBlocked(cell2, state.pillars)) {
      crashed = true;
      break;
    }
    if (samePoint(cell2, coin)) {
      coins += 1;
      coin = spawnCoin(cell2, state.pillars, ctx);
    }
    if (trail.length === 0 || !samePoint(trail[0], cell2)) trail = [cell2, ...trail].slice(0, TRAIL_LEN);
  }
  return { ...state, x, y, travel, coins, coin, trail, crashed };
}
function draw(state, screen) {
  const W = GAME_WIDTH - 1, H = GAME_HEIGHT - 1;
  for (let x = 1; x < W; x++) {
    screen.put(x, 0, "\u2500", "gray");
    screen.put(x, H, "\u2500", "gray");
  }
  for (let y = 1; y < H; y++) {
    screen.put(0, y, "\u2502", "gray");
    screen.put(W, y, "\u2502", "gray");
  }
  screen.put(0, 0, "\u250C", "gray");
  screen.put(W, 0, "\u2510", "gray");
  screen.put(0, H, "\u2514", "gray");
  screen.put(W, H, "\u2518", "gray");
  for (const r of state.pillars) {
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) screen.put(x, y, "\u2588", "blue");
  }
  const car = cellOf(state);
  if (isDrifting(state.travel, state.heading)) {
    for (const t of state.trail) if (!samePoint(t, car)) screen.put(t.x, t.y, "\xB7", "gray");
  }
  screen.put(state.coin.x, state.coin.y, "\u25CF", "yellow");
  screen.put(car.x, car.y, CAR[state.heading], state.crashed ? "red" : "brightCyan");
}
var drift = {
  id: "drift",
  title: "Drift",
  description: "Drift for coins. Every coin is faster. Don't touch the walls.",
  tickMs: TICK_MS,
  controls: "\u2190\u2192 steer",
  init,
  onKey,
  update,
  draw,
  score: (s) => s.coins * 10,
  isOver: (s) => s.crashed
};
var drift_default = drift;

// src/games/worm/index.ts
var BOARD_W = Math.floor((GAME_WIDTH - 2) / 2);
var BOARD_H = GAME_HEIGHT - 2;
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
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (!body.some((p) => p.x === x && p.y === y)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  return free[Math.floor(ctx.random() * free.length)];
}
function init2(ctx) {
  const cx = Math.floor(BOARD_W / 2), cy = Math.floor(BOARD_H / 2);
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
function onKey2(state, key) {
  if (key === "space") return { ...state, turbo: !state.turbo };
  if (key !== "up" && key !== "down" && key !== "left" && key !== "right") return state;
  if (key === OPPOSITE[state.moved]) return state;
  return { ...state, pending: key };
}
function update2(prev2, ctx) {
  const state = { ...prev2, tick: prev2.tick + 1 };
  if (!state.turbo && state.tick % 2 === 1) return state;
  const head = state.body[0];
  const step = STEP[state.pending];
  const next = { x: head.x + step.x, y: head.y + step.y };
  if (next.x < 0 || next.x >= BOARD_W || next.y < 0 || next.y >= BOARD_H) {
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
function drawBorder(state, screen) {
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
function draw2(state, screen) {
  drawBorder(state, screen);
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
  init: init2,
  onKey: onKey2,
  update: update2,
  draw: draw2,
  score: (s) => s.score,
  isOver: (s) => s.over
};
var worm_default = worm;

// src/games/registry.generated.ts
var games = [drift_default, worm_default];

// src/arcade.ts
if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.log("The arcade needs an interactive terminal.");
  process.exit(1);
}
try {
  trimEvents(eventsFile());
} catch {
}
var app = new App({ games, scoresFile: scoresFile(), nowMs: Date.now(), startGameId: process.argv[2] });
var watcher = new EventWatcher(eventsFile(), (ev) => app.onEvent(ev, Date.now()));
watcher.start();
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
  const buf = app.render(process.stdout.columns || 80, process.stdout.rows || 24, now);
  const out = renderDiff(prev, buf);
  if (out) process.stdout.write(out);
  prev = buf;
}, 16);
