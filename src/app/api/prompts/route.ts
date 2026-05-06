import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and } from "drizzle-orm";

/**
 * POST /api/prompts - Create a new prompt
 * Respects team default visibility settings when teamId is provided.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => ({}));
    const { promptText, responseText, projectName, promptType, teamId } = body;

    if (!promptText || typeof promptText !== "string") {
      return NextResponse.json({ error: "Prompt text is required" }, { status: 400 });
    }

    let visibility: "private" | "team" | "public" = "private";

    // If teamId is provided, verify membership and apply team default visibility
    if (teamId) {
      const [membership] = await db
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, teamId),
            eq(schema.teamMembers.userId, session.userId)
          )
        )
        .limit(1);

      if (!membership) {
        return NextResponse.json({ error: "Team not found or access denied" }, { status: 403 });
      }

      const [settings] = await db
        .select({ defaultPromptVisibility: schema.teamSettings.defaultPromptVisibility })
        .from(schema.teamSettings)
        .where(eq(schema.teamSettings.teamId, teamId))
        .limit(1);

      const teamVis = settings?.defaultPromptVisibility ?? "team";
      if (teamVis === "private" || teamVis === "team" || teamVis === "public") {
        visibility = teamVis;
      }
    }

    const [prompt] = await db
      .insert(schema.prompts)
      .values({
        eventKey: `${session.userId}/${Date.now()}`,
        timestamp: new Date(),
        promptText,
        responseText: responseText ?? null,
        promptLength: promptText.length,
        responseLength: responseText?.length ?? null,
        projectName: projectName ?? null,
        promptType: promptType ?? "user_input",
        userId: session.userId,
        teamId: teamId ?? null,
        visibility,
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Create prompt error");
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
