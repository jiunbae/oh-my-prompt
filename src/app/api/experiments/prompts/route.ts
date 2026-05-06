import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const prompts = await db
      .select({
        id: schema.prompts.id,
        promptText: schema.prompts.promptText,
        projectName: schema.prompts.projectName,
        timestamp: schema.prompts.timestamp,
      })
      .from(schema.prompts)
      .where(and(eq(schema.prompts.userId, session.userId), isNull(schema.prompts.deletedAt)))
      .orderBy(desc(schema.prompts.timestamp))
      .limit(200);

    return NextResponse.json({ prompts });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "List prompts for experiments API error");
    return NextResponse.json({ error: "Failed to load prompts" }, { status: 500 });
  }
}
