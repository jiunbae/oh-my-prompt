import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/digest/unsubscribe — User opts out of weekly email digests
 */
export async function POST(_request: NextRequest) {
  try {
    const session = await requireAuth();

    await db
      .update(schema.users)
      .set({ emailDigestEnabled: false })
      .where(eq(schema.users.id, session.userId));

    logger.info({ userId: session.userId }, "User unsubscribed from email digests");

    return NextResponse.json({
      success: true,
      message: "You have been unsubscribed from weekly email digests.",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Digest unsubscribe API error");
    return NextResponse.json(
      { error: "Failed to unsubscribe" },
      { status: 500 }
    );
  }
}
