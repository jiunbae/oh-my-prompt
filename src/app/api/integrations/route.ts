import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { validateWebhookUrl } from "@/services/webhook";
import { VALID_INTEGRATION_EVENTS } from "./shared";
import { canManageTeam } from "@/lib/team-access";

export const dynamic = "force-dynamic";

const createIntegrationSchema = z.object({
  name: z.string().min(1).max(255),
  provider: z.enum(["zapier", "make", "custom"]),
  webhookUrl: z.string().url().max(4096),
  secret: z.string().max(1024).optional(),
  events: z
    .array(z.enum(VALID_INTEGRATION_EVENTS))
    .min(1, "At least one event is required"),
  teamId: z.string().uuid().optional(),
});

/**
 * GET /api/integrations - List outgoing integrations for user (or team if teamId provided)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("teamId");

    let conditions;
    if (teamId) {
      if (!z.string().uuid().safeParse(teamId).success) {
        return NextResponse.json({ error: "Invalid teamId" }, { status: 400 });
      }
      if (!(await canManageTeam(session.userId, teamId))) {
        return NextResponse.json({ error: "Team management access required" }, { status: 403 });
      }
      conditions = eq(schema.outgoingIntegrations.teamId, teamId);
    } else {
      conditions = and(
        eq(schema.outgoingIntegrations.userId, session.userId),
        isNull(schema.outgoingIntegrations.teamId)
      );
    }

    const integrations = await db
      .select({
        id: schema.outgoingIntegrations.id,
        userId: schema.outgoingIntegrations.userId,
        teamId: schema.outgoingIntegrations.teamId,
        name: schema.outgoingIntegrations.name,
        provider: schema.outgoingIntegrations.provider,
        webhookUrl: schema.outgoingIntegrations.webhookUrl,
        secret: sql<boolean>`CASE WHEN ${schema.outgoingIntegrations.secret} IS NOT NULL THEN true ELSE false END`,
        events: schema.outgoingIntegrations.events,
        isActive: schema.outgoingIntegrations.isActive,
        lastTriggeredAt: schema.outgoingIntegrations.lastTriggeredAt,
        createdAt: schema.outgoingIntegrations.createdAt,
      })
      .from(schema.outgoingIntegrations)
      .where(conditions)
      .orderBy(desc(schema.outgoingIntegrations.createdAt));

    return NextResponse.json({ integrations });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Integrations list error");
    return NextResponse.json(
      { error: "Failed to fetch integrations" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations - Create new integration
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

    const parseResult = createIntegrationSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { name, provider, webhookUrl, secret, events, teamId } = parseResult.data;

    // Team integrations can export team metadata, so only current team
    // owner/admin users may configure them. Check before resolving the supplied
    // webhook URL so unauthorized members cannot use validation as a probe.
    if (teamId && !(await canManageTeam(session.userId, teamId))) {
      return NextResponse.json(
        { error: "Team management access required" },
        { status: 403 }
      );
    }

    // Validate webhook URL is HTTPS
    const urlCheck = await validateWebhookUrl(webhookUrl);
    if (!urlCheck.valid) {
      return NextResponse.json(
        { error: `Invalid webhook URL: ${urlCheck.error}` },
        { status: 400 }
      );
    }

    if (!webhookUrl.startsWith("https://")) {
      return NextResponse.json(
        { error: "Webhook URL must use HTTPS" },
        { status: 400 }
      );
    }

    const [integration] = await db
      .insert(schema.outgoingIntegrations)
      .values({
        userId: session.userId,
        teamId: teamId || null,
        name,
        provider,
        webhookUrl,
        secret: secret || null,
        events,
        isActive: true,
      })
      .returning({
        id: schema.outgoingIntegrations.id,
        userId: schema.outgoingIntegrations.userId,
        teamId: schema.outgoingIntegrations.teamId,
        name: schema.outgoingIntegrations.name,
        provider: schema.outgoingIntegrations.provider,
        webhookUrl: schema.outgoingIntegrations.webhookUrl,
        events: schema.outgoingIntegrations.events,
        isActive: schema.outgoingIntegrations.isActive,
        createdAt: schema.outgoingIntegrations.createdAt,
      });

    return NextResponse.json({ integration }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Integration create error");
    return NextResponse.json(
      { error: "Failed to create integration" },
      { status: 500 }
    );
  }
}
