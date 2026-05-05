import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { requireAuth, checkIsAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { computeDiff, computeSimilarity } from "@/lib/prompt-diff";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const idA = searchParams.get("a");
    const idB = searchParams.get("b");
    const fromVersion = searchParams.get("from");
    const toVersion = searchParams.get("to");
    const promptId = searchParams.get("promptId");

    const isAdmin = session.isAdmin ? await checkIsAdmin(session.userId) : false;

    // Version-based diff: /api/prompts/:id/diff?from=v1&to=v2
    if (fromVersion && toVersion && promptId) {
      const fromNum = parseInt(fromVersion.replace(/^v/, ""), 10);
      const toNum = parseInt(toVersion.replace(/^v/, ""), 10);

      if (isNaN(fromNum) || isNaN(toNum)) {
        return NextResponse.json(
          { error: "Invalid version numbers" },
          { status: 400 }
        );
      }

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
        return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
      }

      // Fetch both versions
      const versions = await db
        .select({
          version: schema.promptVersions.version,
          promptText: schema.promptVersions.promptText,
          createdAt: schema.promptVersions.createdAt,
        })
        .from(schema.promptVersions)
        .where(
          and(
            eq(schema.promptVersions.promptId, promptId),
            inArray(schema.promptVersions.version, [fromNum, toNum])
          )
        );

      const versionA = versions.find((v) => v.version === fromNum);
      const versionB = versions.find((v) => v.version === toNum);

      if (!versionA || !versionB) {
        return NextResponse.json(
          { error: "One or both versions not found" },
          { status: 404 }
        );
      }

      const diff = computeDiff(versionA.promptText, versionB.promptText);
      const similarity = computeSimilarity(versionA.promptText, versionB.promptText);

      return NextResponse.json({
        promptA: {
          id: `${promptId}-v${fromNum}`,
          version: fromNum,
          timestamp: versionA.createdAt,
          promptText: versionA.promptText,
        },
        promptB: {
          id: `${promptId}-v${toNum}`,
          version: toNum,
          timestamp: versionB.createdAt,
          promptText: versionB.promptText,
        },
        diff,
        similarity,
      });
    }

    // Original prompt-based diff
    if (!idA || !idB) {
      return NextResponse.json(
        { error: "Both 'a' and 'b' prompt IDs are required" },
        { status: 400 }
      );
    }

    const ownershipCondition = isAdmin
      ? and(inArray(schema.prompts.id, [idA, idB]), isNull(schema.prompts.deletedAt))
      : and(
          inArray(schema.prompts.id, [idA, idB]),
          eq(schema.prompts.userId, session.userId),
          isNull(schema.prompts.deletedAt)
        );

    const results = await db
      .select({
        id: schema.prompts.id,
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
        promptText: schema.prompts.promptText,
        qualityScore: schema.prompts.qualityScore,
      })
      .from(schema.prompts)
      .where(ownershipCondition);

    const promptA = results.find((r) => r.id === idA);
    const promptB = results.find((r) => r.id === idB);

    if (!promptA || !promptB) {
      return NextResponse.json(
        { error: "One or both prompts not found" },
        { status: 404 }
      );
    }

    const diff = computeDiff(promptA.promptText, promptB.promptText);
    const similarity = computeSimilarity(promptA.promptText, promptB.promptText);

    return NextResponse.json({
      promptA: {
        id: promptA.id,
        timestamp: promptA.timestamp,
        projectName: promptA.projectName,
        promptText: promptA.promptText,
        qualityScore: promptA.qualityScore,
      },
      promptB: {
        id: promptB.id,
        timestamp: promptB.timestamp,
        projectName: promptB.projectName,
        promptText: promptB.promptText,
        qualityScore: promptB.qualityScore,
      },
      diff,
      similarity,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Diff API error");
    return NextResponse.json(
      { error: "Failed to compute diff" },
      { status: 500 }
    );
  }
}
