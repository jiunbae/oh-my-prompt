"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TemplateRating } from "./template-rating";

interface TemplateCardProps {
  id: string;
  templateId: string;
  title: string;
  description: string | null;
  category: string;
  tags: string[] | null;
  rating: number;
  ratingCount: number;
  forkCount: number;
  authorName: string | null;
  authorEmail: string;
  onFork?: (id: string) => void;
}

export function TemplateCard({
  id,
  title,
  description,
  category,
  tags,
  rating,
  ratingCount,
  forkCount,
  authorName,
  authorEmail,
  onFork,
}: TemplateCardProps) {
  const displayAuthor = authorName || authorEmail.split("@")[0];

  return (
    <div className="rounded-lg border border-border bg-card p-5 hover:border-ring/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Link href={`/marketplace/${id}`} className="block">
            <h3 className="font-semibold text-foreground truncate hover:text-primary transition-colors">
              {title}
            </h3>
          </Link>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="info" className="capitalize text-[10px]">
              {category}
            </Badge>
            <span className="text-xs text-muted-foreground">
              by {displayAuthor}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => onFork?.(id)}
          className="shrink-0"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Fork
        </Button>
      </div>

      {description && (
        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
          {description}
        </p>
      )}

      {tags && tags.length > 0 && (
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px]"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
        <TemplateRating rating={rating} count={ratingCount} size="sm" />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {forkCount}
        </div>
      </div>
    </div>
  );
}
