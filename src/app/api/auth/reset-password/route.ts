import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/auth";
import { db } from "@/db/client";
import { users, passwordResetTokens } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { rateLimiters, getClientIp, getAuthRateLimitKey } from "@/lib/rate-limit";
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
    const rateCheck = await rateLimiters.authGlobal(ip);
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

    if (typeof token !== "string" || typeof password !== "string" || !token || !password) {
      return NextResponse.json(
        { error: "Token and password are required" },
        { status: 400 }
      );
    }

    const identityRateCheck = await rateLimiters.auth(getAuthRateLimitKey(ip, token));
    if (!identityRateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(identityRateCheck.retryAfterMs / 1000)),
          },
        },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }
    if (password.length > 1024 || token.length > 2048) {
      return NextResponse.json(
        { error: "Token or password is too long" },
        { status: 400 },
      );
    }

    // Hash the provided token to compare against stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Hash the new password
    const passwordHash = await hashPassword(password);

    const resetApplied = await db.transaction(async (tx) => {
      // Consume the token atomically. Concurrent requests cannot both receive
      // a user id from this UPDATE ... RETURNING operation.
      const [claimed] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });

      if (!claimed) return false;

      // passwordChangedAt invalidates existing web sessions; regenerating the
      // API token also invalidates existing CLI credentials.
      await tx
        .update(users)
        .set({
          passwordHash,
          token: sql`gen_random_uuid()`,
          passwordChangedAt: new Date(),
        })
        .where(eq(users.id, claimed.userId));
      return true;
    });

    if (!resetApplied) {
      return NextResponse.json(
        { error: "Invalid or expired reset token. Please request a new one from your administrator." },
        { status: 400 },
      );
    }

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
