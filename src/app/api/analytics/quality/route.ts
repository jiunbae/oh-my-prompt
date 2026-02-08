import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { parseSessionToken, AUTH_COOKIE_NAME } from "@/lib/auth";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

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

type SignalRow = {
  id: string;
  label?: string;
  description?: string;
  present?: boolean;
};

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
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
    const baseWhere = and(
      eq(schema.prompts.userId, userId),
      gte(schema.prompts.timestamp, from),
      lt(schema.prompts.timestamp, to),
      eq(schema.prompts.promptType, "user_input")
    );

    const dateExpr = sql<string>`date(${schema.prompts.timestamp})`;

    const [trendRows, reviewRows] = await Promise.all([
      db
        .select({
          date: dateExpr,
          avgScore: sql<number>`round(avg(${schema.promptReviews.score}))`,
        })
        .from(schema.prompts)
        .innerJoin(
          schema.promptReviews,
          eq(schema.promptReviews.promptId, schema.prompts.id)
        )
        .where(baseWhere)
        .groupBy(dateExpr)
        .orderBy(dateExpr),

      db
        .select({
          score: schema.promptReviews.score,
          signals: schema.promptReviews.signals,
          suggestions: schema.promptReviews.suggestions,
        })
        .from(schema.prompts)
        .innerJoin(
          schema.promptReviews,
          eq(schema.promptReviews.promptId, schema.prompts.id)
        )
        .where(baseWhere),
    ]);

    const totalReviewed = reviewRows.length;
    const scores = reviewRows.map((r) => Number(r.score ?? 0));
    const averageScore =
      totalReviewed === 0
        ? 0
        : Math.round(scores.reduce((a, b) => a + b, 0) / totalReviewed);

    // Histogram buckets: 0-9, 10-19, ... 90-100
    const histogramMap = new Map<number, number>();
    for (let i = 0; i <= 90; i += 10) histogramMap.set(i, 0);
    for (const score of scores) {
      const bucket = Math.min(90, Math.floor(score / 10) * 10);
      histogramMap.set(bucket, (histogramMap.get(bucket) ?? 0) + 1);
    }

    const histogram = [...histogramMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucketStart, count]) => ({ bucketStart, count }));

    // Signal coverage + suggestion counts (derived from JSON stored in text columns)
    const signalMap = new Map<
      string,
      { id: string; label: string; description?: string; presentCount: number }
    >();

    const suggestionCounts = new Map<string, number>();

    for (const row of reviewRows) {
      const signals = safeParseJson<SignalRow[]>(row.signals) ?? [];
      for (const signal of signals) {
        if (!signal?.id) continue;
        const existing = signalMap.get(signal.id) ?? {
          id: signal.id,
          label: signal.label ?? signal.id,
          description: signal.description,
          presentCount: 0,
        };

        if (signal.present) {
          existing.presentCount += 1;
        }

        signalMap.set(signal.id, existing);
      }

      const suggestions = safeParseJson<string[]>(row.suggestions) ?? [];
      for (const suggestion of suggestions) {
        const key = String(suggestion || "").trim();
        if (!key) continue;
        suggestionCounts.set(key, (suggestionCounts.get(key) ?? 0) + 1);
      }
    }

    const signalCoverage = [...signalMap.values()]
      .map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        presentCount: s.presentCount,
        totalCount: totalReviewed,
        percent: totalReviewed ? Math.round((s.presentCount / totalReviewed) * 100) : 0,
      }))
      .sort((a, b) => a.percent - b.percent);

    const topSuggestions = [...suggestionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([suggestion, count]) => ({ suggestion, count }));

    return NextResponse.json({
      available: true,
      range: { from: from.toISOString(), to: to.toISOString() },
      totalReviewed,
      averageScore,
      histogram,
      signalCoverage,
      dailyTrend: trendRows.map((t) => ({
        date: t.date,
        avgScore: Number(t.avgScore ?? 0),
      })),
      topSuggestions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // If the table hasn't been created/migrated yet, return a soft "not available"
    // response so the UI can hide the section.
    if (message.toLowerCase().includes("prompt_reviews") && message.toLowerCase().includes("does not exist")) {
      return NextResponse.json({
        available: false,
        range: { from: from.toISOString(), to: to.toISOString() },
        message: "prompt_reviews table not found",
      });
    }

    console.error("Analytics quality API error:", error);
    return NextResponse.json(
      { error: "Failed to load quality analytics" },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

