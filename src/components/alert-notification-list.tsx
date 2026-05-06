"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Notification {
  id: string;
  alertRuleId: string;
  triggeredAt: string;
  metricValue: string | null;
  threshold: string | null;
  message: string | null;
  channelsSent: string[] | null;
  acknowledgedAt: string | null;
  ruleName: string;
}

export function AlertNotificationList() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/alerts/notifications?unreadOnly=${unreadOnly}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch notifications");
      }
      const data = await res.json();
      setNotifications(data.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch notifications");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  async function acknowledge(id: string) {
    try {
      const res = await fetch(`/api/alerts/notifications/${id}/acknowledge`, { method: "POST" });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, acknowledgedAt: new Date().toISOString() } : n))
        );
      }
    } catch {
      // Silently fail
    }
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Notification History</h2>
          <p className="text-sm text-muted-foreground">
            Recent alert notifications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-input-bg text-primary focus:ring-ring"
            />
            <span className="text-sm text-secondary-foreground">Unread only</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-skeleton rounded-lg animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No notifications to display.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card key={n.id} className={n.acknowledgedAt ? "opacity-60" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{n.ruleName}</h3>
                      {!n.acknowledgedAt && (
                        <Badge variant="info" className="text-[10px] px-1.5 py-0">New</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{n.message}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/60">
                      <span>{formatDate(n.triggeredAt)}</span>
                      {n.metricValue && (
                        <span>Value: {n.metricValue}</span>
                      )}
                      {n.channelsSent && n.channelsSent.length > 0 && (
                        <span>Sent via: {n.channelsSent.join(", ")}</span>
                      )}
                    </div>
                  </div>
                  {!n.acknowledgedAt && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => acknowledge(n.id)}
                      className="shrink-0 text-xs"
                    >
                      Acknowledge
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
