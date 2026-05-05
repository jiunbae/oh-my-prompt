import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendUserDigest } from "@/lib/digest";
import { logger } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const sendDigestSchema = z.object({
  userId: z.string().uuid(),
});

/**
 * POST /api/digest/send — Trigger digest for a specific user (admin/internal)
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON in request body" },
        { status: 400 }
      );
    }

    const parseResult = sendDigestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { userId } = parseResult.data;

    // Verify user exists and has digest enabled
    const [user] = await db
      .select({
        id: schema.users.id,
        emailDigestEnabled: schema.users.emailDigestEnabled,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.emailDigestEnabled) {
      return NextResponse.json(
        { error: "User has email digests disabled" },
        { status: 400 }
      );
    }

    const result = await sendUserDigest(userId);

    if (result.sent) {
      return NextResponse.json({ success: true, userId });
    }

    return NextResponse.json(
      { error: result.error || "Digest generation returned no data", userId },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Digest send API error");
    return NextResponse.json(
      { error: "Failed to send digest" },
      { status: 500 }
    );
  }
}
