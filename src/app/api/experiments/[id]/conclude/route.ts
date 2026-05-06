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
      .select()
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

    if (experiment.status === "completed") {
      return NextResponse.json({ error: "Experiment already concluded" }, { status: 400 });
    }

    const results = await db
      .select()
      .from(schema.experimentResults)
      .where(eq(schema.experimentResults.experimentId, id));

    const baselineResult = results.find((r) => r.version === experiment.baselineVersion);
    const challengerResult = results.find((r) => r.version === experiment.challengerVersion);

    const baselineAvg = baselineResult?.metricValue ? Number(baselineResult.metricValue) : 0;
    const challengerAvg = challengerResult?.metricValue ? Number(challengerResult.metricValue) : 0;

    let winnerVersion: number | null = null;
    if (baselineAvg > challengerAvg) {
      winnerVersion = experiment.baselineVersion;
    } else if (challengerAvg > baselineAvg) {
      winnerVersion = experiment.challengerVersion;
    }

    const [updated] = await db
      .update(schema.promptExperiments)
      .set({
        status: "completed",
        endedAt: new Date(),
        winnerVersion,
      })
      .where(eq(schema.promptExperiments.id, id))
      .returning();

    return NextResponse.json({ experiment: updated, baselineAvg, challengerAvg });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Conclude experiment API error");
    return NextResponse.json({ error: "Failed to conclude experiment" }, { status: 500 });
  }
}
