"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface SimilarPrompt {
  id: string;
  promptText: string;
  projectName: string | null;
  similarity: number;
  createdAt: string;
}

interface SimilarPromptsProps {
  promptId: string;
}

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatSimilarity(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function SimilarPrompts({ promptId }: SimilarPromptsProps) {
  const [prompts, setPrompts] = useState<SimilarPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSimilar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(promptId)}/similar?limit=5`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data: { results: SimilarPrompt[] } = await res.json();
      setPrompts(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load similar prompts");
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    fetchSimilar();
  }, [fetchSimilar]);

  if (loading) {
    return (
      <div className="space-y-3 px-6 py-4">
        <div className="h-4 w-32 animate-pulse rounded bg-skeleton" />
        <div className="h-10 animate-pulse rounded bg-skeleton" />
        <div className="h-10 animate-pulse rounded bg-skeleton" />
        <div className="h-10 animate-pulse rounded bg-skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-4">
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
        <button
          onClick={fetchSimilar}
          className="mt-2 text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (prompts.length === 0) {
    return (
      <div className="px-6 py-5 text-sm text-muted-foreground">
        No similar prompts found for this prompt yet.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {prompts.map((item) => (
        <div
          key={item.id}
          className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <Link
              href={`/prompts/${item.id}`}
              className="block truncate text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              {item.promptText.split("\n")[0].slice(0, 120) || "Untitled prompt"}
            </Link>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">
                {formatSimilarity(item.similarity)} similar
              </span>
              {item.projectName && (
                <Badge variant="secondary" className="text-xs">
                  {item.projectName}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDate(item.createdAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/prompts/${item.id}`}
              className="inline-flex h-7 items-center justify-center rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              View
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
