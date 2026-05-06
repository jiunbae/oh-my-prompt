import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { triggerEvent } from "@/lib/integration-triggers";

export const dynamic = "force-dynamic";

/**
 * POST /api/prompts/[id]/favorite
 * Toggle favorite status for a prompt.
 * If already favorited, removes it. If not, adds it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    // Check that the prompt actually belongs to the user
    const [existingPrompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.id, id),
          eq(schema.prompts.userId, session.userId),
          isNull(schema.prompts.deletedAt)
        )
      )
      .limit(1);

    if (!existingPrompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Check if already favorited
    const [existing] = await db
      .select({ id: schema.favoritePrompts.id })
      .from(schema.favoritePrompts)
      .where(
        and(
          eq(schema.favoritePrompts.userId, session.userId),
          eq(schema.favoritePrompts.promptId, id)
        )
      )
      .limit(1);

    if (existing) {
      // Remove favorite
      await db
        .delete(schema.favoritePrompts)
        .where(eq(schema.favoritePrompts.id, existing.id));

      return NextResponse.json({ favorited: false });
    }

    // Add favorite
    await db
      .insert(schema.favoritePrompts)
      .values({
        userId: session.userId,
        promptId: id,
      });

    // Trigger outgoing integration (fire-and-forget)
    triggerEvent("prompt.favorited", { promptId: id }, session.userId).catch((err) => {
      logger.error({ err }, "Non-blocking integration trigger failed for prompt.favorited");
    });

    return NextResponse.json({ favorited: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Favorite prompt toggle error");
    return NextResponse.json(
      { error: "Failed to toggle favorite" },
      { status: 500 }
    );
  }
}
