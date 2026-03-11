import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, desc } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import { logger } from "@/lib/logger";

export interface DashboardData {
  today: { prompts: number; tokens: number; sessions: number; projects: number };
  yesterday: { prompts: number; tokens: number; sessions: number; projects: number };
  last7Days: Array<{ date: string; count: number }>;
  recentSessions: Array<{
    sessionId: string;
    displayName: string | null;
    firstPrompt: string;
    startedAt: string;
    endedAt: string;
    promptCount: number;
    responseCount: number;
    projectName: string | null;
    source: string | null;
    totalTokens: number;
  }>;
  topProjects: Array<{ project: string; count: number }>;
  // Token Usage card
  tokenUsage: {
    totalTokens: number;
    promptTokens: number;
    responseTokens: number;
    avgPerPrompt: number;
    dailyTrend: Array<{ date: string; tokens: number }>;
    byProject: Array<{ project: string; tokens: number }>;
  };
  // Quality Score card
  quality: {
    avgScore: number;
    totalScored: number;
    distribution: Array<{ range: string; count: number }>;
    dailyTrend: Array<{ date: string; avg: number }>;
    topPrompts: Array<{ id: string; score: number; text: string }>;
  };
  // Topics card
  topics: Array<{ tag: string; count: number }>;
}

export async function getDashboardData(userId: string): Promise<DashboardData | null> {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    const weekAgoStart = new Date(todayStart);
    weekAgoStart.setUTCDate(weekAgoStart.getUTCDate() - 6);

    const userFilter = eq(schema.prompts.userId, userId);

    // Single Promise.all for all 13 queries (no data dependency between them)
    const [todayStats, yesterdayStats, dailyCounts, recentSessionsRaw, topProjectsRaw, tokenStats, dailyTokens, tokensByProject, qualityStats, qualityDistRaw, qualityTrend, topQualityRaw, topicTagsRaw] =
      await Promise.all([
        db.select({
          prompts: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
          sessions: sql<number>`count(distinct ${schema.prompts.sessionId})`,
          projects: sql<number>`count(distinct ${schema.prompts.projectName})`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, todayStart), lt(schema.prompts.timestamp, tomorrowStart))),

        db.select({
          prompts: sql<number>`count(*)`,
          tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
          sessions: sql<number>`count(distinct ${schema.prompts.sessionId})`,
          projects: sql<number>`count(distinct ${schema.prompts.projectName})`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, yesterdayStart), lt(schema.prompts.timestamp, todayStart))),

        db.select({
          date: sql<string>`date(${schema.prompts.timestamp})`,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart)))
        .groupBy(sql`date(${schema.prompts.timestamp})`)
        .orderBy(sql`date(${schema.prompts.timestamp})`),

        db.execute(sql`
          SELECT
            ${schema.prompts.sessionId} as session_id,
            ${schema.sessionDisplayNames.displayName} as display_name,
            MIN(${schema.prompts.timestamp}) as started_at,
            MAX(${schema.prompts.timestamp}) as ended_at,
            COUNT(*)::int as prompt_count,
            COUNT(${schema.prompts.responseText})::int as response_count,
            (array_agg(${schema.prompts.projectName} ORDER BY ${schema.prompts.timestamp} ASC))[1] as project_name,
            (array_agg(${schema.prompts.source} ORDER BY ${schema.prompts.timestamp} ASC))[1] as source,
            LEFT((array_agg(${schema.prompts.promptText} ORDER BY ${schema.prompts.timestamp} ASC))[1], 200) as first_prompt,
            SUM(COALESCE(${schema.prompts.tokenEstimate}, 0) + COALESCE(${schema.prompts.tokenEstimateResponse}, 0))::int as total_tokens
          FROM ${schema.prompts}
          LEFT JOIN ${schema.sessionDisplayNames}
            ON ${schema.sessionDisplayNames.userId} = ${userId}
           AND ${schema.sessionDisplayNames.sessionId} = ${schema.prompts.sessionId}
          WHERE ${schema.prompts.userId} = ${userId} AND ${schema.prompts.sessionId} IS NOT NULL
          GROUP BY ${schema.prompts.sessionId}, ${schema.sessionDisplayNames.displayName}
          ORDER BY MAX(${schema.prompts.timestamp}) DESC
          LIMIT 3
        `),

        db.select({
          project: schema.prompts.projectName,
          count: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(
          userFilter,
          gte(schema.prompts.timestamp, weekAgoStart),
          lt(schema.prompts.timestamp, tomorrowStart),
          sql`${schema.prompts.projectName} IS NOT NULL`,
        ))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`count(*)`))
        .limit(3),

        // Token totals for the week
        db.select({
          totalTokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
          promptTokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0)),0)`,
          responseTokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
          promptCount: sql<number>`count(*)`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart))),

        // Daily token trend (7 days)
        db.select({
          date: sql<string>`date(${schema.prompts.timestamp})`,
          tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart)))
        .groupBy(sql`date(${schema.prompts.timestamp})`)
        .orderBy(sql`date(${schema.prompts.timestamp})`),

        // Tokens by project (top 5)
        db.select({
          project: schema.prompts.projectName,
          tokens: sql<number>`coalesce(sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0)),0)`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart), sql`${schema.prompts.projectName} IS NOT NULL`))
        .groupBy(schema.prompts.projectName)
        .orderBy(desc(sql`sum(coalesce(${schema.prompts.tokenEstimate},0) + coalesce(${schema.prompts.tokenEstimateResponse},0))`))
        .limit(5),

        // Quality average + total scored (7 days)
        db.select({
          avgScore: sql<number>`coalesce(avg(${schema.prompts.qualityScore}),0)`,
          totalScored: sql<number>`count(${schema.prompts.qualityScore})`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart), sql`${schema.prompts.qualityScore} IS NOT NULL`)),

        // Quality score distribution (buckets of 20)
        db.execute(sql`
          SELECT
            CASE
              WHEN ${schema.prompts.qualityScore} < 20 THEN '0-20'
              WHEN ${schema.prompts.qualityScore} < 40 THEN '20-40'
              WHEN ${schema.prompts.qualityScore} < 60 THEN '40-60'
              WHEN ${schema.prompts.qualityScore} < 80 THEN '60-80'
              ELSE '80-100'
            END as range,
            COUNT(*)::int as count
          FROM ${schema.prompts}
          WHERE ${schema.prompts.userId} = ${userId}
            AND ${schema.prompts.timestamp} >= ${weekAgoStart}
            AND ${schema.prompts.timestamp} < ${tomorrowStart}
            AND ${schema.prompts.qualityScore} IS NOT NULL
          GROUP BY 1
          ORDER BY 1
        `),

        // Quality daily trend (7 days)
        db.select({
          date: sql<string>`date(${schema.prompts.timestamp})`,
          avg: sql<number>`coalesce(avg(${schema.prompts.qualityScore}),0)`,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart), sql`${schema.prompts.qualityScore} IS NOT NULL`))
        .groupBy(sql`date(${schema.prompts.timestamp})`)
        .orderBy(sql`date(${schema.prompts.timestamp})`),

        // Top 3 quality prompts (7 days)
        db.select({
          id: schema.prompts.id,
          qualityScore: schema.prompts.qualityScore,
          promptText: schema.prompts.promptText,
        })
        .from(schema.prompts)
        .where(and(userFilter, gte(schema.prompts.timestamp, weekAgoStart), lt(schema.prompts.timestamp, tomorrowStart), sql`${schema.prompts.qualityScore} IS NOT NULL`))
        .orderBy(desc(schema.prompts.qualityScore))
        .limit(3),

        // Topic tags aggregation (7 days)
        db.execute(sql`
          SELECT tag, COUNT(*)::int as count
          FROM ${schema.prompts}, unnest(${schema.prompts.topicTags}) as tag
          WHERE ${schema.prompts.userId} = ${userId}
            AND ${schema.prompts.timestamp} >= ${weekAgoStart}
            AND ${schema.prompts.timestamp} < ${tomorrowStart}
            AND ${schema.prompts.topicTags} IS NOT NULL
          GROUP BY tag
          ORDER BY count DESC
          LIMIT 10
        `),
      ]);

    // Fill 7-day series with zeros for missing days
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setUTCDate(d.getUTCDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
    }
    const dailyMap = new Map(dailyCounts.map(d => [d.date, Number(d.count)]));
    const last7Days = dayKeys.map(date => ({ date, count: dailyMap.get(date) ?? 0 }));

    // Fill daily token trend
    const dailyTokenMap = new Map(dailyTokens.map(d => [d.date, Number(d.tokens)]));
    const tokenDailyTrend = dayKeys.map(date => ({ date, tokens: dailyTokenMap.get(date) ?? 0 }));

    // Fill quality daily trend
    const qualityTrendMap = new Map(qualityTrend.map(d => [d.date, Math.round(Number(d.avg))]));
    const qualityDailyTrend = dayKeys.map(date => ({ date, avg: qualityTrendMap.get(date) ?? 0 }));

    // Parse quality distribution
    const allRanges = ["0-20", "20-40", "40-60", "60-80", "80-100"];
    const distRows = extractRows(qualityDistRaw);
    const distMap = new Map(distRows.map(r => [String(r.range), Number(r.count)]));
    const qualityDistribution = allRanges.map(range => ({ range, count: distMap.get(range) ?? 0 }));

    // Parse top quality prompts
    const topQualityPrompts = topQualityRaw.map(p => ({
      id: p.id,
      score: Number(p.qualityScore ?? 0),
      text: (p.promptText ?? "").slice(0, 120),
    }));

    // Parse topic tags
    const topicRows = extractRows(topicTagsRaw);
    const topics = topicRows.map(r => ({ tag: String(r.tag), count: Number(r.count) }));

    // Parse sessions
    const sRows = extractRows(recentSessionsRaw);
    const recentSessions = sRows.map(r => ({
      sessionId: String(r.session_id),
      displayName: r.display_name ? String(r.display_name) : null,
      firstPrompt: String(r.first_prompt ?? ""),
      startedAt: String(r.started_at),
      endedAt: String(r.ended_at),
      promptCount: Number(r.prompt_count),
      responseCount: Number(r.response_count),
      projectName: r.project_name ? String(r.project_name) : null,
      source: r.source ? String(r.source) : null,
      totalTokens: Number(r.total_tokens ?? 0),
    }));

    // Token usage stats
    const tRow = tokenStats[0];
    const totalTokensWeek = Number(tRow?.totalTokens ?? 0);
    const promptTokensWeek = Number(tRow?.promptTokens ?? 0);
    const responseTokensWeek = Number(tRow?.responseTokens ?? 0);
    const promptCountWeek = Number(tRow?.promptCount ?? 0);

    return {
      today: {
        prompts: Number(todayStats[0]?.prompts ?? 0),
        tokens: Number(todayStats[0]?.tokens ?? 0),
        sessions: Number(todayStats[0]?.sessions ?? 0),
        projects: Number(todayStats[0]?.projects ?? 0),
      },
      yesterday: {
        prompts: Number(yesterdayStats[0]?.prompts ?? 0),
        tokens: Number(yesterdayStats[0]?.tokens ?? 0),
        sessions: Number(yesterdayStats[0]?.sessions ?? 0),
        projects: Number(yesterdayStats[0]?.projects ?? 0),
      },
      last7Days,
      recentSessions,
      topProjects: topProjectsRaw.map(p => ({
        project: p.project ?? "Unknown",
        count: Number(p.count),
      })),
      tokenUsage: {
        totalTokens: totalTokensWeek,
        promptTokens: promptTokensWeek,
        responseTokens: responseTokensWeek,
        avgPerPrompt: promptCountWeek > 0 ? Math.round(totalTokensWeek / promptCountWeek) : 0,
        dailyTrend: tokenDailyTrend,
        byProject: tokensByProject.map(p => ({
          project: p.project ?? "Unknown",
          tokens: Number(p.tokens),
        })),
      },
      quality: {
        avgScore: Math.round(Number(qualityStats[0]?.avgScore ?? 0)),
        totalScored: Number(qualityStats[0]?.totalScored ?? 0),
        distribution: qualityDistribution,
        dailyTrend: qualityDailyTrend,
        topPrompts: topQualityPrompts,
      },
      topics,
    };
  } catch (error) {
    logger.error({ err: error }, "Dashboard data error");
    return null;
  }
}
