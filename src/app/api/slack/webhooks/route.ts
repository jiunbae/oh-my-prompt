import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/services/";

const createSchema = z.object({
  webhookUrl: z.string().min(1).max(2048),
  channel: z.string().max(100).optional(),
  events: z.array(z.enum(["daily_summary", "new_prompt"])).optional().default(["daily_summary"]),
  teamId: z.string().uuid().optional().nullable(),
});

/**
 * GET /api/slack/webhooks - List user's configured Slack webhooks
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const webhooks = await db
      .select({
        id: schema.slackWebhooks.id,
        webhookUrl: schema.slackWebhooks.webhookUrl,
        channel: schema.slackWebhooks.channel,
        events: schema.slackWebhooks.events,
        isActive: schema.slackWebhooks.isActive,
        teamId: schema.slackWebhooks.teamId,
        createdAt: schema.slackWebhooks.createdAt,
      })
      .from(schema.slackWebhooks)
      .where(eq(schema.slackWebhooks.userId, session.userId))
      .orderBy(schema.slackWebhooks.createdAt);

    return NextResponse.json({ webhooks });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Slack webhooks list error");
    return NextResponse.json(
      { error: "Failed to fetch Slack webhooks" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/slack/webhooks - Add a new webhook
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON in request body" },
        { status: 400 }
      );
    }

    const parseResult = createSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { webhookUrl, channel, events, teamId } = parseResult.data;

    // Validate webhook URL
    if (!webhookUrl.startsWith(SLACK_WEBHOOK_PREFIX)) {
      return NextResponse.json(
        { error: "Webhook URL must start with https://hooks.slack.com/services/" },
        { status: 400 }
      );
    }

    // If teamId is provided, verify the user is a member
    if (teamId) {
      const [membership] = await db
        .select()
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, teamId),
            eq(schema.teamMembers.userId, session.userId)
          )
        )
        .limit(1);

      if (!membership) {
        return NextResponse.json(
          { error: "You are not a member of this team" },
          { status: 403 }
        );
      }
    }

    const [webhook] = await db
      .insert(schema.slackWebhooks)
      .values({
        userId: session.userId,
        teamId: teamId ?? null,
        webhookUrl,
        channel: channel ?? null,
        events,
        isActive: true,
      })
      .returning({
        id: schema.slackWebhooks.id,
        webhookUrl: schema.slackWebhooks.webhookUrl,
        channel: schema.slackWebhooks.channel,
        events: schema.slackWebhooks.events,
        isActive: schema.slackWebhooks.isActive,
        teamId: schema.slackWebhooks.teamId,
        createdAt: schema.slackWebhooks.createdAt,
      });

    return NextResponse.json({ webhook }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Slack webhook create error");
    return NextResponse.json(
      { error: "Failed to create Slack webhook" },
      { status: 500 }
    );
  }
}
