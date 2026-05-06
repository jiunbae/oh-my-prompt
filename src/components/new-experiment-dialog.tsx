"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface PromptOption {
  id: string;
  promptText: string;
  projectName: string | null;
}

interface VersionOption {
  id: string;
  version: number;
}

interface NewExperimentDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultPromptId?: string;
  defaultBaselineVersion?: number;
  defaultChallengerVersion?: number;
}

export function NewExperimentDialog({
  open,
  onClose,
  onCreated,
  defaultPromptId,
  defaultBaselineVersion,
  defaultChallengerVersion,
}: NewExperimentDialogProps) {
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [baselineVersion, setBaselineVersion] = useState("");
  const [challengerVersion, setChallengerVersion] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [winMetric, setWinMetric] = useState("quality_score");
  const [minSamples, setMinSamples] = useState(10);
  const [loading, setLoading] = useState(false);
  const [fetchingPrompts, setFetchingPrompts] = useState(false);
  const [fetchingVersions, setFetchingVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrompts = useCallback(async () => {
    setFetchingPrompts(true);
    try {
      const res = await fetch("/api/experiments/prompts");
      if (!res.ok) throw new Error("Failed to fetch prompts");
      const data = await res.json();
      setPrompts(data.prompts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompts");
    } finally {
      setFetchingPrompts(false);
    }
  }, []);

  const fetchVersions = useCallback(async (promptId: string) => {
    setFetchingVersions(true);
    setVersions([]);
    try {
      const res = await fetch(`/api/prompts/${promptId}/versions`);
      if (!res.ok) throw new Error("Failed to fetch versions");
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    } finally {
      setFetchingVersions(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchPrompts();
      setSelectedPromptId(defaultPromptId ?? "");
      setBaselineVersion(defaultBaselineVersion ? String(defaultBaselineVersion) : "");
      setChallengerVersion(defaultChallengerVersion ? String(defaultChallengerVersion) : "");
      setName("");
      setDescription("");
      setWinMetric("quality_score");
      setMinSamples(10);
      setError(null);
    }
  }, [open, fetchPrompts, defaultPromptId, defaultBaselineVersion, defaultChallengerVersion]);

  useEffect(() => {
    if (selectedPromptId) {
      fetchVersions(selectedPromptId);
    }
  }, [selectedPromptId, fetchVersions]);

  const handleSubmit = async () => {
    if (!selectedPromptId || !name.trim() || !baselineVersion || !challengerVersion) {
      setError("Please fill in all required fields");
      return;
    }
    if (baselineVersion === challengerVersion) {
      setError("Baseline and challenger versions must be different");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: selectedPromptId,
          name: name.trim(),
          description: description.trim() || undefined,
          baselineVersion: parseInt(baselineVersion, 10),
          challengerVersion: parseInt(challengerVersion, 10),
          winMetric,
          minSamples,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create experiment");
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create experiment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogTitle>New A/B Experiment</DialogTitle>
      <DialogDescription>
        Compare two prompt versions and track which performs better.
      </DialogDescription>

      <div className="mt-4 space-y-4">
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-2">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Prompt</label>
          <select
            value={selectedPromptId}
            onChange={(e) => setSelectedPromptId(e.target.value)}
            disabled={fetchingPrompts}
            className="h-10 w-full rounded-md border border-border bg-input-bg px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select a prompt...</option>
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.projectName ? `${p.projectName} — ` : ""}
                {p.promptText.slice(0, 60)}
                {p.promptText.length > 60 ? "..." : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Baseline Version</label>
            <select
              value={baselineVersion}
              onChange={(e) => setBaselineVersion(e.target.value)}
              disabled={!selectedPromptId || fetchingVersions}
              className="h-10 w-full rounded-md border border-border bg-input-bg px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select...</option>
              {versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Challenger Version</label>
            <select
              value={challengerVersion}
              onChange={(e) => setChallengerVersion(e.target.value)}
              disabled={!selectedPromptId || fetchingVersions}
              className="h-10 w-full rounded-md border border-border bg-input-bg px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select...</option>
              {versions.map((v) => (
                <option key={v.id} value={v.version}>
                  v{v.version}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Experiment Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Headline clarity test"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description..."
            rows={2}
            className="flex w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Win Metric</label>
            <select
              value={winMetric}
              onChange={(e) => setWinMetric(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-input-bg px-3 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="quality_score">Quality Score</option>
              <option value="clarity">Clarity</option>
              <option value="specificity">Specificity</option>
              <option value="context">Context</option>
              <option value="constraints">Constraints</option>
              <option value="structure">Structure</option>
              <option value="response_quality">Response Quality</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Min Samples</label>
            <Input
              type="number"
              min={1}
              value={minSamples}
              onChange={(e) => setMinSamples(parseInt(e.target.value, 10) || 1)}
            />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={loading}>
          {loading ? "Creating..." : "Create Experiment"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
