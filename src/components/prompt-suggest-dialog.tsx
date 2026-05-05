"use client";

import { useState, useCallback } from "react";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const GOALS = [
  { key: "clarity", label: "Improve clarity" },
  { key: "conciseness", label: "Make more concise" },
  { key: "specificity", label: "Add specificity" },
  { key: "debugging", label: "Debug this" },
] as const;

type GoalKey = typeof GOALS[number]["key"];

interface SuggestionResult {
  original: string;
  suggestion: string;
  goal: string;
}

interface PromptSuggestDialogProps {
  open: boolean;
  onClose: () => void;
  promptId: string;
  promptText: string;
  onApply?: (suggestion: string) => void;
}

export function PromptSuggestDialog({
  open,
  onClose,
  promptId,
  promptText,
  onApply,
}: PromptSuggestDialogProps) {
  const [selectedGoal, setSelectedGoal] = useState<GoalKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const requestSuggestion = useCallback(
    async (goal: GoalKey) => {
      setSelectedGoal(goal);
      setLoading(true);
      setError(null);
      setResult(null);
      setCopied(false);

      try {
        const res = await fetch(`/api/prompts/${encodeURIComponent(promptId)}/suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Request failed" }));
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        const data: SuggestionResult = await res.json();
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate suggestion");
      } finally {
        setLoading(false);
      }
    },
    [promptId]
  );

  const handleCopy = async () => {
    if (!result?.suggestion) return;
    try {
      await navigator.clipboard.writeText(result.suggestion);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may not be available
    }
  };

  const handleReplace = () => {
    if (!result?.suggestion) return;
    if (onApply) {
      onApply(result.suggestion);
    }
    onClose();
  };

  const handleClose = () => {
    setSelectedGoal(null);
    setResult(null);
    setError(null);
    setCopied(false);
    onClose();
  };

  const isUnavailable = error?.includes("No LLM provider configured") || error?.includes("unavailable");

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-2xl">
      <DialogTitle>Suggest Improvements</DialogTitle>
      <DialogDescription>
        Use AI to rewrite your prompt for better results.
      </DialogDescription>

      <div className="mt-4 space-y-4">
        {/* Goal selection */}
        {!result && !loading && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GOALS.map((g) => (
              <button
                key={g.key}
                onClick={() => requestSuggestion(g.key)}
                className="flex items-center justify-center rounded-lg border border-border bg-card p-3 text-sm transition-colors hover:bg-accent hover:border-primary/30"
              >
                <span className="font-medium text-foreground">{g.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating suggestion...
            </div>
            <div className="h-4 w-full animate-pulse rounded bg-skeleton" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-skeleton" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-skeleton" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="space-y-3">
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
            {isUnavailable && (
              <div className="rounded-lg border border-border bg-surface p-3 text-sm text-muted-foreground space-y-2">
                <p className="font-medium text-foreground">Setup Instructions</p>
                <p>
                  To enable AI-powered suggestions, configure an LLM provider by setting one of these environment variables:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <code className="text-xs bg-background px-1 py-0.5 rounded">SUGGESTION_PROVIDER</code> — URL of your LLM API (falls back to EMBEDDING_API_URL)
                  </li>
                  <li>
                    <code className="text-xs bg-background px-1 py-0.5 rounded">SUGGESTION_MODEL</code> — Model name for generation (optional)
                  </li>
                  <li>
                    <code className="text-xs bg-background px-1 py-0.5 rounded">SUGGESTION_MAX_TOKENS</code> — Max tokens for suggestions (default: 500)
                  </li>
                </ul>
                <p className="text-xs">
                  Supports Ollama (e.g. <code>http://localhost:11434</code>) and OpenAI-compatible APIs.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{result.goal}</Badge>
              <button
                onClick={() => requestSuggestion(selectedGoal ?? "clarity")}
                className="text-xs text-primary hover:underline"
              >
                Retry
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Original */}
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Original</p>
                <p className="text-sm text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {result.original}
                </p>
              </div>

              {/* Suggestion */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-medium text-primary mb-2">Suggestion</p>
                <p className="text-sm text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {result.suggestion}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <span className="flex items-center gap-1">
                    <svg className="h-4 w-4 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy suggestion
                  </span>
                )}
              </Button>
              <Button size="sm" onClick={handleReplace}>
                Replace
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
