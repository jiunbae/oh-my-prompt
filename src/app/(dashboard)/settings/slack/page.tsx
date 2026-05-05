"use client";

import { useState, useEffect, useCallback } from "react";
import { useTeam } from "@/contexts/team-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";

interface SlackWebhook {
  id: string;
  webhookUrl: string;
  channel: string | null;
  events: string[];
  isActive: boolean;
  teamId: string | null;
  createdAt: string;
}

const AVAILABLE_EVENTS = [
  { value: "daily_summary", label: "Daily Summary" },
  { value: "new_prompt", label: "New Prompt Alert" },
] as const;

export default function SlackSettingsPage() {
  const { teams, selectedTeamId, isTeamContext } = useTeam();
  const [webhooks, setWebhooks] = useState<SlackWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createUrl, setCreateUrl] = useState("");
  const [createChannel, setCreateChannel] = useState("");
  const [createEvents, setCreateEvents] = useState<string[]>(["daily_summary"]);
  const [createTeamId, setCreateTeamId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; statusCode: number | null; error: string | null } | null>(null);

  const fetchWebhooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/slack/webhooks");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch Slack webhooks");
      }
      const data = await res.json();
      setWebhooks(data.webhooks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Slack webhooks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  // When team context changes, update createTeamId default
  useEffect(() => {
    setCreateTeamId(selectedTeamId);
  }, [selectedTeamId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/slack/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: createUrl,
          channel: createChannel || undefined,
          events: createEvents,
          teamId: createTeamId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create webhook");
      }
      setShowCreateForm(false);
      setCreateUrl("");
      setCreateChannel("");
      setCreateEvents(["daily_summary"]);
      await fetchWebhooks();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmTarget(id);
    setConfirmOpen(true);
  };

  const executeDelete = async () => {
    if (!confirmTarget) return;
    const id = confirmTarget;
    setConfirmOpen(false);
    setConfirmTarget(null);
    try {
      const res = await fetch(`/api/slack/webhooks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete webhook");
      }
      await fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete webhook");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/slack/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult({ id, success: data.success, statusCode: data.statusCode, error: data.error });
    } catch {
      setTestResult({ id, success: false, statusCode: null, error: "Request failed" });
    } finally {
      setTestingId(null);
    }
  };

  const toggleEvent = (event: string, current: string[], setter: (events: string[]) => void) => {
    if (current.includes(event)) {
      if (current.length > 1) {
        setter(current.filter((e) => e !== event));
      }
    } else {
      setter([...current, event]);
    }
  };

  const getTeamName = (teamId: string | null) => {
    if (!teamId) return "Personal";
    const team = teams.find((t) => t.id === teamId);
    return team?.name ?? "Team";
  };

  // Filter webhooks based on team context
  const visibleWebhooks = webhooks.filter((w) => {
    if (isTeamContext) {
      return w.teamId === selectedTeamId;
    }
    return w.teamId === null;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Slack Integration</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Slack webhooks to receive daily summaries and real-time alerts
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? "Cancel" : "Add Webhook"}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add Slack Webhook</CardTitle>
            <CardDescription>
              Enter your Slack incoming webhook URL to get started
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Webhook URL
                </label>
                <Input
                  type="url"
                  value={createUrl}
                  onChange={(e) => setCreateUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Must start with https://hooks.slack.com/services/
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Channel (optional)
                </label>
                <Input
                  value={createChannel}
                  onChange={(e) => setCreateChannel(e.target.value)}
                  placeholder="#prompt-alerts"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Events
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_EVENTS.map(({ value, label }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={createEvents.includes(value)}
                        onChange={() =>
                          toggleEvent(value, createEvents, setCreateEvents)
                        }
                        className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                      />
                      <span className="text-sm text-secondary-foreground">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {teams.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-secondary-foreground">
                    Context
                  </label>
                  <select
                    value={createTeamId ?? ""}
                    onChange={(e) => setCreateTeamId(e.target.value || null)}
                    className="flex h-10 w-full max-w-xs rounded-md border border-border bg-input-bg px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Personal</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {createError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                  {createError}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={creating}>
                  {creating ? "Adding..." : "Add Webhook"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Webhooks List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-32 bg-skeleton rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : visibleWebhooks.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No Slack webhooks configured for {isTeamContext ? "this team" : "your personal workspace"} yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleWebhooks.map((webhook) => (
            <Card key={webhook.id}>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-base font-semibold text-foreground">
                        Slack Webhook
                      </h3>
                      {webhook.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="error">Disabled</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground font-mono break-all">
                      {webhook.webhookUrl.slice(0, 60)}...
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {webhook.events.map((event) => (
                    <Badge key={event} variant="secondary">
                      {event}
                    </Badge>
                  ))}
                  {webhook.channel && (
                    <Badge variant="outline">{webhook.channel}</Badge>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  <span>Context: {getTeamName(webhook.teamId)}</span>
                </div>

                {/* Test result */}
                {testResult && testResult.id === webhook.id && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      testResult.success
                        ? "bg-chart-2/10 border border-chart-2/20 text-chart-2"
                        : "bg-destructive/10 border border-destructive/20 text-destructive"
                    }`}
                  >
                    {testResult.success
                      ? `Test successful - Status: ${testResult.statusCode}`
                      : `Test failed: ${testResult.error ?? "Unknown error"}`}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(webhook.id)}
                    disabled={testingId === webhook.id}
                  >
                    {testingId === webhook.id ? "Testing..." : "Test"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(webhook.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null); }}
        onConfirm={executeDelete}
        title="Delete Slack webhook"
        description="Are you sure you want to delete this Slack webhook?"
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
