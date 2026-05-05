import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, checkIsAdmin, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  try {
    const session = await requireAuth();
    const { id, version: versionParam } = await params;

    const versionNum = parseInt(versionParam, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return NextResponse.json(
        { error: "Invalid version number" },
        { status: 400 }
      );
    }

    const isAdmin = session.isAdmin ? await checkIsAdmin(session.userId) : false;

    // Verify prompt ownership
    const ownershipCondition = isAdmin
      ? eq(schema.prompts.id, id)
      : and(eq(schema.prompts.id, id), eq(schema.prompts.userId, session.userId));

    const [prompt] = await db
      .select({ id: schema.prompts.id })
      .from(schema.prompts)
      .where(ownershipCondition)
      .limit(1);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const [version] = await db
      .select({
        id: schema.promptVersions.id,
        version: schema.promptVersions.version,
        promptText: schema.promptVersions.promptText,
        responseText: schema.promptVersions.responseText,
        createdAt: schema.promptVersions.createdAt,
        reason: schema.promptVersions.reason,
      })
      .from(schema.promptVersions)
      .where(
        and(
          eq(schema.promptVersions.promptId, id),
          eq(schema.promptVersions.version, versionNum)
        )
      )
      .limit(1);

    if (!version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({ version });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Get version API error");
    return NextResponse.json(
      { error: "Failed to get version" },
      { status: 500 }
    );
  }
}
