import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import {
  canViewPrompt,
  canEditPrompt,
  canDeletePrompt,
  canManagePromptAccess,
} from "@/lib/team-access";
import { triggerEvent } from "@/lib/integration-triggers";
import { toPromptDto } from "@/lib/prompt-dto";
import { z } from "zod";

const updatePromptSchema = z.object({
  promptText: z.string().min(1).max(1_000_000).optional(),
  responseText: z.string().max(4_000_000).nullable().optional(),
  visibility: z.enum(["private", "team", "public"]).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
});

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

    return NextResponse.json({ prompt: toPromptDto(prompt) });
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

    const body = await request.json().catch(() => null);
    const parsed = updatePromptSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid prompt update", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { promptText, responseText, visibility, tags } = parsed.data;

    const updateData: Partial<typeof schema.prompts.$inferInsert> = {};
    if (promptText !== undefined) updateData.promptText = promptText;
    if (responseText !== undefined) updateData.responseText = responseText;
    if (visibility !== undefined) {
      if (!(await canManagePromptAccess(session.userId, id))) {
        return NextResponse.json(
          { error: "Only prompt owners and admins can change visibility" },
          { status: 403 }
        );
      }
      updateData.visibility = visibility;
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.prompts)
        .set({ ...updateData, updatedAt: new Date() })
        .where(and(eq(schema.prompts.id, id), isNull(schema.prompts.deletedAt)))
        .returning();

      if (!row) throw new Error("Prompt not found");

      if (tags) {
        await tx.delete(schema.promptTags).where(eq(schema.promptTags.promptId, id));

        for (const tagName of new Set(tags)) {
          const [insertedTag] = await tx
            .insert(schema.tags)
            .values({ name: tagName })
            .onConflictDoNothing({ target: schema.tags.name })
            .returning({ id: schema.tags.id });
          const tag = insertedTag ?? (
            await tx
              .select({ id: schema.tags.id })
              .from(schema.tags)
              .where(eq(schema.tags.name, tagName))
              .limit(1)
          )[0];

          if (tag) {
            await tx
              .insert(schema.promptTags)
              .values({ promptId: id, tagId: tag.id })
              .onConflictDoNothing();
          }
        }
      }

      return row;
    });

    return NextResponse.json({ prompt: toPromptDto(updated) });
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
