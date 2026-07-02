import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/auth";
import { db } from "@/db/client";
import { users, passwordResetTokens } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { sql } from "drizzle-orm";

/**
 * POST /api/auth/reset-password
 * Validates a reset token and updates the user's password.
 * Also invalidates all active sessions by regenerating the user's API token.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP
    const ip = getClientIp(request);
    const rateCheck = await rateLimiters.auth(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
          },
        }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { token, password } = body as {
      token?: string;
      password?: string;
    };

    if (!token || !password) {
      return NextResponse.json(
        { error: "Token and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }

    // Hash the provided token to compare against stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find valid (unused, not expired) reset token
    const [resetToken] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!resetToken) {
      return NextResponse.json(
        { error: "Invalid or expired reset token. Please request a new one from your administrator." },
        { status: 400 }
      );
    }

    // Hash the new password
    const passwordHash = await hashPassword(password);

    // Update password and regenerate API token (invalidates all sessions).
    // passwordChangedAt is bumped so any session issued before the reset is
    // rejected by the passwordChangedAt-vs-session-iat check in with-auth /
    // the tRPC context.
    await db
      .update(users)
      .set({
        passwordHash,
        token: sql`gen_random_uuid()`,
        passwordChangedAt: new Date(),
      })
      .where(eq(users.id, resetToken.userId));

    // Mark token as used
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, resetToken.id));

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully.",
    });
  } catch (error) {
    logger.error({ err: error }, "Password reset error");
    return NextResponse.json(
      { error: "An error occurred during password reset" },
      { status: 500 }
    );
  }
}
