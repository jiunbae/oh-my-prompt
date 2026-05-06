import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/[id]/logs - Get delivery logs for an integration
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

    // Verify the integration belongs to the user
    const [integration] = await db
      .select({ id: schema.outgoingIntegrations.id })
      .from(schema.outgoingIntegrations)
      .where(
        and(
          eq(schema.outgoingIntegrations.id, id),
          eq(schema.outgoingIntegrations.userId, session.userId)
        )
      )
      .limit(1);

    if (!integration) {
      return NextResponse.json({ error: "Integration not found" }, { status: 404 });
    }

    const logs = await db
      .select({
        id: schema.integrationDeliveryLogs.id,
        eventType: schema.integrationDeliveryLogs.eventType,
        responseStatus: schema.integrationDeliveryLogs.responseStatus,
        responseBody: schema.integrationDeliveryLogs.responseBody,
        errorMessage: schema.integrationDeliveryLogs.errorMessage,
        deliveredAt: schema.integrationDeliveryLogs.deliveredAt,
      })
      .from(schema.integrationDeliveryLogs)
      .where(eq(schema.integrationDeliveryLogs.integrationId, id))
      .orderBy(desc(schema.integrationDeliveryLogs.deliveredAt))
      .limit(limit);

    return NextResponse.json({ logs });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Integration logs error");
    return NextResponse.json(
      { error: "Failed to fetch integration logs" },
      { status: 500 }
    );
  }
}
