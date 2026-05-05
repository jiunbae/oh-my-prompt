import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

async function canManagePrompt(userId: string, prompt: { userId: string | null; teamId: string | null }): Promise<boolean> {
  if (prompt.userId === userId) return true;
  if (prompt.teamId) {
    const [membership] = await db
      .select({ role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, prompt.teamId),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .limit(1);
    if (membership && (membership.role === "owner" || membership.role === "admin")) {
      return true;
    }
  }
  return false;
}

// DELETE /api/prompts/[id]/shares/[shareId] — Revoke a share
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const { id, shareId } = await params;
    const session = await requireAuth();

    // Find the prompt and verify ownership
    const [prompt] = await db
      .select({
        id: schema.prompts.id,
        userId: schema.prompts.userId,
        teamId: schema.prompts.teamId,
      })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.id, id), isNull(schema.prompts.deletedAt)))
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const hasAccess = await canManagePrompt(session.userId, prompt);
    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Find the share to confirm it belongs to this prompt
    const [share] = await db
      .select({ id: schema.promptShares.id })
      .from(schema.promptShares)
      .where(and(eq(schema.promptShares.id, shareId), eq(schema.promptShares.promptId, id)))
      .limit(1);

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    await db
      .delete(schema.promptShares)
      .where(eq(schema.promptShares.id, shareId));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Prompt share DELETE error");
    return NextResponse.json(
      { error: "Failed to revoke share" },
      { status: 500 }
    );
  }
}
