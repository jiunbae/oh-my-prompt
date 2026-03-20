import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/favorites
 * List all favorited session IDs for the current user.
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const favorites = await db
      .select({
        sessionId: schema.favoriteSessions.sessionId,
        createdAt: schema.favoriteSessions.createdAt,
      })
      .from(schema.favoriteSessions)
      .where(eq(schema.favoriteSessions.userId, session.userId));

    return NextResponse.json({
      favorites: favorites.map((f) => ({
        sessionId: f.sessionId,
        createdAt: f.createdAt,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "List favorite sessions error");
    return NextResponse.json(
      { error: "Failed to load favorites" },
      { status: 500 }
    );
  }
}
