import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { env } from "@/env";

/**
 * Exponential backoff intervals for webhook retries (in milliseconds).
 * Sequence: 1min, 5min, 30min, 2h, 12h (capped at attempt 5+)
 */
const BACKOFF_INTERVALS_MS = [
  60_000,       // 1 min
  300_000,      // 5 min
  1_800_000,    // 30 min
  7_200_000,    // 2 h
  43_200_000,   // 12 h (cap — all subsequent attempts use this)
] as const;

const MAX_FAIL_COUNT = env.OMP_WEBHOOK_MAX_FAIL_COUNT;

interface RetryEntry {
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  attempt: number;
  retryOfLogId: string;
  scheduledAt: number;     // Date.now() when the retry was scheduled
  executeAt: number;       // Date.now() when the retry should fire
  timerId: ReturnType<typeof setTimeout>;
}

/** In-memory retry queue (process-level, not persistent across restarts) */
const retryQueue = new Map<string, RetryEntry>();

/** Generate a unique key for a retry entry */
function retryKey(webhookId: string, retryOfLogId: string, attempt: number): string {
  return `${webhookId}:${retryOfLogId}:${attempt}`;
}

/**
 * Calculate the backoff delay for a given attempt number.
 * attempt starts at 2 (first retry), so index into the array at attempt - 2.
 */
export function getBackoffDelayMs(attempt: number): number {
  const index = Math.min(attempt - 2, BACKOFF_INTERVALS_MS.length - 1);
  return BACKOFF_INTERVALS_MS[Math.max(0, index)];
}

/**
 * Execute a single webhook delivery attempt. Used by both the main dispatch
 * path and the retry scheduler. Returns true on success (2xx).
 */
export async function executeWebhookDelivery(params: {
  webhookId: string;
  url: string;
  secret: string | null;
  event: string;
  payload: Record<string, unknown>;
  attempt: number;
  retryOfLogId?: string;
}): Promise<{ success: boolean; statusCode: number | null; duration: number; logId: string }> {
  const { webhookId, url, secret, event, payload, attempt, retryOfLogId } = params;

  const bodyString = JSON.stringify(payload);
  const startTime = Date.now();
  let statusCode: number | null = null;
  let responseBody: string | null = null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "oh-my-prompt/webhooks",
    "X-Webhook-Event": event,
    "X-Webhook-Id": webhookId,
    "X-Webhook-Attempt": String(attempt),
  };

  if (secret) {
    const crypto = await import("crypto");
    const signature = crypto.createHmac("sha256", secret).update(bodyString).digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  try {
    const { validateWebhookUrl } = await import("@/services/webhook");
    const urlCheck = await validateWebhookUrl(url);
    if (!urlCheck.valid) {
      throw new Error(`SSRF blocked: ${urlCheck.error}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), env.OMP_WEBHOOK_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: bodyString,
      signal: controller.signal,
      redirect: "error",
    });

    clearTimeout(timeoutId);

    statusCode = response.status;
    responseBody = await response.text().catch(() => null);

    if (responseBody && responseBody.length > 4096) {
      responseBody = responseBody.slice(0, 4096) + "...(truncated)";
    }

    const duration = Date.now() - startTime;

    const [logEntry] = await db.insert(schema.webhookLogs).values({
      webhookId,
      event,
      payload,
      statusCode,
      responseBody,
      duration,
      attempt,
      retryOf: retryOfLogId ?? null,
    }).returning({ id: schema.webhookLogs.id });

    const logId = logEntry.id;

    if (statusCode >= 200 && statusCode < 300) {
      // Success: reset fail count
      await db
        .update(schema.webhooks)
        .set({ lastTriggeredAt: new Date(), lastStatus: statusCode, failCount: 0 })
        .where(eq(schema.webhooks.id, webhookId));

      return { success: true, statusCode, duration, logId };
    }

    // Non-2xx: increment fail count, auto-disable if threshold hit
    await db.execute(
      sql`UPDATE webhooks SET
        last_triggered_at = NOW(),
        last_status = ${statusCode},
        fail_count = fail_count + 1,
        is_active = CASE WHEN fail_count + 1 >= ${MAX_FAIL_COUNT} THEN false ELSE is_active END
      WHERE id = ${webhookId}`
    );

    return { success: false, statusCode, duration, logId };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    const [logEntry] = await db.insert(schema.webhookLogs).values({
      webhookId,
      event,
      payload,
      statusCode: null,
      responseBody: `Error: ${errorMessage}`,
      duration,
      attempt,
      retryOf: retryOfLogId ?? null,
    }).returning({ id: schema.webhookLogs.id });

    const logId = logEntry.id;

    await db.execute(
      sql`UPDATE webhooks SET
        last_triggered_at = NOW(),
        last_status = NULL,
        fail_count = fail_count + 1,
        is_active = CASE WHEN fail_count + 1 >= ${MAX_FAIL_COUNT} THEN false ELSE is_active END
      WHERE id = ${webhookId}`
    );

    logger.error({ err: error, webhookId, url, attempt }, "Webhook delivery failed");

    return { success: false, statusCode: null, duration, logId };
  }
}

/**
 * Schedule a retry for a failed webhook delivery using exponential backoff.
 * Returns the scheduled attempt number, or null if retries are exhausted.
 */
export async function scheduleRetry(
  webhookId: string,
  url: string,
  secret: string | null,
  event: string,
  payload: Record<string, unknown>,
  currentAttempt: number,
  retryOfLogId: string,
): Promise<number | null> {
  const nextAttempt = currentAttempt + 1;

  // Cap: don't exceed max fail count attempts
  if (nextAttempt > MAX_FAIL_COUNT) {
    logger.warn(
      { webhookId, currentAttempt, maxFailCount: MAX_FAIL_COUNT },
      "Webhook retry limit reached, no more retries scheduled"
    );
    return null;
  }

  // Check if webhook is still active before scheduling
  const [webhook] = await db
    .select({ isActive: schema.webhooks.isActive })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);

  if (!webhook || !webhook.isActive) {
    logger.info({ webhookId }, "Webhook is inactive, skipping retry");
    return null;
  }

  const key = retryKey(webhookId, retryOfLogId, nextAttempt);

  // Don't schedule duplicate retries
  if (retryQueue.has(key)) {
    return nextAttempt;
  }

  const delayMs = getBackoffDelayMs(nextAttempt);
  const now = Date.now();

  const timerId = setTimeout(async () => {
    retryQueue.delete(key);

    // Re-check webhook is still active at execution time
    const [w] = await db
      .select({ isActive: schema.webhooks.isActive, url: schema.webhooks.url, secret: schema.webhooks.secret })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.id, webhookId))
      .limit(1);

    if (!w || !w.isActive) {
      logger.info({ webhookId, attempt: nextAttempt }, "Webhook inactive at retry time, aborting");
      return;
    }

    logger.info(
      { webhookId, attempt: nextAttempt, retryOfLogId },
      "Executing webhook retry"
    );

    const result = await executeWebhookDelivery({
      webhookId,
      url: w.url,
      secret: w.secret,
      event,
      payload,
      attempt: nextAttempt,
      retryOfLogId,
    });

    if (!result.success) {
      // Schedule next retry, pointing to the original log entry for traceability
      await scheduleRetry(webhookId, w.url, w.secret, event, payload, nextAttempt, retryOfLogId);
    } else {
      logger.info({ webhookId, attempt: nextAttempt }, "Webhook retry succeeded");
    }
  }, delayMs);

  retryQueue.set(key, {
    webhookId,
    event,
    payload,
    attempt: nextAttempt,
    retryOfLogId,
    scheduledAt: now,
    executeAt: now + delayMs,
    timerId,
  });

  logger.info(
    { webhookId, attempt: nextAttempt, delayMs, retryOfLogId },
    "Webhook retry scheduled"
  );

  return nextAttempt;
}

/**
 * Cancel all pending retries for a webhook.
 * Called when a webhook is deleted or manually disabled.
 */
export function cancelRetries(webhookId: string): number {
  let cancelled = 0;
  for (const [key, entry] of retryQueue.entries()) {
    if (entry.webhookId === webhookId) {
      clearTimeout(entry.timerId);
      retryQueue.delete(key);
      cancelled++;
    }
  }
  if (cancelled > 0) {
    logger.info({ webhookId, cancelled }, "Cancelled pending webhook retries");
  }
  return cancelled;
}

/**
 * Get the current retry queue status. Returns a summary of all pending retries,
 * optionally filtered by webhookId.
 */
export function getRetryQueue(webhookId?: string): Array<{
  webhookId: string;
  event: string;
  attempt: number;
  retryOfLogId: string;
  scheduledAt: number;
  executeAt: number;
  remainingMs: number;
}> {
  const now = Date.now();
  const results: Array<{
    webhookId: string;
    event: string;
    attempt: number;
    retryOfLogId: string;
    scheduledAt: number;
    executeAt: number;
    remainingMs: number;
  }> = [];

  for (const entry of retryQueue.values()) {
    if (webhookId && entry.webhookId !== webhookId) continue;
    results.push({
      webhookId: entry.webhookId,
      event: entry.event,
      attempt: entry.attempt,
      retryOfLogId: entry.retryOfLogId,
      scheduledAt: entry.scheduledAt,
      executeAt: entry.executeAt,
      remainingMs: Math.max(0, entry.executeAt - now),
    });
  }

  return results.sort((a, b) => a.executeAt - b.executeAt);
}

/**
 * Manually trigger a retry for a specific webhook log entry.
 * Validates ownership and re-delivers the original payload.
 */
export async function manualRetry(
  webhookId: string,
  logId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  // Fetch the webhook log and verify ownership
  const [log] = await db
    .select({
      id: schema.webhookLogs.id,
      webhookId: schema.webhookLogs.webhookId,
      event: schema.webhookLogs.event,
      payload: schema.webhookLogs.payload,
    })
    .from(schema.webhookLogs)
    .innerJoin(schema.webhooks, eq(schema.webhookLogs.webhookId, schema.webhooks.id))
    .where(
      and(
        eq(schema.webhookLogs.id, logId),
        eq(schema.webhookLogs.webhookId, webhookId),
        eq(schema.webhooks.userId, userId),
      )
    )
    .limit(1);

  if (!log) {
    return { success: false, error: "Webhook log not found" };
  }

  // Fetch the webhook to get current URL and secret
  const [webhook] = await db
    .select({
      id: schema.webhooks.id,
      url: schema.webhooks.url,
      secret: schema.webhooks.secret,
      isActive: schema.webhooks.isActive,
    })
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .limit(1);

  if (!webhook) {
    return { success: false, error: "Webhook not found" };
  }

  const payload = log.payload as Record<string, unknown>;

  const result = await executeWebhookDelivery({
    webhookId: webhook.id,
    url: webhook.url,
    secret: webhook.secret,
    event: log.event,
    payload,
    attempt: 1,
    retryOfLogId: log.id,
  });

  if (result.success) {
    return { success: true };
  }

  // Schedule a retry for the manual retry
  await scheduleRetry(
    webhook.id,
    webhook.url,
    webhook.secret,
    log.event,
    payload,
    1,
    log.id,
  );

  return {
    success: false,
    error: `Delivery failed (status: ${result.statusCode}). Retry has been scheduled.`,
  };
}