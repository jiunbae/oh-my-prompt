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
  resetParseFailureLatch,
  resetPoolState,
} from "@/extensions/gemini-keys";

/** Keys arrive as a JSON map keyed by contract label, never as a positional list. */
function setKeys(map: Record<string, string>): void {
  process.env.GEMINI_API_KEYS = JSON.stringify(map);
}

const SIX_FREE = {
  "free-1": "k1",
  "free-2": "k2",
  "free-3": "k3",
  "free-4": "k4",
  "free-5": "k5",
  "free-6": "k6",
};

beforeEach(() => {
  resetPoolState();
  resetParseFailureLatch();
  setKeys(SIX_FREE);
});

afterEach(() => {
  delete process.env.GEMINI_API_KEYS;
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

  it("ignores blank values and surrounding whitespace", () => {
    setKeys({ "free-1": " a ", "free-2": "", "free-3": "b" });
    expect(getGeminiKeys()).toEqual([
      { label: "free-1", apiKey: "a", isPaid: false },
      { label: "free-3", apiKey: "b", isPaid: false },
    ]);
  });

  it("takes the label from the map key, so a gap leaves a gap", () => {
    // The whole reason for a map: with a positional list, dropping free-2
    // would silently rename free-3..free-6 onto the wrong GCP accounts and the
    // dashboard would attribute quota to projects that never served it.
    setKeys({ "free-1": "a", "free-3": "c", "free-6": "f" });
    expect(getGeminiKeys().map((k) => k.label)).toEqual(["free-1", "free-3", "free-6"]);
  });

  it("orders by label number, not by key insertion order", () => {
    setKeys({ "free-6": "f", "free-1": "a", "free-2": "b" });
    expect(getGeminiKeys().map((k) => k.label)).toEqual(["free-1", "free-2", "free-6"]);
  });

  it("reports an empty pool when nothing is configured", () => {
    delete process.env.GEMINI_API_KEYS;
    expect(getGeminiKeys()).toEqual([]);
    expect(availableKeys()).toEqual([]);
  });

  it("empties the pool loudly rather than throwing on a malformed value", () => {
    process.env.GEMINI_API_KEYS = "not json";
    expect(getGeminiKeys()).toEqual([]);
    expect(availableKeys()).toEqual([]);

    process.env.GEMINI_API_KEYS = JSON.stringify(["a", "b"]);
    expect(getGeminiKeys()).toEqual([]);
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
    setKeys({ ...SIX_FREE, "paid-1": "paid" });
  });

  it("labels the paid key paid-1, per the contract label vocabulary", () => {
    expect(getPaidGeminiKey()).toEqual({ label: "paid-1", apiKey: "paid", isPaid: true });
  });

  it("is absent when not configured", () => {
    setKeys(SIX_FREE);
    expect(getPaidGeminiKey()).toBeNull();
  });

  it("never appears among the free keys, even though it shares the map", () => {
    // paid-1 lives in the same JSON object, so the free list has to exclude it
    // by label rather than by source, or round-robin would bill it 1-in-7.
    expect(getGeminiKeys().map((k) => k.label)).not.toContain("paid-1");
    expect(getGeminiKeys()).toHaveLength(6);
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
    setKeys({ ...SIX_FREE, "paid-1": "paid" });
    const { validateApiKeyLabel } = await import("@/lib/usage/contract");

    for (const key of [...getGeminiKeys(), getPaidGeminiKey()!]) {
      expect(validateApiKeyLabel(key.label)).toEqual({ label: key.label });
    }
  });

  it("uses the contract vocabulary, not the retired key_N form", () => {
    setKeys({ ...SIX_FREE, "paid-1": "paid" });
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
