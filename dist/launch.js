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

// src/launch.ts
var launch_exports = {};
__export(launch_exports, {
  isOnPath: () => isOnPath,
  launchCommand: () => launchCommand,
  main: () => main,
  spawnDetached: () => spawnDetached
});
module.exports = __toCommonJS(launch_exports);
var path2 = __toESM(require("node:path"));
var import_node_child_process = require("node:child_process");

// src/core/paths.ts
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));
function dataDir(home = os.homedir()) {
  return path.join(home, ".time-waster");
}
function binDir(home) {
  return path.join(dataDir(home), "bin");
}

// src/launch.ts
function launchCommand(pluginRoot, hasWt) {
  const arcade = path2.win32.join(pluginRoot, "dist", "arcade.js");
  if (hasWt) {
    return { file: "wt", args: ["-w", "0", "nt", "node", arcade], verbatim: false };
  }
  return { file: "cmd", args: ["/c", `start "" cmd /c node "${arcade}"`], verbatim: true };
}
var norm = (p) => p.replace(/\\+$/, "").toLowerCase();
function isOnPath(dir, pathEnv) {
  const want = norm(dir);
  return pathEnv.split(";").filter((e) => e.length > 0).some((e) => norm(e) === want);
}
function spawnDetached(cmd, timeoutMs = 2e3) {
  return new Promise((resolve2) => {
    try {
      const child = (0, import_node_child_process.spawn)(cmd.file, cmd.args, {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: cmd.verbatim
      });
      const timer = setTimeout(() => resolve2(null), timeoutMs);
      child.once("error", (e) => {
        clearTimeout(timer);
        resolve2(e.message);
      });
      child.once("spawn", () => {
        clearTimeout(timer);
        child.unref();
        resolve2(null);
      });
    } catch (e) {
      resolve2(e instanceof Error ? e.message : String(e));
    }
  });
}
async function main() {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT ?? path2.resolve(__dirname, "..");
    const hasWt = (0, import_node_child_process.spawnSync)("where", ["wt"], { stdio: "ignore" }).status === 0;
    const failure = await spawnDetached(launchCommand(root, hasWt));
    if (failure) {
      console.log("Could not open the arcade: " + failure);
      return;
    }
    console.log("Arcade opened.");
    if (!isOnPath(binDir(), process.env.PATH ?? process.env.Path ?? "")) {
      console.log("To start the arcade while Claude is busy, run once in PowerShell, then open a new terminal:");
      console.log(
        `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';' + "$env:USERPROFILE\\.time-waster\\bin", 'User')`
      );
      console.log("Then restart Claude Code.");
    }
  } catch (e) {
    console.log("Could not open the arcade: " + (e instanceof Error ? e.message : String(e)));
  }
}
if (require.main === module) {
  void main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isOnPath,
  launchCommand,
  main,
  spawnDetached
});
