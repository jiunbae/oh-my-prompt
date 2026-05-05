import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    // Find the prompt
    const [prompt] = await db
      .select({ userId: schema.prompts.userId, teamId: schema.prompts.teamId })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.id, id), isNull(schema.prompts.deletedAt)))
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Check ownership
    const isOwner = prompt.userId === session.userId;
    let canDelete = isOwner;

    // Check team admin/owner access
    if (!canDelete && prompt.teamId) {
      const [membership] = await db
        .select({ role: schema.teamMembers.role })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, prompt.teamId),
            eq(schema.teamMembers.userId, session.userId)
          )
        )
        .limit(1);
      if (membership && (membership.role === "owner" || membership.role === "admin")) {
        canDelete = true;
      }
    }

    if (!canDelete) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db
      .update(schema.prompts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.prompts.id, id));

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
