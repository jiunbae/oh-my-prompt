import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and, gt, isNull } from "drizzle-orm";

/**
 * POST /api/teams/:id/join - Accept invite with token
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { token } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Invite token is required" }, { status: 400 });
    }

    // Find valid invite
    const [invite] = await db
      .select()
      .from(schema.teamInvites)
      .where(
        and(
          eq(schema.teamInvites.teamId, id),
          eq(schema.teamInvites.token, token),
          gt(schema.teamInvites.expiresAt, new Date()),
          isNull(schema.teamInvites.usedAt)
        )
      )
      .limit(1);

    if (!invite) {
      return NextResponse.json({ error: "Invalid or expired invite token" }, { status: 400 });
    }

    // Verify the invite email matches the current user's email
    if (invite.email !== session.email.toLowerCase()) {
      return NextResponse.json(
        { error: "Invite was sent to a different email address" },
        { status: 403 }
      );
    }

    // Check if already a member
    const [existingMember] = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, id),
          eq(schema.teamMembers.userId, session.userId)
        )
      )
      .limit(1);

    if (existingMember) {
      return NextResponse.json({ error: "You are already a member of this team" }, { status: 409 });
    }

    // Add member and mark invite as used
    await db.insert(schema.teamMembers).values({
      teamId: id,
      userId: session.userId,
      role: "member",
    });

    await db
      .update(schema.teamInvites)
      .set({ usedAt: new Date() })
      .where(eq(schema.teamInvites.id, invite.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Join team error");
    return NextResponse.json({ error: "Failed to join team" }, { status: 500 });
  }
}
