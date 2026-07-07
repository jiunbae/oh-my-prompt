import { describe, it, expect } from "vitest";
import { firingBucket } from "@/lib/queue";
import { isPerUserJob } from "@/lib/scheduler";

describe("firingBucket", () => {
  it("is a stable YYYYMMDDHH key for a given instant", () => {
    const d = new Date("2026-07-07T13:37:00.000Z");
    const bucket = firingBucket(d);
    expect(bucket).toMatch(/^\d{10}$/);
    // Deterministic: same instant -> same bucket.
    expect(firingBucket(d)).toBe(bucket);
  });

  it("gives the same bucket for two instants in the same app-timezone hour", () => {
    const a = new Date("2026-07-07T13:00:05.000Z");
    const b = new Date("2026-07-07T13:59:55.000Z");
    expect(firingBucket(a)).toBe(firingBucket(b));
  });

  it("gives different buckets across an hour boundary", () => {
    const a = new Date("2026-07-07T13:59:00.000Z");
    const b = new Date("2026-07-07T14:00:00.000Z");
    expect(firingBucket(a)).not.toBe(firingBucket(b));
  });
});

describe("isPerUserJob", () => {
  it("classifies per-user vs global extension job names", () => {
    // Per-user processors fan out over every user.
    expect(isPerUserJob("insight:daily-summary")).toBe(true);
    expect(isPerUserJob("insight:weekly-trends")).toBe(true);
    expect(isPerUserJob("insight:prompt-quality")).toBe(true);
    // Global processors run once.
    expect(isPerUserJob("email:weekly-digest")).toBe(false);
    expect(isPerUserJob("slack:daily-summary")).toBe(false);
    expect(isPerUserJob("alerts:evaluate-rules")).toBe(false);
    // Unknown job name is not per-user.
    expect(isPerUserJob("does-not-exist")).toBe(false);
  });
});
