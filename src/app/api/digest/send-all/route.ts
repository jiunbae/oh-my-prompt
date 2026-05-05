import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendUserDigest } from "@/lib/digest";
import { logger } from "@/lib/logger";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Rate limiter for send-all: max 1 request per 5 minutes.
 * Keyed by admin user ID to prevent abuse.
 */
const sendAllLimiter = createRateLimiter(1, 5 * 60 * 1000);

/**
 * POST /api/digest/send-all — Trigger digest for all users (admin, with rate limiting)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin();

    // Rate limiting
    const limit = sendAllLimiter(session.userId);
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          retryAfterSeconds: Math.ceil(limit.retryAfterMs / 1000),
        },
        { status: 429 }
      );
    }

    // Fetch all users with digests enabled
    const users = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.emailDigestEnabled, true));

    const results: Array<{ userId: string; sent: boolean; error?: string }> = [];
    let successCount = 0;
    let failCount = 0;

    // Process sequentially to avoid overwhelming the email provider
    for (const user of users) {
      try {
        const result = await sendUserDigest(user.id);
        results.push({ userId: user.id, sent: result.sent, error: result.error });
        if (result.sent) successCount++;
        else failCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, userId: user.id }, "Digest send-all user error");
        results.push({ userId: user.id, sent: false, error: errMsg });
        failCount++;
      }
    }

    logger.info(
      { total: users.length, success: successCount, failed: failCount },
      "Digest send-all completed"
    );

    return NextResponse.json({
      success: true,
      totalUsers: users.length,
      sent: successCount,
      failed: failCount,
      results,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Digest send-all API error");
    return NextResponse.json(
      { error: "Failed to send digests" },
      { status: 500 }
    );
  }
}
