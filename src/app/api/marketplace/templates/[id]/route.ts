import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";

const updateSchema = z.object({
  category: z.string().max(50).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  isPublic: z.boolean().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const [entry] = await db
      .select({
        id: schema.templateMarketplace.id,
        templateId: schema.templateMarketplace.templateId,
        category: schema.templateMarketplace.category,
        tags: schema.templateMarketplace.tags,
        rating: schema.templateMarketplace.rating,
        ratingCount: schema.templateMarketplace.ratingCount,
        forkCount: schema.templateMarketplace.forkCount,
        isPublic: schema.templateMarketplace.isPublic,
        createdAt: schema.templateMarketplace.createdAt,
        title: schema.promptTemplates.title,
        description: schema.promptTemplates.description,
        template: schema.promptTemplates.template,
        variables: schema.promptTemplates.variables,
        authorName: schema.users.name,
        authorEmail: schema.users.email,
        authorId: schema.templateMarketplace.userId,
      })
      .from(schema.templateMarketplace)
      .innerJoin(schema.promptTemplates, eq(schema.templateMarketplace.templateId, schema.promptTemplates.id))
      .innerJoin(schema.users, eq(schema.templateMarketplace.userId, schema.users.id))
      .where(eq(schema.templateMarketplace.id, id))
      .limit(1);

    if (!entry) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    if (!entry.isPublic && entry.authorId !== session.userId) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Fetch versions
    const versions = await db
      .select()
      .from(schema.templateVersions)
      .where(eq(schema.templateVersions.templateId, entry.templateId))
      .orderBy(schema.templateVersions.version);

    // Fetch user's rating if any
    const [userRating] = await db
      .select()
      .from(schema.templateRatings)
      .where(
        and(
          eq(schema.templateRatings.templateId, entry.templateId),
          eq(schema.templateRatings.userId, session.userId)
        )
      )
      .limit(1);

    return NextResponse.json({
      template: {
        ...entry,
        rating: Number(entry.rating || 0),
      },
      versions,
      userRating: userRating?.rating ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace GET [id] error");
    return NextResponse.json({ error: "Failed to fetch template" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { category, tags, isPublic } = parsed.data;

    const [updated] = await db
      .update(schema.templateMarketplace)
      .set({
        ...(category !== undefined && { category }),
        ...(tags !== undefined && { tags: tags.length > 0 ? tags : null }),
        ...(isPublic !== undefined && { isPublic }),
      })
      .where(
        and(
          eq(schema.templateMarketplace.id, id),
          eq(schema.templateMarketplace.userId, session.userId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Template not found or not owned by you" }, { status: 404 });
    }

    return NextResponse.json({ marketplaceEntry: updated });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace PATCH error");
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const deleted = await db
      .delete(schema.templateMarketplace)
      .where(
        and(
          eq(schema.templateMarketplace.id, id),
          eq(schema.templateMarketplace.userId, session.userId)
        )
      )
      .returning({ id: schema.templateMarketplace.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Template not found or not owned by you" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace DELETE error");
    return NextResponse.json({ error: "Failed to unpublish template" }, { status: 500 });
  }
}
