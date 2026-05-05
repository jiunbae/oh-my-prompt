import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { and, lt, isNotNull } from "drizzle-orm";

/**
 * POST /api/admin/purge-deleted
 *
 * Permanently deletes soft-deleted prompts older than 30 days.
 */
export async function POST() {
  try {
    await requireAdmin();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await db
      .delete(schema.prompts)
      .where(
        and(
          isNotNull(schema.prompts.deletedAt),
          lt(schema.prompts.deletedAt, thirtyDaysAgo)
        )
      )
      .returning({ id: schema.prompts.id });

    const purgedCount = result.length;

    logger.info({ purgedCount }, "Purged soft-deleted prompts");

    return NextResponse.json({ success: true, purgedCount });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Purge deleted prompts error");
    return NextResponse.json(
      { error: "Failed to purge deleted prompts" },
      { status: 500 }
    );
  }
}
