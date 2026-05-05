"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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

const RANGE_LABELS: Record<string, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  custom: "Custom",
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  const { selectedTeamId, isTeamContext } = useTeam();

  const [range, setRange] = useState<DateRange>("30");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);

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
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-project-dropdown]")) setShowProjectDropdown(false);
      if (!target.closest("[data-source-dropdown]")) setShowSourceDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const summary = trendsData?.summary;

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
          <h1 className="text-2xl font-semibold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isTeamContext
              ? "Team-scoped prompt analytics"
              : "Personal prompt analytics"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Date range */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium mr-1">Period:</span>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(["7", "30", "90"] as DateRange[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRange(preset)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  range === preset
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {RANGE_LABELS[preset]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setRange("custom");
                if (!customFrom) {
                  const d = new Date();
                  d.setDate(d.getDate() - 30);
                  setCustomFrom(toDateInputValue(d));
                }
                if (!customTo) {
                  setCustomTo(toDateInputValue(new Date()));
                }
              }}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                range === "custom"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              Custom
            </button>
          </div>
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
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="px-2 py-1.5 bg-background border border-border rounded-md text-foreground text-xs"
            />
          </div>
        )}

        {/* Project multi-select */}
        <div className="relative" data-project-dropdown>
          <button
            type="button"
            onClick={() => setShowProjectDropdown(!showProjectDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground hover:bg-accent transition-colors"
          >
            <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Projects
            {selectedProjects.length > 0 && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                {selectedProjects.length}
              </Badge>
            )}
            <svg className={`h-3 w-3 text-muted-foreground transition-transform ${showProjectDropdown ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showProjectDropdown && trendsData && trendsData.availableProjects.length > 0 && (
            <div className="absolute z-50 mt-1 w-56 rounded-lg border border-border bg-card shadow-lg p-2 space-y-1">
              {trendsData.availableProjects.map((p) => (
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
                  <span className="text-muted-foreground shrink-0">{p.count}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Source multi-select */}
        <div className="relative" data-source-dropdown>
          <button
            type="button"
            onClick={() => setShowSourceDropdown(!showSourceDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-foreground hover:bg-accent transition-colors"
          >
            <svg className="h-3.5 w-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Sources
            {selectedSources.length > 0 && (
              <Badge variant="default" className="text-[10px] px-1.5 py-0">
                {selectedSources.length}
              </Badge>
            )}
            <svg className={`h-3 w-3 text-muted-foreground transition-transform ${showSourceDropdown ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showSourceDropdown && trendsData && trendsData.availableSources.length > 0 && (
            <div className="absolute z-50 mt-1 w-56 rounded-lg border border-border bg-card shadow-lg p-2 space-y-1">
              {trendsData.availableSources.map((s) => (
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
                  <span className="text-muted-foreground shrink-0">{s.count}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Clear filters */}
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <p className="font-medium">Failed to load analytics</p>
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
            { label: "Total Prompts", value: summary ? formatNumber(summary.totalPrompts) : "0" },
            { label: "Avg Quality", value: summary ? `${summary.avgQuality.toFixed(1)} / 5` : "0 / 5" },
            { label: "Total Tokens", value: summary ? formatNumber(summary.totalTokens) : "0" },
            { label: "Active Projects", value: summary ? String(summary.activeProjects) : "0" },
          ].map((item) => (
            <Card key={item.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">{item.value}</div>
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
            Insights
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
            <CardTitle>Prompt Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <PromptVolumeChart
              data={trendsData?.daily ?? []}
              isLoading={loading}
            />
          </CardContent>
        </Card>

        {/* Token Usage */}
        <Card>
          <CardHeader>
            <CardTitle>Token Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <TokenUsageChart
              data={trendsData?.daily.map((d) => ({ date: d.date, tokens: d.tokens })) ?? []}
              isLoading={loading}
            />
          </CardContent>
        </Card>

        {/* Quality Score */}
        <Card>
          <CardHeader>
            <CardTitle>Quality Score Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <QualityScoreChart
              data={trendsData?.daily ?? []}
              isLoading={loading}
            />
          </CardContent>
        </Card>

        {/* Project Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Project Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectDistributionChart
              data={trendsData?.byProject ?? []}
              isLoading={loading}
            />
          </CardContent>
        </Card>

        {/* Hourly Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Hourly Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <HourlyActivityChart
              data={trendsData?.byHour ?? []}
              isLoading={loading}
            />
          </CardContent>
        </Card>

        {/* Weekday Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Weekday Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekdayActivityChart
              data={trendsData?.byWeekday ?? []}
              isLoading={loading}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
