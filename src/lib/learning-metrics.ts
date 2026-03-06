/**
 * Learning & improvement tracking — computes weekly metrics and improvement suggestions.
 */

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql } from "drizzle-orm";

export interface WeeklyMetrics {
  weekStart: string; // ISO date string (YYYY-MM-DD)
  averageQualityScore: number;
  qualityScoreTrend: number; // delta vs previous week (positive = improving)
  totalPrompts: number;
  averagePromptLength: number;
  promptLengthTrend: number; // delta vs previous week
  vocabularyDiversityScore: number; // unique words / total words ratio (0-1)
  structureUsageRate: number; // fraction of prompts using bullets/code blocks/headers (0-1)
}

export interface ImprovementSuggestion {
  area: string;
  message: string;
  priority: "high" | "medium" | "low";
}

// ── Helpers ─────────────────────────────────────────────────────

function startOfPreviousWeek(weekStart: Date): Date {
  const prev = new Date(weekStart);
  prev.setDate(prev.getDate() - 7);
  return prev;
}

function endOfWeek(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  return end;
}

const STRUCTURE_RE = /[-*]\s+|^\d+\.\s+|^#{1,6}\s+|```/m;

function computeVocabularyDiversity(texts: string[]): number {
  let wordCount = 0;
  const uniqueWords = new Set<string>();

  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);
    for (const word of words) {
      wordCount++;
      uniqueWords.add(word);
    }
  }

  if (wordCount === 0) return 0;
  return uniqueWords.size / wordCount;
}

function computeStructureUsageRate(texts: string[]): number {
  if (texts.length === 0) return 0;
  const structured = texts.filter((t) => STRUCTURE_RE.test(t)).length;
  return structured / texts.length;
}

// ── Core functions ──────────────────────────────────────────────

interface WeekQueryRow {
  promptText: string;
  qualityScore: number | null;
  promptLength: number;
}

async function fetchWeekPrompts(
  userId: string,
  weekStart: Date,
): Promise<WeekQueryRow[]> {
  const weekEnd = endOfWeek(weekStart);

  return db
    .select({
      promptText: sql<string>`LEFT(${schema.prompts.promptText}, 500)`,
      qualityScore: schema.prompts.qualityScore,
      promptLength: schema.prompts.promptLength,
    })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.userId, userId),
        eq(schema.prompts.promptType, "user_input"),
        gte(schema.prompts.timestamp, weekStart),
        lt(schema.prompts.timestamp, weekEnd),
      ),
    );
}

async function fetchWeekAggregates(
  userId: string,
  weekStart: Date,
): Promise<{ avgScore: number; avgLength: number; total: number }> {
  const weekEnd = endOfWeek(weekStart);

  const [row] = await db
    .select({
      avgScore: sql<number>`coalesce(avg(quality_score), 0)`,
      avgLength: sql<number>`coalesce(avg(prompt_length), 0)`,
      total: sql<number>`count(*)`,
    })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.userId, userId),
        eq(schema.prompts.promptType, "user_input"),
        gte(schema.prompts.timestamp, weekStart),
        lt(schema.prompts.timestamp, weekEnd),
      ),
    );

  return {
    avgScore: Math.round(Number(row?.avgScore ?? 0)),
    avgLength: Math.round(Number(row?.avgLength ?? 0)),
    total: Number(row?.total ?? 0),
  };
}

export async function computeWeeklyMetrics(
  userId: string,
  weekStart: Date,
): Promise<WeeklyMetrics> {
  const currentPrompts = await fetchWeekPrompts(userId, weekStart);
  const prevWeekStart = startOfPreviousWeek(weekStart);
  const prevAgg = await fetchWeekAggregates(userId, prevWeekStart);

  const totalPrompts = currentPrompts.length;
  const scoredPrompts = currentPrompts.filter((p) => p.qualityScore != null);
  const averageQualityScore =
    scoredPrompts.length > 0
      ? Math.round(
          scoredPrompts.reduce((s, p) => s + (p.qualityScore ?? 0), 0) /
            scoredPrompts.length,
        )
      : 0;

  const averagePromptLength =
    totalPrompts > 0
      ? Math.round(
          currentPrompts.reduce((s, p) => s + p.promptLength, 0) / totalPrompts,
        )
      : 0;

  const qualityScoreTrend = averageQualityScore - prevAgg.avgScore;
  const promptLengthTrend = averagePromptLength - prevAgg.avgLength;

  const texts = currentPrompts.map((p) => p.promptText);
  const vocabularyDiversityScore = computeVocabularyDiversity(texts);
  const structureUsageRate = computeStructureUsageRate(texts);

  return {
    weekStart: weekStart.toISOString().split("T")[0],
    averageQualityScore,
    qualityScoreTrend,
    totalPrompts,
    averagePromptLength,
    promptLengthTrend,
    vocabularyDiversityScore: Math.round(vocabularyDiversityScore * 1000) / 1000,
    structureUsageRate: Math.round(structureUsageRate * 1000) / 1000,
  };
}

// ── Batch function (avoids N+1 queries in trend endpoint) ────

export async function computeWeeklyMetricsBatch(
  userId: string,
  weekStarts: Date[],
): Promise<WeeklyMetrics[]> {
  if (weekStarts.length === 0) return [];

  // Include one extra week before the earliest for trend calculation
  const earliest = new Date(
    Math.min(...weekStarts.map((d) => d.getTime())),
  );
  const batchStart = startOfPreviousWeek(earliest);
  const latest = new Date(
    Math.max(...weekStarts.map((d) => d.getTime())),
  );
  const batchEnd = endOfWeek(latest);

  // ONE query for all prompts in the full range
  // Truncate promptText to 500 chars — vocabulary/structure analysis doesn't need full text
  const allPrompts = await db
    .select({
      promptText: sql<string>`LEFT(${schema.prompts.promptText}, 500)`,
      qualityScore: schema.prompts.qualityScore,
      promptLength: schema.prompts.promptLength,
      timestamp: schema.prompts.timestamp,
    })
    .from(schema.prompts)
    .where(
      and(
        eq(schema.prompts.userId, userId),
        eq(schema.prompts.promptType, "user_input"),
        gte(schema.prompts.timestamp, batchStart),
        lt(schema.prompts.timestamp, batchEnd),
      ),
    );

  // Group prompts by week-start key
  function weekKeyForDate(d: Date): string {
    // Find the Monday at or before d (UTC-based to match DB timestamps)
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - diff);
    return monday.toISOString().split("T")[0];
  }

  const byWeek = new Map<string, typeof allPrompts>();
  for (const p of allPrompts) {
    const key = weekKeyForDate(new Date(p.timestamp));
    let bucket = byWeek.get(key);
    if (!bucket) {
      bucket = [];
      byWeek.set(key, bucket);
    }
    bucket.push(p);
  }

  // Compute metrics for each requested week
  return weekStarts.map((ws) => {
    const key = ws.toISOString().split("T")[0];
    const currentPrompts = byWeek.get(key) ?? [];

    const totalPrompts = currentPrompts.length;
    const scoredPrompts = currentPrompts.filter((p) => p.qualityScore != null);
    const averageQualityScore =
      scoredPrompts.length > 0
        ? Math.round(
            scoredPrompts.reduce((s, p) => s + (p.qualityScore ?? 0), 0) /
              scoredPrompts.length,
          )
        : 0;

    const averagePromptLength =
      totalPrompts > 0
        ? Math.round(
            currentPrompts.reduce((s, p) => s + p.promptLength, 0) / totalPrompts,
          )
        : 0;

    // Previous week aggregates for trend
    const prevKey = startOfPreviousWeek(ws).toISOString().split("T")[0];
    const prevPrompts = byWeek.get(prevKey) ?? [];
    const prevScored = prevPrompts.filter((p) => p.qualityScore != null);
    const prevAvgScore =
      prevScored.length > 0
        ? Math.round(
            prevScored.reduce((s, p) => s + (p.qualityScore ?? 0), 0) /
              prevScored.length,
          )
        : 0;
    const prevAvgLength =
      prevPrompts.length > 0
        ? Math.round(
            prevPrompts.reduce((s, p) => s + p.promptLength, 0) / prevPrompts.length,
          )
        : 0;

    const texts = currentPrompts.map((p) => p.promptText);
    const vocabularyDiversityScore = computeVocabularyDiversity(texts);
    const structureUsageRate = computeStructureUsageRate(texts);

    return {
      weekStart: key,
      averageQualityScore,
      qualityScoreTrend: averageQualityScore - prevAvgScore,
      totalPrompts,
      averagePromptLength,
      promptLengthTrend: averagePromptLength - prevAvgLength,
      vocabularyDiversityScore: Math.round(vocabularyDiversityScore * 1000) / 1000,
      structureUsageRate: Math.round(structureUsageRate * 1000) / 1000,
    };
  });
}

export function getImprovementSuggestions(
  metrics: WeeklyMetrics,
): ImprovementSuggestion[] {
  const suggestions: ImprovementSuggestion[] = [];

  if (metrics.averageQualityScore < 40) {
    suggestions.push({
      area: "quality",
      message:
        "Your average quality score is below 40. Focus on being specific — mention file names, function names, and expected behavior.",
      priority: "high",
    });
  } else if (metrics.averageQualityScore < 60) {
    suggestions.push({
      area: "quality",
      message:
        "Your quality scores are moderate. Try adding more context about current behavior and what you want changed.",
      priority: "medium",
    });
  }

  if (metrics.qualityScoreTrend < -10) {
    suggestions.push({
      area: "trend",
      message:
        "Your quality scores dropped compared to last week. Review your recent prompts to identify what changed.",
      priority: "high",
    });
  }

  if (metrics.structureUsageRate < 0.2) {
    suggestions.push({
      area: "structure",
      message:
        "Less than 20% of your prompts use structural formatting. Use bullet points or numbered lists to organize complex requests.",
      priority: "medium",
    });
  }

  if (metrics.vocabularyDiversityScore < 0.3 && metrics.totalPrompts >= 5) {
    suggestions.push({
      area: "vocabulary",
      message:
        "Your prompts use repetitive language. Try varying your phrasing and being more descriptive about your goals.",
      priority: "low",
    });
  }

  if (metrics.averagePromptLength < 30) {
    suggestions.push({
      area: "length",
      message:
        "Your prompts are very short on average. Longer prompts with context, constraints, and examples tend to produce better results.",
      priority: "medium",
    });
  }

  if (metrics.totalPrompts === 0) {
    suggestions.push({
      area: "activity",
      message: "No prompts recorded this week. Keep using AI tools to track your progress!",
      priority: "low",
    });
  }

  return suggestions;
}
