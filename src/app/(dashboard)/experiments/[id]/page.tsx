"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ExperimentComparison } from "@/components/experiment-comparison";
import { ExperimentChart } from "@/components/experiment-chart";

interface ExperimentResult {
  id: string;
  experimentId: string;
  version: number;
  metricValue: string | null;
  sampleSize: number | null;
  recordedAt: string;
}

interface ExperimentDetail {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  promptId: string;
  baselineVersion: number;
  challengerVersion: number;
  winMetric: string | null;
  minSamples: number | null;
  startedAt: string | null;
  endedAt: string | null;
  winnerVersion: number | null;
  createdAt: string;
}

interface ExperimentData {
  experiment: ExperimentDetail;
  baselineResult: ExperimentResult | null;
  challengerResult: ExperimentResult | null;
  baselinePromptText: string | null;
  challengerPromptText: string | null;
}

export default function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [data, setData] = useState<ExperimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [id, setId] = useState<string>("");

  useEffect(() => {
    params.then((p) => setId(p.id));
  }, [params]);

  const fetchExperiment = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/experiments/${id}`);
      if (!res.ok) throw new Error("Failed to fetch experiment");
      const d = await res.json();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load experiment");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchExperiment();
  }, [fetchExperiment]);

  const handleAction = async (action: "start" | "pause" | "conclude") => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/experiments/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Failed to ${action} experiment`);
      }
      await fetchExperiment();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} experiment`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    setActionLoading("delete");
    try {
      const res = await fetch(`/api/experiments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete experiment");
      router.push("/experiments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete experiment");
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadgeVariant = (status: string | null) => {
    switch (status) {
      case "running":
        return "success";
      case "paused":
        return "warning";
      case "completed":
        return "default";
      default:
        return "secondary";
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[200px]" />
          <Skeleton className="h-[200px]" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
        <p className="font-medium">Failed to load experiment</p>
        <p className="mt-1 opacity-80">{error}</p>
      </div>
    );
  }

  const { experiment, baselineResult, challengerResult, baselinePromptText, challengerPromptText } = data;
  const baselineMetric = baselineResult?.metricValue ? Number(baselineResult.metricValue) : 0;
  const challengerMetric = challengerResult?.metricValue ? Number(challengerResult.metricValue) : 0;
  const baselineSamples = baselineResult?.sampleSize ?? 0;
  const challengerSamples = challengerResult?.sampleSize ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push("/experiments")}>
            <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">{experiment.name}</h1>
          <Badge variant={statusBadgeVariant(experiment.status)}>
            {experiment.status ?? "draft"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {experiment.status === "draft" && (
            <Button size="sm" onClick={() => handleAction("start")} disabled={!!actionLoading}>
              {actionLoading === "start" ? "Starting..." : "Start"}
            </Button>
          )}
          {experiment.status === "running" && (
            <Button size="sm" variant="outline" onClick={() => handleAction("pause")} disabled={!!actionLoading}>
              {actionLoading === "pause" ? "Pausing..." : "Pause"}
            </Button>
          )}
          {experiment.status !== "completed" && (
            <Button size="sm" variant="secondary" onClick={() => handleAction("conclude")} disabled={!!actionLoading}>
              {actionLoading === "conclude" ? "Concluding..." : "Conclude"}
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!!actionLoading}
          >
            Delete
          </Button>
        </div>
      </div>

      {experiment.description && (
        <p className="text-sm text-muted-foreground">{experiment.description}</p>
      )}

      {experiment.status === "completed" && experiment.winnerVersion != null && (
        <div className="rounded-lg border border-chart-2/30 bg-chart-2/10 p-4 text-chart-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Winner: v{experiment.winnerVersion}
          </div>
          <p className="text-xs mt-1 opacity-80">
            Based on {experiment.winMetric ?? "quality_score"} with {baselineSamples + challengerSamples} total samples.
          </p>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Baseline Avg", value: baselineMetric.toFixed(1) },
          { label: "Baseline Samples", value: String(baselineSamples) },
          { label: "Challenger Avg", value: challengerMetric.toFixed(1) },
          { label: "Challenger Samples", value: String(challengerSamples) },
        ].map((item) => (
          <Card key={item.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{item.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Metric Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <ExperimentChart
            baselineMetric={baselineMetric}
            challengerMetric={challengerMetric}
            baselineSamples={baselineSamples}
            challengerSamples={challengerSamples}
          />
        </CardContent>
      </Card>

      {/* Comparison */}
      <Card>
        <CardHeader>
          <CardTitle>Prompt Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <ExperimentComparison
            baselinePromptText={baselinePromptText}
            challengerPromptText={challengerPromptText}
            baselineVersion={experiment.baselineVersion}
            challengerVersion={experiment.challengerVersion}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete experiment"
        description="Are you sure you want to delete this experiment? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={actionLoading === "delete"}
      />
    </div>
  );
}
