"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { TeamActivityFeed } from "@/components/team-activity-feed";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function TeamActivityPage() {
  const params = useParams();
  const { id } = params as { id: string };

  return (
    <div className="space-y-6">
      {/* Header with back link */}
      <div className="flex items-center gap-3">
        <Link
          href={`/teams/${id}`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to team
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">Activity</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time feed of prompts created by team members
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live Activity Feed</CardTitle>
          <CardDescription>
            New prompts appear automatically as team members create them
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeamActivityFeed teamId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
