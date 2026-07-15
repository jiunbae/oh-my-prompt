import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { eq } from "drizzle-orm";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

/**
 * POST /api/teams - Create a new team
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => ({}));
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Team name is required" }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length > 255) {
      return NextResponse.json({ error: "Team name must be 255 characters or less" }, { status: 400 });
    }

    const baseSlug = generateSlug(trimmedName) || "team";
    let slug = baseSlug;
    let attempts = 0;

    // Ensure unique slug
    while (attempts < 10) {
      const existing = await db
        .select({ id: schema.teams.id })
        .from(schema.teams)
        .where(eq(schema.teams.slug, slug))
        .limit(1);
      if (existing.length === 0) break;
      attempts++;
      slug = `${baseSlug}-${attempts}`;
    }

    // Team and owner membership must either both exist or both roll back.
    const team = await db.transaction(async (tx) => {
      const [created] = await tx.insert(schema.teams).values({
        name: trimmedName,
        slug,
      }).returning();

      await tx.insert(schema.teamMembers).values({
        teamId: created.id,
        userId: session.userId,
        role: "owner",
      });
      return created;
    });

    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "Create team error");
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }
}

/**
 * GET /api/teams - List teams the current user is a member of
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const memberships = await db
      .select({
        teamId: schema.teamMembers.teamId,
        role: schema.teamMembers.role,
        joinedAt: schema.teamMembers.joinedAt,
        teamName: schema.teams.name,
        teamSlug: schema.teams.slug,
        teamCreatedAt: schema.teams.createdAt,
        inviteOnly: schema.teamSettings.inviteOnly,
      })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teamMembers.teamId, schema.teams.id))
      .leftJoin(schema.teamSettings, eq(schema.teamMembers.teamId, schema.teamSettings.teamId))
      .where(eq(schema.teamMembers.userId, session.userId));

    return NextResponse.json({
      teams: memberships.map((m) => ({
        id: m.teamId,
        name: m.teamName,
        slug: m.teamSlug,
        role: m.role,
        joinedAt: m.joinedAt,
        createdAt: m.teamCreatedAt,
        inviteOnly: m.inviteOnly ?? false,
      })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error }, "List teams error");
    return NextResponse.json({ error: "Failed to list teams" }, { status: 500 });
  }
}
