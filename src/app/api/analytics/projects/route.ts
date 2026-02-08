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

  const url = new URL(request.url);
  const { searchParams } = url;
  const { from, to } = parseDateRange(searchParams);

  const project = searchParams.get("project")?.trim() || null;

  const limitParam = searchParams.get("limit");
  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 50);
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const baseWhere = and(
      eq(schema.prompts.userId, userId),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to),
      eq(schema.prompts.promptType, "user_input")
    );

    const dateExpr = sql<string>`date(${schema.prompts.timestamp})`;

    const topProjectsPromise = db
      .select({
        project: schema.prompts.projectName,
        promptCount: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        lastActive: sql<Date>`max(${schema.prompts.timestamp})`,
      })
      .from(schema.prompts)
      .where(and(baseWhere, sql`project_name is not null`))
      .groupBy(schema.prompts.projectName)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

    const topProjects = await topProjectsPromise;

    const timeline = project
      ? await db
          .select({
            date: dateExpr,
            promptCount: sql<number>`count(*)`,
            tokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
          })
          .from(schema.prompts)
          .where(and(baseWhere, eq(schema.prompts.projectName, project)))
          .groupBy(dateExpr)
          .orderBy(dateExpr)
      : [];

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      topProjects: topProjects.map((p) => ({
        project: p.project,
        promptCount: Number(p.promptCount ?? 0),
        tokens: Number(p.tokens ?? 0),
        lastActive: p.lastActive ? new Date(p.lastActive).toISOString() : null,
      })),
      timeline: timeline.map((t) => ({
        date: t.date,
        promptCount: Number(t.promptCount ?? 0),
        tokens: Number(t.tokens ?? 0),
      })),
    });
  } catch (error) {
    console.error("Analytics projects API error:", error);
    return NextResponse.json(
      { error: "Failed to load projects analytics" },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
