import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { ProcessorInput, InsightResult } from "../types";
import { sendSlackMessage, buildDailySummary, queryDailySummaryData } from "@/lib/slack";
import { logger } from "@/lib/logger";

export async function handler(_input: ProcessorInput): Promise<InsightResult> {
  // Find all active slack_webhooks with daily_summary event
  const hooks = await db
    .select()
    .from(schema.slackWebhooks)
    .where(
      and(
        eq(schema.slackWebhooks.isActive, true),
        sql`'daily_summary' = ANY(${schema.slackWebhooks.events})`,
      ),
    );

  let sentCount = 0;
  let failCount = 0;

  for (const hook of hooks) {
    try {
      const data = await queryDailySummaryData(hook.userId, hook.teamId);
      const payload = buildDailySummary(data);

      if (hook.channel) {
        payload.channel = hook.channel;
      }

      const result = await sendSlackMessage(hook.webhookUrl, payload);
      if (result.success) {
        sentCount++;
      } else {
        failCount++;
        logger.warn(
          { userId: hook.userId, webhookId: hook.id, error: result.error },
          "Slack daily summary delivery failed",
        );
      }
    } catch (error) {
      failCount++;
      logger.error(
        { err: error, userId: hook.userId, webhookId: hook.id },
        "Failed to send Slack daily summary",
      );
    }
  }

  const summary = `Slack daily summaries sent to ${sentCount} of ${hooks.length} webhooks. ${failCount} failures.`;

  return {
    title: "Slack Daily Summary",
    summary,
    highlights: [
      { label: "Total Webhooks", value: hooks.length },
      { label: "Sent", value: sentCount },
      { label: "Failed", value: failCount },
    ],
    confidence: 1,
    generatedAt: new Date().toISOString(),
  };
}
