"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface ExperimentCardProps {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  baselineVersion: number;
  challengerVersion: number;
  winnerVersion: number | null;
  winMetric: string | null;
  createdAt: string;
  promptEventKey: string | null;
}

function statusBadgeVariant(status: string | null): "default" | "secondary" | "warning" | "success" | "error" {
  switch (status) {
    case "draft":
      return "secondary";
    case "running":
      return "success";
    case "paused":
      return "warning";
    case "completed":
      return "default";
    default:
      return "secondary";
  }
}

export function ExperimentCard({
  id,
  name,
  description,
  status,
  baselineVersion,
  challengerVersion,
  winnerVersion,
  winMetric,
  createdAt,
  promptEventKey,
}: ExperimentCardProps) {
  const formattedDate = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link href={`/experiments/${id}`}>
      <Card variant="interactive" className="h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{name}</h3>
            <Badge variant={statusBadgeVariant(status)} className="shrink-0 text-[10px]">
              {status ?? "draft"}
            </Badge>
          </div>

          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              v{baselineVersion} vs v{challengerVersion}
            </span>
            <span className="inline-flex items-center gap-1">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {winMetric ?? "quality_score"}
            </span>
          </div>

          {winnerVersion != null && (
            <div className="text-xs font-medium text-chart-2">
              Winner: v{winnerVersion}
            </div>
          )}

          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{promptEventKey ?? "Prompt"}</span>
            <span>{formattedDate}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
