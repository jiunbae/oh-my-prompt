import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, desc, asc, like, or } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";

const MARKETPLACE_CATEGORIES = [
  "development",
  "debugging",
  "refactoring",
  "learning",
  "other",
] as const;

const publishSchema = z.object({
  templateId: z.string().uuid(),
  category: z.enum(MARKETPLACE_CATEGORIES),
  tags: z.array(z.string().max(30)).max(10).default([]),
  isPublic: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    const category = url.searchParams.get("category")?.trim();
    const sort = url.searchParams.get("sort")?.trim() || "newest";
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "12", 10)));
    const offset = (page - 1) * limit;

    // Base conditions: public marketplace entries
    const conditions = [eq(schema.templateMarketplace.isPublic, true)];

    if (category) {
      conditions.push(eq(schema.templateMarketplace.category, category));
    }

    // Search across template title, description, and template text
    let searchCondition;
    if (q) {
      const pattern = `%${q}%`;
      searchCondition = or(
        like(schema.promptTemplates.title, pattern),
        like(schema.promptTemplates.description, pattern),
        like(schema.promptTemplates.template, pattern)
      );
    }

    const whereClause = searchCondition
      ? and(...conditions, searchCondition)
      : and(...conditions);

    // Sort order
    let orderBy;
    switch (sort) {
      case "rating":
        orderBy = [desc(schema.templateMarketplace.rating), desc(schema.templateMarketplace.ratingCount)];
        break;
      case "popular":
        orderBy = [desc(schema.templateMarketplace.forkCount), desc(schema.templateMarketplace.rating)];
        break;
      case "newest":
      default:
        orderBy = [desc(schema.templateMarketplace.createdAt)];
        break;
    }

    const results = await db
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
      })
      .from(schema.templateMarketplace)
      .innerJoin(schema.promptTemplates, eq(schema.templateMarketplace.templateId, schema.promptTemplates.id))
      .innerJoin(schema.users, eq(schema.templateMarketplace.userId, schema.users.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    // Count total
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.templateMarketplace)
      .innerJoin(schema.promptTemplates, eq(schema.templateMarketplace.templateId, schema.promptTemplates.id))
      .where(whereClause);

    const total = countResult[0]?.count ?? 0;

    return NextResponse.json({
      templates: results.map((r) => ({
        ...r,
        rating: Number(r.rating || 0),
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace GET error");
    return NextResponse.json({ error: "Failed to fetch marketplace templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();

    const body = await request.json();
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { templateId, category, tags, isPublic } = parsed.data;

    // Verify user owns the template
    const [tmpl] = await db
      .select()
      .from(schema.promptTemplates)
      .where(
        and(
          eq(schema.promptTemplates.id, templateId),
          eq(schema.promptTemplates.userId, session.userId)
        )
      )
      .limit(1);

    if (!tmpl) {
      return NextResponse.json({ error: "Template not found or not owned by you" }, { status: 404 });
    }

    // Check if already published
    const [existing] = await db
      .select()
      .from(schema.templateMarketplace)
      .where(eq(schema.templateMarketplace.templateId, templateId))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: "Template is already published to marketplace" }, { status: 409 });
    }

    const [published] = await db
      .insert(schema.templateMarketplace)
      .values({
        templateId,
        userId: session.userId,
        category,
        tags: tags.length > 0 ? tags : null,
        isPublic,
      })
      .returning();

    // Also create initial version entry
    await db.insert(schema.templateVersions).values({
      templateId,
      version: 1,
      content: tmpl.template,
      description: tmpl.description,
    });

    return NextResponse.json({ marketplaceEntry: published }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace POST error");
    return NextResponse.json({ error: "Failed to publish template" }, { status: 500 });
  }
}
