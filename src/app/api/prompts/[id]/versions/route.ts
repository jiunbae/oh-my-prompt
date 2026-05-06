import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, checkIsAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { handleVersionForExperiments } from "@/lib/experiment-utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const isAdmin = session.isAdmin ? await checkIsAdmin(session.userId) : false;

    // Verify prompt ownership
    const ownershipCondition = isAdmin
      ? eq(schema.prompts.id, id)
      : and(eq(schema.prompts.id, id), eq(schema.prompts.userId, session.userId));

    const [prompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(ownershipCondition)
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const versions = await db
      .select({
        id: schema.promptVersions.id,
        version: schema.promptVersions.version,
        promptText: schema.promptVersions.promptText,
        responseText: schema.promptVersions.responseText,
        createdAt: schema.promptVersions.createdAt,
        reason: schema.promptVersions.reason,
      })
      .from(schema.promptVersions)
      .where(eq(schema.promptVersions.promptId, id))
      .orderBy(desc(schema.promptVersions.version));

    return NextResponse.json({ versions });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "List versions API error");
    return NextResponse.json(
      { error: "Failed to list versions" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" && body.reason.length <= 100
      ? body.reason
      : "user_edit";

    const isAdmin = session.isAdmin ? await checkIsAdmin(session.userId) : false;

    // Verify prompt ownership
    const ownershipCondition = isAdmin
      ? eq(schema.prompts.id, id)
      : and(eq(schema.prompts.id, id), eq(schema.prompts.userId, session.userId));

    const [prompt] = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        responseText: schema.prompts.responseText,
        qualityScore: schema.prompts.qualityScore,
        qualityClarity: schema.prompts.qualityClarity,
        qualitySpecificity: schema.prompts.qualitySpecificity,
        qualityContext: schema.prompts.qualityContext,
        qualityConstraints: schema.prompts.qualityConstraints,
        qualityStructure: schema.prompts.qualityStructure,
      })
      .from(schema.prompts)
      .where(ownershipCondition)
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Get next version number
    const [latestVersion] = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(${schema.promptVersions.version}), 0)` })
      .from(schema.promptVersions)
      .where(eq(schema.promptVersions.promptId, id));

    const nextVersion = (latestVersion?.maxVersion ?? 0) + 1;

    const [newVersion] = await db
      .insert(schema.promptVersions)
      .values({
        promptId: id,
        version: nextVersion,
        promptText: prompt.promptText,
        responseText: prompt.responseText,
        reason,
      })
      .returning();

    // Trigger experiment auto-calculation for running experiments
    try {
      await handleVersionForExperiments(id, nextVersion, prompt as schema.Prompt);
    } catch (expErr) {
      logger.error({ err: expErr }, "Experiment auto-calculation error");
    }

    return NextResponse.json({ version: newVersion }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Create version API error");
    return NextResponse.json(
      { error: "Failed to create version" },
      { status: 500 }
    );
  }
}
