import { NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuth();

    const favorites = await db
      .select({
        id: schema.favoritePrompts.id,
        promptId: schema.favoritePrompts.promptId,
        prompt: {
          id: schema.prompts.id,
          timestamp: schema.prompts.timestamp,
          promptText: schema.prompts.promptText,
          projectName: schema.prompts.projectName,
          promptType: schema.prompts.promptType,
        },
      })
      .from(schema.favoritePrompts)
      .innerJoin(schema.prompts, eq(schema.favoritePrompts.promptId, schema.prompts.id))
      .where(
        and(
          eq(schema.favoritePrompts.userId, session.userId),
          isNull(schema.prompts.deletedAt)
        )
      )
      .orderBy(desc(schema.favoritePrompts.createdAt))
      .limit(100);

    return NextResponse.json({ prompts: favorites });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Favorite prompts list error");
    return NextResponse.json({ error: "Failed to fetch favorites" }, { status: 500 });
  }
}
