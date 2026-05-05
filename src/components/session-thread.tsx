"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { MarkdownContent } from "@/components/markdown-content";
import { CheckboxRow } from "@/components/checkbox-row";
import { BulkOperationsBar } from "@/components/bulk-operations-bar";
import { PromptVersionTimeline } from "@/components/prompt-version-timeline";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

interface PromptData {
  id: string;
  timestamp: string;
  promptText: string;
  responseText: string | null;
  tokenEstimate: number | null;
  tokenEstimateResponse: number | null;
  promptTags: { tag: { id: string; name: string; color: string | null } }[];
}

interface SessionThreadProps {
  prompts: PromptData[];
  responseCount: number;
  hasNote?: boolean;
  selectable?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
      title="Copy message"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

export function SessionThread({ prompts, responseCount, hasNote = false, selectable = false }: SessionThreadProps) {
  const router = useRouter();
  const [showResponses, setShowResponses] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sortedPrompts = sortAsc ? [...prompts].reverse() : prompts;

  const promptIds = prompts.map((p) => p.id);
  const allSelected = promptIds.length > 0 && promptIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(promptIds));
    }
  }, [allSelected, promptIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const res = await fetch("/api/prompts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids }),
    });
    if (res.ok) {
      setSelectedIds(new Set());
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to delete prompts");
    }
  }, [selectedIds, router]);

  const handleBulkTag = useCallback(
    async (tagName: string) => {
      const ids = Array.from(selectedIds);
      const res = await fetch("/api/prompts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tag", ids, tag: tagName }),
      });
      if (res.ok) {
        setSelectedIds(new Set());
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to tag prompts");
      }
    },
    [selectedIds, router]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        {selectable && (
          <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card text-secondary-foreground hover:bg-surface transition-colors cursor-pointer select-none">
            <CheckboxRow
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label="Select all prompts"
            />
            {allSelected ? "Deselect all" : "Select all"}
          </label>
        )}
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card text-secondary-foreground hover:bg-surface transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {sortAsc ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9M3 12h5m8-4v8m0 0l-3-3m3 3l3-3" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9M3 12h9m2-4v8m0-8l3 3m-3-3l-3 3" />
            )}
          </svg>
          {sortAsc ? "Oldest First" : "Newest First"}
        </button>
        {responseCount > 0 && (
          <button
            onClick={() => setShowResponses(!showResponses)}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card text-secondary-foreground hover:bg-surface transition-colors"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${showResponses ? "" : "-rotate-90"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {showResponses ? "Hide" : "Show"} Responses ({responseCount})
          </button>
        )}
      </div>

      {/* Thread with timeline */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-5 top-0 bottom-0 w-px bg-border-subtle" />

        {sortedPrompts.map((prompt, index) => {
          const promptNumber = sortAsc ? index + 1 : prompts.length - index;
          const isSelected = selectedIds.has(prompt.id);
          return (
            <div key={prompt.id} className="relative pb-6 last:pb-0">
              {/* User message */}
              <div className="relative pl-14 group">
                {/* Avatar */}
                <div className="absolute left-2 top-0 h-7 w-7 rounded-full bg-user-message flex items-center justify-center z-10">
                  <svg className="h-3.5 w-3.5 text-user-message-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>

                {/* Message bubble */}
                <div
                  className={`rounded-lg border overflow-hidden transition-colors ${
                    isSelected
                      ? "border-primary/50 bg-user-message/15 ring-1 ring-primary/20"
                      : "border-user-message/30 bg-user-message/10"
                  }`}
                >
                  <div className="p-4">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3">
                      {selectable && (
                        <CheckboxRow
                          checked={isSelected}
                          onChange={() => toggleSelect(prompt.id)}
                          aria-label={`Select prompt #${promptNumber}`}
                        />
                      )}
                      <span className="font-medium text-user-message-foreground">You</span>
                      <span className="text-xs text-muted-foreground">{formatDate(prompt.timestamp)}</span>
                      {prompt.tokenEstimate && (
                        <span className="text-xs text-muted-foreground">
                          {formatTokens(prompt.tokenEstimate)} tokens
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground font-mono">#{promptNumber}</span>
                      <div className="ml-auto flex items-center gap-1">
                        <CopyButton text={prompt.promptText} />
                        <Link
                          href={`/prompts/${prompt.id}`}
                          className="text-xs text-muted-foreground hover:text-secondary-foreground transition-colors"
                        >
                          View detail
                        </Link>
                      </div>
                    </div>
                    <div className="prose prose-invert max-w-none">
                      <MarkdownContent content={prompt.promptText} />
                    </div>
                    {prompt.promptTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {prompt.promptTags.map((pt) => (
                          <Badge
                            key={pt.tag.id}
                            variant="secondary"
                            style={pt.tag.color ? { backgroundColor: `${pt.tag.color}22`, color: pt.tag.color, borderColor: pt.tag.color } : undefined}
                          >
                            {pt.tag.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {/* Version history for this prompt */}
                    <PromptVersionTimeline promptId={prompt.id} />
                  </div>
                </div>
              </div>

              {/* Assistant response */}
              {showResponses && prompt.responseText && (
                <div className="relative pl-14 mt-3 group">
                  {/* Avatar */}
                  <div className="absolute left-2 top-0 h-7 w-7 rounded-full bg-assistant-message flex items-center justify-center z-10">
                    <svg className="h-3.5 w-3.5 text-assistant-message-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>

                  {/* Message bubble */}
                  <div className="rounded-lg border border-assistant-message/30 bg-assistant-message/10 overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="font-medium text-assistant-message-foreground">Assistant</span>
                        {prompt.tokenEstimateResponse && (
                          <span className="text-xs text-muted-foreground">
                            {formatTokens(prompt.tokenEstimateResponse)} tokens
                          </span>
                        )}
                        <div className="ml-auto">
                          <CopyButton text={prompt.responseText} />
                        </div>
                      </div>
                      <div className="prose prose-invert max-w-none">
                        <MarkdownContent content={prompt.responseText} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bulk operations bar */}
      {selectable && (
        <BulkOperationsBar
          selectedCount={selectedIds.size}
          onDelete={handleBulkDelete}
          onTag={handleBulkTag}
          onClear={clearSelection}
        />
      )}
    </div>
  );
}