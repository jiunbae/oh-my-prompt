import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * POST /api/onboarding/complete — Mark onboarding as completed
 */
export async function POST() {
  try {
    const session = await requireAuth();

    await db
      .update(users)
      .set({
        onboardingCompleted: true,
        onboardingStep: "completed",
      })
      .where(eq(users.id, session.userId));

    return NextResponse.json({ completed: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Complete onboarding error");
    return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
  }
}
