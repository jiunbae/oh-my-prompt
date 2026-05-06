import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/notifications/[id]/acknowledge - Mark notification as read
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const [notification] = await db
      .update(schema.alertNotifications)
      .set({ acknowledgedAt: new Date() })
      .where(
        and(
          eq(schema.alertNotifications.id, id),
          eq(schema.alertNotifications.userId, session.userId)
        )
      )
      .returning();

    if (!notification) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, notification });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Alert acknowledge error");
    return NextResponse.json({ error: "Failed to acknowledge notification" }, { status: 500 });
  }
}
