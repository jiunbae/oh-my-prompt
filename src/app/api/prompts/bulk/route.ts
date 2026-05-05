import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

const bulkActionSchema = z.object({
  action: z.enum(["delete", "tag"]),
  ids: z.array(z.string().uuid()).min(1).max(500),
  tag: z.string().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => null);
    const parsed = bulkActionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, ids, tag } = parsed.data;

    // Verify ownership: only affect prompts belonging to the current user
    const ownedPrompts = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(
        and(
          inArray(schema.prompts.id, ids),
          eq(schema.prompts.userId, session.userId),
          isNull(schema.prompts.deletedAt)
        )
      );

    const ownedIds = ownedPrompts.map((p) => p.id);

    if (ownedIds.length === 0) {
      return NextResponse.json({ affected: 0 });
    }

    let affected = 0;

    if (action === "delete") {
      await db
        .update(schema.prompts)
        .set({ deletedAt: new Date() })
        .where(
          and(
            inArray(schema.prompts.id, ownedIds),
            eq(schema.prompts.userId, session.userId)
          )
        );
      affected = ownedIds.length;
    }

    if (action === "tag") {
      if (!tag) {
        return NextResponse.json(
          { error: "Tag name is required for tag action" },
          { status: 400 }
        );
      }

      // Find or create the tag
      const [existingTag] = await db
        .select({ id: schema.tags.id })
        .from(schema.tags)
        .where(eq(schema.tags.name, tag))
        .limit(1);

      let tagId: string;

      if (existingTag) {
        tagId = existingTag.id;
      } else {
        const [newTag] = await db
          .insert(schema.tags)
          .values({ name: tag })
          .returning({ id: schema.tags.id });
        tagId = newTag.id;
      }

      // Insert prompt-tag associations (skip duplicates)
      const values = ownedIds.map((promptId) => ({
        promptId,
        tagId,
      }));

      await db
        .insert(schema.promptTags)
        .values(values)
        .onConflictDoNothing();

      affected = ownedIds.length;
    }

    return NextResponse.json({ affected });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Bulk prompts API error");
    return NextResponse.json(
      { error: "Failed to perform bulk operation" },
      { status: 500 }
    );
  }
}