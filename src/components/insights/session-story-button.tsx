"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { normalizeSessionTitleSuggestion } from "@/lib/session-ui";

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
  cached?: boolean;
}

function TrendArrow({ direction }: { direction: "up" | "down" | "stable" }) {
  if (direction === "up") {
    return (
      <svg className="h-4 w-4 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  }
  if (direction === "down") {
    return (
      <svg className="h-4 w-4 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
    </svg>
  );
}

interface SessionStoryButtonProps {
  sessionId: string;
  allowUseAsSessionName?: boolean;
}

export function SessionStoryButton({ sessionId, allowUseAsSessionName = false }: SessionStoryButtonProps) {
  const router = useRouter();
  const t = useTranslations("insights");
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setDetailsOpen(false);
    setNameSaved(false);
    setNameError(null);
  }, [locale, sessionId]);

  const generateStory = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setDetailsOpen(false);
    setNameSaved(false);
    setNameError(null);

    try {
      const refreshParam = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/insights/session/${encodeURIComponent(sessionId)}${refreshParam}`, {
        headers: { "X-OMP-Locale": locale },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data: InsightResult = await res.json();
      setResult(data);
    } catch {
      setError(t("story.error"));
    } finally {
      setLoading(false);
    }
  }, [locale, sessionId, t]);

  const applyStoryTitleAsName = useCallback(async () => {
    if (!result) return;
    const displayName = normalizeSessionTitleSuggestion(result.title);
    if (!displayName) return;

    setNameLoading(true);
    setNameSaved(false);
    setNameError(null);

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update session name");
      }
      setNameSaved(true);
      router.refresh();
    } catch {
      setNameError(t("story.nameError"));
    } finally {
      setNameLoading(false);
    }
  }, [result, router, sessionId, t]);

  return (
    <div className="min-w-0 space-y-4">
      {!result && !loading && (
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t("story.title")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("sessionStories.description")}</p>
            </div>
            <Button
              onClick={() => generateStory(false)}
              disabled={loading}
              variant="outline"
              size="sm"
              className="shrink-0"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t("story.generating")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  {t("story.generate")}
                </span>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="p-4 space-y-3">
            <div className="h-5 w-48 animate-pulse rounded bg-skeleton" />
            <div className="h-3 w-full animate-pulse rounded bg-skeleton" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-skeleton" />
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="min-w-0 p-4 space-y-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase text-muted-foreground">{t("story.title")}</span>
                  <Badge variant={result.cached ? "outline" : "success"} className="shrink-0">
                    {result.cached ? t("story.cached") : t("story.fresh")}
                  </Badge>
                </div>
                <h3 className="break-words text-base font-semibold text-foreground">{result.title}</h3>
                <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">{result.summary}</p>
                {nameSaved && (
                  <p className="mt-2 text-xs text-chart-2">{t("story.nameApplied")}</p>
                )}
                {nameError && (
                  <p className="mt-2 text-xs text-destructive">{nameError}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {allowUseAsSessionName && (
                  <Button
                    onClick={applyStoryTitleAsName}
                    variant="outline"
                    size="sm"
                    disabled={nameLoading || loading}
                  >
                    {nameLoading ? t("common.loading") : t("story.useAsName")}
                  </Button>
                )}
                <Button
                  onClick={() => generateStory(true)}
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {t("story.regenerate")}
                </Button>
                <Button
                  onClick={() => setDetailsOpen((value) => !value)}
                  variant="outline"
                  size="sm"
                >
                  <svg
                    className={`h-4 w-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  {detailsOpen ? t("story.hideDetails") : t("story.showDetails")}
                </Button>
              </div>
            </div>

            {detailsOpen && (
              <div className="space-y-4 border-t border-border-subtle pt-4">
                {result.highlights && result.highlights.length > 0 && (
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {result.highlights.map((h, i) => (
                      <div
                        key={i}
                        className="min-w-0 rounded-lg border border-border bg-card p-2"
                      >
                        <p className="break-words text-xs text-muted-foreground">{h.label}</p>
                        <p className="break-words text-sm font-medium text-foreground">{h.value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {result.trends && result.trends.length > 0 && (
                  <div className="space-y-1">
                    {result.trends.map((t, i) => (
                      <div key={i} className="flex min-w-0 items-start gap-2 text-sm">
                        <div className="mt-0.5 shrink-0">
                          <TrendArrow direction={t.direction} />
                        </div>
                        <span className="min-w-0 break-words font-medium text-foreground">{t.metric}</span>
                        <span className="min-w-0 break-words text-muted-foreground">{t.explanation}</span>
                      </div>
                    ))}
                  </div>
                )}

                {result.recommendations && result.recommendations.length > 0 && (
                  <ul className="space-y-1">
                    {result.recommendations.map((r, i) => (
                      <li key={i} className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
                        <svg className="h-4 w-4 mt-0.5 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        <span className="min-w-0 break-words">{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="shrink-0">
                {t("common.confidence", { value: Math.round(result.confidence * 100) })}
              </Badge>
              <span className="min-w-0 break-words">
                {t("common.generated", { time: new Date(result.generatedAt).toLocaleString(locale) })}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
