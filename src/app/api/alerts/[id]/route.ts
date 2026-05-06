import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateAlertSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  metric: z.enum(["daily_prompt_count", "avg_quality", "token_usage", "session_count", "project_activity"]).optional(),
  condition: z.enum(["above", "below", "equals", "changes_by"]).optional(),
  threshold: z.number().or(z.string().transform((v) => Number(v))).optional(),
  comparisonPeriod: z.enum(["1_hour", "1_day", "7_days", "30_days"]).optional(),
  notificationChannels: z.array(z.enum(["email", "slack", "in_app"])).min(1).optional(),
  isActive: z.boolean().optional(),
  teamId: z.string().uuid().optional().nullable(),
});

/**
 * PATCH /api/alerts/[id] - Update an alert rule
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON in request body" }, { status: 400 });
    }

    const parseResult = updateAlertSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const updates = parseResult.data;
    const setValues: Record<string, unknown> = {};

    if (updates.name !== undefined) setValues.name = updates.name;
    if (updates.description !== undefined) setValues.description = updates.description || null;
    if (updates.metric !== undefined) setValues.metric = updates.metric;
    if (updates.condition !== undefined) setValues.condition = updates.condition;
    if (updates.threshold !== undefined) setValues.threshold = String(updates.threshold);
    if (updates.comparisonPeriod !== undefined) setValues.comparisonPeriod = updates.comparisonPeriod;
    if (updates.notificationChannels !== undefined) setValues.notificationChannels = updates.notificationChannels;
    if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
    if (updates.teamId !== undefined) setValues.teamId = updates.teamId;

    if (Object.keys(setValues).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [rule] = await db
      .update(schema.alertRules)
      .set(setValues)
      .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.userId, session.userId)))
      .returning();

    if (!rule) {
      return NextResponse.json({ error: "Alert rule not found" }, { status: 404 });
    }

    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alert update error");
    return NextResponse.json({ error: "Failed to update alert rule" }, { status: 500 });
  }
}

/**
 * DELETE /api/alerts/[id] - Delete an alert rule
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const [deleted] = await db
      .delete(schema.alertRules)
      .where(and(eq(schema.alertRules.id, id), eq(schema.alertRules.userId, session.userId)))
      .returning({ id: schema.alertRules.id });

    if (!deleted) {
      return NextResponse.json({ error: "Alert rule not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alert delete error");
    return NextResponse.json({ error: "Failed to delete alert rule" }, { status: 500 });
  }
}
