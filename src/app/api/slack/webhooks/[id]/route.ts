import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/slack/webhooks/[id] - Remove webhook
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const [deleted] = await db
      .delete(schema.slackWebhooks)
      .where(
        and(
          eq(schema.slackWebhooks.id, id),
          eq(schema.slackWebhooks.userId, session.userId)
        )
      )
      .returning({ id: schema.slackWebhooks.id });

    if (!deleted) {
      return NextResponse.json(
        { error: "Webhook not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Slack webhook delete error");
    return NextResponse.json(
      { error: "Failed to delete Slack webhook" },
      { status: 500 }
    );
  }
}
