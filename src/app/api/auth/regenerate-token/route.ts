import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { rateLimiters } from "@/lib/rate-limit";
import { createSessionToken, AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS } from "@/lib/auth";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * POST /api/auth/regenerate-token
 * Regenerate the user's API token (invalidates the old one).
 * Also updates passwordChangedAt to invalidate all other sessions
 * (API tokens are sensitive credentials).
 */
export async function POST() {
  try {
    const session = await requireAuth();

    const rateLimit = rateLimiters.auth(session.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
        }
      );
    }

    // Generate new token, update passwordChangedAt to invalidate other sessions
    const [updatedUser] = await db
      .update(users)
      .set({
        token: sql`gen_random_uuid()`,
        passwordChangedAt: new Date(),
      })
      .where(eq(users.id, session.userId))
      .returning({ token: users.token, email: users.email });

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Re-issue session cookie with new iat so the current user stays logged in
    const newSessionToken = createSessionToken({
      userId: session.userId,
      email: updatedUser.email,
      token: updatedUser.token,
      isAdmin: session.isAdmin,
    });
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, newSessionToken, AUTH_COOKIE_OPTIONS);

    return NextResponse.json({
      success: true,
      token: updatedUser.token,
      message: "Token regenerated successfully. Update your prompt capture hook configuration.",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Token regeneration error");
    return NextResponse.json(
      { error: "Failed to regenerate token" },
      { status: 500 }
    );
  }
}
