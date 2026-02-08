import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { and, eq, gte, lt } from "drizzle-orm";

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

function toDateOnlyString(date: Date) {
  return date.toISOString().slice(0, 10);
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
  const { from, to } = parseDateRange(url.searchParams);

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    const rows = await db
      .select({
        timestamp: schema.prompts.timestamp,
        projectName: schema.prompts.projectName,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, userId),
          gte(schema.prompts.timestamp, from),
          lt(schema.prompts.timestamp, to),
          eq(schema.prompts.promptType, "user_input")
        )
      )
      .orderBy(schema.prompts.timestamp);

    const gapMs = 30 * 60 * 1000;

    const sessions: Array<{
      start: Date;
      end: Date;
      promptCount: number;
    }> = [];

    for (const row of rows) {
      const ts = new Date(row.timestamp);
      const last = sessions[sessions.length - 1];

      if (!last) {
        sessions.push({ start: ts, end: ts, promptCount: 1 });
        continue;
      }

      const gap = ts.getTime() - last.end.getTime();
      if (gap > gapMs) {
        sessions.push({ start: ts, end: ts, promptCount: 1 });
      } else {
        last.end = ts;
        last.promptCount += 1;
      }
    }

    const sessionsCount = sessions.length;
    const totalPrompts = sessions.reduce((acc, s) => acc + s.promptCount, 0);
    const totalMinutes = sessions.reduce(
      (acc, s) => acc + (s.end.getTime() - s.start.getTime()) / 60000,
      0
    );

    const avgPromptsPerSession =
      sessionsCount === 0 ? 0 : Math.round(totalPrompts / sessionsCount);
    const avgSessionMinutes =
      sessionsCount === 0 ? 0 : Math.round(totalMinutes / sessionsCount);

    const sessionsPerDayMap = new Map<string, number>();
    for (const s of sessions) {
      const day = toDateOnlyString(s.start);
      sessionsPerDayMap.set(day, (sessionsPerDayMap.get(day) ?? 0) + 1);
    }

    const sessionsPerDay = [...sessionsPerDayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, sessions: count }));

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        sessions: sessionsCount,
        avgPromptsPerSession,
        avgSessionMinutes,
      },
      sessionsPerDay,
    });
  } catch (error) {
    console.error("Analytics sessions API error:", error);
    return NextResponse.json(
      { error: "Failed to load sessions analytics" },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

