/**
 * Delivery of LLM usage events to jiun-api.
 *
 * Contract: jiunbae/jiun-api `docs/USAGE_EVENTS.md`.
 *
 * Two rules shape this module:
 *
 *  1. Reporting must never make the original provider request run twice. Every
 *     entry point swallows its own errors, and an event is written to a durable
 *     outbox before any network call is attempted.
 *
 *  2. A retry reuses its `eventId`. The endpoint is idempotent on
 *     `(serviceId, eventId)`, so a resend is free and a regenerated ID is a
 *     permanent double-count.
 *
 * Reporting is off unless both `JIUN_USAGE_SERVICE_ID` and `JIUN_USAGE_KEY` are
 * present. Oh My Prompt is self-hosted with the operator's own provider keys;
 * an install that has not been given a jiun-api usage key reports nothing.
 */

import { and, asc, count, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import {
  buildEventId,
  isUsageProvider,
  validateApiKeyLabel,
  type UsageEvent,
  type UsageProvider,
  type UsageStatus,
  type UsageTokens,
} from "./contract";

/** The contract caps a batch at 100 events. */
const MAX_BATCH = 100;

/** Delivered rows are kept briefly for debugging, then pruned. */
const KEEP_DELIVERED_DAYS = 7;

export interface UsageConfig {
  apiUrl: string;
  serviceId: string;
  serviceKey: string;
  apiKeyLabel?: string;
  timeoutMs: number;
}

let loggedDisabled = false;
let loggedBadLabel = false;

export function getUsageConfig(): UsageConfig | null {
  const serviceId = env.JIUN_USAGE_SERVICE_ID.trim();
  const serviceKey = env.JIUN_USAGE_KEY.trim();

  if (!serviceId || !serviceKey) {
    if (!loggedDisabled) {
      loggedDisabled = true;
      logger.debug("LLM usage reporting disabled (no JIUN_USAGE_SERVICE_ID / JIUN_USAGE_KEY)");
    }
    return null;
  }

  // A bad label is dropped rather than sent: jiun-api answers 400, and the
  // value may be the credential itself, so it is never logged back.
  let apiKeyLabel: string | undefined;
  const raw = env.JIUN_USAGE_API_KEY_LABEL.trim();
  if (raw) {
    const result = validateApiKeyLabel(raw);
    if (result.label !== null) {
      apiKeyLabel = result.label;
    } else if (!loggedBadLabel) {
      loggedBadLabel = true;
      logger.error(
        { reason: result.reason },
        "JIUN_USAGE_API_KEY_LABEL rejected; usage will be reported unlabelled"
      );
    }
  }

  return {
    apiUrl: env.JIUN_USAGE_API_URL.replace(/\/$/, ""),
    serviceId,
    serviceKey,
    apiKeyLabel,
    timeoutMs: env.JIUN_USAGE_TIMEOUT_MS,
  };
}

export interface RecordUsageInput {
  provider: UsageProvider;
  model: string;
  tokens: UsageTokens;
  status: UsageStatus;
  latencyMs?: number;
  /** The provider's own request ID, when the response carried one. */
  providerRequestId?: string | null;
  occurredAt?: Date;
}

/**
 * Record one provider call and try to deliver it.
 *
 * Never throws and never rejects: callers await it on the success and error
 * paths of a provider call, and a reporting failure must not disturb either.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const config = getUsageConfig();
  if (!config) return;

  try {
    // The mapping functions are exhaustive over a typed union, so this guard
    // should be unreachable. It stays because jiun-api accepts any string for
    // `provider`: a wrong value is not rejected, it silently becomes a second
    // permanent series for the same vendor. Dropping the event leaves a gap,
    // which is repairable; a wrong spelling is not.
    if (!isUsageProvider(input.provider)) {
      logger.error(
        { provider: input.provider },
        "Refusing to report usage with a provider outside the contract vocabulary"
      );
      return;
    }
    if (!input.model) {
      logger.error("Refusing to report usage without a model ID");
      return;
    }

    const eventId = buildEventId(config.serviceId, input.providerRequestId);

    await db
      .insert(schema.llmUsageEvents)
      .values({
        eventId,
        occurredAt: input.occurredAt ?? new Date(),
        provider: input.provider,
        model: input.model,
        apiKeyLabel: config.apiKeyLabel ?? null,
        inputTokens: input.tokens.inputTokens,
        outputTokens: input.tokens.outputTokens,
        cachedInputTokens: input.tokens.cachedInputTokens,
        totalTokens: input.tokens.totalTokens,
        latencyMs: input.latencyMs ?? null,
        status: input.status,
      })
      // A provider request ID we have already recorded is the same call.
      // Keeping the first row preserves the idempotency key.
      .onConflictDoNothing({ target: schema.llmUsageEvents.eventId });
  } catch (error) {
    logger.error({ err: error }, "Failed to record LLM usage event");
    return;
  }

  // Opportunistic delivery. Anything left behind is picked up by
  // POST /api/admin/usage/flush.
  void flushUsageOutbox().catch((error) => {
    logger.debug({ err: error }, "Opportunistic usage flush failed");
  });
}

export interface FlushResult {
  attempted: number;
  accepted: number;
  duplicates: number;
  reprocessed: number;
  failed: number;
}

/**
 * How many events are still undelivered. A backlog that only grows means
 * delivery is broken — before registration in JIUN_SERVICES it will be zero,
 * because reporting is off without a key.
 */
export async function countPendingUsageEvents(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.llmUsageEvents)
    .where(eq(schema.llmUsageEvents.deliveryStatus, "pending"));
  return row?.value ?? 0;
}

const EMPTY_FLUSH: FlushResult = {
  attempted: 0,
  accepted: 0,
  duplicates: 0,
  reprocessed: 0,
  failed: 0,
};

let flushInFlight: Promise<FlushResult> | null = null;

/**
 * Deliver pending outbox rows. Concurrent calls share one run so an
 * opportunistic flush and the scheduled sweep cannot send the same batch twice.
 */
export function flushUsageOutbox(): Promise<FlushResult> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runFlush().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlush(): Promise<FlushResult> {
  const config = getUsageConfig();
  if (!config) return EMPTY_FLUSH;

  const now = new Date();

  const rows = await db
    .select()
    .from(schema.llmUsageEvents)
    .where(
      and(
        eq(schema.llmUsageEvents.deliveryStatus, "pending"),
        lte(schema.llmUsageEvents.nextAttemptAt, now)
      )
    )
    .orderBy(asc(schema.llmUsageEvents.occurredAt))
    .limit(MAX_BATCH);

  if (rows.length === 0) {
    await pruneDelivered();
    return EMPTY_FLUSH;
  }

  const events: UsageEvent[] = rows.map((row) => {
    const event: UsageEvent = {
      eventId: row.eventId,
      occurredAt: row.occurredAt.toISOString(),
      provider: row.provider as UsageProvider,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      totalTokens: row.totalTokens,
      status: row.status as UsageStatus,
    };
    if (row.apiKeyLabel) event.apiKeyLabel = row.apiKeyLabel;
    if (row.latencyMs !== null) event.latencyMs = row.latencyMs;
    return event;
  });

  // `userId` is deliberately omitted, and this is the correct answer rather
  // than a shortcut. The field takes the jiun-api user ID that a service
  // receives from `GET /auth/me` as `user.id` when its users sign in through
  // jiun-api. Oh My Prompt does not: it authenticates locally against its own
  // users table (bcrypt + its own session cookie), so there is no jiun-api ID
  // to persist at login. Its own UUIDs are a different identifier space and
  // the endpoint rejects them.
  //
  // The cost of omitting it is real and worth stating: this usage aggregates
  // as `auth="anonymous"`, which on the dashboard reads as "no signed-in
  // user". For this service that is accurate. It stops being accurate the day
  // Oh My Prompt gains jiun-api login — at which point persist `user.id` on
  // the user record and send it here.
  const body = JSON.stringify({ serviceId: config.serviceId, events });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.apiUrl}/usage/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": config.serviceKey,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");

      // 401/403 means the service is not registered in JIUN_SERVICES, or the
      // key does not belong to this serviceId. Retrying cannot fix either, and
      // the generic "will retry" warning hides the one thing an operator needs
      // to know, so it is called out by name. Events are still kept: once the
      // service is registered they deliver under their original occurredAt,
      // which the contract aggregates into the correct historical day.
      if (response.status === 401 || response.status === 403) {
        logger.error(
          { status: response.status, serviceId: config.serviceId, pending: rows.length },
          "jiun-api rejected the usage key. Is this serviceId registered in JIUN_SERVICES, " +
            "and does JIUN_USAGE_KEY belong to it? Events are held until this is fixed."
        );
      }

      // A 4xx other than 429 will not become valid by being resent, but the
      // row is kept anyway: the raw event is the only copy of this usage, and
      // an operator can repair and re-drive it. Backoff keeps it quiet.
      await markFailed(rows, `HTTP ${response.status}: ${detail.slice(0, 300)}`);
      return { ...EMPTY_FLUSH, attempted: rows.length, failed: rows.length };
    }

    const result = (await response.json().catch(() => ({}))) as {
      accepted?: number;
      duplicates?: number;
      reprocessed?: number;
    };

    await db
      .update(schema.llmUsageEvents)
      .set({ deliveryStatus: "sent", deliveredAt: new Date(), lastError: null })
      .where(
        inArray(
          schema.llmUsageEvents.id,
          rows.map((row) => row.id)
        )
      );

    await pruneDelivered();

    return {
      attempted: rows.length,
      accepted: result.accepted ?? 0,
      duplicates: result.duplicates ?? 0,
      reprocessed: result.reprocessed ?? 0,
      failed: 0,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `timed out after ${config.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error);
    await markFailed(rows, message.slice(0, 300));
    return { ...EMPTY_FLUSH, attempted: rows.length, failed: rows.length };
  } finally {
    clearTimeout(timer);
  }
}

/** Exponential backoff from 30s, capped at 1h. */
function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.min(attempts, 8), 3_600_000);
}

async function markFailed(
  rows: Array<{ id: string; attempts: number }>,
  reason: string
): Promise<void> {
  const now = Date.now();
  await Promise.all(
    rows.map((row) =>
      db
        .update(schema.llmUsageEvents)
        .set({
          attempts: row.attempts + 1,
          nextAttemptAt: new Date(now + backoffMs(row.attempts)),
          lastError: reason,
        })
        .where(eq(schema.llmUsageEvents.id, row.id))
    )
  );
  logger.warn({ count: rows.length, reason }, "LLM usage report failed; will retry");
}

async function pruneDelivered(): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_DELIVERED_DAYS * 86_400_000);
  await db
    .delete(schema.llmUsageEvents)
    .where(
      and(
        eq(schema.llmUsageEvents.deliveryStatus, "sent"),
        isNotNull(schema.llmUsageEvents.deliveredAt),
        lte(schema.llmUsageEvents.deliveredAt, cutoff)
      )
    );
}
