import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    // Get marketplace entry
    const [entry] = await db
      .select({
        templateId: schema.templateMarketplace.templateId,
        isPublic: schema.templateMarketplace.isPublic,
        authorId: schema.templateMarketplace.userId,
      })
      .from(schema.templateMarketplace)
      .where(eq(schema.templateMarketplace.id, id))
      .limit(1);

    if (!entry) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    if (!entry.isPublic && entry.authorId !== session.userId) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    // Get original template
    const [tmpl] = await db
      .select()
      .from(schema.promptTemplates)
      .where(eq(schema.promptTemplates.id, entry.templateId))
      .limit(1);

    if (!tmpl) {
      return NextResponse.json({ error: "Original template not found" }, { status: 404 });
    }

    // Create forked template for current user
    const [forked] = await db
      .insert(schema.promptTemplates)
      .values({
        userId: session.userId,
        title: `${tmpl.title} (forked)`,
        description: tmpl.description,
        template: tmpl.template,
        variables: tmpl.variables,
        category: tmpl.category,
        isPublic: false,
      })
      .returning();

    // Increment fork count
    await db
      .update(schema.templateMarketplace)
      .set({ forkCount: sql`${schema.templateMarketplace.forkCount} + 1` })
      .where(eq(schema.templateMarketplace.id, id));

    return NextResponse.json({ template: forked }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace fork error");
    return NextResponse.json({ error: "Failed to fork template" }, { status: 500 });
  }
}
