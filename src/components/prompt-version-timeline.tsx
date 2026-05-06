"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { NewExperimentDialog } from "@/components/new-experiment-dialog";

interface PromptVersion {
  id: string;
  version: number;
  promptText: string;
  responseText: string | null;
  createdAt: string;
  reason: string | null;
}

interface DiffSegment {
  type: "added" | "removed" | "unchanged";
  text: string;
}

interface PromptVersionTimelineProps {
  promptId: string;
}

function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

function getReasonLabel(reason: string | null): string {
  switch (reason) {
    case "user_edit":
      return "User Edit";
    case "refinement":
      return "Refinement";
    case "retry":
      return "Retry";
    case "manual_save":
      return "Manual Save";
    default:
      return reason ?? "Unknown";
  }
}

function getReasonColor(reason: string | null): string {
  switch (reason) {
    case "user_edit":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "refinement":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "retry":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "manual_save":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface DiffModalState {
  open: boolean;
  fromVersion: PromptVersion | null;
  toVersion: PromptVersion | null;
  diff: DiffSegment[] | null;
  similarity: number;
  loading: boolean;
}

export function PromptVersionTimeline({ promptId }: PromptVersionTimelineProps) {
  const router = useRouter();
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [diffModal, setDiffModal] = useState<DiffModalState>({
    open: false,
    fromVersion: null,
    toVersion: null,
    diff: null,
    similarity: 0,
    loading: false,
  });
  const [experimentDialogOpen, setExperimentDialogOpen] = useState(false);
  const [experimentDefaultBaseline, setExperimentDefaultBaseline] = useState<number | undefined>();

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prompts/${promptId}/versions`);
      if (res.ok) {
        const data = await res.json();
        setVersions(data.versions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    if (expanded) {
      fetchVersions();
    }
  }, [expanded, fetchVersions]);

  const handleSaveVersion = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/prompts/${promptId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "manual_save" }),
      });
      if (res.ok) {
        await fetchVersions();
      }
    } finally {
      setSaving(false);
    }
  }, [promptId, fetchVersions]);

  const handleCompare = useCallback(async (from: PromptVersion, to: PromptVersion) => {
    setDiffModal({
      open: true,
      fromVersion: from,
      toVersion: to,
      diff: null,
      similarity: 0,
      loading: true,
    });

    const res = await fetch(
      `/api/prompts/diff?promptId=${promptId}&from=v${from.version}&to=v${to.version}`
    );
    const data = await res.json().catch(() => null);

    if (data && data.diff) {
      setDiffModal({
        open: true,
        fromVersion: from,
        toVersion: to,
        diff: data.diff,
        similarity: data.similarity ?? 0,
        loading: false,
      });
    } else {
      setDiffModal((prev) => ({ ...prev, loading: false }));
    }
  }, [promptId]);

  const closeDiffModal = useCallback(() => {
    setDiffModal({
      open: false,
      fromVersion: null,
      toVersion: null,
      diff: null,
      similarity: 0,
      loading: false,
    });
  }, []);

  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      {/* Toggle bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg
            className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {versions.length > 0 ? (
            <span>
              {versions.length} version{versions.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span>Version history</span>
          )}
        </button>
        <button
          onClick={handleSaveVersion}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border border-border bg-card text-secondary-foreground hover:bg-surface transition-colors disabled:opacity-50"
        >
          <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          {saving ? "Saving..." : "Save version"}
        </button>
      </div>

      {/* Expanded timeline */}
      {expanded && (
        <div className="mt-2">
          {loading ? (
            <div className="text-xs text-muted-foreground py-1">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="text-xs text-muted-foreground py-1">No versions saved yet.</div>
          ) : (
            <div className="relative">
              <div className="absolute left-[7px] top-0 bottom-0 w-px bg-border-subtle" />
              <div className="space-y-1.5">
                {versions.map((version, index) => {
                  const isExpanded = expandedVersion === version.version;
                  const prevVersion = index < versions.length - 1 ? versions[index + 1] : null;

                  return (
                    <div key={version.id} className="relative pl-5">
                      <div
                        className={`absolute left-[4px] top-[5px] h-[7px] w-[7px] rounded-full border-2 z-10 ${
                          index === 0
                            ? "border-primary bg-primary"
                            : "border-border bg-background"
                        }`}
                      />
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setExpandedVersion(isExpanded ? null : version.version)}
                            className="text-[11px] font-medium text-foreground hover:text-primary transition-colors"
                          >
                            v{version.version}
                          </button>
                          <span className={`text-[9px] px-1 py-0 rounded-full ${getReasonColor(version.reason)}`}>
                            {getReasonLabel(version.reason)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDate(version.createdAt)}
                          </span>
                        </div>
                        {isExpanded && (
                          <div className="rounded border border-border bg-surface-sunken p-2 space-y-1.5">
                            <div className="text-[11px] text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                              {version.promptText}
                            </div>
                            <div className="flex items-center gap-2">
                              {prevVersion && (
                                <button
                                  onClick={() => handleCompare(prevVersion, version)}
                                  className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                                >
                                  <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                  Compare with v{prevVersion.version}
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  setExperimentDefaultBaseline(prevVersion?.version);
                                  setExperimentDialogOpen(true);
                                }}
                                className="inline-flex items-center gap-1 text-[10px] text-chart-2 hover:text-chart-2/80 transition-colors"
                              >
                                <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                Start A/B test
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <NewExperimentDialog
        open={experimentDialogOpen}
        onClose={() => setExperimentDialogOpen(false)}
        onCreated={() => {}}
        defaultPromptId={promptId}
        defaultBaselineVersion={experimentDefaultBaseline}
        defaultChallengerVersion={expandedVersion ?? undefined}
      />

      {/* Diff Modal */}
      {diffModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeDiffModal}>
          <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="text-sm font-semibold">
                Diff: v{diffModal.fromVersion?.version} → v{diffModal.toVersion?.version}
              </div>
              <button
                onClick={closeDiffModal}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4">
              {diffModal.loading ? (
                <div className="text-center py-8 text-sm text-muted-foreground">Computing diff...</div>
              ) : diffModal.diff ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      Similarity: {Math.round((diffModal.similarity ?? 0) * 100)}%
                    </span>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground">
                        v{diffModal.fromVersion?.version} ({formatDate(diffModal.fromVersion?.createdAt ?? new Date())})
                      </h3>
                      <div className="rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
                        {diffModal.diff.map((segment: DiffSegment, i: number) => (
                          <span
                            key={i}
                            className={
                              segment.type === "removed"
                                ? "bg-red-100 dark:bg-red-900/30"
                                : segment.type === "added"
                                  ? "opacity-30"
                                  : ""
                            }
                          >
                            {segment.text}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold text-muted-foreground">
                        v{diffModal.toVersion?.version} ({formatDate(diffModal.toVersion?.createdAt ?? new Date())})
                      </h3>
                      <div className="rounded-md border border-border bg-background p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words max-h-[400px] overflow-auto">
                        {diffModal.diff.map((segment: DiffSegment, i: number) => (
                          <span
                            key={i}
                            className={
                              segment.type === "added"
                                ? "bg-green-100 dark:bg-green-900/30"
                                : segment.type === "removed"
                                  ? "opacity-30"
                                  : ""
                            }
                          >
                            {segment.text}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">Failed to compute diff</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
