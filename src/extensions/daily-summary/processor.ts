import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, isNull } from "drizzle-orm";
import type {
  ProcessorInput,
  InsightResult,
  InsightHighlight,
  InsightTrend,
} from "../types";
import { callLLM, getLLMConfig, localeInstruction } from "../llm";
import { logger } from "@/lib/logger";
import { APP_TIME_ZONE, resolveDateRange } from "@/lib/date-utils";

interface DailyStats {
  totalPrompts: number;
  totalTokens: number;
  uniqueProjects: number;
  uniqueSessions: number;
  peakHour: number;
  peakHourCount: number;
  mostActiveProject: string | null;
  mostActiveProjectCount: number;
  avgPromptLength: number;
  totalResponseTokens: number;
}

async function queryDailyStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<DailyStats> {
  const whereClause = and(
    eq(schema.prompts.userId, userId),
    gte(schema.prompts.timestamp, from),
    lt(schema.prompts.timestamp, to),
    isNull(schema.prompts.deletedAt),
  );

  const [overview, hourly, projects] = await Promise.all([
    db
      .select({
        totalPrompts: sql<number>`count(*)`,
        totalTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0)), 0)`,
        totalResponseTokens: sql<number>`coalesce(sum(coalesce(token_estimate_response, 0)), 0)`,
        uniqueProjects: sql<number>`count(distinct project_name)`,
        uniqueSessions: sql<number>`count(distinct session_id)`,
        avgPromptLength: sql<number>`coalesce(avg(prompt_length), 0)`,
      })
      .from(schema.prompts)
      .where(whereClause),

    db
      .select({
        hour: sql<number>`extract(hour from (${schema.prompts.timestamp} AT TIME ZONE ${APP_TIME_ZONE}))`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(whereClause)
      .groupBy(sql`1`)
      .orderBy(sql`count(*) DESC`)
      .limit(1),

    db
      .select({
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(whereClause, sql`project_name IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(1),
  ]);

  const row = overview[0];
  const peakRow = hourly[0];
  const topProject = projects[0];

  return {
    totalPrompts: Number(row?.totalPrompts ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    totalResponseTokens: Number(row?.totalResponseTokens ?? 0),
    uniqueProjects: Number(row?.uniqueProjects ?? 0),
    uniqueSessions: Number(row?.uniqueSessions ?? 0),
    peakHour: Number(peakRow?.hour ?? 0),
    peakHourCount: Number(peakRow?.count ?? 0),
    mostActiveProject: topProject?.project ?? null,
    mostActiveProjectCount: Number(topProject?.count ?? 0),
    avgPromptLength: Math.round(Number(row?.avgPromptLength ?? 0)),
  };
}

function formatHour(hour: number, locale?: string): string {
  if (locale === "ko") return `${hour}시`;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}${suffix}`;
}

/** Localized title + fallback strings for the daily-summary insight. */
function dailyDict(locale?: string) {
  const ko = locale === "ko";
  return {
    title: ko ? "일일 요약" : "Daily Summary",
    noActivity: ko
      ? "이 기간에는 프롬프트 활동이 없어요. 프롬프트를 작성하면 일일 요약을 볼 수 있어요!"
      : "No prompt activity found for this period. Start prompting to see your daily summary!",
    aiUnavailable: ko
      ? "AI 요약을 사용할 수 없어요. LLM 설정을 확인해 주세요."
      : "AI-enhanced summary unavailable. Check your LLM configuration.",
    labels: {
      totalPrompts: ko ? "전체 프롬프트" : "Total Prompts",
      inputTokens: ko ? "입력 토큰" : "Input Tokens",
      outputTokens: ko ? "출력 토큰" : "Output Tokens",
      uniqueProjects: ko ? "고유 프로젝트" : "Unique Projects",
      sessions: ko ? "세션" : "Sessions",
      peakHour: ko ? "피크 시간대" : "Peak Hour",
      avgPromptLength: ko ? "평균 프롬프트 길이" : "Avg Prompt Length",
      mostActiveProject: ko ? "가장 활발한 프로젝트" : "Most Active Project",
    },
  };
}

function buildStatsOnlyInsight(stats: DailyStats, locale?: string): InsightResult {
  const ko = locale === "ko";
  const d = dailyDict(locale);
  const highlights: InsightHighlight[] = [
    { label: d.labels.totalPrompts, value: stats.totalPrompts },
    { label: d.labels.inputTokens, value: stats.totalTokens },
    { label: d.labels.outputTokens, value: stats.totalResponseTokens },
    { label: d.labels.uniqueProjects, value: stats.uniqueProjects },
    { label: d.labels.sessions, value: stats.uniqueSessions },
    { label: d.labels.peakHour, value: formatHour(stats.peakHour, locale) },
    {
      label: d.labels.avgPromptLength,
      value: ko ? `${stats.avgPromptLength}자` : `${stats.avgPromptLength} chars`,
    },
  ];

  const totalTokens = stats.totalTokens + stats.totalResponseTokens;

  if (stats.mostActiveProject) {
    highlights.push({
      label: d.labels.mostActiveProject,
      value: ko
        ? `${stats.mostActiveProject} (${stats.mostActiveProjectCount}건)`
        : `${stats.mostActiveProject} (${stats.mostActiveProjectCount} prompts)`,
    });
  }

  let summary: string;
  if (ko) {
    const segs: string[] = [];
    const scope: string[] = [];
    if (stats.uniqueProjects > 0) scope.push(`프로젝트 ${stats.uniqueProjects}개`);
    if (stats.uniqueSessions > 0) scope.push(`세션 ${stats.uniqueSessions}개`);
    let lead = `오늘 프롬프트 ${stats.totalPrompts}건을 작성했어요`;
    if (scope.length) lead += ` (${scope.join(", ")})`;
    lead += `, 총 약 ${totalTokens} 토큰을 사용했어요.`;
    segs.push(lead);
    if (stats.peakHourCount > 0) {
      segs.push(
        `가장 활발했던 시간대는 ${formatHour(stats.peakHour, locale)}로 프롬프트 ${stats.peakHourCount}건이 있었어요.`,
      );
    }
    if (stats.mostActiveProject) {
      segs.push(`주요 프로젝트: ${stats.mostActiveProject} (${stats.mostActiveProjectCount}건).`);
    }
    summary = segs.join(" ");
  } else {
    const summaryParts: string[] = [];
    summaryParts.push(
      `You made ${stats.totalPrompts} prompt${stats.totalPrompts !== 1 ? "s" : ""} today`,
    );
    if (stats.uniqueProjects > 0) {
      summaryParts.push(
        `across ${stats.uniqueProjects} project${stats.uniqueProjects !== 1 ? "s" : ""}`,
      );
    }
    if (stats.uniqueSessions > 0) {
      summaryParts.push(
        `in ${stats.uniqueSessions} session${stats.uniqueSessions !== 1 ? "s" : ""}`,
      );
    }
    summaryParts.push(`using approximately ${totalTokens} tokens total.`);
    if (stats.peakHourCount > 0) {
      summaryParts.push(
        `Your most active hour was ${formatHour(stats.peakHour, locale)} with ${stats.peakHourCount} prompts.`,
      );
    }
    if (stats.mostActiveProject) {
      summaryParts.push(
        `Top project: ${stats.mostActiveProject} (${stats.mostActiveProjectCount} prompts).`,
      );
    }
    summary = summaryParts.join(" ");
  }

  return {
    title: d.title,
    summary,
    highlights,
    confidence: 0.9,
    generatedAt: new Date().toISOString(),
  };
}

export async function handler(input: ProcessorInput): Promise<InsightResult> {
  const { from, to } = resolveDateRange(input.dateRange, 1);
  const { locale } = input;
  const d = dailyDict(locale);

  const stats = await queryDailyStats(input.userId, from, to);

  // If no prompts at all, return a minimal result
  if (stats.totalPrompts === 0) {
    return {
      title: d.title,
      summary: d.noActivity,
      highlights: [{ label: d.labels.totalPrompts, value: 0 }],
      confidence: 1,
      generatedAt: new Date().toISOString(),
    };
  }

  // If LLM is not configured, return stats-only insight
  const llmConfig = getLLMConfig();
  if (!llmConfig) {
    return buildStatsOnlyInsight(stats, locale);
  }

  // Build LLM prompt
  const statsJson = JSON.stringify(stats, null, 2);
  const systemPrompt = `You are an AI assistant that generates concise daily activity summaries for a developer prompt tracking tool called "Oh My Prompt". You analyze prompt usage statistics and generate insightful, natural-language summaries.

Always respond with valid JSON matching this exact schema:
{
  "title": "string - brief title for the daily summary",
  "summary": "string - 2-3 sentence natural language summary with trends and highlights",
  "highlights": [{"label": "string", "value": "string or number"}],
  "trends": [{"metric": "string", "direction": "up|down|stable", "magnitude": number (0-100), "explanation": "string"}],
  "recommendations": ["string - actionable tip based on the data"],
  "confidence": number (0-1)
}${localeInstruction(locale)}`;

  const userPrompt = `Here are today's prompt activity statistics for a user:

${statsJson}

Date range: ${input.dateRange.from} to ${input.dateRange.to}

Generate a daily summary insight. Focus on:
1. A brief, engaging summary of the day's activity
2. Key highlights (most interesting data points)
3. Any notable trends or patterns (e.g., peak productivity hours)
4. 1-2 actionable recommendations

Respond ONLY with valid JSON.`;

  try {
    const response = await callLLM(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      llmConfig,
    );

    // Parse the LLM response — extract JSON from possible markdown fences
    let content = response.content.trim();
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(content);

    // Validate required fields and build result
    const fallback = buildStatsOnlyInsight(stats, locale);
    const result: InsightResult = {
      title: typeof parsed.title === "string" ? parsed.title : d.title,
      summary:
        typeof parsed.summary === "string" ? parsed.summary : fallback.summary,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter(
            (h: unknown): h is InsightHighlight =>
              typeof h === "object" &&
              h !== null &&
              "label" in h &&
              "value" in h,
          )
        : fallback.highlights,
      trends: Array.isArray(parsed.trends)
        ? parsed.trends.filter(
            (t: unknown): t is InsightTrend =>
              typeof t === "object" &&
              t !== null &&
              "metric" in t &&
              "direction" in t &&
              "magnitude" in t &&
              "explanation" in t,
          )
        : undefined,
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(
            (r: unknown): r is string => typeof r === "string",
          )
        : undefined,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.8,
      generatedAt: new Date().toISOString(),
    };

    return result;
  } catch (error) {
    logger.error({ err: error }, "Daily summary LLM error");
    // Fall back to stats-only on LLM failure
    const fallback = buildStatsOnlyInsight(stats, locale);
    fallback.recommendations = [d.aiUnavailable];
    return fallback;
  }
}
