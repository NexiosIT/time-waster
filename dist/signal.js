"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/signal.ts
var signal_exports = {};
__export(signal_exports, {
  main: () => main
});
module.exports = __toCommonJS(signal_exports);
var path3 = __toESM(require("node:path"));

// src/core/events.ts
var import_node_fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function toEvent(kind, hookInput, now) {
  let input = {};
  try {
    const parsed = JSON.parse(hookInput.replace(/^﻿/, ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
  } catch {
  }
  if (kind === "attention") {
    const nt = input.notification_type;
    const message = input.message;
    if (nt === "idle_prompt") return null;
    if (nt === void 0 && typeof message === "string" && /waiting for your input/i.test(message)) return null;
  }
  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  return { type: kind, at: now.toISOString(), project: cwd ? path.win32.basename(cwd) : "" };
}
function appendEvent(file, ev) {
  import_node_fs.default.mkdirSync(path.dirname(file), { recursive: true });
  import_node_fs.default.appendFileSync(file, JSON.stringify(ev) + "\n");
}
function writeShim(binDir2, pluginRoot) {
  import_node_fs.default.mkdirSync(binDir2, { recursive: true });
  import_node_fs.default.writeFileSync(path.join(binDir2, "arcade.cmd"), `@node "${pluginRoot}\\dist\\arcade.js" %*\r
`);
}

// src/core/paths.ts
var os = __toESM(require("node:os"));
var path2 = __toESM(require("node:path"));
function dataDir(home = os.homedir()) {
  return path2.join(home, ".time-waster");
}
function eventsFile(home) {
  return path2.join(dataDir(home), "events.jsonl");
}
function binDir(home) {
  return path2.join(dataDir(home), "bin");
}

// src/signal.ts
function main(argv, stdinText, home) {
  try {
    const cmd = argv[0];
    if (cmd === "done" || cmd === "attention") {
      const ev = toEvent(cmd, stdinText, /* @__PURE__ */ new Date());
      if (ev) appendEvent(eventsFile(home), ev);
    } else if (cmd === "shim") {
      writeShim(binDir(home), process.env.CLAUDE_PLUGIN_ROOT ?? path3.resolve(__dirname, ".."));
    }
  } catch {
  }
}
function readStdin(timeoutMs) {
  return new Promise((resolve2) => {
    let data = "";
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve2(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => data += c);
      process.stdin.on("end", finish);
      process.stdin.on("error", finish);
    } catch {
      finish();
    }
  });
}
if (require.main === module) {
  readStdin(100).then((text) => main(process.argv.slice(2), text)).catch(() => {
  }).then(() => process.exit(0));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
