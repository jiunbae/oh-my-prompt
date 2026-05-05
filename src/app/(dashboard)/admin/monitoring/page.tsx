"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MonitoringData {
  rateLimits?: {
    redis: string;
    presets: Array<{ name: string; maxRequests: number; windowMs: number }>;
  };
  webhooks?: {
    total: number;
    active: number;
    inactive: number;
    recentFailures: Array<{ id: string; name: string; failCount: number; lastStatus: number | null }>;
    pendingRetries: number;
  };
  system?: {
    database: string;
    redis: string;
    uptime: number;
    memory: { heapUsed: number; heapTotal: number };
  };
  sync?: {
    users: number;
    prompts: number;
    recentActivity: Array<{ id: string; email: string; lastLoginAt: string | null }>;
  };
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "connected" ? "bg-green-500" :
    status === "watching" ? "bg-green-500" :
    status === "error" || status === "disconnected" ? "bg-red-500" :
    "bg-yellow-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function AdminMonitoringPage() {
  const [data, setData] = useState<MonitoringData>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [rateLimits, webhooks, system, sync] = await Promise.all([
          fetch("/api/admin/monitoring/rate-limits").then((r) => r.ok ? r.json() : null),
          fetch("/api/admin/monitoring/webhooks").then((r) => r.ok ? r.json() : null),
          fetch("/api/admin/monitoring/system").then((r) => r.ok ? r.json() : null),
          fetch("/api/admin/monitoring/sync").then((r) => r.ok ? r.json() : null),
        ]);
        setData({ rateLimits, webhooks, system, sync });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Monitoring</h1>
        <p className="text-sm text-muted-foreground mt-1">System health and operational metrics.</p>
      </div>

      {/* System Health */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Database</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusBadge status={data.system?.database || "unknown"} />
              <span className="text-sm">{data.system?.database || "unknown"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Redis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <StatusBadge status={data.system?.redis || "unknown"} />
              <span className="text-sm">{data.system?.redis || "unknown"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {data.system?.uptime ? `${Math.floor(data.system.uptime / 60)}m` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rate Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Rate Limits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            {data.rateLimits?.presets?.map((preset) => (
              <div key={preset.name} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground uppercase">{preset.name}</p>
                <p className="text-lg font-semibold mt-1">
                  {preset.maxRequests}<span className="text-xs text-muted-foreground">/min</span>
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Webhooks */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{data.webhooks?.total ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-lg font-semibold text-green-600">{data.webhooks?.active ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inactive</p>
              <p className="text-lg font-semibold text-red-600">{data.webhooks?.inactive ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pending Retries</p>
              <p className="text-lg font-semibold">{data.webhooks?.pendingRetries ?? 0}</p>
            </div>
          </div>
          {(data.webhooks?.recentFailures?.length ?? 0) > 0 && (
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Recent Failures</p>
              <div className="space-y-1">
                {(data.webhooks?.recentFailures ?? []).map((w) => (
                  <div key={w.id} className="flex items-center gap-2 text-sm">
                    <span className="truncate">{w.name}</span>
                    <Badge variant="error" className="text-xs">{w.failCount} fails</Badge>
                    {w.lastStatus && <span className="text-xs text-muted-foreground">HTTP {w.lastStatus}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Sync Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-muted-foreground">Total Users</p>
              <p className="text-lg font-semibold">{data.sync?.users ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Prompts</p>
              <p className="text-lg font-semibold">{data.sync?.prompts ?? 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
