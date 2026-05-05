import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { estimatePromptsToDelete } from "@/lib/data-retention";

/**
 * GET /api/user/retention
 * Get current user's data retention days and estimated deletions.
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const [user] = await db
      .select({ dataRetentionDays: users.dataRetentionDays })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const retentionDays = user.dataRetentionDays ?? 365;
    const estimatedDeletions = await estimatePromptsToDelete(session.userId, retentionDays);

    return NextResponse.json({
      dataRetentionDays: retentionDays,
      estimatedDeletions,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Error fetching retention settings");
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}

/**
 * POST /api/user/retention
 * Update current user's data retention days.
 * Body: { dataRetentionDays: number }
 * 0 = unlimited, max 3650 (10 years).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const schema = z.object({
      dataRetentionDays: z.coerce.number().int().min(0).max(3650),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "dataRetentionDays must be an integer between 0 and 3650" },
        { status: 400 }
      );
    }

    const { dataRetentionDays } = parsed.data;

    const [updated] = await db
      .update(users)
      .set({ dataRetentionDays })
      .where(eq(users.id, session.userId))
      .returning({
        id: users.id,
        dataRetentionDays: users.dataRetentionDays,
      });

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const estimatedDeletions = await estimatePromptsToDelete(session.userId, dataRetentionDays);

    return NextResponse.json({
      dataRetentionDays: updated.dataRetentionDays,
      estimatedDeletions,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Error updating retention settings");
    return NextResponse.json({ error: "An error occurred" }, { status: 500 });
  }
}
