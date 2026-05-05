import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

const VALID_STEPS = ["welcome", "install_hook", "create_team", "explore", "completed"];

/**
 * POST /api/onboarding/progress — Update user's onboarding step
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => ({}));
    const { step } = body;

    if (!step || typeof step !== "string" || !VALID_STEPS.includes(step)) {
      return NextResponse.json(
        { error: `Invalid step. Must be one of: ${VALID_STEPS.join(", ")}` },
        { status: 400 }
      );
    }

    await db
      .update(users)
      .set({ onboardingStep: step })
      .where(eq(users.id, session.userId));

    return NextResponse.json({ step });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Update onboarding progress error");
    return NextResponse.json({ error: "Failed to update onboarding progress" }, { status: 500 });
  }
}
