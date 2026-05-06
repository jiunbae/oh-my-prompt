import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function GET(
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

    const results = await db
      .select()
      .from(schema.experimentResults)
      .where(eq(schema.experimentResults.experimentId, id));

    const baselineResult = results.find((r) => r.version === experiment.baselineVersion);
    const challengerResult = results.find((r) => r.version === experiment.challengerVersion);

    const [baselineVersionRow] = await db
      .select({ promptText: schema.promptVersions.promptText })
      .from(schema.promptVersions)
      .where(
        and(
          eq(schema.promptVersions.promptId, experiment.promptId),
          eq(schema.promptVersions.version, experiment.baselineVersion)
        )
      )
      .limit(1);

    const [challengerVersionRow] = await db
      .select({ promptText: schema.promptVersions.promptText })
      .from(schema.promptVersions)
      .where(
        and(
          eq(schema.promptVersions.promptId, experiment.promptId),
          eq(schema.promptVersions.version, experiment.challengerVersion)
        )
      )
      .limit(1);

    return NextResponse.json({
      experiment,
      results,
      baselineResult,
      challengerResult,
      baselinePromptText: baselineVersionRow?.promptText ?? null,
      challengerPromptText: challengerVersionRow?.promptText ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Get experiment API error");
    return NextResponse.json({ error: "Failed to get experiment" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const [experiment] = await db
      .select({ id: schema.promptExperiments.id })
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

    await db.delete(schema.promptExperiments).where(eq(schema.promptExperiments.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Delete experiment API error");
    return NextResponse.json({ error: "Failed to delete experiment" }, { status: 500 });
  }
}
