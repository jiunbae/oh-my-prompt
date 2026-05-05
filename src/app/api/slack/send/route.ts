import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { sendSlackMessage, buildDailySummary, queryDailySummaryData } from "@/lib/slack";

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  webhookId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional().nullable(),
  message: z.string().optional(),
  type: z.enum(["test", "daily_summary"]).default("test"),
});

/**
 * POST /api/slack/send - Admin-only endpoint to trigger a manual Slack notification
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON in request body" },
        { status: 400 }
      );
    }

    const parseResult = sendSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { webhookId, userId, teamId, message, type } = parseResult.data;

    // If webhookId is provided, send to that specific webhook
    if (webhookId) {
      const [webhook] = await db
        .select()
        .from(schema.slackWebhooks)
        .where(eq(schema.slackWebhooks.id, webhookId))
        .limit(1);

      if (!webhook) {
        return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
      }

      const payload = type === "daily_summary"
        ? buildDailySummary(await queryDailySummaryData(webhook.userId, webhook.teamId))
        : { text: message || "Manual notification from Oh My Prompt" };

      if (webhook.channel) {
        payload.channel = webhook.channel;
      }

      const result = await sendSlackMessage(webhook.webhookUrl, payload);
      return NextResponse.json({
        success: result.success,
        webhookId: webhook.id,
        statusCode: result.statusCode ?? null,
        error: result.error ?? null,
      });
    }

    // If userId is provided, find matching webhooks
    if (userId) {
      const conditions = [
        eq(schema.slackWebhooks.userId, userId),
        eq(schema.slackWebhooks.isActive, true),
      ];
      if (teamId === null) {
        conditions.push(isNull(schema.slackWebhooks.teamId));
      } else if (teamId !== undefined) {
        conditions.push(eq(schema.slackWebhooks.teamId, teamId));
      }

      const hooks = await db
        .select()
        .from(schema.slackWebhooks)
        .where(and(...conditions));

      if (hooks.length === 0) {
        return NextResponse.json(
          { error: "No active Slack webhooks found for this user" },
          { status: 404 }
        );
      }

      const results = [];
      for (const hook of hooks) {
        const payload = type === "daily_summary"
          ? buildDailySummary(await queryDailySummaryData(hook.userId, hook.teamId))
          : { text: message || "Manual notification from Oh My Prompt" };

        if (hook.channel) {
          payload.channel = hook.channel;
        }

        const result = await sendSlackMessage(hook.webhookUrl, payload);
        results.push({
          webhookId: hook.id,
          success: result.success,
          statusCode: result.statusCode ?? null,
          error: result.error ?? null,
        });
      }

      return NextResponse.json({ results });
    }

    return NextResponse.json(
      { error: "Either webhookId or userId is required" },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Slack manual send error");
    return NextResponse.json(
      { error: "Failed to send Slack notification" },
      { status: 500 }
    );
  }
}

