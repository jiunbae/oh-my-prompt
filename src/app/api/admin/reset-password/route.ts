import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import { users, passwordResetTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * POST /api/admin/reset-password
 * Admin generates a password reset token for a user.
 * Returns the raw token (to be shared with the user out-of-band).
 * The token is stored hashed in the database.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const schema = z.object({
      userId: z.string().uuid(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "userId (UUID) is required" },
        { status: 400 }
      );
    }

    const { userId } = parsed.data;

    // Verify user exists
    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Generate a cryptographically secure random token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    // Store hashed token
    await db.insert(passwordResetTokens).values({
      userId,
      tokenHash,
      expiresAt,
    });

    // Build the reset URL
    const baseUrl =
      request.headers.get("x-forwarded-proto") && request.headers.get("host")
        ? `${request.headers.get("x-forwarded-proto")}://${request.headers.get("host")}`
        : new URL(request.url).origin;
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

    return NextResponse.json({
      success: true,
      resetUrl,
      token: rawToken,
      expiresAt: expiresAt.toISOString(),
      userEmail: user.email,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    logger.error({ err: error }, "Error generating password reset token");
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
