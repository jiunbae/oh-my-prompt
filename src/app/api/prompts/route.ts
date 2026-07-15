import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and } from "drizzle-orm";
import { toPromptDto } from "@/lib/prompt-dto";
import { z } from "zod";

const createPromptSchema = z.object({
  promptText: z.string().min(1).max(1_000_000),
  responseText: z.string().max(4_000_000).nullable().optional(),
  projectName: z.string().trim().max(255).nullable().optional(),
  promptType: z.string().trim().min(1).max(100).optional(),
  teamId: z.string().uuid().nullable().optional(),
});

/**
 * POST /api/prompts - Create a new prompt
 * Respects team default visibility settings when teamId is provided.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => null);
    const parsed = createPromptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid prompt", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { promptText, responseText, projectName, promptType, teamId } = parsed.data;

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

    return NextResponse.json({ prompt: toPromptDto(prompt) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Create prompt error");
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
}
