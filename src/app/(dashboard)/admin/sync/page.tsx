"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/user-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface SyncSettings {
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
}

interface SyncLogEntry {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  filesProcessed: number;
  filesAdded: number;
  filesSkipped: number;
  errorMessage: string | null;
  syncType: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

const INTERVAL_OPTIONS = [
  { value: 5, label: "5 minutes" },
  { value: 10, label: "10 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
];

export default function AdminSyncPage() {
  const { user, loading: userLoading } = useUser();
  const router = useRouter();

  const [settings, setSettings] = useState<SyncSettings>({
    autoSyncEnabled: false,
    syncIntervalMinutes: 10,
  });
  const [originalSettings, setOriginalSettings] = useState<SyncSettings>({
    autoSyncEnabled: false,
    syncIntervalMinutes: 10,
  });
  const [syncLogs, setSyncLogs] = useState<SyncLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/sync-settings");

      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setOriginalSettings(data);
      } else if (res.status === 403) {
        router.push("/prompts");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to fetch sync settings");
      }
    } catch {
      setError("Failed to fetch sync settings");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchSyncLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sync-history");
      if (res.ok) {
        const data = await res.json();
        setSyncLogs(data.logs || []);
      }
    } catch {
      // Silently fail for sync logs
    }
  }, []);

  useEffect(() => {
    if (!userLoading) {
      if (!user?.isAdmin) {
        router.push("/prompts");
      } else {
        fetchSettings();
        fetchSyncLogs();
      }
    }
  }, [user, userLoading, router, fetchSettings, fetchSyncLogs]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/admin/sync-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setOriginalSettings(data);
        setSuccessMessage("Settings saved successfully");
        setTimeout(() => setSuccessMessage(""), 3000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save settings");
      }
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    settings.autoSyncEnabled !== originalSettings.autoSyncEnabled ||
    settings.syncIntervalMinutes !== originalSettings.syncIntervalMinutes;

  const calculateNextRun = () => {
    if (!settings.autoSyncEnabled) return null;
    const now = new Date();
    const nextRun = new Date(
      now.getTime() + settings.syncIntervalMinutes * 60 * 1000
    );
    return nextRun.toLocaleString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: "bg-green-900/50 text-green-400 border-green-700",
      running: "bg-blue-900/50 text-blue-400 border-blue-700",
      failed: "bg-red-900/50 text-red-400 border-red-700",
    };
    return styles[status] || "bg-zinc-800 text-zinc-400 border-zinc-700";
  };

  if (userLoading || !user?.isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Sync Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Configure automatic data synchronization
        </p>
      </div>

      {/* Auto-Sync Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Auto-Sync</CardTitle>
          <CardDescription>
            Configure automatic synchronization from MinIO storage
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* Enable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    Enable automatic sync
                  </p>
                  <p className="text-xs text-zinc-500">
                    Automatically sync prompt data at regular intervals
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoSyncEnabled}
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      autoSyncEnabled: !prev.autoSyncEnabled,
                    }))
                  }
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full
                    transition-colors duration-200 ease-in-out
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900
                    ${settings.autoSyncEnabled ? "bg-blue-600" : "bg-zinc-700"}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white
                      transition-transform duration-200 ease-in-out
                      ${settings.autoSyncEnabled ? "translate-x-6" : "translate-x-1"}
                    `}
                  />
                </button>
              </div>

              {/* Interval Dropdown */}
              <div className="space-y-2">
                <label
                  htmlFor="sync-interval"
                  className="text-sm font-medium text-zinc-100"
                >
                  Sync every
                </label>
                <select
                  id="sync-interval"
                  value={settings.syncIntervalMinutes}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      syncIntervalMinutes: parseInt(e.target.value, 10),
                    }))
                  }
                  disabled={!settings.autoSyncEnabled}
                  className={`
                    w-full max-w-xs rounded-md border border-zinc-700 bg-zinc-800
                    px-3 py-2 text-sm text-zinc-100
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  {INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Save Button */}
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                >
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
                {successMessage && (
                  <p className="text-sm text-green-400">{successMessage}</p>
                )}
                {error && <p className="text-sm text-red-400">{error}</p>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Implementation Note Card */}
      <Card>
        <CardHeader>
          <CardTitle>Implementation Note</CardTitle>
          <CardDescription>
            How automatic sync is executed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <p className="text-zinc-400">
              Auto-sync runs via Kubernetes CronJob. Changes here update the
              cron schedule.
            </p>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-zinc-500">CronJob status:</span>
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    settings.autoSyncEnabled ? "text-green-400" : "text-zinc-500"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      settings.autoSyncEnabled ? "bg-green-500" : "bg-zinc-600"
                    }`}
                  />
                  {settings.autoSyncEnabled ? "Active" : "Disabled"}
                </span>
              </div>
              {settings.autoSyncEnabled && calculateNextRun() && (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Next run:</span>
                  <span className="text-zinc-300">{calculateNextRun()}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Global Sync History Card */}
      <Card>
        <CardHeader>
          <CardTitle>Global Sync History</CardTitle>
          <CardDescription>
            Recent synchronization activity across all users
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncLogs.length === 0 ? (
            <p className="text-zinc-400 text-center py-8">
              No sync history available yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-3 px-2 text-zinc-400 font-medium">
                      Started
                    </th>
                    <th className="text-left py-3 px-2 text-zinc-400 font-medium">
                      User
                    </th>
                    <th className="text-left py-3 px-2 text-zinc-400 font-medium">
                      Type
                    </th>
                    <th className="text-left py-3 px-2 text-zinc-400 font-medium">
                      Status
                    </th>
                    <th className="text-right py-3 px-2 text-zinc-400 font-medium">
                      Processed
                    </th>
                    <th className="text-right py-3 px-2 text-zinc-400 font-medium">
                      Added
                    </th>
                    <th className="text-right py-3 px-2 text-zinc-400 font-medium">
                      Skipped
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {syncLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-zinc-800/50">
                      <td className="py-3 px-2 text-zinc-300">
                        {formatDate(log.startedAt)}
                      </td>
                      <td className="py-3 px-2 text-zinc-300">
                        {log.user?.name || log.user?.email || "System"}
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-zinc-400 capitalize">
                          {log.syncType || "manual"}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${getStatusBadge(
                            log.status
                          )}`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right text-zinc-300">
                        {log.filesProcessed}
                      </td>
                      <td className="py-3 px-2 text-right text-zinc-300">
                        {log.filesAdded}
                      </td>
                      <td className="py-3 px-2 text-right text-zinc-300">
                        {log.filesSkipped}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
