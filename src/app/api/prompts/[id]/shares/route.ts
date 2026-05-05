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

// GET /api/prompts/[id]/shares — List active shares for a prompt
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const shares = await db
      .select({
        id: schema.promptShares.id,
        token: schema.promptShares.token,
        access: schema.promptShares.access,
        expiresAt: schema.promptShares.expiresAt,
        viewCount: schema.promptShares.viewCount,
        createdAt: schema.promptShares.createdAt,
      })
      .from(schema.promptShares)
      .where(eq(schema.promptShares.promptId, id))
      .orderBy(schema.promptShares.createdAt);

    // Filter out expired shares on the server side
    const now = new Date();
    const activeShares = shares.filter((s) => !s.expiresAt || new Date(s.expiresAt) >= now);

    return NextResponse.json({ shares: activeShares });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Prompt shares GET error");
    return NextResponse.json(
      { error: "Failed to fetch shares" },
      { status: 500 }
    );
  }
}
