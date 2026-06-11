"use client";

import { useMemo, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { cn } from "@/lib/utils";
import { shouldCollapseMessage } from "@/lib/session-ui";

interface CollapsibleMessageContentProps {
  content: string;
  className?: string;
  collapsedClassName?: string;
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

export function CollapsibleMessageContent({
  content,
  className,
  collapsedClassName = "max-h-80",
  expanded,
  defaultExpanded = false,
  onExpandedChange,
}: CollapsibleMessageContentProps) {
  const canCollapse = useMemo(() => shouldCollapseMessage(content), [content]);
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = expanded ?? internalExpanded;

  const setExpanded = (nextExpanded: boolean) => {
    if (expanded === undefined) {
      setInternalExpanded(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };

  return (
    <div className="min-w-0" data-collapsible-message={canCollapse ? "true" : "false"}>
      <div
        className={cn(
          "relative min-w-0",
          canCollapse && !isExpanded && "overflow-hidden",
          canCollapse && !isExpanded && collapsedClassName,
        )}
        data-message-collapsed={canCollapse && !isExpanded ? "true" : "false"}
      >
        <MarkdownContent content={content} className={className} />
      </div>

      {canCollapse && (
        <div className="mt-3 flex justify-start border-t border-border-subtle pt-3">
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => setExpanded(!isExpanded)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg
              className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {isExpanded ? "Collapse message" : "Show full message"}
          </button>
        </div>
      )}
    </div>
  );
}
