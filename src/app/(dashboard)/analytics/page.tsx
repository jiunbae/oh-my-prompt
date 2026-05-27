"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
} from "@/components/ui/dropdown";
import { useTeam } from "@/contexts/team-context";
import { PromptVolumeChart } from "@/components/charts/PromptVolumeChart";
import { TokenUsageChart } from "@/components/charts/TokenUsageChart";
import { QualityScoreChart } from "@/components/charts/QualityScoreChart";
import { ProjectDistributionChart } from "@/components/charts/ProjectDistributionChart";
import { HourlyActivityChart } from "@/components/charts/HourlyActivityChart";
import { WeekdayActivityChart } from "@/components/charts/WeekdayActivityChart";
import { formatNumber } from "@/lib/format";

interface TrendsData {
  daily: Array<{ date: string; count: number; tokens: number; avgQuality: number }>;
  byProject: Array<{ name: string; count: number }>;
  byHour: Array<{ hour: number; count: number }>;
  byWeekday: Array<{ day: string; count: number }>;
  summary: {
    totalPrompts: number;
    avgQuality: number;
    totalTokens: number;
    activeProjects: number;
  };
  availableProjects: Array<{ name: string; count: number }>;
  availableSources: Array<{ name: string; count: number }>;
}

interface InsightsData {
  insights: string[];
}

type DateRange = "7" | "30" | "90" | "custom";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  const { selectedTeamId, isTeamContext } = useTeam();
  const tDash = useTranslations("dashboard");
  const tNav = useTranslations("nav");
  const tAnalytics = useTranslations("analytics");

  const RANGE_OPTIONS: ReadonlyArray<{ value: DateRange; label: string }> = [
    { value: "7", label: tAnalytics("range.7") },
    { value: "30", label: tAnalytics("range.30") },
    { value: "90", label: tAnalytics("range.90") },
    { value: "custom", label: tAnalytics("range.custom") },
  ];

  const [range, setRange] = useState<DateRange>("30");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (range === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    } else {
      params.set("range", range);
    }
    if (selectedProjects.length > 0) {
      params.set("project", selectedProjects.join(","));
    }
    if (selectedSources.length > 0) {
      params.set("source", selectedSources.join(","));
    }
    if (isTeamContext && selectedTeamId) {
      params.set("teamId", selectedTeamId);
    }
    return params.toString();
  }, [range, customFrom, customTo, selectedProjects, selectedSources, isTeamContext, selectedTeamId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildQueryString();
      const [trendsRes, insightsRes] = await Promise.all([
        fetch(`/api/analytics/trends?${qs}`),
        fetch(`/api/analytics/insights?${qs}`),
      ]);

      if (!trendsRes.ok) {
        const data = await trendsRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load trends");
      }
      if (!insightsRes.ok) {
        const data = await insightsRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load insights");
      }

      const trends = await trendsRes.json();
      const insights = await insightsRes.json();
      setTrendsData(trends);
      setInsightsData(insights);
    } catch (err) {
      setError(err instanceof Error ? err.message : tAnalytics("failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summary = trendsData?.summary;

  const handleRangeChange = (next: DateRange) => {
    setRange(next);
    if (next === "custom") {
      if (!customFrom) {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        setCustomFrom(toDateInputValue(d));
      }
      if (!customTo) {
        setCustomTo(toDateInputValue(new Date()));
      }
    }
  };

  const toggleProject = (name: string) => {
    setSelectedProjects((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  const toggleSource = (name: string) => {
    setSelectedSources((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  };

  const clearFilters = () => {
    setSelectedProjects([]);
    setSelectedSources([]);
  };

  const hasFilters = selectedProjects.length > 0 || selectedSources.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="t-h1">{tNav("analytics")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isTeamContext
              ? tAnalytics("subtitleTeam")
              : tAnalytics("subtitlePersonal")}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        {/* Date range — SegmentedControl */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">{tAnalytics("period")}</span>
          <SegmentedControl<DateRange>
            value={range}
            onValueChange={handleRangeChange}
            options={RANGE_OPTIONS}
            aria-label={tAnalytics("dateRangeAria")}
            size="sm"
          />
        </div>

        {/* Custom date inputs */}
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="px-2 py-1.5 bg-background border border-border rounded-md text-foreground text-xs"
            />
            <span className="text-xs text-muted-foreground">{tAnalytics("to")}</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1.5 bg-background border border-border rounded-md text-foreground text-xs"
            />
          </div>
        )}

        {/* Project multi-select — Dropdown */}
        <div className="relative">
          <Dropdown>
            <DropdownTrigger
              className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground hover:bg-accent transition-colors"
            >
              <svg
                className="h-3.5 w-3.5 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              {tAnalytics("projects")}
              {selectedProjects.length > 0 && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0">
                  {selectedProjects.length}
                </Badge>
              )}
              <svg
                className="h-3 w-3 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </DropdownTrigger>
            {/*
              Multi-select: each row is a <label> wrapping a checkbox. We do NOT
              use <DropdownItem> because items auto-close on activation, which
              would break repeated selection. The container still has role=menu
              from DropdownContent; the labels participate in keyboard nav via
              the checkbox's native focusability.
            */}
            <DropdownContent align="start" className="w-56 p-2 space-y-1">
              {trendsData && trendsData.availableProjects.length > 0 ? (
                trendsData.availableProjects.map((p) => (
                  <label
                    key={p.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-accent/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjects.includes(p.name)}
                      onChange={() => toggleProject(p.name)}
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="truncate flex-1">{p.name}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {p.count}
                    </span>
                  </label>
                ))
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{tAnalytics("noProjects")}</p>
              )}
            </DropdownContent>
          </Dropdown>
        </div>

        {/* Source multi-select — Dropdown */}
        <div className="relative">
          <Dropdown>
            <DropdownTrigger
              className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground hover:bg-accent transition-colors"
            >
              <svg
                className="h-3.5 w-3.5 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              {tAnalytics("sources")}
              {selectedSources.length > 0 && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0">
                  {selectedSources.length}
                </Badge>
              )}
              <svg
                className="h-3 w-3 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </DropdownTrigger>
            <DropdownContent align="start" className="w-56 p-2 space-y-1">
              {trendsData && trendsData.availableSources.length > 0 ? (
                trendsData.availableSources.map((s) => (
                  <label
                    key={s.name}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-foreground hover:bg-accent/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(s.name)}
                      onChange={() => toggleSource(s.name)}
                      className="rounded border-border text-primary focus:ring-primary"
                    />
                    <span className="truncate flex-1">{s.name}</span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {s.count}
                    </span>
                  </label>
                ))
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{tAnalytics("noSources")}</p>
              )}
            </DropdownContent>
          </Dropdown>
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            {tAnalytics("clearFilters")}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <p className="font-medium">{tAnalytics("failedToLoad")}</p>
          <p className="mt-1 opacity-80">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : (
          [
            { label: tAnalytics("kpi.totalPrompts"), value: summary ? formatNumber(summary.totalPrompts) : "0" },
            { label: tAnalytics("kpi.avgQuality"), value: tAnalytics("kpi.avgQualityValue", { value: summary ? summary.avgQuality.toFixed(1) : "0" }) },
            { label: tAnalytics("kpi.totalTokens"), value: summary ? formatNumber(summary.totalTokens) : "0" },
            { label: tDash("kpi.activeProjects"), value: summary ? String(summary.activeProjects) : "0" },
          ].map((item) => (
            <Card key={item.label}>
              <CardHeader className="pb-2">
                <CardTitle className="t-caption text-muted-foreground font-medium">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="t-h1 tabular-nums text-foreground">{item.value}</div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Insights */}
      {insightsData && insightsData.insights.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-chart-5" />
            {tAnalytics("insights")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {insightsData.insights.map((insight, i) => (
              <Badge key={i} variant="info" className="text-xs py-1 px-2.5">
                {insight}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Prompt Volume */}
        <Card>
          <CardHeader>
            <CardTitle>{tAnalytics("charts.promptVolume")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PromptVolumeChart
              data={trendsData?.daily ?? []}
              isLoading={loading}
              emptyMessage={tAnalytics("empty.promptVolume")}
              tooltipLabel={tAnalytics("tooltip.count")}
              formatTooltipValue={(value) =>
                tAnalytics("tooltip.promptsSuffix", { value: String(value ?? 0) })
              }
            />
          </CardContent>
        </Card>

        {/* Token Usage */}
        <Card>
          <CardHeader>
            <CardTitle>{tAnalytics("charts.tokenUsage")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TokenUsageChart
              data={trendsData?.daily.map((d) => ({ date: d.date, tokens: d.tokens })) ?? []}
              isLoading={loading}
              emptyMessage={tAnalytics("empty.tokenUsage")}
              tooltipLabel={tAnalytics("tooltip.tokens")}
              formatTooltipValue={(formatted) =>
                tAnalytics("tooltip.tokensSuffix", { value: formatted })
              }
            />
          </CardContent>
        </Card>

        {/* Quality Score */}
        <Card>
          <CardHeader>
            <CardTitle>{tAnalytics("charts.qualityScoreTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityScoreChart
              data={trendsData?.daily ?? []}
              isLoading={loading}
              emptyMessage={tAnalytics("empty.qualityScore")}
              tooltipLabel={tAnalytics("tooltip.avgQuality")}
              formatTooltipValue={(formatted) =>
                tAnalytics("tooltip.avgQualityValue", { value: formatted })
              }
            />
          </CardContent>
        </Card>

        {/* Project Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>{tAnalytics("charts.projectDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectDistributionChart
              data={trendsData?.byProject ?? []}
              isLoading={loading}
              emptyMessage={tAnalytics("empty.projectDistribution")}
            />
          </CardContent>
        </Card>

        {/* Hourly Activity */}
        <Card>
          <CardHeader>
            <CardTitle>{tAnalytics("charts.hourlyActivity")}</CardTitle>
          </CardHeader>
          <CardContent>
            <HourlyActivityChart
              data={trendsData?.byHour ?? []}
              isLoading={loading}
              emptyMessage={tAnalytics("empty.hourly")}
            />
          </CardContent>
        </Card>

        {/* Weekday Activity */}
        <Card>
          <CardHeader>
            <CardTitle>{tAnalytics("charts.weekdayActivity")}</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekdayActivityChart
              data={trendsData?.byWeekday ?? []}
              isLoading={loading}
              emptyMessage={tAnalytics("empty.weekday")}
              tooltipLabel={tAnalytics("tooltip.count")}
              formatTooltipValue={(value) =>
                tAnalytics("tooltip.promptsSuffix", { value: String(value ?? 0) })
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
