import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { requireAuth, AuthError } from "@/lib/with-auth";
import { logger } from "@/lib/logger";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, isNull } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import {
  APP_TIME_ZONE,
  addDaysToDateKey,
  dateKeyInTimeZone,
  parseDate,
  startOfDateKeyInTimeZone,
  endExclusiveOfDateKeyInTimeZone,
} from "@/lib/date-utils";

export const dynamic = "force-dynamic";

/**
 * Lightweight endpoint that returns {date, count}[] for the full date range.
 * No session details, no pagination — just day-level session counts for the calendar heatmap.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();

    const { searchParams } = new URL(request.url);
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const project = searchParams.get("project") || null;
    const source = searchParams.get("source") || null;

    // Validate date params
    if (fromParam && !parseDate(fromParam)) {
      return NextResponse.json({ error: "Invalid 'from' date. Expected YYYY-MM-DD." }, { status: 400 });
    }
    if (toParam && !parseDate(toParam)) {
      return NextResponse.json({ error: "Invalid 'to' date. Expected YYYY-MM-DD." }, { status: 400 });
    }

    // Validate from <= to
    if (fromParam && toParam) {
      const fromDate = parseDate(fromParam)!;
      const toDate = parseDate(toParam)!;
      if (fromDate.getTime() > toDate.getTime()) {
        return NextResponse.json({ error: "'from' date must be <= 'to' date." }, { status: 400 });
      }
    }

    // Default range: last 90 days in the app timezone
    const now = new Date();
    const todayKey = dateKeyInTimeZone(now);
    const defaultFrom = startOfDateKeyInTimeZone(addDaysToDateKey(todayKey, -90))!;

    const from = fromParam ? startOfDateKeyInTimeZone(fromParam)! : defaultFrom;

    const toExclusive = toParam
      ? endExclusiveOfDateKeyInTimeZone(toParam)!
      : endExclusiveOfDateKeyInTimeZone(todayKey)!;

    const conditions = [
      eq(schema.prompts.userId, session.userId),
      sql`${schema.prompts.sessionId} IS NOT NULL`,
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, toExclusive),
      isNull(schema.prompts.deletedAt),
    ];

    if (project) conditions.push(eq(schema.prompts.projectName, project));
    if (source) conditions.push(eq(schema.prompts.source, source));

    const whereClause = and(...conditions);

    // Get per-day distinct session counts — no session details, no pagination
    const result = await db.execute(sql`
      SELECT
        (MIN(${schema.prompts.timestamp}) AT TIME ZONE ${APP_TIME_ZONE})::date::text as date,
        COUNT(DISTINCT ${schema.prompts.sessionId})::int as count
      FROM ${schema.prompts}
      WHERE ${whereClause}
      GROUP BY ${schema.prompts.sessionId}
    `);

    const rows = extractRows(result);

    // Aggregate by date (a session's date is based on its first prompt's app-timezone date)
    const dayMap = new Map<string, number>();
    for (const row of rows) {
      const date = String(row.date);
      dayMap.set(date, (dayMap.get(date) ?? 0) + Number(row.count));
    }

    const days = Array.from(dayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json({ days });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    logger.error({ err: error }, "Calendar API error");
    return NextResponse.json(
      { error: "Failed to load calendar data" },
      { status: 500 }
    );
  }
}
