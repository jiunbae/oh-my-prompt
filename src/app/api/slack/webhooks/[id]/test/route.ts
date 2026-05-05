import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendSlackMessage } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * POST /api/slack/webhooks/[id]/test - Send a test message
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const [webhook] = await db
      .select()
      .from(schema.slackWebhooks)
      .where(
        and(
          eq(schema.slackWebhooks.id, id),
          eq(schema.slackWebhooks.userId, session.userId)
        )
      )
      .limit(1);

    if (!webhook) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    const result = await sendSlackMessage(webhook.webhookUrl, {
      text: "Test message from Oh My Prompt! Your Slack integration is working.",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "Test Message",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "This is a test from *Oh My Prompt*. Your Slack integration is configured correctly!",
          },
        },
      ],
      channel: webhook.channel ?? undefined,
    });

    return NextResponse.json({
      success: result.success,
      statusCode: result.statusCode ?? null,
      error: result.error ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Slack webhook test error");
    return NextResponse.json(
      { error: "Failed to test Slack webhook" },
      { status: 500 }
    );
  }
}
