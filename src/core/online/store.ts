import fs from 'node:fs';
import { readText, withRetry, writeAtomic } from '../fsutil';
import * as path from 'node:path';

export type Account = { serverUrl: string; token: string; login: string };
export type OutboxEntry = { game: string; score: number; at: string };

const OUTBOX_MAX = 50;

function isAccount(d: unknown): d is Account {
  if (typeof d !== 'object' || d === null) return false;
  const a = d as Record<string, unknown>;
  return typeof a.serverUrl === 'string' && typeof a.token === 'string' && typeof a.login === 'string';
}

function isEntry(d: unknown): d is OutboxEntry {
  if (typeof d !== 'object' || d === null) return false;
  const e = d as Record<string, unknown>;
  return typeof e.game === 'string' && typeof e.score === 'number' && Number.isFinite(e.score) && typeof e.at === 'string';
}

export function loadAccount(file: string): Account | null {
  try {
    const text = readText(file);
    if (text === null) return null;
    const d: unknown = JSON.parse(text);
    return isAccount(d) ? { serverUrl: d.serverUrl, token: d.token, login: d.login } : null;
  } catch {
    return null;
  }
}

export function saveAccount(file: string, a: Account): void {
  writeAtomic(file, JSON.stringify(a, null, 2));
}

export function clearAccount(file: string): void {
  withRetry(() => fs.rmSync(file, { force: true }));
}

export function appendOutbox(file: string, e: OutboxEntry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(e) + '\n');
}

export function readOutbox(file: string): OutboxEntry[] {
  let text: string | null;
  try {
    text = readText(file);
  } catch {
    return [];
  }
  if (text === null) return [];
  const out: OutboxEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const d: unknown = JSON.parse(line);
      if (isEntry(d)) out.push({ game: d.game, score: d.score, at: d.at });
    } catch {
      // skip bad line
    }
  }
  return out;
}

export function writeOutbox(file: string, entries: OutboxEntry[]): void {
  const kept = entries.slice(-OUTBOX_MAX);
  writeAtomic(file, kept.map((e) => JSON.stringify(e) + '\n').join(''));
}
