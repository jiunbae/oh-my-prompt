import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createAlertSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  metric: z.enum(["daily_prompt_count", "avg_quality", "token_usage", "session_count", "project_activity"]),
  condition: z.enum(["above", "below", "equals", "changes_by"]),
  threshold: z.number().or(z.string().transform((v) => Number(v))),
  comparisonPeriod: z.enum(["1_hour", "1_day", "7_days", "30_days"]).default("1_day"),
  notificationChannels: z.array(z.enum(["email", "slack", "in_app"])).min(1),
  teamId: z.string().uuid().optional().nullable(),
});

/**
 * GET /api/alerts - List alert rules for the current user
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const rules = await db
      .select()
      .from(schema.alertRules)
      .where(eq(schema.alertRules.userId, session.userId))
      .orderBy(desc(schema.alertRules.createdAt));

    return NextResponse.json({ rules });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alerts list error");
    return NextResponse.json({ error: "Failed to fetch alert rules" }, { status: 500 });
  }
}

/**
 * POST /api/alerts - Create a new alert rule
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON in request body" }, { status: 400 });
    }

    const parseResult = createAlertSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const {
      name,
      description,
      metric,
      condition,
      threshold,
      comparisonPeriod,
      notificationChannels,
      teamId,
    } = parseResult.data;

    const [rule] = await db
      .insert(schema.alertRules)
      .values({
        userId: session.userId,
        teamId: teamId ?? null,
        name,
        description: description || null,
        metric,
        condition,
        threshold: String(threshold),
        comparisonPeriod,
        notificationChannels,
        isActive: true,
      })
      .returning();

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alert create error");
    return NextResponse.json({ error: "Failed to create alert rule" }, { status: 500 });
  }
}
