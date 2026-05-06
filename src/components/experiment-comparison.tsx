"use client";

interface ExperimentComparisonProps {
  baselinePromptText: string | null;
  challengerPromptText: string | null;
  baselineVersion: number;
  challengerVersion: number;
}

export function ExperimentComparison({
  baselinePromptText,
  challengerPromptText,
  baselineVersion,
  challengerVersion,
}: ExperimentComparisonProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Baseline
          </span>
          <span className="text-xs font-medium text-primary">v{baselineVersion}</span>
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
          {baselinePromptText ?? "No text available"}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Challenger
          </span>
          <span className="text-xs font-medium text-chart-2">v{challengerVersion}</span>
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
          {challengerPromptText ?? "No text available"}
        </div>
      </div>
    </div>
  );
}
