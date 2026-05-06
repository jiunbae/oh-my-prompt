"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AlertRuleFormProps {
  initialData?: {
    name: string;
    description?: string;
    metric: string;
    condition: string;
    threshold: string;
    comparisonPeriod: string;
    notificationChannels: string[];
    teamId?: string | null;
  };
  teams: Array<{ id: string; name: string }>;
  onSubmit: (data: {
    name: string;
    description?: string;
    metric: string;
    condition: string;
    threshold: number;
    comparisonPeriod: string;
    notificationChannels: string[];
    teamId?: string | null;
  }) => void;
  onCancel: () => void;
  onTest?: (data: {
    name: string;
    description?: string;
    metric: string;
    condition: string;
    threshold: number;
    comparisonPeriod: string;
    notificationChannels: string[];
  }) => void;
  loading?: boolean;
}

const METRICS = [
  { value: "daily_prompt_count", label: "Daily Prompt Count", unit: "prompts" },
  { value: "avg_quality", label: "Average Quality Score", unit: "score" },
  { value: "token_usage", label: "Token Usage", unit: "tokens" },
  { value: "session_count", label: "Session Count", unit: "sessions" },
  { value: "project_activity", label: "Project Activity", unit: "prompts" },
];

const CONDITIONS = [
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
  { value: "equals", label: "Equals" },
  { value: "changes_by", label: "Changes by" },
];

const PERIODS = [
  { value: "1_hour", label: "Last hour" },
  { value: "1_day", label: "Last 24 hours" },
  { value: "7_days", label: "Last 7 days" },
  { value: "30_days", label: "Last 30 days" },
];

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "in_app", label: "In-app" },
];

export function AlertRuleForm({
  initialData,
  teams,
  onSubmit,
  onCancel,
  onTest,
  loading = false,
}: AlertRuleFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [metric, setMetric] = useState(initialData?.metric ?? "daily_prompt_count");
  const [condition, setCondition] = useState(initialData?.condition ?? "above");
  const [threshold, setThreshold] = useState(initialData?.threshold ?? "");
  const [comparisonPeriod, setComparisonPeriod] = useState(initialData?.comparisonPeriod ?? "1_day");
  const [notificationChannels, setNotificationChannels] = useState<string[]>(
    initialData?.notificationChannels ?? ["in_app"]
  );
  const [teamId, setTeamId] = useState<string | null>(initialData?.teamId ?? null);

  const selectedMetric = METRICS.find((m) => m.value === metric);

  function getPreviewMessage(): string {
    const metricLabel = selectedMetric?.label ?? "Metric";
    const condLabel = CONDITIONS.find((c) => c.value === condition)?.label ?? condition;
    return `Alert: ${metricLabel} (X) is ${condLabel.toLowerCase()} threshold (${threshold || 0})`;
  }

  function toggleChannel(value: string) {
    setNotificationChannels((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      description,
      metric,
      condition,
      threshold: Number(threshold),
      comparisonPeriod,
      notificationChannels,
      teamId,
    });
  }

  function handleTest() {
    if (!onTest) return;
    onTest({
      name,
      description,
      metric,
      condition,
      threshold: Number(threshold),
      comparisonPeriod,
      notificationChannels,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData ? "Edit Alert Rule" : "New Alert Rule"}</CardTitle>
        <CardDescription>
          Define a metric threshold and how you want to be notified
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-secondary-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Low daily prompt count"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-secondary-foreground">Description (optional)</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>

          {/* Metric */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-secondary-foreground">Metric</label>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Condition & Threshold */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">Condition</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">
                Threshold ({selectedMetric?.unit})
              </label>
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="5"
                required
              />
            </div>
          </div>

          {/* Comparison Period */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-secondary-foreground">Comparison Period</label>
            <select
              value={comparisonPeriod}
              onChange={(e) => setComparisonPeriod(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Notification Channels */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-secondary-foreground">Notify via</label>
            <div className="flex flex-wrap gap-3">
              {CHANNELS.map((ch) => (
                <label key={ch.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notificationChannels.includes(ch.value)}
                    onChange={() => toggleChannel(ch.value)}
                    className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                  />
                  <span className="text-sm text-secondary-foreground">{ch.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Team Context */}
          {teams.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-secondary-foreground">Context</label>
              <select
                value={teamId ?? ""}
                onChange={(e) => setTeamId(e.target.value || null)}
                className="flex h-10 w-full rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Personal</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Live Preview */}
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60 mb-2">
              Preview
            </p>
            <p className="text-sm text-secondary-foreground">{getPreviewMessage()}</p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : initialData ? "Update Rule" : "Create Rule"}
            </Button>
            {onTest && (
              <Button type="button" variant="outline" onClick={handleTest} disabled={loading || !threshold}>
                Test Alert
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
