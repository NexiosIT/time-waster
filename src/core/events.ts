import fs from 'node:fs';
import * as path from 'node:path';

export type ClaudeEvent = { type: 'done' | 'attention'; at: string; project: string };

export function toEvent(kind: 'done' | 'attention', hookInput: string, now: Date): ClaudeEvent | null {
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(hookInput.replace(/^﻿/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
  } catch {
    // invalid JSON: fall through with empty input
  }
  if (kind === 'attention') {
    const nt = input.notification_type;
    const message = input.message;
    if (nt === 'idle_prompt') return null;
    if (nt === undefined && typeof message === 'string' && /waiting for your input/i.test(message)) return null;
  }
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';
  return { type: kind, at: now.toISOString(), project: cwd ? path.win32.basename(cwd) : '' };
}

export function appendEvent(file: string, ev: ClaudeEvent): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(ev) + '\n');
}

export function writeShim(binDir: string, pluginRoot: string): void {
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'arcade.cmd'), `@node "${pluginRoot}\\dist\\arcade.js" %*\r\n`);
}

export function trimEvents(file: string, keep = 100): void {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length <= keep) return;
  fs.writeFileSync(file, lines.slice(-keep).join('\n') + '\n');
}

function parseEvent(text: string): ClaudeEvent | null {
  try {
    const v = JSON.parse(text) as Partial<ClaudeEvent> | null;
    if (
      v &&
      typeof v === 'object' &&
      (v.type === 'done' || v.type === 'attention') &&
      typeof v.at === 'string' &&
      typeof v.project === 'string'
    ) {
      return { type: v.type, at: v.at, project: v.project };
    }
  } catch {
    // skip invalid line
  }
  return null;
}

export function readNewEvents(file: string, offset: number): { events: ClaudeEvent[]; offset: number } {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return { events: [], offset: 0 };
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = size < offset ? 0 : offset;
    const len = size - start;
    if (len <= 0) return { events: [], offset: start };
    const buf = Buffer.alloc(len);
    let read = 0;
    while (read < len) {
      const n = fs.readSync(fd, buf, read, len - read, start + read);
      if (n === 0) break;
      read += n;
    }
    const lastNl = buf.subarray(0, read).lastIndexOf(0x0a);
    if (lastNl < 0) return { events: [], offset: start };
    const events: ClaudeEvent[] = [];
    for (const l of buf.subarray(0, lastNl).toString('utf8').split('\n')) {
      const ev = l.trim() ? parseEvent(l) : null;
      if (ev) events.push(ev);
    }
    return { events, offset: start + lastNl + 1 };
  } catch {
    return { events: [], offset };
  } finally {
    fs.closeSync(fd);
  }
}

export class EventWatcher {
  private offset = 0;
  private startedAt = 0;
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private file: string,
    private onEvent: (e: ClaudeEvent) => void,
    private pollMs = 1000,
  ) {}

  start(): void {
    this.stop();
    this.startedAt = Date.now();
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    } catch {
      // poll will keep trying
    }
    try {
      this.offset = fs.statSync(this.file).size;
    } catch {
      this.offset = 0;
    }
    try {
      this.watcher = fs.watch(path.dirname(this.file), () => this.poll());
      this.watcher.on('error', () => {});
    } catch {
      this.watcher = null;
    }
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(): void {
    if (!this.timer) return;
    const r = readNewEvents(this.file, this.offset);
    this.offset = r.offset;
    for (const e of r.events) {
      const t = Date.parse(e.at);
      if (!Number.isNaN(t) && t >= this.startedAt) this.onEvent(e);
    }
  }
}
