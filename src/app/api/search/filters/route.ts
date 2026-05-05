import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/search/filters
 * Returns available project names and sources for the current user's prompts.
 */
export async function GET() {
  try {
    const session = await requireAuth();

    const [projectsResult, sourcesResult] = await Promise.all([
      db
        .select({
          name: schema.prompts.projectName,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.prompts)
        .where(
          and(
            eq(schema.prompts.userId, session.userId),
            sql`${schema.prompts.projectName} IS NOT NULL`
          )
        )
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`)),
      db
        .select({
          name: schema.prompts.source,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.prompts)
        .where(
          and(
            eq(schema.prompts.userId, session.userId),
            sql`${schema.prompts.source} IS NOT NULL`
          )
        )
        .groupBy(schema.prompts.source)
        .orderBy(desc(sql`count(*)`)),
    ]);

    return NextResponse.json({
      projects: projectsResult.map((p) => ({ name: p.name ?? "", count: p.count })),
      sources: sourcesResult.map((s) => ({ name: s.name ?? "", count: s.count })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Search filters API error");
    return NextResponse.json({ error: "Failed to load filters" }, { status: 500 });
  }
}
