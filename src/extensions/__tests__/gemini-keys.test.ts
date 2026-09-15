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
  it("labels keys key_1..key_6 in configured order, matching Vault and the usage contract", () => {
    expect(getGeminiKeys().map((k) => k.label)).toEqual([
      "key_1",
      "key_2",
      "key_3",
      "key_4",
      "key_5",
      "key_6",
    ]);
  });

  it("ignores blanks and surrounding whitespace", () => {
    process.env.OMP_GEMINI_API_KEYS = " a , ,b ,";
    expect(getGeminiKeys()).toEqual([
      { label: "key_1", apiKey: "a", isPaid: false },
      { label: "key_2", apiKey: "b", isPaid: false },
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
    expect(availableKeys()[0].label).toBe("key_1");
    expect(availableKeys()[0].label).toBe("key_2");
    expect(availableKeys()[0].label).toBe("key_3");
  });

  it("still offers every key as a fallback, in wrap-around order", () => {
    availableKeys(); // advance past key_1
    expect(availableKeys().map((k) => k.label)).toEqual([
      "key_2",
      "key_3",
      "key_4",
      "key_5",
      "key_6",
      "key_1",
    ]);
  });
});

describe("parking a key after a 429", () => {
  it("parks a per-minute breach briefly, using the provider's retryDelay", () => {
    const now = Date.now();
    parkKey("key_1", "GenerateRequestsPerMinutePerProjectPerModel", 30);

    expect(availableKeys(now).map((k) => k.label)).not.toContain("key_1");
    // Clears on its own well before the day is out.
    expect(availableKeys(now + 40_000).map((k) => k.label)).toContain("key_1");
  });

  it("parks a per-day breach until the Pacific reset, not for seconds", () => {
    const now = Date.now();
    parkKey("key_2", "GenerateRequestsPerDayPerProjectPerModel", 30);

    expect(availableKeys(now + 60_000).map((k) => k.label)).not.toContain("key_2");

    const status = poolStatus(now).find((s) => s.label === "key_2");
    expect(status?.available).toBe(false);
    expect(status?.reason).toBe("daily quota exhausted");
    // Somewhere within the next 24h, never a few seconds.
    expect(status!.secondsRemaining!).toBeGreaterThan(60);
    expect(status!.secondsRemaining!).toBeLessThanOrEqual(86_400);
  });

  it("keeps the rest of the pool usable when one project is exhausted", () => {
    parkKey("key_1", "GenerateRequestsPerDayPerProjectPerModel", null);
    const labels = availableKeys().map((k) => k.label);
    expect(labels).not.toContain("key_1");
    expect(labels).toHaveLength(5);
  });

  it("empties the pool when every key is parked and no paid key is configured", () => {
    for (const label of ["key_1", "key_2", "key_3", "key_4", "key_5", "key_6"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    expect(availableKeys()).toEqual([]);
  });

  it("releases a key once it serves a request again", () => {
    parkKey("key_3", "GenerateRequestsPerMinutePerProjectPerModel", 600);
    expect(availableKeys().map((k) => k.label)).not.toContain("key_3");
    releaseKey("key_3");
    expect(availableKeys().map((k) => k.label)).toContain("key_3");
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
    parkKey("key_4", "", null);
    expect(poolStatus(now).find((s) => s.label === "key_4")?.reason).toBe("per-minute quota");
  });
});

describe("paid key as last resort", () => {
  beforeEach(() => {
    process.env.OMP_GEMINI_API_KEY_PAID = "paid";
  });

  it("labels the paid key key_99, matching Vault and the dashboard", () => {
    expect(getPaidGeminiKey()).toEqual({ label: "key_99", apiKey: "paid", isPaid: true });
  });

  it("is absent when not configured", () => {
    delete process.env.OMP_GEMINI_API_KEY_PAID;
    expect(getPaidGeminiKey()).toBeNull();
  });

  it("is NOT offered while any free key is usable", () => {
    // This is the property that keeps the paid key from becoming a standing route.
    for (const label of ["key_1", "key_2", "key_3", "key_4", "key_5"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    const labels = availableKeys().map((k) => k.label);
    expect(labels).toEqual(["key_6"]);
    expect(labels).not.toContain("key_99");
  });

  it("is offered only once every free key is parked", () => {
    for (const label of ["key_1", "key_2", "key_3", "key_4", "key_5", "key_6"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    expect(availableKeys().map((k) => k.label)).toEqual(["key_99"]);
  });

  it("empties the pool when the paid key is parked too", () => {
    for (const label of ["key_1", "key_2", "key_3", "key_4", "key_5", "key_6", "key_99"]) {
      parkKey(label, "GenerateRequestsPerDayPerProjectPerModel", null);
    }
    expect(availableKeys()).toEqual([]);
  });

  it("shows the paid key in the diagnostics snapshot", () => {
    expect(poolStatus().map((s) => s.label)).toContain("key_99");
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
