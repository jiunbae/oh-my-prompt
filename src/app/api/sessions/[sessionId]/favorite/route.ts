import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/sessions/[sessionId]/favorite
 * Toggle favorite status for a session.
 * If already favorited, removes it. If not, adds it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = await requireAuth();
    const { sessionId } = await params;

    // Check that the session actually belongs to the user
    const [existingSession] = await db
      .select({ sessionId: schema.prompts.sessionId })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, session.userId),
          eq(schema.prompts.sessionId, sessionId),
          isNull(schema.prompts.deletedAt)
        )
      )
      .limit(1);

    if (!existingSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Check if already favorited
    const [existing] = await db
      .select({ id: schema.favoriteSessions.id })
      .from(schema.favoriteSessions)
      .where(
        and(
          eq(schema.favoriteSessions.userId, session.userId),
          eq(schema.favoriteSessions.sessionId, sessionId)
        )
      )
      .limit(1);

    if (existing) {
      // Remove favorite
      await db
        .delete(schema.favoriteSessions)
        .where(eq(schema.favoriteSessions.id, existing.id));

      return NextResponse.json({ favorited: false });
    }

    // Add favorite
    await db
      .insert(schema.favoriteSessions)
      .values({
        userId: session.userId,
        sessionId,
      });

    return NextResponse.json({ favorited: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Favorite session toggle error");
    return NextResponse.json(
      { error: "Failed to toggle favorite" },
      { status: 500 }
    );
  }
}
