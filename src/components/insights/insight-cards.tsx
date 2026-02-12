"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  InsightResult,
  InsightTrend,
  InsightHighlight,
} from "@/extensions/types";

interface CachedInsight {
  id: string;
  type: string;
  result: InsightResult;
  generatedAt: string;
}

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function TrendArrow({ direction }: { direction: InsightTrend["direction"] }) {
  if (direction === "up") {
    return (
      <svg
        className="h-3.5 w-3.5 text-green-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 17l5-5 5 5M7 7l5 5 5-5"
        />
      </svg>
    );
  }
  if (direction === "down") {
    return (
      <svg
        className="h-3.5 w-3.5 text-red-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M17 7l-5 5-5-5M17 17l-5-5-5 5"
        />
      </svg>
    );
  }
  return (
    <svg
      className="h-3.5 w-3.5 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 12h14"
      />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-muted-foreground"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function InsightCard({
  type,
  title,
  description,
  insight,
  loading,
  onGenerate,
}: {
  type: string;
  title: string;
  description: string;
  insight: CachedInsight | null;
  loading: boolean;
  onGenerate: (type: string) => void;
}) {
  const result = insight?.result ?? null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{result?.title ?? title}</CardTitle>
          {loading ? (
            <Badge variant="secondary" className="gap-1">
              <LoadingSpinner />
              Generating
            </Badge>
          ) : result ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="outline">Not generated</Badge>
          )}
        </div>
        <CardDescription>
          {result?.summary ?? description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-3">
            {/* Highlights */}
            {result.highlights && result.highlights.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {result.highlights.slice(0, 6).map((h: InsightHighlight) => (
                  <div
                    key={h.label}
                    className="rounded-md bg-secondary/50 p-2"
                  >
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {h.label}
                    </p>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {h.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Trends */}
            {result.trends && result.trends.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Trends
                </p>
                {result.trends.slice(0, 4).map((t: InsightTrend) => (
                  <div
                    key={t.metric}
                    className="flex items-center gap-2 text-xs"
                  >
                    <TrendArrow direction={t.direction} />
                    <span className="font-medium text-foreground">
                      {t.metric}
                    </span>
                    <span className="text-muted-foreground truncate flex-1">
                      {t.explanation}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {result.recommendations && result.recommendations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Recommendations
                </p>
                <ul className="space-y-1">
                  {result.recommendations.slice(0, 3).map((r: string, i: number) => (
                    <li
                      key={i}
                      className="text-xs text-foreground flex items-start gap-1.5"
                    >
                      <span className="text-purple-400 mt-0.5 shrink-0">
                        *
                      </span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Footer: timestamp + refresh */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-[10px] text-muted-foreground">
                Generated{" "}
                {insight?.generatedAt
                  ? formatTimeAgo(insight.generatedAt)
                  : result.generatedAt
                    ? formatTimeAgo(result.generatedAt)
                    : ""}
              </span>
              <button
                onClick={() => onGenerate(type)}
                disabled={loading}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 gap-3">
            <svg
              className="h-8 w-8 text-muted-foreground/30"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
            <button
              onClick={() => onGenerate(type)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <LoadingSpinner />
                  Generating...
                </>
              ) : (
                "Generate Insight"
              )}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const INSIGHT_TYPES = [
  {
    type: "daily-summary",
    title: "Daily Summary",
    description:
      "AI-generated summary of your daily prompt activity with trends and highlights",
  },
  {
    type: "weekly-trends",
    title: "Weekly Trends",
    description:
      "Week-over-week analysis of your prompting patterns and recommendations",
  },
] as const;

export function InsightCards() {
  const [insights, setInsights] = useState<Map<string, CachedInsight>>(
    new Map(),
  );
  const [loadingTypes, setLoadingTypes] = useState<Set<string>>(new Set());
  const [initialLoaded, setInitialLoaded] = useState(false);

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch("/api/insights");
      if (!res.ok) return;
      const data = await res.json();
      const map = new Map<string, CachedInsight>();
      if (Array.isArray(data.insights)) {
        for (const item of data.insights) {
          map.set(item.type, item);
        }
      }
      setInsights(map);
    } catch (error) {
      console.error("Failed to fetch insights:", error);
    } finally {
      setInitialLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const generateInsight = useCallback(
    async (type: string) => {
      setLoadingTypes((prev) => new Set(prev).add(type));
      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type }),
        });
        if (!res.ok) {
          const errorData = await res.json().catch(() => null);
          console.error(
            "Failed to generate insight:",
            errorData?.error ?? res.statusText,
          );
          return;
        }
        // Refetch all insights to get updated cache state
        await fetchInsights();
      } catch (error) {
        console.error("Failed to generate insight:", error);
      } finally {
        setLoadingTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }
    },
    [fetchInsights],
  );

  if (!initialLoaded) {
    return (
      <div className="grid md:grid-cols-2 gap-4">
        {INSIGHT_TYPES.map(({ type, title }) => (
          <Card key={type}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{title}</CardTitle>
                <Badge variant="secondary" className="gap-1">
                  <LoadingSpinner />
                  Loading
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-3 bg-muted/50 rounded animate-pulse"
                    style={{ width: `${100 - i * 15}%` }}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {INSIGHT_TYPES.map(({ type, title, description }) => (
        <InsightCard
          key={type}
          type={type}
          title={title}
          description={description}
          insight={insights.get(type) ?? null}
          loading={loadingTypes.has(type)}
          onGenerate={generateInsight}
        />
      ))}
    </div>
  );
}
