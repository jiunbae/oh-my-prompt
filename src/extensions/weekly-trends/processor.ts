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

interface WeekStats {
  totalPrompts: number;
  totalTokens: number;
  totalResponseTokens: number;
  uniqueProjects: number;
  uniqueSessions: number;
  avgPromptLength: number;
  projects: Array<{ project: string; count: number }>;
  dailyCounts: Array<{ date: string; count: number }>;
}

async function queryWeekStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<WeekStats> {
  const whereClause = and(
    eq(schema.prompts.userId, userId),
    gte(schema.prompts.timestamp, from),
    lt(schema.prompts.timestamp, to),
    isNull(schema.prompts.deletedAt),
  );

  const [overview, projects, dailyCounts] = await Promise.all([
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
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(whereClause, sql`project_name IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(10),

    db
      .select({
        date: sql<string>`(${schema.prompts.timestamp} AT TIME ZONE ${APP_TIME_ZONE})::date::text`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(whereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  const row = overview[0];

  return {
    totalPrompts: Number(row?.totalPrompts ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    totalResponseTokens: Number(row?.totalResponseTokens ?? 0),
    uniqueProjects: Number(row?.uniqueProjects ?? 0),
    uniqueSessions: Number(row?.uniqueSessions ?? 0),
    avgPromptLength: Math.round(Number(row?.avgPromptLength ?? 0)),
    projects: projects.map((p) => ({
      project: p.project ?? "Unknown",
      count: Number(p.count ?? 0),
    })),
    dailyCounts: dailyCounts.map((d) => ({
      date: d.date,
      count: Number(d.count ?? 0),
    })),
  };
}

function computeDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function trendDirection(
  delta: number,
): "up" | "down" | "stable" {
  if (delta > 5) return "up";
  if (delta < -5) return "down";
  return "stable";
}

/** Localized title + fallback strings for the weekly-trends insight. */
function weeklyDict(locale?: string) {
  const ko = locale === "ko";
  return {
    title: ko ? "주간 추이" : "Weekly Trends",
    noActivity: ko
      ? "이번 주와 지난주 모두 프롬프트 활동이 없어요. 프롬프트를 작성하면 주간 추이를 볼 수 있어요!"
      : "No prompt activity found for the current or previous week. Start prompting to see weekly trends!",
    aiUnavailable: ko
      ? "AI 분석을 사용할 수 없어요. LLM 설정을 확인해 주세요."
      : "AI-enhanced analysis unavailable. Check your LLM configuration.",
  };
}

function buildStatsOnlyInsight(
  currentWeek: WeekStats,
  previousWeek: WeekStats,
  locale?: string,
): InsightResult {
  const ko = locale === "ko";
  const promptDelta = computeDelta(
    currentWeek.totalPrompts,
    previousWeek.totalPrompts,
  );
  const tokenDelta = computeDelta(
    currentWeek.totalTokens + currentWeek.totalResponseTokens,
    previousWeek.totalTokens + previousWeek.totalResponseTokens,
  );
  const sessionDelta = computeDelta(
    currentWeek.uniqueSessions,
    previousWeek.uniqueSessions,
  );
  const projectDelta = computeDelta(
    currentWeek.uniqueProjects,
    previousWeek.uniqueProjects,
  );
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;

  // Find new projects this week that were not in last week
  const prevProjectNames = new Set(previousWeek.projects.map((p) => p.project));
  const newProjects = currentWeek.projects
    .filter((p) => !prevProjectNames.has(p.project))
    .map((p) => p.project);

  const highlights: InsightHighlight[] = ko
    ? [
        { label: "이번 주 프롬프트", value: currentWeek.totalPrompts },
        { label: "지난주 프롬프트", value: previousWeek.totalPrompts },
        { label: "전주 대비", value: pct(promptDelta) },
        { label: "전체 토큰", value: currentWeek.totalTokens + currentWeek.totalResponseTokens },
        { label: "프로젝트", value: currentWeek.uniqueProjects },
        { label: "세션", value: currentWeek.uniqueSessions },
      ]
    : [
        { label: "Prompts This Week", value: currentWeek.totalPrompts },
        { label: "Prompts Last Week", value: previousWeek.totalPrompts },
        { label: "WoW Change", value: pct(promptDelta) },
        { label: "Total Tokens", value: currentWeek.totalTokens + currentWeek.totalResponseTokens },
        { label: "Projects", value: currentWeek.uniqueProjects },
        { label: "Sessions", value: currentWeek.uniqueSessions },
      ];

  if (newProjects.length > 0) {
    highlights.push({
      label: ko ? "신규 프로젝트" : "New Projects",
      value: newProjects.slice(0, 3).join(", "),
    });
  }

  const trends: InsightTrend[] = ko
    ? [
        {
          metric: "프롬프트 볼륨",
          direction: trendDirection(promptDelta),
          magnitude: Math.abs(promptDelta),
          explanation: `이번 주 프롬프트 ${currentWeek.totalPrompts}건 vs 지난주 ${previousWeek.totalPrompts}건 (${pct(promptDelta)})`,
        },
        {
          metric: "토큰 사용량",
          direction: trendDirection(tokenDelta),
          magnitude: Math.abs(tokenDelta),
          explanation: `전체 토큰 사용량이 전주 대비 ${pct(tokenDelta)} 변했어요`,
        },
        {
          metric: "세션",
          direction: trendDirection(sessionDelta),
          magnitude: Math.abs(sessionDelta),
          explanation: `이번 주 세션 ${currentWeek.uniqueSessions}개 vs 지난주 ${previousWeek.uniqueSessions}개`,
        },
        {
          metric: "프로젝트 다양성",
          direction: trendDirection(projectDelta),
          magnitude: Math.abs(projectDelta),
          explanation: `고유 프로젝트 ${currentWeek.uniqueProjects}개${newProjects.length > 0 ? `, 신규 ${newProjects.length}개` : ""} 작업`,
        },
      ]
    : [
        {
          metric: "Prompt Volume",
          direction: trendDirection(promptDelta),
          magnitude: Math.abs(promptDelta),
          explanation: `${currentWeek.totalPrompts} prompts this week vs ${previousWeek.totalPrompts} last week (${pct(promptDelta)})`,
        },
        {
          metric: "Token Usage",
          direction: trendDirection(tokenDelta),
          magnitude: Math.abs(tokenDelta),
          explanation: `Total token usage changed by ${pct(tokenDelta)} week-over-week`,
        },
        {
          metric: "Sessions",
          direction: trendDirection(sessionDelta),
          magnitude: Math.abs(sessionDelta),
          explanation: `${currentWeek.uniqueSessions} sessions this week vs ${previousWeek.uniqueSessions} last week`,
        },
        {
          metric: "Project Diversity",
          direction: trendDirection(projectDelta),
          magnitude: Math.abs(projectDelta),
          explanation: `Worked on ${currentWeek.uniqueProjects} unique projects${newProjects.length > 0 ? `, ${newProjects.length} new` : ""}`,
        },
      ];

  const summaryParts: string[] = [];
  if (ko) {
    summaryParts.push(
      `이번 주에는 프롬프트 ${currentWeek.totalPrompts}건을 작성했어요 (전주 대비 ${pct(promptDelta)}).`,
    );
    summaryParts.push(
      `프로젝트 ${currentWeek.uniqueProjects}개와 세션 ${currentWeek.uniqueSessions}개에 걸쳐 진행했어요.`,
    );
    if (newProjects.length > 0) {
      summaryParts.push(`신규 프로젝트: ${newProjects.slice(0, 3).join(", ")}.`);
    }
  } else {
    summaryParts.push(
      `This week you made ${currentWeek.totalPrompts} prompts (${pct(promptDelta)} vs last week)`,
    );
    summaryParts.push(
      `across ${currentWeek.uniqueProjects} projects and ${currentWeek.uniqueSessions} sessions.`,
    );
    if (newProjects.length > 0) {
      summaryParts.push(`New projects: ${newProjects.slice(0, 3).join(", ")}.`);
    }
  }

  const recommendations: string[] = [];
  if (ko) {
    if (promptDelta < -20) {
      recommendations.push(
        "프롬프트 활동이 크게 줄었어요. 꾸준함을 유지하려면 하루 프롬프트 목표를 정해보세요.",
      );
    }
    if (currentWeek.uniqueProjects === 1 && previousWeek.uniqueProjects > 1) {
      recommendations.push(
        "이번 주에는 한 프로젝트에만 집중했어요. 다양한 작업은 폭넓은 역량 유지에 도움이 돼요.",
      );
    }
    if (currentWeek.avgPromptLength < 50) {
      recommendations.push(
        "평균 프롬프트 길이가 다소 짧아요. 더 구체적인 프롬프트가 더 좋은 결과를 내는 경우가 많아요.",
      );
    }
    if (recommendations.length === 0) {
      recommendations.push("잘하고 있어요! 프롬프트 활동이 꾸준해요.");
    }
  } else {
    if (promptDelta < -20) {
      recommendations.push(
        "Your prompt activity dropped significantly. Consider setting a daily prompting goal to maintain momentum.",
      );
    }
    if (currentWeek.uniqueProjects === 1 && previousWeek.uniqueProjects > 1) {
      recommendations.push(
        "You focused on a single project this week. Diversifying can help maintain a broader skill set.",
      );
    }
    if (currentWeek.avgPromptLength < 50) {
      recommendations.push(
        "Your average prompt length is quite short. More detailed prompts often yield better results.",
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        "Keep up the great work! Your prompting activity is consistent.",
      );
    }
  }

  return {
    title: weeklyDict(locale).title,
    summary: summaryParts.join(" "),
    highlights,
    trends,
    recommendations,
    confidence: 0.9,
    generatedAt: new Date().toISOString(),
  };
}

export async function handler(input: ProcessorInput): Promise<InsightResult> {
  // If the caller provided an explicit date range, use it for the current week
  // and compute the previous week relative to it
  const explicitRange = resolveDateRange(input.dateRange, 7);
  const cwFrom = explicitRange.from;
  const cwTo = explicitRange.to;
  const durationMs = cwTo.getTime() - cwFrom.getTime();
  const pwTo = new Date(cwFrom.getTime());
  const pwFrom = new Date(cwFrom.getTime() - durationMs);

  const { locale } = input;
  const d = weeklyDict(locale);
  const ko = locale === "ko";

  const [currentWeek, previousWeek] = await Promise.all([
    queryWeekStats(input.userId, cwFrom, cwTo),
    queryWeekStats(input.userId, pwFrom, pwTo),
  ]);

  // If no activity at all in both weeks
  if (currentWeek.totalPrompts === 0 && previousWeek.totalPrompts === 0) {
    return {
      title: d.title,
      summary: d.noActivity,
      highlights: [
        { label: ko ? "이번 주 프롬프트" : "Prompts This Week", value: 0 },
        { label: ko ? "지난주 프롬프트" : "Prompts Last Week", value: 0 },
      ],
      confidence: 1,
      generatedAt: new Date().toISOString(),
    };
  }

  // If LLM is not configured, return stats-only insight
  const llmConfig = getLLMConfig();
  if (!llmConfig) {
    return buildStatsOnlyInsight(currentWeek, previousWeek, locale);
  }

  // Build LLM prompt
  const dataPayload = JSON.stringify(
    {
      currentWeek: {
        ...currentWeek,
        dateRange: { from: cwFrom.toISOString(), to: cwTo.toISOString() },
      },
      previousWeek: {
        ...previousWeek,
        dateRange: { from: pwFrom.toISOString(), to: pwTo.toISOString() },
      },
      deltas: {
        promptCountDelta: computeDelta(
          currentWeek.totalPrompts,
          previousWeek.totalPrompts,
        ),
        tokenDelta: computeDelta(
          currentWeek.totalTokens + currentWeek.totalResponseTokens,
          previousWeek.totalTokens + previousWeek.totalResponseTokens,
        ),
        sessionDelta: computeDelta(
          currentWeek.uniqueSessions,
          previousWeek.uniqueSessions,
        ),
        projectDelta: computeDelta(
          currentWeek.uniqueProjects,
          previousWeek.uniqueProjects,
        ),
      },
    },
    null,
    2,
  );

  const systemPrompt = `You are an AI assistant that generates weekly trend analysis for a developer prompt tracking tool called "Oh My Prompt". You compare week-over-week metrics and provide actionable insights.

Always respond with valid JSON matching this exact schema:
{
  "title": "string - brief title for the weekly trends",
  "summary": "string - 2-4 sentence narrative summary of the week's trends",
  "highlights": [{"label": "string", "value": "string or number"}],
  "trends": [{"metric": "string", "direction": "up|down|stable", "magnitude": number (0-100), "explanation": "string"}],
  "recommendations": ["string - actionable recommendation based on trends"],
  "confidence": number (0-1)
}${localeInstruction(locale)}`;

  const userPrompt = `Here is the week-over-week prompt activity data:

${dataPayload}

Generate a weekly trends insight. Focus on:
1. A narrative summary comparing this week to last week
2. Key highlights (most significant changes)
3. Clear trends with direction and magnitude
4. 2-3 actionable recommendations based on the trends

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

    const fallback = buildStatsOnlyInsight(currentWeek, previousWeek, locale);

    const result: InsightResult = {
      title:
        typeof parsed.title === "string" ? parsed.title : d.title,
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
        : fallback.trends,
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.filter(
            (r: unknown): r is string => typeof r === "string",
          )
        : fallback.recommendations,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.8,
      generatedAt: new Date().toISOString(),
    };

    return result;
  } catch (error) {
    logger.error({ err: error }, "Weekly trends LLM error");
    const fallback = buildStatsOnlyInsight(currentWeek, previousWeek, locale);
    fallback.recommendations = [
      ...(fallback.recommendations ?? []),
      d.aiUnavailable,
    ];
    return fallback;
  }
}
