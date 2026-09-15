/**
 * jiun-api LLM usage event contract.
 *
 * Contract: jiunbae/jiun-api `docs/USAGE_EVENTS.md`.
 *
 * This module holds the parts of the contract that are easy to get wrong and
 * cheap to test: the closed provider vocabulary, the credential-label rules,
 * and the token-counting convention. It never touches the network and never
 * sees a prompt or a completion.
 *
 * The single most important property here: jiun-api does NOT reject an
 * unrecognised `provider` — the endpoint accepts any string. A wrong spelling
 * is therefore not an error but a permanently split aggregate. Validation is
 * entirely the sender's job, so every value that leaves this module is either
 * a member of the closed vocabulary or `null`.
 */

import type { LLMProvider } from "@/extensions/types";

/**
 * The closed provider vocabulary. `provider` names the vendor that billed the
 * request — not the model family, the SDK, or the gateway product.
 */
export const USAGE_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "cloudflare",
  "openrouter",
  "local",
] as const;

export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

const USAGE_PROVIDER_SET: ReadonlySet<string> = new Set(USAGE_PROVIDERS);

export function isUsageProvider(value: string): value is UsageProvider {
  return USAGE_PROVIDER_SET.has(value);
}

/**
 * Host suffixes that identify the billing vendor behind an arbitrary base URL.
 * Used only for the providers whose endpoint is user-supplied (`custom`,
 * `ollama`): a "custom" OpenAI-compatible base URL pointed at OpenRouter is
 * billed by OpenRouter, and reporting it as `local` would understate a real
 * vendor's spend.
 *
 * Order matters: the first matching suffix wins.
 */
const HOST_VENDORS: ReadonlyArray<readonly [string, UsageProvider]> = [
  ["openrouter.ai", "openrouter"],
  ["api.openai.com", "openai"],
  ["api.anthropic.com", "anthropic"],
  ["generativelanguage.googleapis.com", "google"],
  ["googleapis.com", "google"],
  ["workers.dev", "cloudflare"],
  ["api.cloudflare.com", "cloudflare"],
];

function vendorFromBaseUrl(baseUrl: string | undefined): UsageProvider | null {
  if (!baseUrl) return null;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [suffix, vendor] of HOST_VENDORS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return vendor;
  }
  return null;
}

/**
 * Map this service's own provider vocabulary onto the contract's.
 *
 * The two vocabularies are not the same set, which is the whole reason this
 * function exists:
 *
 *   - `gemini` is NOT a provider. A Gemini call is `google` + the model ID.
 *   - `azure` is Azure OpenAI. The contract rejects `azure-openai` by name and
 *     says to name the vendor, so it reports as `openai`.
 *   - `ollama` and `custom` have a user-supplied endpoint. They resolve by
 *     host when the host names a known vendor, and fall back to `local`
 *     (self-hosted inference), which is what both are for.
 */
export function resolveUsageProvider(
  provider: LLMProvider,
  baseUrl?: string,
): UsageProvider {
  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "azure":
      return "openai";
    case "gemini":
      return "google";
    case "ollama":
    case "custom":
      return vendorFromBaseUrl(baseUrl) ?? "local";
  }
}

/**
 * Resolve a bare endpoint URL (the embedding and suggestion providers, which
 * have no provider name of their own — only a base URL).
 */
export function resolveUsageProviderFromUrl(baseUrl: string | undefined): UsageProvider {
  return vendorFromBaseUrl(baseUrl) ?? "local";
}

// ── Credential labels ──────────────────────────────────────────────

const API_KEY_LABEL_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * Prefixes that mark a value as a credential rather than a label. jiun-api
 * rejects these with a 400; we refuse to send them at all, because the failure
 * mode of getting this wrong is a live key copied into MongoDB and into the
 * Prometheus `api_key` label, where it cannot be recalled from either.
 */
const CREDENTIAL_PREFIXES = [
  "aiza",
  "sk-",
  "sk_",
  "ghp_",
  "gho_",
  "github_pat_",
  "xoxb-",
  "xoxp-",
  "akia",
  "asia",
  "pk-",
  "api-",
  "bearer",
  "glpat-",
  "hf_",
  "or-v1-",
];

/**
 * Validate an `apiKeyLabel`. Returns the label, or `null` with a reason when it
 * must not be sent.
 *
 * Never echo the rejected value anywhere — it may be the credential itself.
 */
export function validateApiKeyLabel(
  raw: string | undefined | null,
): { label: string } | { label: null; reason: string } {
  const value = (raw ?? "").trim();
  if (!value) return { label: null, reason: "empty" };

  const lowered = value.toLowerCase();
  if (CREDENTIAL_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return { label: null, reason: "looks like a credential" };
  }
  if (!API_KEY_LABEL_PATTERN.test(value)) {
    return {
      label: null,
      reason: "must be 1-32 chars of lowercase letters, digits, underscore or hyphen",
    };
  }
  return { label: value };
}

// ── Event shape ────────────────────────────────────────────────────

export type UsageStatus = "success" | "error" | "cancelled";

export interface UsageEvent {
  eventId: string;
  occurredAt: string;
  provider: UsageProvider;
  model: string;
  apiKeyLabel?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  latencyMs?: number;
  status: UsageStatus;
}

/**
 * Token counts as this service reports them.
 *
 * Counting convention, applied identically to every provider so the aggregate
 * stays comparable across them (the contract requires one convention per
 * service and does not infer `totalTokens` from the other fields):
 *
 *   inputTokens        all input tokens, INCLUDING the cached ones
 *   cachedInputTokens  the cached subset of `inputTokens`
 *   totalTokens        the provider-reported total where one exists,
 *                      otherwise inputTokens + outputTokens
 *
 * OpenAI and Gemini already count cached tokens inside their input figure.
 * Anthropic does not, so its adapter adds the cache-read tokens back in.
 */
export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

/** Coerce anything a provider might hand back into a non-negative integer. */
export function toTokenCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

export function emptyTokens(): UsageTokens {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
}

/**
 * Build the idempotency key. The provider's own request ID is preferred: it is
 * stable across our retries and unique per provider call. A retry MUST reuse
 * the same ID — a fresh one double-counts, because the endpoint is idempotent
 * on `(serviceId, eventId)` and nothing else.
 */
export function buildEventId(serviceId: string, providerRequestId?: string | null): string {
  const suffix = providerRequestId?.trim() || crypto.randomUUID();
  return `${serviceId}:${suffix}`.slice(0, 255);
}
