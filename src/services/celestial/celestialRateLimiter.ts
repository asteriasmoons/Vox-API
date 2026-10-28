//
//  celestialRateLimiter.ts
//  Centralized, sliding-window requests-per-minute limiter shared by the
//  celestial generation worker so background generation stays within Groq's
//  free-plan pace. HTTP 429 and transient-failure backoff are additionally
//  handled inside groqAIClient (retry-after header + exponential backoff).
//
//  Configure with CELESTIAL_GROQ_RPM (default 25) and CELESTIAL_GROQ_CONCURRENCY
//  (default 1). Keep the pace conservative; the actual account/model limits are
//  the real ceiling (see Groq rate-limit docs for the configured model).
//

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SlidingWindowRateLimiter {
  private hits: number[] = [];
  constructor(private readonly rpm: number) {}

  async acquire(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const now = Date.now();
      this.hits = this.hits.filter((t) => now - t < 60_000);
      if (this.hits.length < this.rpm) {
        this.hits.push(now);
        return;
      }
      const oldest = this.hits[0] ?? now;
      const waitMs = 60_000 - (now - oldest) + 50;
      await sleep(Math.max(waitMs, 250));
    }
  }
}

export const CELESTIAL_GROQ_CONCURRENCY = Math.max(
  1,
  Number(process.env.CELESTIAL_GROQ_CONCURRENCY) || 1,
);

export const celestialRateLimiter = new SlidingWindowRateLimiter(
  Math.max(1, Number(process.env.CELESTIAL_GROQ_RPM) || 25),
);
