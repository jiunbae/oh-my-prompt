import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../rate-limit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within the limit", () => {
    const limiter = createRateLimiter(3, 60_000);

    const r1 = limiter("user-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter("user-1");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter("user-1");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter(2, 60_000);

    limiter("user-1");
    limiter("user-1");

    const r3 = limiter("user-1");
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter(1, 60_000);

    const r1 = limiter("user-1");
    expect(r1.allowed).toBe(true);

    const r2 = limiter("user-2");
    expect(r2.allowed).toBe(true);

    const r3 = limiter("user-1");
    expect(r3.allowed).toBe(false);
  });

  it("resets after the window expires", () => {
    const limiter = createRateLimiter(1, 60_000);

    const r1 = limiter("user-1");
    expect(r1.allowed).toBe(true);

    const r2 = limiter("user-1");
    expect(r2.allowed).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61_000);

    const r3 = limiter("user-1");
    expect(r3.allowed).toBe(true);
  });

  it("returns correct retryAfterMs", () => {
    const limiter = createRateLimiter(1, 60_000);

    limiter("user-1");

    vi.advanceTimersByTime(20_000);

    const r2 = limiter("user-1");
    expect(r2.allowed).toBe(false);
    // Should be ~40 seconds left in the window
    expect(r2.retryAfterMs).toBeLessThanOrEqual(40_000);
    expect(r2.retryAfterMs).toBeGreaterThan(39_000);
  });

  it("cleans up expired entries", () => {
    const limiter = createRateLimiter(1, 1_000);

    limiter("user-1");
    limiter("user-2");

    // Advance past window + cleanup interval (5 min)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Trigger cleanup by calling limiter
    const result = limiter("user-1");
    expect(result.allowed).toBe(true);
  });
});
