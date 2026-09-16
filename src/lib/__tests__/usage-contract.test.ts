import { describe, it, expect } from "vitest";
import {
  USAGE_PROVIDERS,
  buildEventId,
  isUsageProvider,
  resolveUsageProvider,
  resolveUsageProviderFromUrl,
  toTokenCount,
  validateApiKeyLabel,
} from "@/lib/usage/contract";
import type { LLMProvider } from "@/extensions/types";

/**
 * jiun-api accepts any string for `provider` — it does not validate against the
 * vocabulary. A wrong value is therefore not an error but a permanently split
 * aggregate, so these tests are the only thing standing between a typo and a
 * corrupted per-model total.
 */
describe("provider vocabulary", () => {
  it("maps gemini to the vendor, not the model family", () => {
    expect(resolveUsageProvider("gemini")).toBe("google");
  });

  it("maps azure onto openai, which the contract names as the vendor", () => {
    expect(resolveUsageProvider("azure")).toBe("openai");
  });

  it("passes through the providers that already name a vendor", () => {
    expect(resolveUsageProvider("openai")).toBe("openai");
    expect(resolveUsageProvider("anthropic")).toBe("anthropic");
  });

  it("treats ollama and an unknown custom endpoint as local inference", () => {
    expect(resolveUsageProvider("ollama")).toBe("local");
    expect(resolveUsageProvider("ollama", "http://localhost:11434/v1")).toBe("local");
    expect(resolveUsageProvider("custom", "https://llm.internal.example/v1")).toBe("local");
    expect(resolveUsageProvider("custom", "not a url")).toBe("local");
    expect(resolveUsageProvider("custom")).toBe("local");
  });

  it("resolves a custom endpoint that actually points at a known vendor", () => {
    expect(resolveUsageProvider("custom", "https://openrouter.ai/api/v1")).toBe("openrouter");
    expect(resolveUsageProvider("custom", "https://api.openai.com/v1")).toBe("openai");
    expect(resolveUsageProvider("custom", "https://api.anthropic.com")).toBe("anthropic");
    expect(
      resolveUsageProvider("custom", "https://generativelanguage.googleapis.com/v1beta")
    ).toBe("google");
  });

  it("never emits a value outside the closed vocabulary", () => {
    const providers: LLMProvider[] = [
      "anthropic",
      "openai",
      "azure",
      "gemini",
      "ollama",
      "custom",
    ];
    for (const provider of providers) {
      expect(isUsageProvider(resolveUsageProvider(provider))).toBe(true);
    }
  });

  it("rejects the spellings the contract calls out by name", () => {
    for (const wrong of ["gemini", "claude", "gpt", "vertex", "bedrock", "azure-openai"]) {
      expect(isUsageProvider(wrong)).toBe(false);
    }
  });

  it("does not silently gain a vocabulary entry", () => {
    expect([...USAGE_PROVIDERS]).toEqual([
      "openai",
      "anthropic",
      "google",
      "cloudflare",
      "openrouter",
      "local",
    ]);
  });

  it("resolves a bare endpoint URL for the embedding and suggestion providers", () => {
    expect(resolveUsageProviderFromUrl("http://localhost:11434")).toBe("local");
    expect(resolveUsageProviderFromUrl("https://api.openai.com")).toBe("openai");
    expect(resolveUsageProviderFromUrl(undefined)).toBe("local");
  });
});

/**
 * A credential that reaches this field is copied into MongoDB and into the
 * public Prometheus `api_key` label, where it cannot be recalled from either.
 */
describe("credential labels", () => {
  it("accepts the contract vocabulary the rotation emits", () => {
    expect(validateApiKeyLabel("free-1")).toEqual({ label: "free-1" });
    expect(validateApiKeyLabel("free-6")).toEqual({ label: "free-6" });
    expect(validateApiKeyLabel("paid-1")).toEqual({ label: "paid-1" });
    expect(validateApiKeyLabel(" free-3 ")).toEqual({ label: "free-3" });
  });

  it("still accepts the retired key_N shape without endorsing it", () => {
    // This validator checks the SHAPE the endpoint enforces, not the
    // vocabulary. jiun-api kept accepting key_N so an unmigrated sender does
    // not lose already-consumed usage to a 400; rejecting it here would be
    // stricter than the contract for no gain. What we EMIT is pinned by the
    // pool's own test instead.
    expect(validateApiKeyLabel("key_1")).toEqual({ label: "key_1" });
  });

  it("refuses anything shaped like a live credential", () => {
    for (const secret of [
      "AIzaSyDummyValueForTest",
      "sk-proj-abcdefghijklmnop",
      "ghp_abcdefghijklmnop",
      "xoxb-1234-5678",
      "AKIAIOSFODNN7EXAMPLE",
      "hf_abcdefghijklmnop",
    ]) {
      expect(validateApiKeyLabel(secret).label).toBeNull();
    }
  });

  it("refuses labels the endpoint would answer with a 400", () => {
    expect(validateApiKeyLabel("Key_1").label).toBeNull(); // uppercase
    expect(validateApiKeyLabel("key 1").label).toBeNull(); // space
    expect(validateApiKeyLabel("key.1").label).toBeNull(); // dot
    expect(validateApiKeyLabel("k".repeat(33)).label).toBeNull(); // too long
    expect(validateApiKeyLabel("k".repeat(32))).toEqual({ label: "k".repeat(32) });
  });

  it("treats a missing label as absent rather than invalid", () => {
    expect(validateApiKeyLabel(undefined).label).toBeNull();
    expect(validateApiKeyLabel("").label).toBeNull();
  });

  it("never echoes the rejected value back in the reason", () => {
    const secret = "AIzaSyDummyValueForTest";
    const result = validateApiKeyLabel(secret);
    expect(result.label).toBeNull();
    expect("reason" in result && result.reason).not.toContain(secret);
  });
});

describe("token counts", () => {
  it("coerces anything a provider might return into a non-negative integer", () => {
    expect(toTokenCount(12)).toBe(12);
    expect(toTokenCount("12")).toBe(12);
    expect(toTokenCount(12.6)).toBe(13);
    expect(toTokenCount(undefined)).toBe(0);
    expect(toTokenCount(null)).toBe(0);
    expect(toTokenCount(-5)).toBe(0);
    expect(toTokenCount(NaN)).toBe(0);
    expect(toTokenCount("nope")).toBe(0);
  });
});

describe("event IDs", () => {
  it("prefers the provider request ID so a retry lands on the same event", () => {
    expect(buildEventId("oh-my-prompt", "msg_01HQXYZ")).toBe("oh-my-prompt:msg_01HQXYZ");
    expect(buildEventId("oh-my-prompt", "msg_01HQXYZ")).toBe(
      buildEventId("oh-my-prompt", "msg_01HQXYZ")
    );
  });

  it("generates a unique ID when the provider gave none", () => {
    const a = buildEventId("oh-my-prompt", null);
    const b = buildEventId("oh-my-prompt", undefined);
    expect(a).not.toBe(b);
    expect(a.startsWith("oh-my-prompt:")).toBe(true);
  });

  it("stays within the column width", () => {
    expect(buildEventId("oh-my-prompt", "x".repeat(400)).length).toBe(255);
  });
});
