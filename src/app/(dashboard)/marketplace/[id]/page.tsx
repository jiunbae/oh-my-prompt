"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TemplateRating } from "@/components/template-rating";
import { useUser } from "@/contexts/user-context";

interface TemplateVersion {
  id: string;
  version: number;
  content: string;
  description: string | null;
  createdAt: string;
}

interface MarketplaceTemplate {
  id: string;
  templateId: string;
  title: string;
  description: string | null;
  template: string;
  variables: unknown;
  category: string;
  tags: string[] | null;
  rating: number;
  ratingCount: number;
  forkCount: number;
  isPublic: boolean;
  createdAt: string;
  authorName: string | null;
  authorEmail: string;
  authorId: string;
}

export default function MarketplaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  const id = params.id as string;

  const [template, setTemplate] = useState<MarketplaceTemplate | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [forking, setForking] = useState(false);
  const [ratingLoading, setRatingLoading] = useState(false);

  useEffect(() => {
    async function fetchTemplate() {
      try {
        const res = await fetch(`/api/marketplace/templates/${id}`);
        if (res.ok) {
          const data = await res.json();
          setTemplate(data.template);
          setVersions(data.versions || []);
          setUserRating(data.userRating);
        } else if (res.status === 404) {
          router.push("/marketplace");
        }
      } catch (error) {
        console.error("Failed to fetch template:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchTemplate();
  }, [id, router]);

  const handleFork = async () => {
    if (!user || !template) return;
    setForking(true);
    try {
      const res = await fetch(`/api/marketplace/templates/${id}/fork`, {
        method: "POST",
      });
      if (res.ok) {
        router.push("/templates");
      }
    } catch (error) {
      console.error("Fork error:", error);
    } finally {
      setForking(false);
    }
  };

  const handleRate = async (value: number) => {
    if (!user || !template) return;
    setRatingLoading(true);
    try {
      const res = await fetch(`/api/marketplace/templates/${id}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      if (res.ok) {
        const data = await res.json();
        setUserRating(value);
        setTemplate((prev) =>
          prev
            ? {
                ...prev,
                rating: data.rating,
                ratingCount: data.ratingCount,
              }
            : null
        );
      }
    } catch (error) {
      console.error("Rate error:", error);
    } finally {
      setRatingLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-skeleton rounded animate-pulse" />
        <div className="h-64 bg-skeleton rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!template) {
    return null;
  }

  const displayAuthor = template.authorName || template.authorEmail.split("@")[0];
  const isAuthor = user?.id === template.authorId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h1 className="text-2xl font-semibold text-foreground">{template.title}</h1>
            <Badge variant="info" className="capitalize">
              {template.category}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>by {displayAuthor}</span>
            <span>•</span>
            <TemplateRating
              rating={template.rating}
              count={template.ratingCount}
              size="sm"
            />
            <span>•</span>
            <span className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {template.forkCount} forks
            </span>
          </div>
        </div>
        {!isAuthor && (
          <Button onClick={handleFork} disabled={forking} size="sm">
            {forking ? "Forking..." : "Fork to my templates"}
          </Button>
        )}
      </div>

      {/* Tags */}
      {template.tags && template.tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      {template.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {template.description}
        </p>
      )}

      {/* Template content preview */}
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">Template</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => navigator.clipboard.writeText(template.template)}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </Button>
        </div>
        <pre className="p-4 text-sm text-foreground font-mono whitespace-pre-wrap overflow-x-auto">
          {template.template}
        </pre>
      </div>

      {/* Rating section */}
      {!isAuthor && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground mb-2">Rate this template</h3>
          <TemplateRating
            rating={template.rating}
            interactive
            value={userRating || 0}
            onChange={handleRate}
          />
          {userRating && (
            <p className="text-xs text-muted-foreground mt-1">
              You rated this {userRating} stars
            </p>
          )}
          {ratingLoading && (
            <p className="text-xs text-muted-foreground mt-1">Saving...</p>
          )}
        </div>
      )}

      {/* Version history */}
      {versions.length > 1 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Version History</h3>
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  v{v.version}
                </span>
                {v.description && (
                  <span className="text-muted-foreground">{v.description}</span>
                )}
                <span className="text-xs text-muted-foreground/60">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Back button */}
      <div className="pt-2">
        <Button variant="outline" size="sm" onClick={() => router.push("/marketplace")}>
          <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Marketplace
        </Button>
      </div>
    </div>
  );
}
