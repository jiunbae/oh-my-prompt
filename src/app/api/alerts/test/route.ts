import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { testAlertRule } from "@/lib/alerts";
import { z } from "zod";

export const dynamic = "force-dynamic";

const testAlertSchema = z.object({
  ruleId: z.string().uuid().optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  metric: z.enum(["daily_prompt_count", "avg_quality", "token_usage", "session_count", "project_activity"]).optional(),
  condition: z.enum(["above", "below", "equals", "changes_by"]).optional(),
  threshold: z.number().or(z.string().transform((v) => Number(v))).optional(),
  comparisonPeriod: z.enum(["1_hour", "1_day", "7_days", "30_days"]).optional(),
  notificationChannels: z.array(z.enum(["email", "slack", "in_app"])).min(1).optional(),
});

/**
 * POST /api/alerts/test - Test an alert rule (simulate trigger)
 *
 * Supports two modes:
 * 1. Existing rule: pass { ruleId } to test a saved rule
 * 2. Draft rule: pass rule fields to test without saving
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

    const parseResult = testAlertSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    let rule: schema.AlertRule;

    if (data.ruleId) {
      // Test existing rule
      const [existing] = await db
        .select()
        .from(schema.alertRules)
        .where(
          and(
            eq(schema.alertRules.id, data.ruleId),
            eq(schema.alertRules.userId, session.userId)
          )
        )
        .limit(1);

      if (!existing) {
        return NextResponse.json({ error: "Alert rule not found" }, { status: 404 });
      }
      rule = existing;
    } else {
      // Validate required fields for draft
      if (!data.name || !data.metric || !data.condition || data.threshold === undefined) {
        return NextResponse.json(
          { error: "Missing required fields for draft rule test" },
          { status: 400 }
        );
      }

      // Create temporary rule object
      rule = {
        id: "test",
        userId: session.userId,
        teamId: null,
        name: data.name,
        description: data.description || null,
        metric: data.metric,
        condition: data.condition,
        threshold: String(data.threshold),
        comparisonPeriod: data.comparisonPeriod ?? "1_day",
        notificationChannels: data.notificationChannels ?? ["in_app"],
        isActive: true,
        lastTriggeredAt: null,
        cooldownMinutes: 0,
        createdAt: new Date(),
      };
    }

    const result = await testAlertRule(rule);

    return NextResponse.json({
      triggered: result.triggered,
      message: result.message,
      channelsSent: result.channelsSent,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alert test error");
    return NextResponse.json({ error: "Failed to test alert rule" }, { status: 500 });
  }
}
