"use client";

import { useState } from "react";
import Link from "next/link";
import { MarkdownContent } from "@/components/markdown-content";

interface SharedPromptData {
  id: string;
  promptText: string;
  responseText: string | null;
  timestamp: string;
  tokenEstimate: number | null;
  tokenEstimateResponse: number | null;
}

interface SharedSessionViewProps {
  projectName: string | null;
  source: string | null;
  startedAt: string;
  endedAt: string;
  promptCount: number;
  prompts: SharedPromptData[];
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

function formatTokenCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toString();
}

export function SharedSessionView({
  projectName,
  source,
  startedAt,
  endedAt,
  promptCount,
  prompts,
}: SharedSessionViewProps) {
  const [showResponses, setShowResponses] = useState(true);
  const [copied, setCopied] = useState(false);

  const totalInputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimate ?? 0), 0);
  const totalOutputTokens = prompts.reduce((sum, p) => sum + (p.tokenEstimateResponse ?? 0), 0);
  const responseCount = prompts.filter((p) => p.responseText).length;

  const handleCopy = async () => {
    try {
      const content = prompts
        .map((p) => {
          let text = `[User]\n${p.promptText}`;
          if (p.responseText) {
            text += `\n\n[Assistant]\n${p.responseText}`;
          }
          return text;
        })
        .join("\n\n---\n\n");
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in insecure contexts
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors">
            <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="font-semibold">Oh My Prompt</span>
          </Link>
          <div className="flex items-center gap-2">
            {responseCount > 0 && (
              <button
                onClick={() => setShowResponses(!showResponses)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${showResponses ? "" : "-rotate-90"}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {showResponses ? "Hide" : "Show"} Responses
              </button>
            )}
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {copied ? (
                <>
                  <svg className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy All
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto max-w-4xl px-6 py-8">
        {/* Session metadata */}
        <div className="rounded-lg border border-border bg-card overflow-hidden mb-6">
          <div className="px-6 py-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatDate(startedAt)} — {formatDuration(startedAt, endedAt)}
              </div>
              {projectName && (
                <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {projectName}
                </span>
              )}
              {source && (
                <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {source}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
              <span>{promptCount} prompts</span>
              <span>{responseCount} responses</span>
              {totalInputTokens > 0 && (
                <span>Input: {formatTokenCount(totalInputTokens)} tokens</span>
              )}
              {totalOutputTokens > 0 && (
                <span>Output: {formatTokenCount(totalOutputTokens)} tokens</span>
              )}
              {(totalInputTokens > 0 || totalOutputTokens > 0) && (
                <span className="font-medium text-foreground">
                  Total: {formatTokenCount(totalInputTokens + totalOutputTokens)} tokens
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Shared session badge */}
        <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>Read-only shared session</span>
        </div>

        {/* Prompt thread */}
        <div className="space-y-4">
          {prompts.map((prompt, index) => (
            <div key={prompt.id} className="space-y-0">
              {/* User message */}
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium text-blue-400">You</span>
                    <span className="text-xs text-muted-foreground">{formatDate(prompt.timestamp)}</span>
                    {prompt.tokenEstimate && (
                      <span className="text-xs text-muted-foreground">
                        {formatTokenCount(prompt.tokenEstimate)} tokens
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      #{index + 1}
                    </span>
                  </div>
                  <div className="prose prose-invert max-w-none">
                    <MarkdownContent content={prompt.promptText} />
                  </div>
                </div>
              </div>

              {/* Assistant response */}
              {showResponses && prompt.responseText && (
                <div className="rounded-lg border border-border border-l-2 border-l-green-800 bg-card overflow-hidden ml-4">
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="font-medium text-green-400">Assistant</span>
                      {prompt.tokenEstimateResponse && (
                        <span className="text-xs text-muted-foreground">
                          {formatTokenCount(prompt.tokenEstimateResponse)} tokens
                        </span>
                      )}
                    </div>
                    <div className="prose prose-invert max-w-none">
                      <MarkdownContent content={prompt.responseText} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer branding */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>
            Shared via{" "}
            <Link
              href="/"
              className="text-primary hover:text-primary/80 transition-colors font-medium"
            >
              Oh My Prompt
            </Link>{" "}
            -- Prompt journal and insight dashboard for better agent instructions
          </p>
        </div>
      </main>
    </div>
  );
}
