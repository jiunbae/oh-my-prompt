import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { canViewPrompt, canEditPrompt, canDeletePrompt } from "@/lib/team-access";
import { triggerEvent } from "@/lib/integration-triggers";

/**
 * GET /api/prompts/:id - Get prompt details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const canView = await canViewPrompt(session.userId, id);
    if (!canView) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const [prompt] = await db
      .select()
      .from(schema.prompts)
      .where(and(eq(schema.prompts.id, id), isNull(schema.prompts.deletedAt)))
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Get prompt error");
    return NextResponse.json({ error: "Failed to get prompt" }, { status: 500 });
  }
}

/**
 * PATCH /api/prompts/:id - Update prompt (edit access required)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const canEdit = await canEditPrompt(session.userId, id);
    if (!canEdit) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { promptText, responseText, visibility, tags } = body;

    const updateData: Partial<typeof schema.prompts.$inferInsert> = {};
    if (promptText !== undefined) updateData.promptText = promptText;
    if (responseText !== undefined) updateData.responseText = responseText;
    if (visibility !== undefined) {
      const validVis = ["private", "team", "public"];
      if (validVis.includes(visibility)) {
        updateData.visibility = visibility;
      }
    }

    const [updated] = await db
      .update(schema.prompts)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(schema.prompts.id, id))
      .returning();

    // Handle tags if provided
    if (Array.isArray(tags)) {
      // Remove existing tags
      await db
        .delete(schema.promptTags)
        .where(eq(schema.promptTags.promptId, id));

      // Add new tags
      for (const tagName of tags) {
        if (typeof tagName !== "string") continue;
        const [existing] = await db
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(eq(schema.tags.name, tagName))
          .limit(1);

        if (existing) {
          await db
            .insert(schema.promptTags)
            .values({ promptId: id, tagId: existing.id })
            .onConflictDoNothing();
        } else {
          const [newTag] = await db
            .insert(schema.tags)
            .values({ name: tagName })
            .returning();
          if (newTag) {
            await db
              .insert(schema.promptTags)
              .values({ promptId: id, tagId: newTag.id });
          }
        }
      }
    }

    return NextResponse.json({ prompt: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Update prompt error");
    return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  }
}

/**
 * DELETE /api/prompts/:id - Soft delete prompt
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const canDelete = await canDeletePrompt(session.userId, id);
    if (!canDelete) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db
      .update(schema.prompts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.prompts.id, id));

    // Trigger outgoing integration (fire-and-forget)
    triggerEvent("prompt.deleted", { promptId: id }, session.userId).catch((err) => {
      logger.error({ err }, "Non-blocking integration trigger failed for prompt.deleted");
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Delete API error");
    return NextResponse.json(
      { error: "Failed to delete prompt" },
      { status: 500 }
    );
  }
}
