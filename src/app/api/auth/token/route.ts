import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { AuthError, requireAuth } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

/**
 * Reveal the API token only when the authenticated user explicitly requests it.
 * It is intentionally absent from session cookies and /api/auth/me responses.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    const [user] = await db
      .select({ token: users.token })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(
      { token: user.token },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "API token reveal error");
    return NextResponse.json({ error: "Failed to reveal API token" }, { status: 500 });
  }
}
