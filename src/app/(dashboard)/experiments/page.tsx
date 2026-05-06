"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExperimentCard } from "@/components/experiment-card";
import { NewExperimentDialog } from "@/components/new-experiment-dialog";

interface Experiment {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  baselineVersion: number;
  challengerVersion: number;
  winnerVersion: number | null;
  winMetric: string | null;
  createdAt: string;
  promptEventKey: string | null;
}

export default function ExperimentsPage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const fetchExperiments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments");
      if (!res.ok) throw new Error("Failed to fetch experiments");
      const data = await res.json();
      setExperiments(data.experiments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load experiments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  const total = experiments.length;
  const running = experiments.filter((e) => e.status === "running").length;
  const completed = experiments.filter((e) => e.status === "completed").length;
  const wins = experiments.filter((e) => e.status === "completed" && e.winnerVersion != null).length;
  const winRate = completed > 0 ? Math.round((wins / completed) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Experiments</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A/B test prompt versions and measure quality improvements.
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)}>
          <svg className="h-4 w-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          New Experiment
        </Button>
      </div>

      {/* Stats */}
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
            { label: "Total Experiments", value: String(total) },
            { label: "Running", value: String(running) },
            { label: "Completed", value: String(completed) },
            { label: "Win Rate", value: `${winRate}%` },
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

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <p className="font-medium">Failed to load experiments</p>
          <p className="mt-1 opacity-80">{error}</p>
        </div>
      )}

      {/* Experiments Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : experiments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No experiments yet.</p>
          <p className="text-sm mt-1">Create your first A/B test to compare prompt versions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {experiments.map((exp) => (
            <ExperimentCard
              key={exp.id}
              id={exp.id}
              name={exp.name}
              description={exp.description}
              status={exp.status}
              baselineVersion={exp.baselineVersion}
              challengerVersion={exp.challengerVersion}
              winnerVersion={exp.winnerVersion}
              winMetric={exp.winMetric}
              createdAt={exp.createdAt}
              promptEventKey={exp.promptEventKey}
            />
          ))}
        </div>
      )}

      <NewExperimentDialog
        open={showDialog}
        onClose={() => setShowDialog(false)}
        onCreated={fetchExperiments}
      />
    </div>
  );
}
