import { NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { count, eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/with-auth";
import { getRetryQueue } from "@/lib/webhook-retry";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();

    const total = await db.select({ count: count() }).from(schema.webhooks);
    const active = await db
      .select({ count: count() })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.isActive, true));

    const recentFailures = await db
      .select({
        id: schema.webhooks.id,
        name: schema.webhooks.name,
        failCount: schema.webhooks.failCount,
        lastStatus: schema.webhooks.lastStatus,
      })
      .from(schema.webhooks)
      .where(sql`${schema.webhooks.failCount} > 0`)
      .orderBy(sql`${schema.webhooks.failCount} DESC`)
      .limit(10);

    const pendingRetries = getRetryQueue();

    return NextResponse.json({
      total: total[0].count,
      active: active[0].count,
      inactive: total[0].count - active[0].count,
      recentFailures,
      pendingRetries: pendingRetries.length,
    });
  } catch (error) {
    logger.error({ err: error }, "Webhook monitoring error");
    return NextResponse.json({ error: "Failed to fetch webhook status" }, { status: 500 });
  }
}
