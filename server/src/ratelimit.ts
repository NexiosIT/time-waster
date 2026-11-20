/** Sliding-window rate limiter kept in memory: at most `limit` hits per key in any `windowMs`. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private calls = 0;

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Records a hit for `key` and returns true if it is allowed; a refused hit is not recorded. */
  hit(key: string, nowMs: number): boolean {
    if (++this.calls % 1000 === 0) this.sweep(nowMs);
    const recent = (this.hits.get(key) ?? []).filter((t) => t > nowMs - this.windowMs);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(nowMs);
    if (recent.length > 0) this.hits.set(key, recent);
    else this.hits.delete(key);
    return allowed;
  }

  /** Drops keys whose hits have all left the window, so the map does not grow without bound. */
  private sweep(nowMs: number): void {
    for (const [key, times] of this.hits) {
      if (times[times.length - 1] <= nowMs - this.windowMs) this.hits.delete(key);
    }
  }
}
