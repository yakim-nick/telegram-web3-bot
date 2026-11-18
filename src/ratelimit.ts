/** A small in-memory token bucket, one bucket per user. */

export interface RateDecision {
  allowed: boolean;
  /** Seconds until one more request is allowed (0 when allowed). */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly buckets = new Map<number, { tokens: number; updated: number }>();
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity: number,
    perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly maxBuckets = 10_000,
  ) {
    this.refillPerMs = perMinute / 60_000;
  }

  take(key: number): RateDecision {
    const time = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: time };
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + (time - bucket.updated) * this.refillPerMs,
    );
    bucket.updated = time;
    this.buckets.set(key, bucket);
    this.evictIfLarge(time);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((1 - bucket.tokens) / this.refillPerMs / 1000),
    };
  }

  /** Bound memory: when there are too many users, drop buckets that have fully refilled. */
  private evictIfLarge(time: number): void {
    if (this.buckets.size <= this.maxBuckets) return;
    for (const [key, bucket] of this.buckets) {
      const tokens = Math.min(
        this.capacity,
        bucket.tokens + (time - bucket.updated) * this.refillPerMs,
      );
      if (tokens >= this.capacity) this.buckets.delete(key);
    }
  }
}
