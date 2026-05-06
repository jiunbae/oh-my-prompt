import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const [experiment] = await db
      .select({ id: schema.promptExperiments.id, status: schema.promptExperiments.status })
      .from(schema.promptExperiments)
      .where(
        and(
          eq(schema.promptExperiments.id, id),
          eq(schema.promptExperiments.userId, session.userId)
        )
      )
      .limit(1);

    if (!experiment) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 });
    }

    if (experiment.status !== "running") {
      return NextResponse.json({ error: "Experiment is not running" }, { status: 400 });
    }

    const [updated] = await db
      .update(schema.promptExperiments)
      .set({ status: "paused" })
      .where(eq(schema.promptExperiments.id, id))
      .returning();

    return NextResponse.json({ experiment: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Pause experiment API error");
    return NextResponse.json({ error: "Failed to pause experiment" }, { status: 500 });
  }
}
