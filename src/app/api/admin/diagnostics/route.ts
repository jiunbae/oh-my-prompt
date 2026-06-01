import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { env } from "@/env";
import { callLLM, getLLMConfig } from "@/extensions/llm";
import { defaultLocale, LOCALE_COOKIE, locales } from "@/i18n/config";
import { AUTH_COOKIE_OPTIONS } from "@/lib/auth";
import { APP_TIME_ZONE, dateKeyInTimeZone } from "@/lib/date-utils";
import { extractRows } from "@/lib/drizzle-utils";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { AuthError, requireAdmin } from "@/lib/with-auth";

export const dynamic = "force-dynamic";

type DiagnosticStatus = "ok" | "warn" | "error";
type OverallStatus = "healthy" | "degraded" | "error";

interface DiagnosticCheck {
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  recommendation?: string;
}

const VALID_LLM_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "azure",
  "gemini",
  "ollama",
  "custom",
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const LLM_PROBE_TIMEOUT_MS = 15_000;

function getOverallStatus(checks: DiagnosticCheck[]): OverallStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warn")) return "degraded";
  return "healthy";
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function sanitizeUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

function formatInTimeZone(date: Date, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "medium",
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}

async function collectDatabaseDiagnostics() {
  const checks: DiagnosticCheck[] = [];
  const startedAt = Date.now();

  try {
    await db.execute(sql`SELECT 1`);
    const latencyMs = Date.now() - startedAt;

    const [metricsRow] = extractRows<{
      users_count: unknown;
      prompts_count: unknown;
      prompts_last_24h: unknown;
      latest_prompt_at: unknown;
      latest_sync_at: unknown;
    }>(
      await db.execute(sql`
        SELECT
          (SELECT COUNT(*)::int FROM "users") AS users_count,
          (SELECT COUNT(*)::int FROM "prompts" WHERE "deleted_at" IS NULL) AS prompts_count,
          (
            SELECT COUNT(*)::int
            FROM "prompts"
            WHERE "deleted_at" IS NULL AND "timestamp" >= NOW() - INTERVAL '1 day'
          ) AS prompts_last_24h,
          (SELECT MAX("timestamp") FROM "prompts" WHERE "deleted_at" IS NULL) AS latest_prompt_at,
          (SELECT MAX("synced_at") FROM "prompts" WHERE "deleted_at" IS NULL) AS latest_sync_at
      `),
    );

    const latestSyncAt = toIsoString(metricsRow?.latest_sync_at);
    const latestPromptAt = toIsoString(metricsRow?.latest_prompt_at);
    const latestSyncAgeMs = latestSyncAt ? Date.now() - new Date(latestSyncAt).getTime() : null;
    const syncStatus: DiagnosticStatus =
      latestSyncAgeMs === null ? "warn" : latestSyncAgeMs > 7 * DAY_MS ? "warn" : "ok";

    checks.push({
      id: "database",
      label: "Database",
      status: "ok",
      detail: `Connected in ${latencyMs}ms.`,
    });
    checks.push({
      id: "sync-recency",
      label: "Prompt sync recency",
      status: syncStatus,
      detail: latestSyncAt
        ? `Latest synced prompt: ${latestSyncAt}.`
        : "No synced prompts were found.",
      recommendation:
        syncStatus === "warn"
          ? "Confirm the CLI or collector is still uploading prompts."
          : undefined,
    });

    return {
      checks,
      database: {
        status: "ok" as DiagnosticStatus,
        latencyMs,
        configured: Boolean(process.env.DATABASE_URL),
      },
      sync: {
        users: toNumber(metricsRow?.users_count),
        prompts: toNumber(metricsRow?.prompts_count),
        promptsLast24h: toNumber(metricsRow?.prompts_last_24h),
        latestPromptAt,
        latestSyncAt,
      },
    };
  } catch (error) {
    checks.push({
      id: "database",
      label: "Database",
      status: "error",
      detail: errorMessage(error),
      recommendation: "Check DATABASE_URL and database reachability from the app container.",
    });

    return {
      checks,
      database: {
        status: "error" as DiagnosticStatus,
        latencyMs: null,
        configured: Boolean(process.env.DATABASE_URL),
        error: errorMessage(error),
      },
      sync: {
        users: 0,
        prompts: 0,
        promptsLast24h: 0,
        latestPromptAt: null,
        latestSyncAt: null,
      },
    };
  }
}

async function collectInsightsDiagnostics() {
  const checks: DiagnosticCheck[] = [];

  try {
    const [summaryRow] = extractRows<{
      cached_total: unknown;
      latest_generated_at: unknown;
      nearest_expiry_at: unknown;
    }>(
      await db.execute(sql`
        SELECT
          COUNT(*)::int AS cached_total,
          MAX(generated_at) AS latest_generated_at,
          MIN(expires_at) AS nearest_expiry_at
        FROM ai_insights
        WHERE expires_at > NOW()
      `),
    );

    const localeRows = extractRows<{ locale: string; count: unknown }>(
      await db.execute(sql`
        SELECT COALESCE(parameters->>'locale', 'legacy') AS locale, COUNT(*)::int AS count
        FROM ai_insights
        WHERE expires_at > NOW()
        GROUP BY 1
        ORDER BY 1
      `),
    );

    const cachedTotal = toNumber(summaryRow?.cached_total);
    const cachedByLocale = Object.fromEntries(
      localeRows.map((row) => [row.locale, toNumber(row.count)]),
    );
    const koreanCacheCount = cachedByLocale.ko ?? 0;

    checks.push({
      id: "insights-cache",
      label: "AI insights cache",
      status: cachedTotal > 0 ? "ok" : "warn",
      detail:
        cachedTotal > 0
          ? `${cachedTotal} active cached insight rows.`
          : "No active cached AI insights were found.",
      recommendation:
        cachedTotal > 0 ? undefined : "Generate insights once to populate the cache.",
    });
    checks.push({
      id: "insights-ko-cache",
      label: "Korean insights cache",
      status: koreanCacheCount > 0 ? "ok" : "warn",
      detail:
        koreanCacheCount > 0
          ? `${koreanCacheCount} active Korean insight cache rows.`
          : "No active Korean insight cache rows were found.",
      recommendation:
        koreanCacheCount > 0
          ? undefined
          : "Open AI Insights in Korean or regenerate insights with NEXT_LOCALE=ko.",
    });

    return {
      checks,
      insights: {
        cachedTotal,
        cachedByLocale,
        latestGeneratedAt: toIsoString(summaryRow?.latest_generated_at),
        nearestExpiryAt: toIsoString(summaryRow?.nearest_expiry_at),
      },
    };
  } catch (error) {
    checks.push({
      id: "insights-cache",
      label: "AI insights cache",
      status: "error",
      detail: errorMessage(error),
      recommendation: "Check the ai_insights table and recent migrations.",
    });

    return {
      checks,
      insights: {
        cachedTotal: 0,
        cachedByLocale: {},
        latestGeneratedAt: null,
        nearestExpiryAt: null,
        error: errorMessage(error),
      },
    };
  }
}

async function collectLLMDiagnostics(runProbe: boolean) {
  const rawProvider = process.env.OMP_LLM_PROVIDER?.trim();
  const providerConfigured = Boolean(rawProvider);
  const providerValid = rawProvider ? VALID_LLM_PROVIDERS.has(rawProvider) : false;
  const config = getLLMConfig();
  const apiKeyConfigured = Boolean(process.env.OMP_LLM_API_KEY);
  const checks: DiagnosticCheck[] = [];

  let status: DiagnosticStatus = "warn";
  let detail = "LLM is not configured.";
  let recommendation: string | undefined =
    "Set OMP_LLM_PROVIDER and, when required, OMP_LLM_API_KEY.";

  if (providerConfigured && !providerValid) {
    status = "error";
    detail = `Invalid OMP_LLM_PROVIDER: ${rawProvider}.`;
    recommendation = "Use one of: anthropic, openai, azure, gemini, ollama, custom.";
  } else if (config) {
    const keyRequired = !["custom", "ollama"].includes(config.provider);
    if (keyRequired && !config.apiKey) {
      status = "error";
      detail = `${config.provider} is configured but OMP_LLM_API_KEY is missing.`;
      recommendation = "Set OMP_LLM_API_KEY or use provider=custom for local OpenAI-compatible serving.";
    } else {
      status = "ok";
      detail = `${config.provider} configured with model ${config.model}.`;
      recommendation = undefined;
    }
  }

  const llm: Record<string, unknown> = {
    status,
    configured: Boolean(config),
    provider: config?.provider ?? rawProvider ?? null,
    model: config?.model ?? null,
    baseUrl: sanitizeUrl(config?.baseUrl),
    apiKeyConfigured,
    maxTokens: config?.maxTokens ?? null,
    temperature: config?.temperature ?? null,
    enableThinking: config?.enableThinking ?? null,
    azureDeploymentConfigured: Boolean(config?.azureDeployment),
    azureApiVersionConfigured: Boolean(config?.azureApiVersion),
    probe: null,
  };

  checks.push({
    id: "llm-config",
    label: "LLM configuration",
    status,
    detail,
    recommendation,
  });

  if (runProbe) {
    if (!config) {
      llm.probe = {
        status: "error",
        error: "LLM is not configured.",
      };
      checks.push({
        id: "llm-probe",
        label: "LLM probe",
        status: "error",
        detail: "Probe skipped because no valid LLM configuration exists.",
      });
    } else {
      const startedAt = Date.now();
      try {
        const result = await Promise.race([
          callLLM(
            [
              { role: "system", content: "Reply with OK only." },
              { role: "user", content: "health" },
            ],
            { ...config, maxTokens: 16, temperature: 0 },
          ),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`LLM probe timed out after ${LLM_PROBE_TIMEOUT_MS}ms`)),
              LLM_PROBE_TIMEOUT_MS,
            );
          }),
        ]);
        const latencyMs = Date.now() - startedAt;
        llm.probe = {
          status: "ok",
          latencyMs,
          model: result.model,
          tokensUsed: result.tokensUsed ?? null,
          sample: result.content.slice(0, 80),
        };
        checks.push({
          id: "llm-probe",
          label: "LLM probe",
          status: "ok",
          detail: `Completed in ${latencyMs}ms with model ${result.model}.`,
        });
      } catch (error) {
        llm.probe = {
          status: "error",
          latencyMs: Date.now() - startedAt,
          error: errorMessage(error),
        };
        checks.push({
          id: "llm-probe",
          label: "LLM probe",
          status: "error",
          detail: errorMessage(error),
          recommendation: "Check the local serving URL, model name, and provider settings.",
        });
      }
    }
  }

  return { checks, llm };
}

function collectRuntimeDiagnostics() {
  const now = new Date();
  const memory = process.memoryUsage();
  const appTimeZoneNow = formatInTimeZone(now, APP_TIME_ZONE);
  const checks: DiagnosticCheck[] = [
    {
      id: "timezone",
      label: "Application timezone",
      status: APP_TIME_ZONE === "Asia/Seoul" ? "ok" : "warn",
      detail: `APP_TIME_ZONE=${APP_TIME_ZONE}; today=${dateKeyInTimeZone(now)}.`,
      recommendation:
        APP_TIME_ZONE === "Asia/Seoul"
          ? undefined
          : "Set TZ=Asia/Seoul or OMP_TIME_ZONE=Asia/Seoul for KST operation.",
    },
    {
      id: "locale-config",
      label: "Locale configuration",
      status: locales.includes("ko") ? "ok" : "warn",
      detail: `Supported locales: ${locales.join(", ")}. Default: ${defaultLocale}.`,
      recommendation: locales.includes("ko") ? undefined : "Add ko to the i18n locale list.",
    },
  ];

  return {
    checks,
    runtime: {
      nodeEnv: env.NODE_ENV,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      appTimeZone: APP_TIME_ZONE,
      processTimeZone: process.env.TZ ?? null,
      serverTime: now.toISOString(),
      serverTimeInAppZone: appTimeZoneNow,
      appDateKey: dateKeyInTimeZone(now),
      memoryMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        external: Math.round(memory.external / 1024 / 1024),
      },
    },
  };
}

function collectRedisDiagnostics() {
  const status: DiagnosticStatus =
    redis.status === "ready" ? "ok" : redis.status === "end" ? "error" : "warn";

  return {
    checks: [
      {
        id: "redis",
        label: "Redis",
        status,
        detail: `Client status: ${redis.status}.`,
        recommendation:
          status === "ok"
            ? undefined
            : "Check REDIS_URL and Redis reachability from the app container.",
      },
    ] satisfies DiagnosticCheck[],
    redis: {
      status,
      clientStatus: redis.status,
      configured: Boolean(process.env.REDIS_URL),
    },
  };
}

function collectConfigDiagnostics() {
  const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
  const appUrl = sanitizeUrl(process.env.NEXT_PUBLIC_APP_URL);
  const productionCookieWarn = env.NODE_ENV === "production" && !AUTH_COOKIE_OPTIONS.secure;

  return {
    checks: [
      {
        id: "session-secret",
        label: "Session secret",
        status: sessionSecretConfigured ? "ok" : "error",
        detail: sessionSecretConfigured
          ? "SESSION_SECRET is configured."
          : "SESSION_SECRET is missing.",
        recommendation: sessionSecretConfigured
          ? undefined
          : "Set SESSION_SECRET to a strong random value.",
      },
      {
        id: "cookie-secure",
        label: "Secure auth cookie",
        status: productionCookieWarn ? "warn" : "ok",
        detail: `Auth cookie secure=${AUTH_COOKIE_OPTIONS.secure}.`,
        recommendation: productionCookieWarn
          ? "Use COOKIE_SECURE=true when serving production over HTTPS."
          : undefined,
      },
      {
        id: "app-url",
        label: "Public app URL",
        status: env.NODE_ENV === "production" && !appUrl ? "warn" : "ok",
        detail: appUrl ? `NEXT_PUBLIC_APP_URL=${appUrl}.` : "NEXT_PUBLIC_APP_URL is not set.",
        recommendation:
          env.NODE_ENV === "production" && !appUrl
            ? "Set NEXT_PUBLIC_APP_URL for absolute links in notifications and sharing."
            : undefined,
      },
    ] satisfies DiagnosticCheck[],
    config: {
      sessionSecretConfigured,
      authCookieSecure: AUTH_COOKIE_OPTIONS.secure,
      publicAppUrl: appUrl,
      upload: {
        redactEnabled: env.OMP_UPLOAD_REDACT_ENABLED !== "false",
        maxBodySizeMb: env.OMP_MAX_BODY_SIZE_MB,
        maxRecordsPerRequest: env.OMP_MAX_RECORDS_PER_REQUEST,
      },
      webhooks: {
        timeoutMs: env.OMP_WEBHOOK_TIMEOUT_MS,
        integrationTimeoutMs: env.INTEGRATION_WEBHOOK_TIMEOUT_MS,
        slackTimeoutMs: env.SLACK_WEBHOOK_TIMEOUT_MS,
        maxFailCount: env.OMP_WEBHOOK_MAX_FAIL_COUNT,
      },
    },
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const runProbe = searchParams.get("probe") === "1";

    const [
      databaseDiagnostics,
      insightsDiagnostics,
      llmDiagnostics,
      runtimeDiagnostics,
      redisDiagnostics,
      configDiagnostics,
    ] = await Promise.all([
      collectDatabaseDiagnostics(),
      collectInsightsDiagnostics(),
      collectLLMDiagnostics(runProbe),
      Promise.resolve(collectRuntimeDiagnostics()),
      Promise.resolve(collectRedisDiagnostics()),
      Promise.resolve(collectConfigDiagnostics()),
    ]);

    const checks = [
      ...databaseDiagnostics.checks,
      ...redisDiagnostics.checks,
      ...llmDiagnostics.checks,
      ...runtimeDiagnostics.checks,
      ...insightsDiagnostics.checks,
      ...configDiagnostics.checks,
    ];

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      overall: getOverallStatus(checks),
      checks,
      runtime: runtimeDiagnostics.runtime,
      database: databaseDiagnostics.database,
      redis: redisDiagnostics.redis,
      llm: llmDiagnostics.llm,
      locale: {
        supportedLocales: locales,
        defaultLocale,
        cookieName: LOCALE_COOKIE,
      },
      insights: insightsDiagnostics.insights,
      sync: databaseDiagnostics.sync,
      config: configDiagnostics.config,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logger.error({ err: error }, "Admin diagnostics error");
    return NextResponse.json(
      { error: "Failed to fetch diagnostics" },
      { status: 500 },
    );
  }
}
