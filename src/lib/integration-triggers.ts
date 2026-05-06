import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { env } from "@/env";
import { validateWebhookUrl } from "@/services/webhook";
import crypto from "crypto";

const INTEGRATION_TIMEOUT_MS = env.INTEGRATION_WEBHOOK_TIMEOUT_MS;

/** Events supported by outgoing integrations */
export const INTEGRATION_EVENTS = [
  "prompt.created",
  "prompt.favorited",
  "prompt.deleted",
  "prompt.updated",
  "session.started",
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

/**
 * Trigger an outgoing integration event.
 * Queries active integrations matching the event type and user/team,
 * then POSTs to each webhook URL fire-and-forget (non-blocking).
 */
export async function triggerEvent(
  eventType: IntegrationEvent,
  payload: Record<string, unknown>,
  userId: string,
  teamId?: string | null,
): Promise<void> {
  // Find active integrations for this user/team subscribed to this event
  const conditions = [
    eq(schema.outgoingIntegrations.isActive, true),
    sql`${eventType} = ANY(${schema.outgoingIntegrations.events})`,
  ];

  if (teamId) {
    conditions.push(eq(schema.outgoingIntegrations.teamId, teamId));
  } else {
    conditions.push(eq(schema.outgoingIntegrations.userId, userId));
  }

  const integrations = await db
    .select()
    .from(schema.outgoingIntegrations)
    .where(and(...conditions));

  if (integrations.length === 0) return;

  const deliveryPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  };

  const bodyString = JSON.stringify(deliveryPayload);

  // Fire-and-forget: don't block the main flow
  await Promise.allSettled(
    integrations.map(async (integration) => {
      const startTime = Date.now();
      let responseStatus: number | null = null;
      let responseBody: string | null = null;
      let errorMessage: string | null = null;

      // SSRF check
      const urlCheck = await validateWebhookUrl(integration.webhookUrl);
      if (!urlCheck.valid) {
        errorMessage = `SSRF blocked: ${urlCheck.error}`;
        await logDelivery(integration.id, eventType, deliveryPayload, null, null, errorMessage);
        logger.warn(
          { integrationId: integration.id, url: integration.webhookUrl, error: errorMessage },
          "Outgoing integration blocked by SSRF check"
        );
        return;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "oh-my-prompt/integrations",
        "X-Integration-Event": eventType,
        "X-Integration-Id": integration.id,
      };

      if (integration.secret) {
        const signature = crypto
          .createHmac("sha256", integration.secret)
          .update(bodyString)
          .digest("hex");
        headers["X-Hub-Signature"] = `sha256=${signature}`;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), INTEGRATION_TIMEOUT_MS);

        const response = await fetch(integration.webhookUrl, {
          method: "POST",
          headers,
          body: bodyString,
          signal: controller.signal,
          redirect: "error",
        });

        clearTimeout(timeoutId);

        responseStatus = response.status;
        responseBody = await response.text().catch(() => null);

        if (responseBody && responseBody.length > 4096) {
          responseBody = responseBody.slice(0, 4096) + "...(truncated)";
        }

        await logDelivery(
          integration.id,
          eventType,
          deliveryPayload,
          responseStatus,
          responseBody,
          null,
        );

        // Update lastTriggeredAt on success
        if (responseStatus >= 200 && responseStatus < 300) {
          await db
            .update(schema.outgoingIntegrations)
            .set({ lastTriggeredAt: new Date() })
            .where(eq(schema.outgoingIntegrations.id, integration.id));
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : "Unknown error";
        await logDelivery(
          integration.id,
          eventType,
          deliveryPayload,
          null,
          null,
          errorMessage,
        );
        logger.error(
          { err: error, integrationId: integration.id, eventType },
          "Outgoing integration delivery failed"
        );
      }
    })
  );
}

async function logDelivery(
  integrationId: string,
  eventType: string,
  payload: Record<string, unknown>,
  responseStatus: number | null,
  responseBody: string | null,
  errorMessage: string | null,
): Promise<void> {
  try {
    await db.insert(schema.integrationDeliveryLogs).values({
      integrationId,
      eventType,
      payload,
      responseStatus,
      responseBody,
      errorMessage,
    });
  } catch (err) {
    logger.error({ err, integrationId }, "Failed to log integration delivery");
  }
}

/**
 * Send a test event to an outgoing integration.
 * Returns the delivery result for immediate feedback.
 */
export async function sendTestIntegration(
  integrationId: string,
  userId: string,
): Promise<{ success: boolean; statusCode: number | null; responseBody: string | null; error?: string }> {
  const conditions = [
    eq(schema.outgoingIntegrations.id, integrationId),
    eq(schema.outgoingIntegrations.userId, userId),
  ];

  const [integration] = await db
    .select()
    .from(schema.outgoingIntegrations)
    .where(and(...conditions))
    .limit(1);

  if (!integration) {
    return { success: false, statusCode: null, responseBody: null, error: "Integration not found" };
  }

  const urlCheck = await validateWebhookUrl(integration.webhookUrl);
  if (!urlCheck.valid) {
    return { success: false, statusCode: null, responseBody: null, error: `URL blocked: ${urlCheck.error}` };
  }

  const testPayload = {
    event: "test",
    timestamp: new Date().toISOString(),
    data: { message: "Test from oh-my-prompt" },
  };

  const bodyString = JSON.stringify(testPayload);
  const startTime = Date.now();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "oh-my-prompt/integrations",
    "X-Integration-Event": "test",
    "X-Integration-Id": integration.id,
  };

  if (integration.secret) {
    const signature = crypto
      .createHmac("sha256", integration.secret)
      .update(bodyString)
      .digest("hex");
    headers["X-Hub-Signature"] = `sha256=${signature}`;
  }

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INTEGRATION_TIMEOUT_MS);

    const response = await fetch(integration.webhookUrl, {
      method: "POST",
      headers,
      body: bodyString,
      signal: controller.signal,
      redirect: "error",
    });

    clearTimeout(timeoutId);

    responseStatus = response.status;
    responseBody = await response.text().catch(() => null);

    if (responseBody && responseBody.length > 4096) {
      responseBody = responseBody.slice(0, 4096) + "...(truncated)";
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown error";
  }

  // Log the test delivery
  await db.insert(schema.integrationDeliveryLogs).values({
    integrationId: integration.id,
    eventType: "test",
    payload: testPayload,
    responseStatus,
    responseBody,
    errorMessage,
  });

  const success = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;

  return {
    success,
    statusCode: responseStatus,
    responseBody,
    error: success ? undefined : (errorMessage ?? responseBody ?? "Request failed"),
  };
}
