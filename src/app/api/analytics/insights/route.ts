import { NextRequest, NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { rateLimiters } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { and, eq, gte, lt, sql, isNull } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";

function getDateRange(searchParams: URLSearchParams): { from: Date; to: Date } {
  const now = new Date();
  const rangeParam = searchParams.get("range");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const defaultTo = now;
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  if (rangeParam && /^\d+$/.test(rangeParam)) {
    const days = parseInt(rangeParam, 10);
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }

  const fromParsed = fromParam ? new Date(fromParam) : defaultFrom;
  const toParsed = toParam ? new Date(toParam) : defaultTo;
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

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    // Rate limit
    const rl = rateLimiters.api(session.userId);
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

    const conditions = [
      isNull(schema.prompts.deletedAt),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to),
    ];

    if (scopeUserId) conditions.push(eq(schema.prompts.userId, scopeUserId));
    if (scopeTeamId) conditions.push(eq(schema.prompts.teamId, scopeTeamId));

    const baseWhere = and(...conditions);

    let finalWhere = baseWhere;
    if (projects && projects.length === 1) {
      finalWhere = and(baseWhere, eq(schema.prompts.projectName, projects[0]));
    } else if (projects && projects.length > 1) {
      finalWhere = and(
        baseWhere,
        sql`${schema.prompts.projectName} IN (${sql.join(projects.map((p) => sql`${p}`))})`
      );
    }
    if (sources && sources.length === 1) {
      finalWhere = and(finalWhere, eq(schema.prompts.source, sources[0]));
    } else if (sources && sources.length > 1) {
      finalWhere = and(
        finalWhere,
        sql`${schema.prompts.source} IN (${sql.join(sources.map((s) => sql`${s}`))})`
      );
    }

    // Compute previous period for comparisons
    const periodMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - periodMs);
    const prevTo = from;

    const prevConditions = [
      isNull(schema.prompts.deletedAt),
      gte(schema.prompts.timestamp, prevFrom),
      lt(schema.prompts.timestamp, prevTo),
    ];
    if (scopeUserId) prevConditions.push(eq(schema.prompts.userId, scopeUserId));
    if (scopeTeamId) prevConditions.push(eq(schema.prompts.teamId, scopeTeamId));
    const prevWhere = and(...prevConditions);

    // Peak activity hour
    const peakHourPromise = db
      .select({
        hour: sql<number>`EXTRACT(hour FROM ${schema.prompts.timestamp})::int`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(finalWhere)
      .groupBy(sql`EXTRACT(hour FROM ${schema.prompts.timestamp})`)
      .orderBy(sql`count(*) DESC`)
      .limit(1);

    // Peak weekday
    const peakWeekdayPromise = db.execute(sql`
      SELECT
        TRIM(TO_CHAR(${schema.prompts.timestamp}, 'Dy')) as day,
        COUNT(*)::int as count
      FROM ${schema.prompts}
      WHERE ${finalWhere}
      GROUP BY TO_CHAR(${schema.prompts.timestamp}, 'Dy'), EXTRACT(DOW FROM ${schema.prompts.timestamp})
      ORDER BY COUNT(*) DESC
      LIMIT 1
    `);

    // Most active project
    const topProjectPromise = db
      .select({
        name: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(finalWhere, sql`${schema.prompts.projectName} IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(1);

    // Quality trend (current vs previous)
    const qualityCurrentPromise = db
      .select({
        avg: sql<number>`coalesce(avg(${schema.prompts.qualityScore}), 0)`,
        count: sql<number>`count(${schema.prompts.qualityScore})`,
      })
      .from(schema.prompts)
      .where(and(finalWhere, sql`${schema.prompts.qualityScore} IS NOT NULL`));

    const qualityPrevPromise = db
      .select({
        avg: sql<number>`coalesce(avg(${schema.prompts.qualityScore}), 0)`,
      })
      .from(schema.prompts)
      .where(and(prevWhere, sql`${schema.prompts.qualityScore} IS NOT NULL`));

    // Total prompts current vs previous
    const countCurrentPromise = db
      .select({ total: sql<number>`count(*)` })
      .from(schema.prompts)
      .where(finalWhere);

    const countPrevPromise = db
      .select({ total: sql<number>`count(*)` })
      .from(schema.prompts)
      .where(prevWhere);

    const [
      peakHour,
      peakWeekdayRaw,
      topProject,
      qualityCurrent,
      qualityPrev,
      countCurrent,
      countPrev,
    ] = await Promise.all([
      peakHourPromise,
      peakWeekdayPromise,
      topProjectPromise,
      qualityCurrentPromise,
      qualityPrevPromise,
      countCurrentPromise,
      countPrevPromise,
    ]);

    const insights: string[] = [];

    // Peak activity insight
    const ph = peakHour[0];
    const pwRows = extractRows(peakWeekdayRaw) as Array<{ day: string; count: number }>;
    const pw = pwRows[0];

    if (ph && pw) {
      const hour = Number(ph.hour);
      const hourLabel = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
      insights.push(`Peak activity on ${String(pw.day)}s at ${hourLabel} (${ph.count} prompts)`);
    } else if (ph) {
      const hour = Number(ph.hour);
      const hourLabel = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
      insights.push(`Peak activity at ${hourLabel} (${ph.count} prompts)`);
    }

    // Most active project
    const tp = topProject[0];
    if (tp) {
      insights.push(`Most active project: ${tp.name} with ${tp.count} prompts`);
    }

    // Quality improvement
    const qc = qualityCurrent[0];
    const qp = qualityPrev[0];
    if (qc && qc.count > 0 && qp) {
      const currentAvg = Number(qc.avg);
      const prevAvg = Number(qp.avg);
      if (prevAvg > 0) {
        const change = ((currentAvg - prevAvg) / prevAvg) * 100;
        if (Math.abs(change) >= 1) {
          const direction = change > 0 ? "improved" : "declined";
          insights.push(`Quality score ${direction} ${Math.abs(change).toFixed(0)}% vs previous period`);
        }
      }
    }

    // Volume change
    const cc = countCurrent[0];
    const cp = countPrev[0];
    if (cc && cp) {
      const currentTotal = Number(cc.total);
      const prevTotal = Number(cp.total);
      if (prevTotal > 0) {
        const change = ((currentTotal - prevTotal) / prevTotal) * 100;
        if (Math.abs(change) >= 5) {
          const direction = change > 0 ? "up" : "down";
          insights.push(`Prompt volume ${direction} ${Math.abs(change).toFixed(0)}% vs previous period`);
        }
      }
    }

    return NextResponse.json({ insights });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Analytics insights API error");
    return NextResponse.json(
      { error: "Failed to load analytics insights" },
      { status: 500 }
    );
  }
}
