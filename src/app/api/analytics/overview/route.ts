import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

function parseDateRange(searchParams: URLSearchParams) {
  const now = new Date();

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const defaultTo = now;
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const fromParsed = fromParam ? new Date(fromParam) : defaultFrom;
  const toParsed = toParam ? new Date(toParam) : defaultTo;

  // Treat `to=YYYY-MM-DD` as inclusive and convert to an exclusive boundary.
  const toExclusive =
    toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)
      ? new Date(toParsed.getTime() + 24 * 60 * 60 * 1000)
      : toParsed;

  const from = Number.isNaN(fromParsed.getTime()) ? defaultFrom : fromParsed;
  const to = Number.isNaN(toExclusive.getTime()) ? defaultTo : toExclusive;

  if (from >= to) {
    const fallbackFrom = new Date(to);
    fallbackFrom.setDate(fallbackFrom.getDate() - 30);
    return { from: fallbackFrom, to };
  }

  return { from, to };
}

async function getSessionUserId() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!sessionToken) return null;
  const session = parseSessionToken(sessionToken);
  if (!session) return null;

  return session.userId;
}

export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const { from, to } = parseDateRange(searchParams);

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const whereClause = and(
      eq(schema.prompts.userId, userId),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to)
    );

    const [stats, topProjects, promptTypes] = await Promise.all([
      db
        .select({
          totalPrompts: sql<number>`count(*)`,
          totalTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
          uniqueProjects: sql<number>`count(distinct project_name)`,
          avgPromptLength: sql<number>`avg(prompt_length)`,
        })
        .from(schema.prompts)
        .where(whereClause),

      db
        .select({
          project: schema.prompts.projectName,
          promptCount: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        })
        .from(schema.prompts)
        .where(and(whereClause, sql`project_name is not null`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(10),

      db
        .select({
          type: schema.prompts.promptType,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(whereClause)
        .groupBy(schema.prompts.promptType)
        .orderBy(desc(sql`count(*)`)),
    ]);

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      stats: {
        totalPrompts: Number(stats[0]?.totalPrompts ?? 0),
        totalTokens: Number(stats[0]?.totalTokens ?? 0),
        uniqueProjects: Number(stats[0]?.uniqueProjects ?? 0),
        avgPromptLength: Number(stats[0]?.avgPromptLength ?? 0),
      },
      topProjects: topProjects.map((p) => ({
        project: p.project,
        promptCount: Number(p.promptCount ?? 0),
        tokens: Number(p.tokens ?? 0),
      })),
      promptTypes: promptTypes.map((t) => ({
        type: t.type,
        count: Number(t.count ?? 0),
      })),
    });
  } catch (error) {
    console.error("Analytics overview API error:", error);
    return NextResponse.json(
      { error: "Failed to load overview analytics" },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

