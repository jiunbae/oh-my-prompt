import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, avg, count } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { z } from "zod";

const rateSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireAuth();

    const body = await request.json();
    const parsed = rateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { rating } = parsed.data;

    // Get marketplace entry to find templateId
    const [entry] = await db
      .select({ templateId: schema.templateMarketplace.templateId })
      .from(schema.templateMarketplace)
      .where(eq(schema.templateMarketplace.id, id))
      .limit(1);

    if (!entry) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const templateId = entry.templateId;

    // Upsert rating
    await db
      .insert(schema.templateRatings)
      .values({
        templateId,
        userId: session.userId,
        rating,
      })
      .onConflictDoUpdate({
        target: [schema.templateRatings.templateId, schema.templateRatings.userId],
        set: { rating },
      });

    // Recalculate average
    const [avgResult] = await db
      .select({ avgRating: avg(schema.templateRatings.rating), count: count() })
      .from(schema.templateRatings)
      .where(eq(schema.templateRatings.templateId, templateId));

    const newRating = avgResult.avgRating ? Number(avgResult.avgRating) : 0;
    const ratingCount = Number(avgResult.count || 0);

    // Update marketplace entry
    await db
      .update(schema.templateMarketplace)
      .set({
        rating: String(newRating.toFixed(2)),
        ratingCount,
      })
      .where(eq(schema.templateMarketplace.templateId, templateId));

    return NextResponse.json({ rating: newRating, ratingCount });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Marketplace rate error");
    return NextResponse.json({ error: "Failed to rate template" }, { status: 500 });
  }
}
