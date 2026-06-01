"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Globe2,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DiagnosticStatus = "ok" | "warn" | "error";
type OverallStatus = "healthy" | "degraded" | "error";

interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  recommendation?: string;
}

interface DiagnosticsData {
  generatedAt: string;
  overall: OverallStatus;
  checks: DiagnosticCheck[];
  runtime: {
    nodeEnv: string;
    nodeVersion: string;
    uptimeSeconds: number;
    appTimeZone: string;
    processTimeZone: string | null;
    serverTime: string;
    serverTimeInAppZone: string | null;
    appDateKey: string;
    memoryMb: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  };
  database: {
    status: DiagnosticStatus;
    latencyMs: number | null;
    configured: boolean;
    error?: string;
  };
  redis: {
    status: DiagnosticStatus;
    clientStatus: string;
    configured: boolean;
  };
  llm: {
    status: DiagnosticStatus;
    configured: boolean;
    provider: string | null;
    model: string | null;
    baseUrl: string | null;
    apiKeyConfigured: boolean;
    maxTokens: number | null;
    temperature: number | null;
    enableThinking: boolean | null;
    azureDeploymentConfigured: boolean;
    azureApiVersionConfigured: boolean;
    probe: {
      status: DiagnosticStatus;
      latencyMs?: number;
      model?: string;
      tokensUsed?: number | null;
      sample?: string;
      error?: string;
    } | null;
  };
  locale: {
    supportedLocales: string[];
    defaultLocale: string;
    cookieName: string;
  };
  insights: {
    cachedTotal: number;
    cachedByLocale: Record<string, number>;
    latestGeneratedAt: string | null;
    nearestExpiryAt: string | null;
    error?: string;
  };
  sync: {
    users: number;
    prompts: number;
    promptsLast24h: number;
    latestPromptAt: string | null;
    latestSyncAt: string | null;
  };
  config: {
    sessionSecretConfigured: boolean;
    authCookieSecure: boolean;
    publicAppUrl: string | null;
    upload: {
      redactEnabled: boolean;
      maxBodySizeMb: number;
      maxRecordsPerRequest: number;
    };
    webhooks: {
      timeoutMs: number;
      integrationTimeoutMs: number;
      slackTimeoutMs: number;
      maxFailCount: number;
    };
  };
}

function statusVariant(status: DiagnosticStatus | OverallStatus): BadgeVariant {
  if (status === "ok" || status === "healthy") return "success";
  if (status === "warn" || status === "degraded") return "warning";
  return "error";
}

function statusLabel(status: DiagnosticStatus | OverallStatus): string {
  if (status === "healthy") return "Healthy";
  if (status === "degraded") return "Degraded";
  return status.toUpperCase();
}

function overallToDiagnosticStatus(status: OverallStatus): DiagnosticStatus {
  if (status === "healthy") return "ok";
  if (status === "degraded") return "warn";
  return "error";
}

function StatusBadge({ status }: { status: DiagnosticStatus | OverallStatus }) {
  const Icon =
    status === "ok" || status === "healthy"
      ? CheckCircle2
      : status === "warn" || status === "degraded"
        ? AlertTriangle
        : XCircle;

  return (
    <Badge variant={statusVariant(status)} className="gap-1.5">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {statusLabel(status)}
    </Badge>
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function boolLabel(value: boolean): string {
  return value ? "Configured" : "Not configured";
}

function SummaryCard({
  title,
  value,
  detail,
  status,
  Icon,
}: {
  title: string;
  value: string;
  detail: string;
  status: DiagnosticStatus;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-xl font-semibold">{value}</p>
          <StatusBadge status={status} />
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="max-w-[65%] break-words text-right text-sm font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

function LocaleCacheRows({ data }: { data: DiagnosticsData }) {
  const knownLocales = new Set(data.locale.supportedLocales);
  const extraLocales = Object.keys(data.insights.cachedByLocale).filter(
    (locale) => !knownLocales.has(locale),
  );

  return (
    <div className="flex flex-wrap gap-2">
      {data.locale.supportedLocales.map((locale) => (
        <Badge
          key={locale}
          variant={(data.insights.cachedByLocale[locale] ?? 0) > 0 ? "success" : "warning"}
        >
          {locale}: {data.insights.cachedByLocale[locale] ?? 0}
        </Badge>
      ))}
      {extraLocales.map((locale) => (
        <Badge key={locale} variant="outline">
          {locale}: {data.insights.cachedByLocale[locale] ?? 0}
        </Badge>
      ))}
    </div>
  );
}

export default function AdminDiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async (runProbe = false) => {
    if (runProbe) {
      setProbing(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/admin/diagnostics${runProbe ? "?probe=1" : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Diagnostics request failed with HTTP ${response.status}`);
      }
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diagnostics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void loadDiagnostics();
  }, [loadDiagnostics]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configuration and runtime checks for AI, localization, sync, and services.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadDiagnostics(false)}
            disabled={refreshing || probing}
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
              aria-hidden="true"
            />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void loadDiagnostics(true)}
            disabled={refreshing || probing}
          >
            <Sparkles
              className={cn("h-4 w-4", probing && "animate-pulse")}
              aria-hidden="true"
            />
            Run LLM Probe
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              title="Overall"
              value={statusLabel(data.overall)}
              detail={`Updated ${formatDateTime(data.generatedAt)}`}
              status={overallToDiagnosticStatus(data.overall)}
              Icon={Activity}
            />
            <SummaryCard
              title="Database"
              value={data.database.latencyMs == null ? "Unavailable" : `${data.database.latencyMs}ms`}
              detail={boolLabel(data.database.configured)}
              status={data.database.status}
              Icon={Database}
            />
            <SummaryCard
              title="Redis"
              value={data.redis.clientStatus}
              detail={boolLabel(data.redis.configured)}
              status={data.redis.status}
              Icon={Server}
            />
            <SummaryCard
              title="LLM"
              value={data.llm.provider ?? "Not set"}
              detail={data.llm.model ?? "No model"}
              status={data.llm.status}
              Icon={Sparkles}
            />
            <SummaryCard
              title="KST"
              value={data.runtime.appTimeZone}
              detail={data.runtime.appDateKey}
              status={data.runtime.appTimeZone === "Asia/Seoul" ? "ok" : "warn"}
              Icon={Clock3}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Runtime</CardTitle>
                <CardDescription>Server clock, memory, and active timezone.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl>
                  <KeyValue label="Environment" value={data.runtime.nodeEnv} />
                  <KeyValue label="Node" value={data.runtime.nodeVersion} />
                  <KeyValue label="Uptime" value={formatDuration(data.runtime.uptimeSeconds)} />
                  <KeyValue label="Server time" value={formatDateTime(data.runtime.serverTime)} />
                  <KeyValue
                    label="App-zone time"
                    value={data.runtime.serverTimeInAppZone ?? "Invalid timezone"}
                  />
                  <KeyValue label="Process TZ" value={data.runtime.processTimeZone ?? "Not set"} />
                  <KeyValue
                    label="Memory"
                    value={`${data.runtime.memoryMb.heapUsed}/${data.runtime.memoryMb.heapTotal} MB heap`}
                  />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>LLM</CardTitle>
                <CardDescription>Configuration is shown without exposing secrets.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl>
                  <KeyValue label="Provider" value={data.llm.provider ?? "Not configured"} />
                  <KeyValue label="Model" value={data.llm.model ?? "Not configured"} />
                  <KeyValue label="Base URL" value={data.llm.baseUrl ?? "Provider default"} />
                  <KeyValue label="API key" value={boolLabel(data.llm.apiKeyConfigured)} />
                  <KeyValue label="Max tokens" value={data.llm.maxTokens ?? "Default"} />
                  <KeyValue label="Temperature" value={data.llm.temperature ?? "Default"} />
                  <KeyValue
                    label="Thinking"
                    value={data.llm.enableThinking == null ? "Default" : String(data.llm.enableThinking)}
                  />
                  <KeyValue
                    label="Probe"
                    value={
                      data.llm.probe ? (
                        <span className="inline-flex items-center gap-2">
                          <StatusBadge status={data.llm.probe.status} />
                          {data.llm.probe.latencyMs ? `${data.llm.probe.latencyMs}ms` : null}
                        </span>
                      ) : (
                        "Not run"
                      )
                    }
                  />
                </dl>
                {data.llm.probe?.error && (
                  <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {data.llm.probe.error}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sync & Insights</CardTitle>
                <CardDescription>Prompt ingestion and active AI insight cache state.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl>
                  <KeyValue label="Users" value={data.sync.users.toLocaleString()} />
                  <KeyValue label="Prompts" value={data.sync.prompts.toLocaleString()} />
                  <KeyValue label="Prompts in 24h" value={data.sync.promptsLast24h.toLocaleString()} />
                  <KeyValue label="Latest prompt" value={formatDateTime(data.sync.latestPromptAt)} />
                  <KeyValue label="Latest sync" value={formatDateTime(data.sync.latestSyncAt)} />
                  <KeyValue label="Active insight rows" value={data.insights.cachedTotal.toLocaleString()} />
                  <KeyValue label="Latest insight" value={formatDateTime(data.insights.latestGeneratedAt)} />
                  <KeyValue label="Nearest expiry" value={formatDateTime(data.insights.nearestExpiryAt)} />
                </dl>
                <div className="mt-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">Insight cache by locale</p>
                  <LocaleCacheRows data={data} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>Operational settings that affect auth, uploads, and webhooks.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl>
                  <KeyValue label="Session secret" value={boolLabel(data.config.sessionSecretConfigured)} />
                  <KeyValue label="Secure auth cookie" value={String(data.config.authCookieSecure)} />
                  <KeyValue label="Public app URL" value={data.config.publicAppUrl ?? "Not set"} />
                  <KeyValue label="Locale cookie" value={data.locale.cookieName} />
                  <KeyValue label="Supported locales" value={data.locale.supportedLocales.join(", ")} />
                  <KeyValue label="Default locale" value={data.locale.defaultLocale} />
                  <KeyValue label="Upload redaction" value={String(data.config.upload.redactEnabled)} />
                  <KeyValue label="Max body" value={`${data.config.upload.maxBodySizeMb} MB`} />
                  <KeyValue
                    label="Max records"
                    value={data.config.upload.maxRecordsPerRequest.toLocaleString()}
                  />
                  <KeyValue label="Webhook timeout" value={`${data.config.webhooks.timeoutMs}ms`} />
                  <KeyValue
                    label="Integration timeout"
                    value={`${data.config.webhooks.integrationTimeoutMs}ms`}
                  />
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>Checks</CardTitle>
                  <CardDescription>Actionable status checks for this deployment.</CardDescription>
                </div>
                <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border/60">
                {data.checks.map((check) => (
                  <div key={check.id} className="grid gap-3 py-4 md:grid-cols-[12rem_1fr]">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={check.status} />
                      <span className="text-sm font-medium text-foreground">{check.label}</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-foreground">{check.detail}</p>
                      {check.recommendation && (
                        <p className="text-sm text-muted-foreground">{check.recommendation}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
            Times are rendered from server ISO values; app-zone time uses {data.runtime.appTimeZone}.
          </div>
        </>
      )}
    </div>
  );
}
