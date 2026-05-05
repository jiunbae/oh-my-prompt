import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * GET /api/onboarding/status — Returns onboarding status for current user
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const [user] = await db
      .select({
        onboardingCompleted: users.onboardingCompleted,
        onboardingStep: users.onboardingStep,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      completed: user.onboardingCompleted ?? false,
      step: user.onboardingStep ?? "welcome",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Get onboarding status error");
    return NextResponse.json({ error: "Failed to get onboarding status" }, { status: 500 });
  }
}
