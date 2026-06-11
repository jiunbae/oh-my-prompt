"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { CollapsibleMessageContent } from "@/components/collapsible-message-content";
import { usePersistentExpandedMessages } from "@/hooks/use-persistent-expanded-messages";
import {
  getAllSessionMessageIds,
  sessionMessageDomId,
  sessionMessageId,
} from "@/lib/session-ui";

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

function CopyButton({ text, label }: { text: string; label?: string }) {
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
      title={label || "Copy message"}
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

export function SharedSessionView({
  projectName,
  source,
  startedAt,
  endedAt,
  promptCount,
  prompts,
}: SharedSessionViewProps) {
  const [showResponses, setShowResponses] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const messageStorageKey = `omp:shared-session-thread:expanded:${startedAt}:${endedAt}:${promptCount}`;
  const allMessageIds = useMemo(() => getAllSessionMessageIds(prompts), [prompts]);
  const {
    expandedIds,
    setMessageExpanded,
    expandMessages,
    collapseMessages,
  } = usePersistentExpandedMessages(messageStorageKey);
  const allMessagesExpanded = allMessageIds.length > 0 && allMessageIds.every((id) => expandedIds.has(id));
  const anyMessageExpanded = allMessageIds.some((id) => expandedIds.has(id));

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!hash) return;

    for (const prompt of prompts) {
      const promptDomId = sessionMessageDomId(prompt.id, "prompt");
      const responseDomId = sessionMessageDomId(prompt.id, "response");
      if (hash === promptDomId) {
        setMessageExpanded(sessionMessageId(prompt.id, "prompt"), true);
        return;
      }
      if (hash === responseDomId) {
        setMessageExpanded(sessionMessageId(prompt.id, "response"), true);
        return;
      }
    }
  }, [prompts, setMessageExpanded]);

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
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in insecure contexts
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Branded header with gradient */}
      <header className="border-b border-border bg-gradient-to-r from-[var(--accent-gradient-from,#3b82f6)]/10 to-[var(--accent-gradient-to,#8b5cf6)]/10">
        <div className="container mx-auto max-w-4xl px-6 py-5">
          <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 text-foreground hover:text-foreground/80 transition-colors">
              <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="font-semibold">Oh My Prompt</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-medium border border-primary/25">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Shared Session
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
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
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
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
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {copied ? (
                <>
                  <svg className="h-4 w-4 text-chart-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            {allMessageIds.length > 1 && (
              <>
                <button
                  onClick={() => expandMessages(allMessageIds)}
                  disabled={allMessagesExpanded}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  Expand all
                </button>
                <button
                  onClick={() => collapseMessages(allMessageIds)}
                  disabled={!anyMessageExpanded}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  Collapse all
                </button>
              </>
            )}
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

        {/* Read-only badge */}
        <div className="flex items-center gap-2 mb-6 text-sm text-muted-foreground">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>Read-only shared session</span>
        </div>

        {/* Prompt thread — matching SessionThread styling */}
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-border-subtle" />

          {(sortAsc ? prompts : [...prompts].reverse()).map((prompt) => {
            const originalIndex = prompts.indexOf(prompt);
            const promptMessageId = sessionMessageId(prompt.id, "prompt");
            const responseMessageId = sessionMessageId(prompt.id, "response");
            return (
              <div key={prompt.id} className="relative pb-6 last:pb-0">
                {/* User message */}
                <div id={sessionMessageDomId(prompt.id, "prompt")} className="relative pl-14 group">
                  {/* Avatar */}
                  <div className="absolute left-2 top-0 h-7 w-7 rounded-full bg-user-message flex items-center justify-center z-10">
                    <svg className="h-3.5 w-3.5 text-user-message-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>

                  {/* Message bubble */}
                  <div className="rounded-lg border border-user-message/30 bg-user-message/10 overflow-hidden">
                    <div className="p-4">
                      <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-medium text-user-message-foreground">You</span>
                        <span className="text-xs text-muted-foreground">{formatDate(prompt.timestamp)}</span>
                        {prompt.tokenEstimate && (
                          <span className="text-xs text-muted-foreground">
                            {formatTokenCount(prompt.tokenEstimate)} tokens
                          </span>
                        )}
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <CopyButton text={prompt.promptText} />
                          <span className="text-xs text-muted-foreground font-mono">
                            #{originalIndex + 1}
                          </span>
                        </span>
                      </div>
                      <CollapsibleMessageContent
                        content={prompt.promptText}
                        expanded={expandedIds.has(promptMessageId)}
                        onExpandedChange={(expanded) => setMessageExpanded(promptMessageId, expanded)}
                      />
                    </div>
                  </div>
                </div>

                {/* Assistant response */}
                {showResponses && prompt.responseText && (
                  <div id={sessionMessageDomId(prompt.id, "response")} className="relative pl-14 mt-3 group">
                    {/* Avatar */}
                    <div className="absolute left-2 top-0 h-7 w-7 rounded-full bg-assistant-message flex items-center justify-center z-10">
                      <svg className="h-3.5 w-3.5 text-assistant-message-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>

                    {/* Message bubble */}
                    <div className="rounded-lg border border-assistant-message/30 bg-assistant-message/10 overflow-hidden">
                      <div className="p-4">
                        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium text-assistant-message-foreground">Assistant</span>
                          {prompt.tokenEstimateResponse && (
                            <span className="text-xs text-muted-foreground">
                              {formatTokenCount(prompt.tokenEstimateResponse)} tokens
                            </span>
                          )}
                          <div className="ml-auto shrink-0">
                            <CopyButton text={prompt.responseText} />
                          </div>
                        </div>
                        <CollapsibleMessageContent
                          content={prompt.responseText}
                          expanded={expandedIds.has(responseMessageId)}
                          onExpandedChange={(expanded) => setMessageExpanded(responseMessageId, expanded)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA footer card */}
        <div className="mt-12 rounded-lg border border-border bg-gradient-to-r from-[var(--accent-gradient-from,#3b82f6)]/5 to-[var(--accent-gradient-to,#8b5cf6)]/5 overflow-hidden">
          <div className="px-6 py-8 text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span className="text-lg font-semibold text-foreground">Oh My Prompt</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Prompt journal and insight dashboard for better agent instructions.
              Track, analyze, and share your coding sessions.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
            >
              Get Started
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
