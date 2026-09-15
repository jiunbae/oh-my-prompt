/**
 * Gemini free-tier key pool.
 *
 * Gemini's quota is per project and per model, so six keys on six separate GCP
 * projects give six independent quotas for the same model. This module rotates
 * across them and parks a key when its own quota says to.
 *
 * Operating standard: `~/.agents/AI_API.md`. Two rules from it shape this file:
 *
 *  - One model, `gemini-3.5-flash-lite`, with no model fallback.
 *  - The paid key is a **last resort, not a standing route**: it is offered
 *    only once every free key is parked. Reaching it is a signal that the free
 *    pool ran dry, which is exactly what the usage dashboard is there to show.
 *
 * Labels are `free-1` through `free-6` for the free projects and `paid-1` for
 * the paid one -- the vocabulary fixed by the jiun-api usage contract's
 * "Label vocabulary" section, NOT the Vault field names and not our own
 * internal naming. (`key_1`/`key_99` were the earlier form and are retired.)
 *
 * The labels have to be identical across services or the per-credential view
 * splits one key into several Prometheus series, the same failure shape as
 * spelling a provider two ways: "which key is near its limit" then has no
 * answer. The `free-`/`paid-` split also reads directly on the dashboard --
 * `paid-1` climbing means real money.
 *
 * This mirrors kongbu's rotation so the two services behave the same way.
 */

import { logger } from "@/lib/logger";

export interface GeminiKey {
  /** Contract label (`free-1` … `free-6`, or `paid-1`). Never the key itself. */
  label: string;
  apiKey: string;
  /** True for the paid key, which is only ever reached as a last resort. */
  isPaid: boolean;
}

interface KeyState {
  /** Epoch ms before which this key must not be used again. */
  cooldownUntil: number;
  /** Why it is parked, for logs. Never contains the key. */
  reason: string;
}

const state = new Map<string, KeyState>();

/**
 * Parse the configured free keys. Order is meaningful: the first key is
 * `free-1`, so a label always points at the same credential across restarts
 * and, as long as every service is given the keys in the same order, across
 * services too.
 */
export function getGeminiKeys(): GeminiKey[] {
  const raw = process.env.OMP_GEMINI_API_KEYS || "";
  const keys = raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  return keys.map((apiKey, i) => ({ label: `free-${i + 1}`, apiKey, isPaid: false }));
}

/** The paid key, or null when none is configured. Always labelled `paid-1`. */
export function getPaidGeminiKey(): GeminiKey | null {
  const apiKey = (process.env.OMP_GEMINI_API_KEY_PAID || "").trim();
  return apiKey ? { label: "paid-1", apiKey, isPaid: true } : null;
}

/** Round-robin cursor. Per process, which is enough — each pod spreads its own load. */
let cursor = 0;

function isAvailable(label: string, now: number): boolean {
  const parked = state.get(label);
  return !parked || parked.cooldownUntil <= now;
}

/**
 * Keys to try for one request, in order.
 *
 * Free keys come first, rotated so consecutive requests start on different
 * projects. The paid key is appended **only** when no free key is usable, so it
 * can never be reached while free quota remains.
 */
export function availableKeys(now = Date.now()): GeminiKey[] {
  const all = getGeminiKeys();
  const paid = getPaidGeminiKey();

  let free: GeminiKey[] = [];
  if (all.length > 0) {
    const start = cursor % all.length;
    cursor = (cursor + 1) % all.length;
    const ordered = [...all.slice(start), ...all.slice(0, start)];
    free = ordered.filter((key) => isAvailable(key.label, now));
  }

  if (free.length > 0) return free;
  if (paid && isAvailable(paid.label, now)) return [paid];
  return [];
}

/** Exponential backoff with jitter, bounded so one key cannot stall a request. */
export function perMinuteBackoffMs(attempt: number, retryDelaySec: number | null): number {
  const base = retryDelaySec != null ? retryDelaySec * 1000 : 1000 * 2 ** attempt;
  const jittered = base + Math.random() * 500;
  // Capped after jitter, so the ceiling is the real upper bound on one wait.
  return Math.min(jittered, MAX_PER_MINUTE_WAIT_MS);
}

/** A per-minute breach clears in seconds; waiting minutes inside a request does not. */
export const MAX_PER_MINUTE_WAIT_MS = 8_000;

/** How many times to retry the same key on a per-minute breach before moving on. */
export const PER_MINUTE_RETRIES = 2;

/**
 * Pacific-midnight reset, expressed in epoch ms.
 *
 * Gemini resets requests-per-day at midnight America/Los_Angeles, which is
 * 16:00 or 17:00 Korean time depending on US daylight saving. Rather than
 * hardcode either offset, ask the runtime what the Pacific date is now and park
 * the key until that date rolls over.
 */
function nextPacificMidnight(now: number): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value])
  );
  const secondsIntoPacificDay =
    Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return now + (86_400 - secondsIntoPacificDay) * 1000;
}

/**
 * Park a key after a 429.
 *
 * Gemini distinguishes the two quotas in the error body, and they want
 * different handling: a per-minute breach clears on its own in seconds, while a
 * per-day breach means this project is finished until the Pacific reset and
 * retrying it only burns latency.
 */
export function parkKey(label: string, quotaId: string, retryDelaySec: number | null): void {
  const now = Date.now();
  const perDay = /PerDay/i.test(quotaId);

  const cooldownUntil = perDay
    ? nextPacificMidnight(now)
    : now + Math.max(retryDelaySec ?? 0, 1) * 1000 + Math.random() * 500;

  state.set(label, {
    cooldownUntil,
    reason: perDay ? "daily quota exhausted" : "per-minute quota",
  });

  logger.warn(
    { label, quotaId, perDay, cooldownSeconds: Math.round((cooldownUntil - now) / 1000) },
    "Gemini key parked after 429"
  );
}

/** Clear a key's cooldown after it serves a request successfully. */
export function releaseKey(label: string): void {
  state.delete(label);
}

/**
 * Pull `quotaId` and `retryDelay` out of a Gemini 429 body. Returns safe
 * defaults when the shape is unfamiliar; the body is never logged, since it is
 * provider output rather than something we control.
 */
export function parseQuotaError(body: string): { quotaId: string; retryDelaySec: number | null } {
  let quotaId = "";
  let retryDelaySec: number | null = null;

  try {
    const parsed = JSON.parse(body);
    const details = parsed?.error?.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        for (const violation of detail?.violations ?? []) {
          if (violation?.quotaId) quotaId = String(violation.quotaId);
        }
        if (typeof detail?.retryDelay === "string") {
          const match = detail.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
          if (match) retryDelaySec = Number(match[1]);
        }
      }
    }
  } catch {
    // Unparseable body: treat as a per-minute breach, the cheaper assumption.
  }

  return { quotaId, retryDelaySec };
}

/** Snapshot for diagnostics. Labels and timings only. */
export function poolStatus(now = Date.now()): Array<{
  label: string;
  available: boolean;
  reason?: string;
  secondsRemaining?: number;
}> {
  const paid = getPaidGeminiKey();
  return [...getGeminiKeys(), ...(paid ? [paid] : [])].map((key) => {
    const parked = state.get(key.label);
    if (!parked || parked.cooldownUntil <= now) return { label: key.label, available: true };
    return {
      label: key.label,
      available: false,
      reason: parked.reason,
      secondsRemaining: Math.round((parked.cooldownUntil - now) / 1000),
    };
  });
}

/** Test seam. */
export function resetPoolState(): void {
  state.clear();
  cursor = 0;
}
