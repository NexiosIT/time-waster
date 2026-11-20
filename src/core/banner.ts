import type { ClaudeEvent } from './events';

export const BANNER_MS = 10_000;

export interface BannerView {
  mode: 'full' | 'marker';
  text: string;
}

export class Banner {
  private ev: ClaudeEvent | null = null;
  private pushedAt = 0;
  private marker = false;

  push(ev: ClaudeEvent, nowMs: number): void {
    this.ev = ev;
    this.pushedAt = nowMs;
    this.marker = true;
  }

  view(nowMs: number): BannerView | null {
    const ev = this.ev;
    if (!ev) return null;
    if (nowMs - this.pushedAt < BANNER_MS) {
      const base = ev.type === 'done' ? '✓ Claude is done' : '! Claude needs you';
      return { mode: 'full', text: ev.project ? `${base} — ${ev.project}` : base };
    }
    if (!this.marker) return null;
    return { mode: 'marker', text: ev.type === 'done' ? '● Claude done' : '● Claude needs you' };
  }

  color(): 'brightGreen' | 'brightYellow' {
    return this.ev?.type === 'attention' ? 'brightYellow' : 'brightGreen';
  }

  clearMarker(): void {
    this.marker = false;
  }
}
