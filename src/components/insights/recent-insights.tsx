"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface InsightHighlight {
  label: string;
  value: string | number;
}

interface InsightTrend {
  metric: string;
  direction: "up" | "down" | "stable";
  magnitude: number;
  explanation: string;
}

interface InsightResult {
  title: string;
  summary: string;
  trends?: InsightTrend[];
  recommendations?: string[];
  highlights?: InsightHighlight[];
  confidence: number;
  generatedAt: string;
}

interface CachedInsight {
  id: string;
  type: string;
  result: InsightResult;
  generatedAt: string;
}

function formatInsightType(type: string): string {
  return type
    .replace(/^session-story:/, "Session: ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type InsightsT = (key: string, values?: Record<string, string | number>) => string;

/** Localized badge label for a cached insight's type key. */
function typeLabel(type: string, t: InsightsT): string {
  if (type === "daily-summary") return t("cards.dailySummary.title");
  if (type === "weekly-trends") return t("cards.weeklyTrends.title");
  if (type.startsWith("session-story:")) return t("sessionStories.title");
  return formatInsightType(type);
}

function InsightCard({ insight }: { insight: CachedInsight }) {
  const t = useTranslations("insights");
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const result = insight.result;

  return (
    <Card className="cursor-pointer transition-colors hover:border-border/80" onClick={() => setExpanded(!expanded)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="secondary" className="text-xs shrink-0">
                {typeLabel(insight.type, t)}
              </Badge>
              <Badge variant="outline" className="text-xs shrink-0">
                {Math.round(result.confidence * 100)}%
              </Badge>
            </div>
            <h4 className="text-sm font-medium text-foreground truncate">
              {result.title}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {result.summary}
            </p>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
            {new Date(insight.generatedAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })}
          </span>
        </div>

        {expanded && (
          <div className="mt-4 space-y-3 border-t border-border pt-3">
            {result.highlights && result.highlights.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {result.highlights.map((h, i) => (
                  <div key={i} className="rounded border border-border p-2">
                    <p className="text-xs text-muted-foreground">{h.label}</p>
                    <p className="text-sm font-medium text-foreground">{h.value}</p>
                  </div>
                ))}
              </div>
            )}

            {result.recommendations && result.recommendations.length > 0 && (
              <ul className="space-y-1">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-0.5">*</span>
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentInsights() {
  const t = useTranslations("insights");
  const locale = useLocale();
  const [insights, setInsights] = useState<CachedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInsights() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/trpc/insights.list", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-OMP-Locale": locale,
          },
        });
        if (!res.ok) {
          throw new Error("Failed to fetch insights");
        }
        const data = await res.json();
        // tRPC's superjson transformer wraps plain JSON under data.json.
        const items = data?.result?.data?.json ?? data?.result?.data ?? [];
        setInsights(items);
      } catch {
        setError(t("recent.error"));
      } finally {
        setLoading(false);
      }
    }
    fetchInsights();
  }, [locale, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("recent.title")}</CardTitle>
        <CardDescription>{t("recent.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <div className="flex gap-2 mb-2">
                  <div className="h-5 w-20 animate-pulse rounded-full bg-skeleton" />
                  <div className="h-5 w-10 animate-pulse rounded-full bg-skeleton" />
                </div>
                <div className="h-4 w-48 animate-pulse rounded bg-skeleton mb-1" />
                <div className="h-3 w-full animate-pulse rounded bg-skeleton" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && insights.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("recent.empty")}
          </p>
        )}

        {!loading && !error && insights.length > 0 && (
          <div className="space-y-3">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
