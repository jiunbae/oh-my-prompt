import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, checkIsAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const conditions = [eq(schema.promptExperiments.userId, session.userId)];
    if (status) {
      conditions.push(eq(schema.promptExperiments.status, status));
    }

    const experiments = await db
      .select({
        id: schema.promptExperiments.id,
        promptId: schema.promptExperiments.promptId,
        name: schema.promptExperiments.name,
        description: schema.promptExperiments.description,
        status: schema.promptExperiments.status,
        baselineVersion: schema.promptExperiments.baselineVersion,
        challengerVersion: schema.promptExperiments.challengerVersion,
        winMetric: schema.promptExperiments.winMetric,
        minSamples: schema.promptExperiments.minSamples,
        startedAt: schema.promptExperiments.startedAt,
        endedAt: schema.promptExperiments.endedAt,
        winnerVersion: schema.promptExperiments.winnerVersion,
        createdAt: schema.promptExperiments.createdAt,
        promptProjectName: schema.prompts.projectName,
      })
      .from(schema.promptExperiments)
      .leftJoin(schema.prompts, eq(schema.promptExperiments.promptId, schema.prompts.id))
      .where(and(...conditions))
      .orderBy(desc(schema.promptExperiments.createdAt));

    return NextResponse.json({ experiments });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "List experiments API error");
    return NextResponse.json({ error: "Failed to list experiments" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => ({}));

    const {
      promptId,
      name,
      description,
      baselineVersion,
      challengerVersion,
      winMetric,
      minSamples,
    } = body;

    if (!promptId || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Missing required fields: promptId, name" }, { status: 400 });
    }
    if (typeof baselineVersion !== "number" || typeof challengerVersion !== "number") {
      return NextResponse.json({ error: "baselineVersion and challengerVersion must be numbers" }, { status: 400 });
    }

    const isAdmin = session.isAdmin ? await checkIsAdmin(session.userId) : false;

    // Verify prompt ownership
    const ownershipCondition = isAdmin
      ? eq(schema.prompts.id, promptId)
      : and(eq(schema.prompts.id, promptId), eq(schema.prompts.userId, session.userId));

    const [prompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(ownershipCondition)
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found or access denied" }, { status: 404 });
    }

    // Validate both versions exist
    const versions = await db
      .select({ version: schema.promptVersions.version })
      .from(schema.promptVersions)
      .where(eq(schema.promptVersions.promptId, promptId));

    const versionNumbers = new Set(versions.map((v) => v.version));
    if (!versionNumbers.has(baselineVersion)) {
      return NextResponse.json({ error: `Baseline version ${baselineVersion} not found` }, { status: 400 });
    }
    if (!versionNumbers.has(challengerVersion)) {
      return NextResponse.json({ error: `Challenger version ${challengerVersion} not found` }, { status: 400 });
    }

    const [experiment] = await db
      .insert(schema.promptExperiments)
      .values({
        promptId,
        userId: session.userId,
        name: name.trim(),
        description: typeof description === "string" ? description.trim() : undefined,
        baselineVersion,
        challengerVersion,
        winMetric: typeof winMetric === "string" ? winMetric : "quality_score",
        minSamples: typeof minSamples === "number" ? minSamples : 10,
      })
      .returning();

    return NextResponse.json({ experiment }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Create experiment API error");
    return NextResponse.json({ error: "Failed to create experiment" }, { status: 500 });
  }
}
