"use client";

import { useState, useEffect, useCallback } from "react";
import { useTeam } from "@/contexts/team-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { AlertRuleForm } from "@/components/alert-rule-form";
import { AlertNotificationList } from "@/components/alert-notification-list";

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  metric: string;
  condition: string;
  threshold: string;
  comparisonPeriod: string;
  notificationChannels: string[];
  isActive: boolean;
  lastTriggeredAt: string | null;
  cooldownMinutes: number;
  teamId: string | null;
  createdAt: string;
}

const METRIC_LABELS: Record<string, string> = {
  daily_prompt_count: "Prompt Count",
  avg_quality: "Avg Quality",
  token_usage: "Token Usage",
  session_count: "Sessions",
  project_activity: "Project Activity",
};

const CONDITION_LABELS: Record<string, string> = {
  above: ">",
  below: "<",
  equals: "=",
  changes_by: "+/-",
};

export default function AlertsPage() {
  const { teams, selectedTeamId, isTeamContext } = useTeam();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ id: string; message: string; success: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<"rules" | "notifications">("rules");

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/alerts");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch alert rules");
      }
      const data = await res.json();
      setRules(data.rules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch alert rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const visibleRules = rules.filter((r) => {
    if (isTeamContext) {
      return r.teamId === selectedTeamId;
    }
    return r.teamId === null;
  });

  async function handleCreate(data: {
    name: string;
    description?: string;
    metric: string;
    condition: string;
    threshold: number;
    comparisonPeriod: string;
    notificationChannels: string[];
    teamId?: string | null;
  }) {
    setFormLoading(true);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create alert rule");
      }
      setShowForm(false);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert rule");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleUpdate(data: {
    name: string;
    description?: string;
    metric: string;
    condition: string;
    threshold: number;
    comparisonPeriod: string;
    notificationChannels: string[];
    teamId?: string | null;
  }) {
    if (!editingRule) return;
    setFormLoading(true);
    try {
      const res = await fetch(`/api/alerts/${editingRule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update alert rule");
      }
      setEditingRule(null);
      setShowForm(false);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alert rule");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setConfirmTarget(id);
    setConfirmOpen(true);
  }

  async function executeDelete() {
    if (!confirmTarget) return;
    const id = confirmTarget;
    setConfirmOpen(false);
    setConfirmTarget(null);
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete alert rule");
      }
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alert rule");
    }
  }

  async function handleToggleActive(rule: AlertRule) {
    try {
      const res = await fetch(`/api/alerts/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update alert rule");
      }
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update alert rule");
    }
  }

  async function handleTest(ruleId: string) {
    setTestResult(null);
    try {
      const res = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId }),
      });
      const data = await res.json();
      setTestResult({
        id: ruleId,
        message: data.message || data.error || "Test complete",
        success: data.triggered ?? false,
      });
      // Clear test result after 5 seconds
      setTimeout(() => setTestResult((prev) => (prev?.id === ruleId ? null : prev)), 5000);
    } catch {
      setTestResult({ id: ruleId, message: "Test request failed", success: false });
    }
  }

  async function handleTestDraft(data: {
    name: string;
    description?: string;
    metric: string;
    condition: string;
    threshold: number;
    comparisonPeriod: string;
    notificationChannels: string[];
  }) {
    setTestResult(null);
    try {
      const res = await fetch("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const responseData = await res.json();
      setTestResult({
        id: "draft",
        message: responseData.message || responseData.error || "Test complete",
        success: responseData.triggered ?? false,
      });
      setTimeout(() => setTestResult((prev) => (prev?.id === "draft" ? null : prev)), 5000);
    } catch {
      setTestResult({ id: "draft", message: "Test request failed", success: false });
    }
  }

  const getTeamName = (teamId: string | null) => {
    if (!teamId) return "Personal";
    const team = teams.find((t) => t.id === teamId);
    return team?.name ?? "Team";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Alerts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define custom thresholds for prompt metrics and get notified
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingRule(null); setShowForm(true); }}>
            New Alert
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        <button
          onClick={() => setActiveTab("rules")}
          className={`pb-2 text-sm font-medium transition-colors ${
            activeTab === "rules"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Rules
        </button>
        <button
          onClick={() => setActiveTab("notifications")}
          className={`pb-2 text-sm font-medium transition-colors ${
            activeTab === "notifications"
              ? "text-foreground border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Notifications
        </button>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {testResult && (
        <div
          className={`p-3 rounded-lg text-sm ${
            testResult.success
              ? "bg-chart-2/10 border border-chart-2/20 text-chart-2"
              : "bg-destructive/10 border border-destructive/20 text-destructive"
          }`}
        >
          {testResult.message}
        </div>
      )}

      {activeTab === "rules" && (
        <>
          {showForm && (
            <AlertRuleForm
              initialData={
                editingRule
                  ? {
                      name: editingRule.name,
                      description: editingRule.description ?? undefined,
                      metric: editingRule.metric,
                      condition: editingRule.condition,
                      threshold: editingRule.threshold,
                      comparisonPeriod: editingRule.comparisonPeriod ?? "1_day",
                      notificationChannels: editingRule.notificationChannels,
                      teamId: editingRule.teamId,
                    }
                  : undefined
              }
              teams={teams}
              onSubmit={editingRule ? handleUpdate : handleCreate}
              onCancel={() => { setShowForm(false); setEditingRule(null); }}
              onTest={handleTestDraft}
              loading={formLoading}
            />
          )}

          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-32 bg-skeleton rounded-lg animate-pulse" />
              ))}
            </div>
          ) : visibleRules.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  No alert rules configured for {isTeamContext ? "this team" : "your personal workspace"} yet.
                </p>
                {!showForm && (
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => { setEditingRule(null); setShowForm(true); }}
                  >
                    Create your first alert
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {visibleRules.map((rule) => (
                <Card key={rule.id}>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-semibold text-foreground">{rule.name}</h3>
                          {rule.isActive ? (
                            <Badge variant="success">Active</Badge>
                          ) : (
                            <Badge variant="error">Paused</Badge>
                          )}
                        </div>
                        {rule.description && (
                          <p className="text-sm text-muted-foreground">{rule.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{METRIC_LABELS[rule.metric] ?? rule.metric}</Badge>
                      <Badge variant="outline">
                        {CONDITION_LABELS[rule.condition] ?? rule.condition} {rule.threshold}
                      </Badge>
                      <Badge variant="outline">{rule.comparisonPeriod ?? "1_day"}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {rule.notificationChannels.map((ch) => (
                        <Badge key={ch} variant="info" className="text-[10px]">
                          {ch}
                        </Badge>
                      ))}
                    </div>

                    <div className="text-xs text-muted-foreground">
                      <span>Context: {getTeamName(rule.teamId)}</span>
                      {rule.lastTriggeredAt && (
                        <span className="ml-4">
                          Last triggered: {new Date(rule.lastTriggeredAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {testResult && testResult.id === rule.id && (
                      <div
                        className={`p-3 rounded-lg text-sm ${
                          testResult.success
                            ? "bg-chart-2/10 border border-chart-2/20 text-chart-2"
                            : "bg-destructive/10 border border-destructive/20 text-destructive"
                        }`}
                      >
                        {testResult.message}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleActive(rule)}
                      >
                        {rule.isActive ? "Pause" : "Activate"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setEditingRule(rule); setShowForm(true); }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTest(rule.id)}
                      >
                        Test
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(rule.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "notifications" && <AlertNotificationList />}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null); }}
        onConfirm={executeDelete}
        title="Delete alert rule"
        description="Are you sure you want to delete this alert rule? This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
      />
    </div>
  );
}
