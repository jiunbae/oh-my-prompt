"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";

interface Integration {
  id: string;
  userId: string;
  teamId: string | null;
  name: string;
  provider: string;
  webhookUrl: string;
  secret: boolean;
  events: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface DeliveryLog {
  id: string;
  eventType: string;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  deliveredAt: string;
}

const AVAILABLE_EVENTS = [
  { value: "prompt.created", label: "Prompt Created" },
  { value: "prompt.favorited", label: "Prompt Favorited" },
  { value: "prompt.deleted", label: "Prompt Deleted" },
  { value: "prompt.updated", label: "Prompt Updated" },
  { value: "session.started", label: "Session Started" },
] as const;

const PROVIDER_OPTIONS = [
  { value: "zapier", label: "Zapier" },
  { value: "make", label: "Make.com" },
  { value: "custom", label: "Custom" },
] as const;

function getProviderBadge(provider: string) {
  switch (provider) {
    case "zapier":
      return <Badge variant="info">Zapier</Badge>;
    case "make":
      return <Badge variant="warning">Make.com</Badge>;
    default:
      return <Badge variant="secondary">Custom</Badge>;
  }
}

function getStatusBadge(integration: Integration) {
  if (!integration.isActive) {
    return <Badge variant="error">Disabled</Badge>;
  }
  return <Badge variant="success">Active</Badge>;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

export default function IntegrationsSettingsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createProvider, setCreateProvider] = useState("zapier");
  const [createWebhookUrl, setCreateWebhookUrl] = useState("");
  const [createSecret, setCreateSecret] = useState("");
  const [createEvents, setCreateEvents] = useState<string[]>(["prompt.created"]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWebhookUrl, setEditWebhookUrl] = useState("");
  const [editSecret, setEditSecret] = useState("");
  const [editClearSecret, setEditClearSecret] = useState(false);
  const [editEvents, setEditEvents] = useState<string[]>([]);
  const [editIsActive, setEditIsActive] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Logs state
  const [logsIntegrationId, setLogsIntegrationId] = useState<string | null>(null);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    success: boolean;
    statusCode: number | null;
    responseBody: string | null;
    error?: string;
  } | null>(null);

  // Zapier help toggle
  const [showZapierHelp, setShowZapierHelp] = useState(false);

  const fetchIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/integrations");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch integrations");
      }
      const data = await res.json();
      setIntegrations(data.integrations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          provider: createProvider,
          webhookUrl: createWebhookUrl,
          secret: createSecret || undefined,
          events: createEvents,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create integration");
      }
      setShowCreateForm(false);
      setCreateName("");
      setCreateProvider("zapier");
      setCreateWebhookUrl("");
      setCreateSecret("");
      setCreateEvents(["prompt.created"]);
      await fetchIntegrations();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create integration");
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string) => {
    setUpdating(true);
    try {
      const payload: Record<string, unknown> = {
        name: editName,
        webhookUrl: editWebhookUrl,
        events: editEvents,
        isActive: editIsActive,
      };

      if (editClearSecret) {
        payload.clearSecret = true;
      } else if (editSecret) {
        payload.secret = editSecret;
      }

      const res = await fetch(`/api/integrations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update integration");
      }
      setEditingId(null);
      await fetchIntegrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update integration");
    } finally {
      setUpdating(false);
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
      const res = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete integration");
      }
      await fetchIntegrations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete integration");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult({ id, ...data });
    } catch {
      setTestResult({ id, success: false, statusCode: null, responseBody: null, error: "Request failed" });
    } finally {
      setTestingId(null);
    }
  };

  const handleViewLogs = async (integrationId: string) => {
    if (logsIntegrationId === integrationId) {
      setLogsIntegrationId(null);
      setLogs([]);
      return;
    }
    setLogsIntegrationId(integrationId);
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/logs?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
      }
    } catch {
      // Silently fail for logs
    } finally {
      setLoadingLogs(false);
    }
  };

  const startEdit = (integration: Integration) => {
    setEditingId(integration.id);
    setEditName(integration.name);
    setEditWebhookUrl(integration.webhookUrl);
    setEditSecret("");
    setEditClearSecret(false);
    setEditEvents(integration.events);
    setEditIsActive(integration.isActive);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Outgoing Integrations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect oh-my-prompt to Zapier, Make.com, or custom webhook endpoints
          </p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? "Cancel" : "Add Integration"}
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

      {/* Zapier Help Panel */}
      {showZapierHelp && (
        <Card>
          <CardHeader>
            <CardTitle>How to Create a Zapier Webhook</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal list-inside space-y-2 text-sm text-secondary-foreground">
              <li>Go to <a href="https://zapier.com/app/zaps" target="_blank" rel="noopener noreferrer" className="text-primary underline">Zapier</a> and click &quot;Create Zap&quot;</li>
              <li>For the trigger, search for &quot;Webhooks by Zapier&quot;</li>
              <li>Select &quot;Catch Hook&quot; as the trigger event</li>
              <li>Copy the webhook URL Zapier provides</li>
              <li>Paste it into the Webhook URL field above</li>
              <li>Choose the events you want to send (e.g., Prompt Created)</li>
              <li>Test the trigger in Zapier, then send a test from oh-my-prompt</li>
              <li>In Zapier, you&apos;ll see the sample payload to configure your action steps</li>
            </ol>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setShowZapierHelp(false)}
            >
              Hide Instructions
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create Integration</CardTitle>
            <CardDescription>
              Add a new outgoing integration webhook
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Name
                </label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="My Zapier Integration"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Provider
                </label>
                <select
                  value={createProvider}
                  onChange={(e) => setCreateProvider(e.target.value)}
                  className="w-full h-10 rounded-md border border-border bg-input-bg px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {PROVIDER_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Webhook URL
                </label>
                <Input
                  type="url"
                  value={createWebhookUrl}
                  onChange={(e) => setCreateWebhookUrl(e.target.value)}
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  required
                />
                {createProvider === "zapier" && (
                  <button
                    type="button"
                    onClick={() => setShowZapierHelp(true)}
                    className="text-xs text-primary underline"
                  >
                    How to create a Zapier webhook
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-secondary-foreground">
                  Secret (optional)
                </label>
                <Input
                  type="password"
                  value={createSecret}
                  onChange={(e) => setCreateSecret(e.target.value)}
                  placeholder="HMAC signing secret"
                />
                <p className="text-xs text-muted-foreground">
                  Used to sign payloads with HMAC-SHA256. The signature is sent in the X-Hub-Signature header.
                </p>
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

              {createError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                  {createError}
                </div>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create Integration"}
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

      {/* Integrations List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-32 bg-skeleton rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : integrations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No integrations configured yet. Add one to get started.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setShowZapierHelp(true)}
            >
              How to create a Zapier webhook
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {integrations.map((integration) => (
            <Card key={integration.id}>
              <CardContent className="p-6">
                {editingId === integration.id ? (
                  /* Edit Mode */
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        Name
                      </label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        Webhook URL
                      </label>
                      <Input
                        type="url"
                        value={editWebhookUrl}
                        onChange={(e) => setEditWebhookUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-secondary-foreground">
                        Secret (leave empty to keep current)
                      </label>
                      <Input
                        type="password"
                        value={editSecret}
                        onChange={(e) => setEditSecret(e.target.value)}
                        placeholder="Leave empty to keep current secret"
                        disabled={editClearSecret}
                      />
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editClearSecret}
                          onChange={(e) => {
                            setEditClearSecret(e.target.checked);
                            if (e.target.checked) setEditSecret("");
                          }}
                          className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">
                          Clear secret (disable HMAC signing)
                        </span>
                      </label>
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
                              checked={editEvents.includes(value)}
                              onChange={() =>
                                toggleEvent(value, editEvents, setEditEvents)
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
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editIsActive}
                          onChange={(e) => setEditIsActive(e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
                        />
                        <span className="text-sm font-medium text-secondary-foreground">
                          Active
                        </span>
                      </label>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleUpdate(integration.id)}
                        disabled={updating}
                      >
                        {updating ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* View Mode */
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-semibold text-foreground">
                            {integration.name}
                          </h3>
                          {getProviderBadge(integration.provider)}
                          {getStatusBadge(integration)}
                        </div>
                        <p className="text-sm text-muted-foreground font-mono break-all">
                          {integration.webhookUrl}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {integration.events.map((event) => (
                        <Badge key={event} variant="secondary">
                          {event}
                        </Badge>
                      ))}
                      {integration.secret && (
                        <Badge variant="outline">Signed</Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        Last triggered: {formatRelativeTime(integration.lastTriggeredAt)}
                      </span>
                    </div>

                    {/* Test result */}
                    {testResult && testResult.id === integration.id && (
                      <div
                        className={`p-3 rounded-lg text-sm ${
                          testResult.success
                            ? "bg-chart-2/10 border border-chart-2/20 text-chart-2"
                            : "bg-destructive/10 border border-destructive/20 text-destructive"
                        }`}
                      >
                        {testResult.success
                          ? `Test successful - Status: ${testResult.statusCode}`
                          : `Test failed${testResult.statusCode ? ` - Status: ${testResult.statusCode}` : ""}: ${testResult.error}`}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => startEdit(integration)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(integration.id)}
                        disabled={testingId === integration.id}
                      >
                        {testingId === integration.id ? "Testing..." : "Test"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewLogs(integration.id)}
                      >
                        {logsIntegrationId === integration.id ? "Hide Logs" : "View Logs"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(integration.id)}
                      >
                        Delete
                      </Button>
                    </div>

                    {/* Logs panel */}
                    {logsIntegrationId === integration.id && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-sm font-medium text-secondary-foreground">
                          Recent Deliveries
                        </h4>
                        {loadingLogs ? (
                          <div className="h-20 bg-skeleton rounded animate-pulse" />
                        ) : logs.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-4 text-center">
                            No delivery logs yet
                          </p>
                        ) : (
                          <div className="border border-border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="bg-surface border-b border-border">
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Event
                                  </th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Status
                                  </th>
                                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                                    Time
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {logs.map((log) => (
                                  <tr
                                    key={log.id}
                                    className="border-b border-border last:border-0"
                                  >
                                    <td className="px-3 py-2 text-foreground">
                                      {log.eventType}
                                    </td>
                                    <td className="px-3 py-2">
                                      {log.responseStatus !== null ? (
                                        <span
                                          className={
                                            log.responseStatus >= 200 &&
                                            log.responseStatus < 300
                                              ? "text-chart-2"
                                              : "text-destructive"
                                          }
                                        >
                                          {log.responseStatus}
                                        </span>
                                      ) : log.errorMessage ? (
                                        <span className="text-destructive">
                                          Error
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">
                                          -
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-muted-foreground">
                                      {formatRelativeTime(log.deliveredAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null); }}
        onConfirm={executeDelete}
        title="Delete integration"
        description="Are you sure you want to delete this integration?"
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
