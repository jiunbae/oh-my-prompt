import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import crypto from "crypto";
import { z } from "zod";

function generateToken(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

async function canSharePrompt(userId: string, prompt: { userId: string | null; teamId: string | null }): Promise<boolean> {
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

const shareBodySchema = z.object({
  access: z.enum(["read", "clone"]).optional().default("read"),
  expiresInHours: z.number().int().positive().max(8760).optional().default(168), // default 7 days
});

// POST /api/prompts/[id]/share — Create a shareable link
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const body = await request.json().catch(() => null);
    const parsed = shareBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { access, expiresInHours } = parsed.data;

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

    const hasAccess = await canSharePrompt(session.userId, prompt);
    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const token = generateToken(16);
    const expiresAt = expiresInHours
      ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
      : null;

    const [share] = await db
      .insert(schema.promptShares)
      .values({
        promptId: id,
        token,
        access,
        expiresAt,
      })
      .returning();

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || ""}/share/${token}`;

    return NextResponse.json({
      shareUrl,
      token: share.token,
      expiresAt: share.expiresAt,
      access: share.access,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Prompt share POST error");
    return NextResponse.json(
      { error: "Failed to create share link" },
      { status: 500 }
    );
  }
}
