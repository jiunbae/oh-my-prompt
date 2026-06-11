"use client";

import { useMemo, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { cn } from "@/lib/utils";

const COLLAPSE_CHAR_LIMIT = 1200;
const COLLAPSE_LINE_LIMIT = 18;

function shouldCollapseMessage(content: string): boolean {
  if (content.length > COLLAPSE_CHAR_LIMIT) return true;
  return content.split(/\r\n|\r|\n/).length > COLLAPSE_LINE_LIMIT;
}

interface CollapsibleMessageContentProps {
  content: string;
  className?: string;
  collapsedClassName?: string;
}

export function CollapsibleMessageContent({
  content,
  className,
  collapsedClassName = "max-h-80",
}: CollapsibleMessageContentProps) {
  const canCollapse = useMemo(() => shouldCollapseMessage(content), [content]);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="min-w-0">
      <div
        className={cn(
          "relative min-w-0",
          canCollapse && !expanded && "overflow-hidden",
          canCollapse && !expanded && collapsedClassName,
        )}
      >
        <MarkdownContent content={content} className={className} />
      </div>

      {canCollapse && (
        <div className="mt-3 flex justify-start border-t border-border-subtle pt-3">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg
              className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {expanded ? "Collapse message" : "Show full message"}
          </button>
        </div>
      )}
    </div>
  );
}
