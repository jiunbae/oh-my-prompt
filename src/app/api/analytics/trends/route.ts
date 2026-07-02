import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { rateLimiters } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { and, eq, gte, lt, sql, isNull } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import {
  APP_TIME_ZONE,
  dateKeyInTimeZone,
  dateKeysBetween,
  getLastNDaysRange,
  parseDateTimeOrDateInTimeZone,
} from "@/lib/date-utils";

function getDateRange(searchParams: URLSearchParams): { from: Date; to: Date } {
  const now = new Date();
  const rangeParam = searchParams.get("range");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const defaultRange = getLastNDaysRange(30, now);

  if (rangeParam && /^\d+$/.test(rangeParam)) {
    const days = parseInt(rangeParam, 10);
    const range = getLastNDaysRange(days, now);
    return { from: range.from, to: range.to };
  }

  const from = parseDateTimeOrDateInTimeZone(fromParam ?? undefined, "start") ?? defaultRange.from;
  const to = parseDateTimeOrDateInTimeZone(toParam ?? undefined, "end-exclusive") ?? defaultRange.to;

  if (from >= to) {
    return { from: defaultRange.from, to: defaultRange.to };
  }

  return { from, to };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Rate limit
    const rl = await rateLimiters.api(session.userId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const { from, to } = getDateRange(searchParams);

    const teamId = searchParams.get("teamId")?.trim() || null;
    const projectParam = searchParams.get("project")?.trim() || null;
    const sourceParam = searchParams.get("source")?.trim() || null;

    // Parse comma-separated filters
    const projects = projectParam ? projectParam.split(",").map((p) => p.trim()).filter(Boolean) : null;
    const sources = sourceParam ? sourceParam.split(",").map((s) => s.trim()).filter(Boolean) : null;

    // Verify team membership if teamId provided
    let scopeUserId: string | null = null;
    let scopeTeamId: string | null = null;

    if (teamId) {
      const membership = await db
        .select()
        .from(schema.teamMembers)
        .where(
          and(
            eq(schema.teamMembers.teamId, teamId),
            eq(schema.teamMembers.userId, session.userId)
          )
        )
        .limit(1);

      if (membership.length === 0) {
        return NextResponse.json({ error: "Team access denied" }, { status: 403 });
      }
      scopeTeamId = teamId;
    } else {
      scopeUserId = session.userId;
    }

    // Build base conditions
    const conditions = [
      isNull(schema.prompts.deletedAt),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to),
    ];

    if (scopeUserId) {
      conditions.push(eq(schema.prompts.userId, scopeUserId));
    }
    if (scopeTeamId) {
      conditions.push(eq(schema.prompts.teamId, scopeTeamId));
    }

    const baseWhere = and(...conditions);

    // Project filter
    let projectWhere = baseWhere;
    if (projects && projects.length === 1) {
      projectWhere = and(baseWhere, eq(schema.prompts.projectName, projects[0]));
    } else if (projects && projects.length > 1) {
      projectWhere = and(
        baseWhere,
        sql`${schema.prompts.projectName} IN (${sql.join(projects.map((p) => sql`${p}`))})`
      );
    }

    // Source filter
    let finalWhere = projectWhere;
    if (sources && sources.length === 1) {
      finalWhere = and(projectWhere, eq(schema.prompts.source, sources[0]));
    } else if (sources && sources.length > 1) {
      finalWhere = and(
        projectWhere,
        sql`${schema.prompts.source} IN (${sql.join(sources.map((s) => sql`${s}`))})`
      );
    }

    const dateExpr = sql<string>`(${schema.prompts.timestamp} AT TIME ZONE ${APP_TIME_ZONE})::date::text`;

    // Daily stats
    const dailyPromise = db
      .select({
        date: dateExpr,
        count: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate}, 0) + coalesce(${schema.prompts.tokenEstimateResponse}, 0)), 0)`,
        avgQuality: sql<number>`coalesce(avg(${schema.prompts.qualityScore}), 0)`,
      })
      .from(schema.prompts)
      .where(finalWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // By project
    const byProjectPromise = db
      .select({
        name: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(finalWhere, sql`${schema.prompts.projectName} IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`);

    // By hour
    const byHourPromise = db
      .select({
        hour: sql<number>`EXTRACT(hour FROM (${schema.prompts.timestamp} AT TIME ZONE ${APP_TIME_ZONE}))::int`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(finalWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    // By weekday
    const byWeekdayPromise = db.execute(sql`
      SELECT
        day,
        COUNT(*)::int as count
      FROM (
        SELECT
          TRIM(TO_CHAR(${schema.prompts.timestamp} AT TIME ZONE ${APP_TIME_ZONE}, 'Dy')) as day,
          EXTRACT(DOW FROM ${schema.prompts.timestamp} AT TIME ZONE ${APP_TIME_ZONE}) as dow
        FROM ${schema.prompts}
        WHERE ${finalWhere}
      ) weekday_counts
      GROUP BY day, dow
      ORDER BY dow
    `);

    // Summary
    const summaryPromise = db
      .select({
        totalPrompts: sql<number>`count(*)`,
        avgQuality: sql<number>`coalesce(avg(${schema.prompts.qualityScore}), 0)`,
        totalTokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate}, 0) + coalesce(${schema.prompts.tokenEstimateResponse}, 0)), 0)`,
        activeProjects: sql<number>`count(distinct ${schema.prompts.projectName})`,
      })
      .from(schema.prompts)
      .where(finalWhere);

    // Available filters (projects and sources for the scope)
    const availableProjectsPromise = db
      .select({
        name: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(baseWhere, sql`${schema.prompts.projectName} IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`);

    const availableSourcesPromise = db
      .select({
        name: schema.prompts.source,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(baseWhere, sql`${schema.prompts.source} IS NOT NULL`))
      .groupBy(schema.prompts.source)
      .orderBy(sql`count(*) DESC`);

    const [
      daily,
      byProject,
      byHour,
      byWeekdayRaw,
      summary,
      availableProjects,
      availableSources,
    ] = await Promise.all([
      dailyPromise,
      byProjectPromise,
      byHourPromise,
      byWeekdayPromise,
      summaryPromise,
      availableProjectsPromise,
      availableSourcesPromise,
    ]);

    // Fill missing days
    const dayKeys = dateKeysBetween(
      dateKeyInTimeZone(from),
      dateKeyInTimeZone(new Date(to.getTime() - 1)),
    );

    const dailyMap = new Map(daily.map((d) => [d.date, d]));
    const filledDaily = dayKeys.map((date) => ({
      date,
      count: Number(dailyMap.get(date)?.count ?? 0),
      tokens: Number(dailyMap.get(date)?.tokens ?? 0),
      avgQuality: Math.round(Number(dailyMap.get(date)?.avgQuality ?? 0) * 10) / 10,
    }));

    // Parse weekday results
    const weekdayRows = extractRows(byWeekdayRaw) as Array<{ day: string; count: number }>;
    const byWeekday = weekdayRows.map((r) => ({
      day: String(r.day).trim(),
      count: Number(r.count ?? 0),
    }));

    return NextResponse.json({
      daily: filledDaily,
      byProject: byProject.map((p) => ({ name: p.name ?? "Unknown", count: Number(p.count ?? 0) })),
      byHour: byHour.map((h) => ({ hour: Number(h.hour), count: Number(h.count ?? 0) })),
      byWeekday,
      summary: {
        totalPrompts: Number(summary[0]?.totalPrompts ?? 0),
        avgQuality: Math.round((Number(summary[0]?.avgQuality ?? 0) / 20) * 10) / 10,
        totalTokens: Number(summary[0]?.totalTokens ?? 0),
        activeProjects: Number(summary[0]?.activeProjects ?? 0),
      },
      availableProjects: availableProjects
        .map((p) => ({ name: p.name ?? "", count: Number(p.count ?? 0) }))
        .filter((p) => p.name),
      availableSources: availableSources
        .map((s) => ({ name: s.name ?? "", count: Number(s.count ?? 0) }))
        .filter((s) => s.name),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Analytics trends API error");
    return NextResponse.json(
      { error: "Failed to load trends analytics" },
      { status: 500 }
    );
  }
}
