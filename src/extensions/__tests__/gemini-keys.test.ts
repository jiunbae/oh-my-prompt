import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MAX_PER_MINUTE_WAIT_MS,
  availableKeys,
  getGeminiKeys,
  getPaidGeminiKey,
  parkKey,
  parseQuotaError,
  perMinuteBackoffMs,
  poolStatus,
  releaseKey,
  resetPoolState,
} from "@/extensions/gemini-keys";

const SIX_KEYS = ["k1", "k2", "k3", "k4", "k5", "k6"].join(",");

beforeEach(() => {
  resetPoolState();
  process.env.OMP_GEMINI_API_KEYS = SIX_KEYS;
});

afterEach(() => {
  delete process.env.OMP_GEMINI_API_KEYS;
  delete process.env.OMP_GEMINI_API_KEY_PAID;
  vi.useRealTimers();
});

describe("key labels", () => {
  it("labels keys free-1..free-6 in configured order, per the contract label vocabulary", () => {
    expect(getGeminiKeys().map((k) => k.label)).toEqual([
      "free-1",
      "free-2",
      "free-3",
      "free-4",
      "free-5",
      "free-6",
    ]);
  });

  it("ignores blanks and surrounding whitespace", () => {
    process.env.OMP_GEMINI_API_KEYS = " a , ,b ,";
    expect(getGeminiKeys()).toEqual([
      { label: "free-1", apiKey: "a", isPaid: false },
      { label: "free-2", apiKey: "b", isPaid: false },
    ]);
  });

  it("reports an empty pool when nothing is configured", () => {
    delete process.env.OMP_GEMINI_API_KEYS;
    expect(getGeminiKeys()).toEqual([]);
    expect(availableKeys()).toEqual([]);
  });
});

describe("round robin", () => {
  it("starts each request on the next key so load spreads across projects", () => {
    expect(availableKeys()[0].label).toBe("free-1");
    expect(availableKeys()[0].label).toBe("free-2");
    expect(availableKeys()[0].label).toBe("free-3");
  });

  it("still offers every key as a fallback, in wrap-around order", () => {
    availableKeys(); // advance past free-1
    expect(availableKeys().map((k) => k.label)).toEqual([
      "free-2",
      "free-3",
      "free-4",
      "free-5",
      "free-6",
      "free-1",
    ]);
  });
});

describe("parking a key after a 429", () => {
  it("parks a per-minute breach briefly, using the provider's retryDelay", () => {
    const now = Date.now();
    parkKey("free-1", "GenerateRequestsPerMinutePerProjectPerModel", 30);

    expect(availableKeys(now).map((k) => k.label)).not.toContain("free-1");
    // Clears on its own well before the day is out.
    expect(availableKeys(now + 40_000).map((k) => k.label)).toContain("free-1");
  });

  it("parks a per-day breach until the Pacific reset, not for seconds", () => {
    const now = Date.now();
    parkKey("free-2", "GenerateRequestsPerDayPerProjectPerModel", 30);

    expect(availableKeys(now + 60_000).map((k) => k.label)).not.toContain("free-2");

    const status = poolStatus(now).find((s) => s.label === "free-2");
    expect(status?.available).toBe(false);
    expect(status?.reason).toBe("daily quota exhausted");
    // Somewhere within the next 24h, never a few seconds.
    expect(status!.secondsRemaining!).toBeGreaterThan(60);
    expect(status!.secondsRemaining!).toBeLessThanOrEqual(86_400);
  });

  it("keeps the rest of the pool usable when one project is exhausted", () => {
    parkKey("free-1", "GenerateRequestsPerDayPerProjectPerModel", null);
    const labels = availableKeys().map((k) => k.label);
    expect(labels).not.toContain("free-1");
    expect(labels).toHaveLength(5);
  });

  it("empties the pool when every key is parked and no paid key is configured", () => {
    for (const label of ["free-1", "free-2", "free-3", "free-4", "free-5", "free-6"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    expect(availableKeys()).toEqual([]);
  });

  it("releases a key once it serves a request again", () => {
    parkKey("free-3", "GenerateRequestsPerMinutePerProjectPerModel", 600);
    expect(availableKeys().map((k) => k.label)).not.toContain("free-3");
    releaseKey("free-3");
    expect(availableKeys().map((k) => k.label)).toContain("free-3");
  });
});

describe("parsing Gemini 429 bodies", () => {
  it("pulls the quota id and retry delay out of the real error shape", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.QuotaFailure",
            violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }],
          },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "27s" },
        ],
      },
    });

    expect(parseQuotaError(body)).toEqual({
      quotaId: "GenerateRequestsPerDayPerProjectPerModel",
      retryDelaySec: 27,
    });
  });

  it("degrades to the cheaper assumption on an unfamiliar body", () => {
    // An unparseable body must not park a key until tomorrow.
    expect(parseQuotaError("<html>502</html>")).toEqual({ quotaId: "", retryDelaySec: null });
    const now = Date.now();
    parkKey("free-4", "", null);
    expect(poolStatus(now).find((s) => s.label === "free-4")?.reason).toBe("per-minute quota");
  });
});

describe("paid key as last resort", () => {
  beforeEach(() => {
    process.env.OMP_GEMINI_API_KEY_PAID = "paid";
  });

  it("labels the paid key paid-1, per the contract label vocabulary", () => {
    expect(getPaidGeminiKey()).toEqual({ label: "paid-1", apiKey: "paid", isPaid: true });
  });

  it("is absent when not configured", () => {
    delete process.env.OMP_GEMINI_API_KEY_PAID;
    expect(getPaidGeminiKey()).toBeNull();
  });

  it("is NOT offered while any free key is usable", () => {
    // This is the property that keeps the paid key from becoming a standing route.
    for (const label of ["free-1", "free-2", "free-3", "free-4", "free-5"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    const labels = availableKeys().map((k) => k.label);
    expect(labels).toEqual(["free-6"]);
    expect(labels).not.toContain("paid-1");
  });

  it("is offered only once every free key is parked", () => {
    for (const label of ["free-1", "free-2", "free-3", "free-4", "free-5", "free-6"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    expect(availableKeys().map((k) => k.label)).toEqual(["paid-1"]);
  });

  it("empties the pool when the paid key is parked too", () => {
    for (const label of ["free-1", "free-2", "free-3", "free-4", "free-5", "free-6", "paid-1"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    expect(availableKeys()).toEqual([]);
  });

  it("shows the paid key in the diagnostics snapshot", () => {
    expect(poolStatus().map((s) => s.label)).toContain("paid-1");
  });
});

describe("per-minute backoff", () => {
  it("prefers the provider's retryDelay when it gives one", () => {
    const ms = perMinuteBackoffMs(0, 3);
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThanOrEqual(MAX_PER_MINUTE_WAIT_MS);
  });

  it("grows exponentially when the provider gives no delay", () => {
    expect(perMinuteBackoffMs(0, null)).toBeLessThan(perMinuteBackoffMs(3, null));
  });

  it("never waits longer than the cap, so one key cannot stall a request", () => {
    for (const attempt of [0, 1, 5, 20]) {
      expect(perMinuteBackoffMs(attempt, 600)).toBeLessThanOrEqual(MAX_PER_MINUTE_WAIT_MS);
      expect(perMinuteBackoffMs(attempt, null)).toBeLessThanOrEqual(MAX_PER_MINUTE_WAIT_MS);
    }
  });
});

describe("labels satisfy the contract's validation rules", () => {
  // The vocabulary is free-1..free-6 / paid-1. These must survive the same
  // checks jiun-api applies, or a correct rotation would be 400'd away.
  it("every emitted label passes validateApiKeyLabel", async () => {
    process.env.OMP_GEMINI_API_KEY_PAID = "paid";
    const { validateApiKeyLabel } = await import("@/lib/usage/contract");

    for (const key of [...getGeminiKeys(), getPaidGeminiKey()!]) {
      expect(validateApiKeyLabel(key.label)).toEqual({ label: key.label });
    }
  });

  it("uses the contract vocabulary, not the retired key_N form", () => {
    process.env.OMP_GEMINI_API_KEY_PAID = "paid";
    expect(getGeminiKeys().map((k) => k.label)).toEqual([
      "free-1",
      "free-2",
      "free-3",
      "free-4",
      "free-5",
      "free-6",
    ]);
    expect(getPaidGeminiKey()!.label).toBe("paid-1");
  });
});
