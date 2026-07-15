import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq, and, gt, isNull } from "drizzle-orm";

class JoinTeamError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409) {
    super(message);
  }
}

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

    await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(schema.teamInvites)
        .where(
          and(
            eq(schema.teamInvites.teamId, id),
            eq(schema.teamInvites.token, token),
            gt(schema.teamInvites.expiresAt, new Date()),
            isNull(schema.teamInvites.usedAt),
          ),
        )
        .limit(1);

      if (!invite) throw new JoinTeamError("Invalid or expired invite token", 400);
      if (invite.email !== session.email.toLowerCase()) {
        throw new JoinTeamError("Invite was sent to a different email address", 403);
      }

      const [existingMember] = await tx
        .select({ userId: schema.teamMembers.userId })
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, id),
            eq(schema.teamMembers.userId, session.userId),
          ),
        )
        .limit(1);
      if (existingMember) {
        throw new JoinTeamError("You are already a member of this team", 409);
      }

      // Claim atomically: a concurrent request can no longer consume the same
      // invite after both requests pass the initial read.
      const [claimed] = await tx
        .update(schema.teamInvites)
        .set({ usedAt: new Date() })
        .where(and(eq(schema.teamInvites.id, invite.id), isNull(schema.teamInvites.usedAt)))
        .returning({ id: schema.teamInvites.id });
      if (!claimed) throw new JoinTeamError("Invite token has already been used", 400);

      await tx.insert(schema.teamMembers).values({
        teamId: id,
        userId: session.userId,
        role: "member",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof JoinTeamError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Join team error");
    return NextResponse.json({ error: "Failed to join team" }, { status: 500 });
  }
}
