import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/alerts/notifications - Get recent alert notifications (in-app)
 * Query param: unreadOnly (boolean)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const conditions = [eq(schema.alertNotifications.userId, session.userId)];
    if (unreadOnly) {
      conditions.push(isNull(schema.alertNotifications.acknowledgedAt));
    }

    const notifications = await db
      .select({
        id: schema.alertNotifications.id,
        alertRuleId: schema.alertNotifications.alertRuleId,
        triggeredAt: schema.alertNotifications.triggeredAt,
        metricValue: schema.alertNotifications.metricValue,
        threshold: schema.alertNotifications.threshold,
        message: schema.alertNotifications.message,
        channelsSent: schema.alertNotifications.channelsSent,
        acknowledgedAt: schema.alertNotifications.acknowledgedAt,
        ruleName: schema.alertRules.name,
      })
      .from(schema.alertNotifications)
      .innerJoin(schema.alertRules, eq(schema.alertNotifications.alertRuleId, schema.alertRules.id))
      .where(and(...conditions))
      .orderBy(desc(schema.alertNotifications.triggeredAt))
      .limit(100);

    return NextResponse.json({ notifications });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alert notifications list error");
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}
