import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MiniActivityChart } from "@/components/charts/mini-activity-chart";
import { MiniTokenTrendChart } from "@/components/charts/mini-token-trend-chart";
import { QualityDistributionChart } from "@/components/charts/quality-distribution-chart";
import { MiniQualityTrendChart } from "@/components/charts/mini-quality-trend-chart";
import { getSessionUser } from "@/lib/with-auth";
import { getDashboardData } from "@/lib/dashboard";
import { formatNumber } from "@/lib/analytics";
import { InsightCards } from "@/components/insights/insight-cards";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

export const dynamic = "force-dynamic";

const getCurrentUser = getSessionUser;

// T3's _chart-helpers isn't merged yet — inline fallback for now.
// `betterDirection` says which direction of change is "good".
// Returns Tailwind text-color class:
//   improving  → text-chart-3 (semantic positive)
//   regressing → text-destructive
//   neutral    → text-muted-foreground
type BetterDirection = "up" | "down";
function deltaColorClass(delta: number, betterDirection: BetterDirection = "up"): string {
  if (delta === 0) return "text-muted-foreground";
  const isImproving = betterDirection === "up" ? delta > 0 : delta < 0;
  return isImproving ? "text-chart-3" : "text-destructive";
}

// Fallback for chartColors.categorical (T3 helper not yet merged).
// Cycles through chart-1..chart-5 CSS vars so each project gets a distinct color.
const CATEGORICAL_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function getGreetingKey(): "greetingMorning" | "greetingAfternoon" | "greetingEvening" {
  const hour = new Date().getHours();
  if (hour < 12) return "greetingMorning";
  if (hour < 18) return "greetingAfternoon";
  return "greetingEvening";
}

function formatTimeAgo(
  dateStr: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 60_000) return t("timeAgo.justNow");
  if (ms < 3_600_000) return t("timeAgo.minutes", { n: Math.round(ms / 60_000) });
  if (ms < 86_400_000) return t("timeAgo.hours", { n: Math.round(ms / 3_600_000) });
  return t("timeAgo.days", { n: Math.round(ms / 86_400_000) });
}

/**
 * Big hero delta badge.
 * - Bigger arrow + percentage (vs. raw delta), tinted by `betterDirection`.
 */
function HeroDeltaBadge({
  current,
  previous,
  betterDirection = "up",
}: {
  current: number;
  previous: number;
  betterDirection?: BetterDirection;
}) {
  if (current === 0 && previous === 0) return null;
  const delta = current - previous;
  // Percentage change. Guard divide-by-zero by falling back to "new" indicator.
  let pctLabel: string;
  if (previous === 0) {
    pctLabel = current > 0 ? "+∞" : "0%";
  } else {
    const pct = Math.round((delta / previous) * 100);
    pctLabel = `${pct > 0 ? "+" : ""}${pct}%`;
  }
  const color = deltaColorClass(delta, betterDirection);
  const isZero = delta === 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2.5 py-1 text-sm font-semibold tabular-nums ${color}`}
    >
      {!isZero &&
        (delta > 0 ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        ))}
      {pctLabel}
    </span>
  );
}

/** Compact delta badge used in the supporting cards. */
function DeltaBadge({
  current,
  previous,
  betterDirection = "up",
  sameLabel,
}: {
  current: number;
  previous: number;
  betterDirection?: BetterDirection;
  sameLabel: string;
}) {
  if (current === 0 && previous === 0) return null;
  const delta = current - previous;
  if (delta === 0) return <span className="t-caption text-muted-foreground">{sameLabel}</span>;
  const color = deltaColorClass(delta, betterDirection);
  const isPositive = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 t-caption tabular-nums ${color}`}>
      {isPositive ? (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      )}
      {isPositive ? "+" : ""}
      {formatNumber(delta)}
    </span>
  );
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getDashboardData(user.userId);
  const t = await getTranslations("dashboard");
  const locale = await getLocale();

  if (!data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t("unableToLoad")}</p>
      </div>
    );
  }

  const userName = user.email.split("@")[0];
  const greeting = t(getGreetingKey());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="t-h1">
            {greeting}, {userName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <Link
          href="/analytics"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          {t("viewInsights")}
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>

      {/* Onboarding Checklist */}
      <OnboardingChecklist hasAnySessions={data.today.sessions > 0 || data.recentSessions.length > 0} />

      {/* Hero KPI — full width on mobile, col-span-2 on md/lg (of a 2-col grid). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card variant="elevated" className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="t-caption uppercase tracking-wider text-muted-foreground font-medium">
              {t("kpi.promptsToday")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4 flex-wrap">
              <div className="t-display tabular-nums text-foreground">{data.today.prompts}</div>
              <HeroDeltaBadge
                current={data.today.prompts}
                previous={data.yesterday.prompts}
                betterDirection="up"
              />
            </div>
            <p className="t-caption text-muted-foreground mt-2">{t("kpi.vsYesterday")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Three supporting cards on a 3-col grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(
          [
            {
              label: t("kpi.tokensToday"),
              value: data.today.tokens,
              prev: data.yesterday.tokens,
              fmt: true,
              // Note: chose 'up' so growth reads as positive (total usage is the user-visible
              // story). If we ever want "less consumption is better" semantics, flip to 'down'.
              betterDirection: "up" as const,
            },
            {
              label: t("kpi.sessionsToday"),
              value: data.today.sessions,
              prev: data.yesterday.sessions,
              betterDirection: "up" as const,
            },
            {
              label: t("kpi.activeProjects"),
              value: data.today.projects,
              prev: data.yesterday.projects,
              betterDirection: "up" as const,
            },
          ]
        ).map((item) => (
          <Card key={item.label} variant="default">
            <CardHeader className="pb-2">
              <CardTitle className="t-caption text-muted-foreground font-medium">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 flex-wrap">
                <div className="t-h1 tabular-nums text-foreground">
                  {item.fmt ? formatNumber(item.value) : item.value}
                </div>
                <DeltaBadge
                  current={item.value}
                  previous={item.prev}
                  betterDirection={item.betterDirection}
                  sameLabel={t("kpi.same")}
                />
              </div>
              <p className="t-caption text-muted-foreground mt-1">{t("kpi.vsYesterday")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* This Week + Top Projects */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("thisWeek")}</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniActivityChart data={data.last7Days} />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
              {data.last7Days.map((d) => (
                <span key={d.date}>
                  {new Date(d.date + "T12:00:00Z").toLocaleDateString(locale, { weekday: "short" })}
                </span>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              <span>{t("weekly.totalPrompts", { n: data.last7Days.reduce((s, d) => s + d.count, 0) })}</span>
              <span>{t("weekly.avgPerDay", { n: Math.round(data.last7Days.reduce((s, d) => s + d.count, 0) / 7) })}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("topProjects")}</CardTitle>
              <span className="text-xs text-muted-foreground">{t("lastNDays", { n: 7 })}</span>
            </div>
          </CardHeader>
          <CardContent>
            {data.topProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("noProjectActivity")}</p>
            ) : (
              (() => {
                const maxCount = data.topProjects[0]?.count ?? 1;
                // Tick marks at 25/50/75/100% of max — give users an absolute scale.
                const ticks = [0.25, 0.5, 0.75, 1];
                return (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      {data.topProjects.map((p, i) => {
                        const pct = (p.count / maxCount) * 100;
                        const color = CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length];
                        return (
                          <div key={p.project} className="space-y-1">
                            <div className="flex justify-between text-sm gap-2">
                              <span className="text-foreground font-medium truncate">{p.project}</span>
                              <span className="text-muted-foreground shrink-0 tabular-nums">
                                {t("topProject.promptsSuffix", { count: p.count })}
                              </span>
                            </div>
                            <div className="relative h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Tick scale: absolute counts at 25/50/75/100% of the leader */}
                    <div className="relative h-4 mt-1" aria-hidden>
                      {ticks.map((frac) => (
                        <div
                          key={frac}
                          className="absolute top-0 flex flex-col items-center -translate-x-1/2"
                          style={{ left: `${frac * 100}%` }}
                        >
                          <div className="h-1 w-px bg-border" />
                          <span className="t-caption text-muted-foreground tabular-nums leading-none mt-0.5">
                            {Math.round(maxCount * frac)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Sessions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t("recentSessions")}</CardTitle>
            <Link href="/sessions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("viewAll")}
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentSessions.length === 0 ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-foreground">{t("empty.noPrompts")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("empty.noPromptsHelp")}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded bg-surface px-3 py-1.5 text-xs font-mono text-foreground border border-border">
                <span>npm install -g oh-my-prompt</span>
              </div>
              <div className="mt-3">
                <Link
                  href="/docs"
                  className="text-sm text-primary hover:underline transition-colors"
                >
                  {t("readTheDocs")}
                </Link>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.recentSessions.map((s) => (
                <Link key={s.sessionId} href={`/sessions/${s.sessionId}`} className="block">
                  <div className="flex items-center justify-between py-3 hover:bg-accent/50 hover:shadow-[0_0_15px_var(--glow)] -mx-2 px-2 rounded transition-all">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground line-clamp-1 whitespace-pre-line">
                        {s.displayName || s.firstPrompt || t("emptySession")}
                      </p>
                      {s.displayName ? (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-1 whitespace-pre-line">
                          {s.firstPrompt || t("emptySession")}
                        </p>
                      ) : null}
                      <div className="flex items-center gap-2 mt-1">
                        {s.projectName && <Badge variant="secondary" className="text-[10px]">{s.projectName}</Badge>}
                        {s.source && <Badge variant="outline" className="text-[10px]">{s.source}</Badge>}
                        <span className="text-xs text-muted-foreground">{formatTimeAgo(s.endedAt, t)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground ml-4 shrink-0">
                      <span>{t("session.promptsSuffix", { count: s.promptCount })}</span>
                      {s.totalTokens > 0 && <span>{t("session.tokensSuffix", { value: formatNumber(s.totalTokens) })}</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Token Usage + Quality Score + Topics */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Token Usage Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("tokenUsage.title")}</CardTitle>
              <span className="text-xs text-muted-foreground">{t("lastNDays", { n: 7 })}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-secondary/50 p-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("tokenUsage.total")}</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{formatNumber(data.tokenUsage.totalTokens)}</p>
              </div>
              <div className="rounded-md bg-secondary/50 p-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("tokenUsage.avgPerPrompt")}</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{formatNumber(data.tokenUsage.avgPerPrompt)}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("tokenUsage.dailyTrend")}</p>
              <MiniTokenTrendChart data={data.tokenUsage.dailyTrend} />
            </div>
            {data.tokenUsage.byProject.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">{t("tokenUsage.byProject")}</p>
                <div className="space-y-2">
                  {data.tokenUsage.byProject.map((p) => {
                    const maxTokens = data.tokenUsage.byProject[0]?.tokens ?? 1;
                    const pct = (p.tokens / maxTokens) * 100;
                    return (
                      <div key={p.project} className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-foreground truncate">{p.project}</span>
                          <span className="text-muted-foreground shrink-0 ml-2 tabular-nums">{formatNumber(p.tokens)}</span>
                        </div>
                        <div className="h-1 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-chart-1 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-between text-[10px] text-muted-foreground pt-2 border-t border-border">
              <span>{t("tokenUsage.prompt", { value: formatNumber(data.tokenUsage.promptTokens) })}</span>
              <span>{t("tokenUsage.response", { value: formatNumber(data.tokenUsage.responseTokens) })}</span>
            </div>
          </CardContent>
        </Card>

        {/* Prompt Quality Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("promptQuality.title")}</CardTitle>
              <span className="text-xs text-muted-foreground">{t("lastNDays", { n: 7 })}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-secondary/50 p-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("promptQuality.avgScore")}</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{data.quality.avgScore}/100</p>
              </div>
              <div className="rounded-md bg-secondary/50 p-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{t("promptQuality.scored")}</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{data.quality.totalScored}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("promptQuality.scoreDistribution")}</p>
              <QualityDistributionChart data={data.quality.distribution} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t("promptQuality.qualityTrend")}</p>
              <MiniQualityTrendChart data={data.quality.dailyTrend} />
            </div>
            {data.quality.topPrompts.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">{t("promptQuality.topPrompts")}</p>
                <div className="space-y-1.5">
                  {data.quality.topPrompts.map((p) => (
                    <Link key={p.id} href={`/prompts/${p.id}`} className="block">
                      <div className="flex items-start gap-2 text-xs hover:bg-accent/50 -mx-1 px-1 py-1 rounded transition-colors">
                        <Badge variant="secondary" className="text-[10px] shrink-0">{p.score}</Badge>
                        <span className="text-foreground line-clamp-1">{p.text}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Topics Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("topics.title")}</CardTitle>
              <span className="text-xs text-muted-foreground">{t("lastNDays", { n: 7 })}</span>
            </div>
          </CardHeader>
          <CardContent>
            {data.topics.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("noTopicData")}</p>
            ) : (
              <div className="space-y-2.5">
                {data.topics.map((tp) => {
                  const maxCount = data.topics[0]?.count ?? 1;
                  const pct = (tp.count / maxCount) * 100;
                  return (
                    <Link key={tp.tag} href={`/prompts?tag=${encodeURIComponent(tp.tag)}`} className="block group">
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground font-medium group-hover:text-primary transition-colors">{tp.tag}</span>
                          <span className="text-muted-foreground shrink-0 ml-2 tabular-nums">{tp.count}</span>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-chart-5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Insights */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-chart-5" />
          {t("aiInsights")}
        </h2>
        <InsightCards />
      </div>
    </div>
  );
}
