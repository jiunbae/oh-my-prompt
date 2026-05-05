import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, isNull } from "drizzle-orm";
import { formatNumber } from "@/lib/format";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeekDigestData {
  userName: string | null;
  userEmail: string;
  weekRange: { from: string; to: string };
  currentWeek: {
    totalPrompts: number;
    totalTokens: number;
    totalResponseTokens: number;
    uniqueProjects: number;
    uniqueSessions: number;
    avgPromptLength: number;
    avgQualityScore: number | null;
    projects: Array<{ project: string; count: number; percent: number }>;
    dailyCounts: Array<{ date: string; count: number }>;
  };
  previousWeek: {
    totalPrompts: number;
    totalTokens: number;
    totalResponseTokens: number;
    uniqueProjects: number;
    uniqueSessions: number;
    avgQualityScore: number | null;
  };
  comparisons: {
    promptDelta: number;
    tokenDelta: number;
    projectDelta: number;
    sessionDelta: number;
    qualityDelta: number | null;
  };
  topProject: string | null;
  peakDay: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1); // Monday = start of week
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function queryWeekStats(
  userId: string,
  from: Date,
  to: Date,
): Promise<{
  totalPrompts: number;
  totalTokens: number;
  totalResponseTokens: number;
  uniqueProjects: number;
  uniqueSessions: number;
  avgPromptLength: number;
  avgQualityScore: number | null;
  projects: Array<{ project: string; count: number }>;
  dailyCounts: Array<{ date: string; count: number }>;
}> {
  const whereClause = and(
    eq(schema.prompts.userId, userId),
    gte(schema.prompts.timestamp, from),
    lt(schema.prompts.timestamp, to),
    isNull(schema.prompts.deletedAt),
  );

  const [overview, projects, dailyCounts, quality] = await Promise.all([
    db
      .select({
        totalPrompts: sql<number>`count(*)`,
        totalTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0)), 0)`,
        totalResponseTokens: sql<number>`coalesce(sum(coalesce(token_estimate_response, 0)), 0)`,
        uniqueProjects: sql<number>`count(distinct project_name)`,
        uniqueSessions: sql<number>`count(distinct session_id)`,
        avgPromptLength: sql<number>`coalesce(avg(prompt_length), 0)`,
      })
      .from(schema.prompts)
      .where(whereClause),

    db
      .select({
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(whereClause, sql`project_name IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(10),

    db
      .select({
        date: sql<string>`date(${schema.prompts.timestamp})`,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(whereClause)
      .groupBy(sql`date(${schema.prompts.timestamp})`)
      .orderBy(sql`date(${schema.prompts.timestamp})`),

    db
      .select({
        avgQuality: sql<number>`coalesce(avg(quality_score), 0)`,
      })
      .from(schema.prompts)
      .where(
        and(
          eq(schema.prompts.userId, userId),
          gte(schema.prompts.timestamp, from),
          lt(schema.prompts.timestamp, to),
          isNull(schema.prompts.deletedAt),
          sql`quality_score IS NOT NULL`,
        )
      ),
  ]);

  const row = overview[0];
  const totalPrompts = Number(row?.totalPrompts ?? 0);

  return {
    totalPrompts,
    totalTokens: Number(row?.totalTokens ?? 0),
    totalResponseTokens: Number(row?.totalResponseTokens ?? 0),
    uniqueProjects: Number(row?.uniqueProjects ?? 0),
    uniqueSessions: Number(row?.uniqueSessions ?? 0),
    avgPromptLength: Math.round(Number(row?.avgPromptLength ?? 0)),
    avgQualityScore: quality[0]?.avgQuality ? Math.round(Number(quality[0].avgQuality)) : null,
    projects: projects.map((p) => ({
      project: p.project ?? "Unknown",
      count: Number(p.count ?? 0),
    })),
    dailyCounts: dailyCounts.map((d) => ({
      date: d.date,
      count: Number(d.count ?? 0),
    })),
  };
}

function computeDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------
// Public: generate weekly digest data for a user
// ---------------------------------------------------------------------------

export async function generateWeeklyDigest(userId: string): Promise<WeekDigestData | null> {
  const [user] = await db
    .select({
      name: schema.users.name,
      email: schema.users.email,
      emailDigestEnabled: schema.users.emailDigestEnabled,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user || !user.emailDigestEnabled) {
    return null;
  }

  const now = new Date();
  const currentWeekStart = startOfWeek(now);
  const currentWeekEnd = addDays(currentWeekStart, 7);
  const previousWeekStart = addDays(currentWeekStart, -7);
  const previousWeekEnd = currentWeekStart;

  const [currentWeek, previousWeek] = await Promise.all([
    queryWeekStats(userId, currentWeekStart, currentWeekEnd),
    queryWeekStats(userId, previousWeekStart, previousWeekEnd),
  ]);

  if (currentWeek.totalPrompts === 0 && previousWeek.totalPrompts === 0) {
    return null;
  }

  const promptDelta = computeDelta(currentWeek.totalPrompts, previousWeek.totalPrompts);
  const tokenDelta = computeDelta(
    currentWeek.totalTokens + currentWeek.totalResponseTokens,
    previousWeek.totalTokens + previousWeek.totalResponseTokens,
  );
  const projectDelta = computeDelta(currentWeek.uniqueProjects, previousWeek.uniqueProjects);
  const sessionDelta = computeDelta(currentWeek.uniqueSessions, previousWeek.uniqueSessions);

  const qualityDelta =
    currentWeek.avgQualityScore !== null && previousWeek.avgQualityScore !== null
      ? computeDelta(currentWeek.avgQualityScore, previousWeek.avgQualityScore)
      : null;

  const totalPrompts = currentWeek.totalPrompts;
  const projectsWithPercent = currentWeek.projects.map((p) => ({
    ...p,
    percent: totalPrompts > 0 ? Math.round((p.count / totalPrompts) * 100) : 0,
  }));

  const peakDay = currentWeek.dailyCounts.length > 0
    ? currentWeek.dailyCounts.reduce((a, b) => (a.count > b.count ? a : b)).date
    : null;

  return {
    userName: user.name,
    userEmail: user.email,
    weekRange: {
      from: toDateString(currentWeekStart),
      to: toDateString(addDays(currentWeekEnd, -1)),
    },
    currentWeek: {
      ...currentWeek,
      projects: projectsWithPercent,
    },
    previousWeek,
    comparisons: {
      promptDelta,
      tokenDelta,
      projectDelta,
      sessionDelta,
      qualityDelta,
    },
    topProject: currentWeek.projects[0]?.project ?? null,
    peakDay,
  };
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function deltaArrow(delta: number): string {
  if (delta > 0) return "&#9650;";
  if (delta < 0) return "&#9660;";
  return "&#9644;";
}

function deltaColor(delta: number): string {
  if (delta > 0) return "#16a34a";
  if (delta < 0) return "#dc2626";
  return "#6b7280";
}

function deltaLabel(delta: number): string {
  const abs = Math.abs(delta);
  if (delta > 0) return `+${abs}%`;
  if (delta < 0) return `${delta}%`;
  return "0%";
}

export function generateDigestHtml(data: WeekDigestData): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const greeting = data.userName ? `Hi ${data.userName},` : "Hi there,";

  const projectRows = data.currentWeek.projects
    .slice(0, 5)
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${p.project}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;text-align:right;">${p.count}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;text-align:right;">${p.percent}%</td>
      </tr>
    `
    )
    .join("");

  const qualityHtml = data.currentWeek.avgQualityScore !== null
    ? `
    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;flex:1;margin:4px;">
      <div style="font-size:24px;font-weight:700;color:#111827;">${data.currentWeek.avgQualityScore}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">Avg Quality</div>
      ${data.comparisons.qualityDelta !== null ? `<div style="font-size:12px;color:${deltaColor(data.comparisons.qualityDelta)};margin-top:4px;">${deltaArrow(data.comparisons.qualityDelta)} ${deltaLabel(data.comparisons.qualityDelta)}</div>` : ""}
    </div>
  `
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Weekly Oh My Prompt Digest</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" width="100%" max-width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 24px;text-align:center;">
              <h1 style="color:#ffffff;font-size:20px;font-weight:700;margin:0;">Your Weekly Digest</h1>
              <p style="color:#e0e7ff;font-size:14px;margin:8px 0 0 0;">${data.weekRange.from} &ndash; ${data.weekRange.to}</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px;">
              <p style="font-size:16px;color:#374151;margin:0 0 16px 0;">${greeting}</p>
              <p style="font-size:14px;color:#6b7280;margin:0 0 24px 0;line-height:1.6;">Here is a summary of your prompt activity this week compared to last week.</p>

              <!-- Stats Grid -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="width:50%;padding:4px;">
                    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
                      <div style="font-size:24px;font-weight:700;color:#111827;">${formatNumber(data.currentWeek.totalPrompts)}</div>
                      <div style="font-size:12px;color:#6b7280;margin-top:4px;">Prompts</div>
                      <div style="font-size:12px;color:${deltaColor(data.comparisons.promptDelta)};margin-top:4px;">${deltaArrow(data.comparisons.promptDelta)} ${deltaLabel(data.comparisons.promptDelta)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:4px;">
                    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
                      <div style="font-size:24px;font-weight:700;color:#111827;">${formatNumber(data.currentWeek.totalTokens + data.currentWeek.totalResponseTokens)}</div>
                      <div style="font-size:12px;color:#6b7280;margin-top:4px;">Total Tokens</div>
                      <div style="font-size:12px;color:${deltaColor(data.comparisons.tokenDelta)};margin-top:4px;">${deltaArrow(data.comparisons.tokenDelta)} ${deltaLabel(data.comparisons.tokenDelta)}</div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="width:50%;padding:4px;">
                    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
                      <div style="font-size:24px;font-weight:700;color:#111827;">${data.currentWeek.uniqueProjects}</div>
                      <div style="font-size:12px;color:#6b7280;margin-top:4px;">Projects</div>
                      <div style="font-size:12px;color:${deltaColor(data.comparisons.projectDelta)};margin-top:4px;">${deltaArrow(data.comparisons.projectDelta)} ${deltaLabel(data.comparisons.projectDelta)}</div>
                    </div>
                  </td>
                  <td style="width:50%;padding:4px;">
                    <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
                      <div style="font-size:24px;font-weight:700;color:#111827;">${data.currentWeek.uniqueSessions}</div>
                      <div style="font-size:12px;color:#6b7280;margin-top:4px;">Sessions</div>
                      <div style="font-size:12px;color:${deltaColor(data.comparisons.sessionDelta)};margin-top:4px;">${deltaArrow(data.comparisons.sessionDelta)} ${deltaLabel(data.comparisons.sessionDelta)}</div>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Quality (conditional) -->
              ${qualityHtml ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:24px;justify-content:center;">${qualityHtml}</div>` : ""}

              <!-- Top Projects -->
              ${projectRows ? `
              <h2 style="font-size:16px;font-weight:600;color:#111827;margin:0 0 12px 0;">Top Projects</h2>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <thead>
                  <tr>
                    <th style="text-align:left;font-size:12px;color:#6b7280;padding:8px 0;border-bottom:2px solid #e5e7eb;">Project</th>
                    <th style="text-align:right;font-size:12px;color:#6b7280;padding:8px 0;border-bottom:2px solid #e5e7eb;">Prompts</th>
                    <th style="text-align:right;font-size:12px;color:#6b7280;padding:8px 0;border-bottom:2px solid #e5e7eb;">Share</th>
                  </tr>
                </thead>
                <tbody>
                  ${projectRows}
                </tbody>
              </table>
              ` : ""}

              <!-- Highlights -->
              <div style="background:#eef2ff;border-radius:8px;padding:16px;margin-bottom:24px;">
                <h3 style="font-size:14px;font-weight:600;color:#4338ca;margin:0 0 8px 0;">Week Highlights</h3>
                <ul style="margin:0;padding:0 0 0 16px;list-style:disc;">
                  <li style="font-size:14px;color:#374151;margin-bottom:4px;">Most active project: <strong>${data.topProject ?? "N/A"}</strong></li>
                  <li style="font-size:14px;color:#374151;margin-bottom:4px;">Peak day: <strong>${data.peakDay ?? "N/A"}</strong></li>
                  <li style="font-size:14px;color:#374151;margin-bottom:4px;">Avg prompt length: <strong>${data.currentWeek.avgPromptLength} chars</strong></li>
                </ul>
              </div>

              <!-- CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
                <tr>
                  <td align="center">
                    <a href="${appUrl}/analytics" style="display:inline-block;background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View Full Analytics</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="font-size:12px;color:#9ca3af;margin:0;">Oh My Prompt &middot; Weekly Digest</p>
              <p style="font-size:12px;color:#9ca3af;margin:4px 0 0 0;">
                <a href="${appUrl}/api/digest/unsubscribe" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Plain text template
// ---------------------------------------------------------------------------

export function generateDigestText(data: WeekDigestData): string {
  const greeting = data.userName ? `Hi ${data.userName},` : "Hi there,";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const projectLines = data.currentWeek.projects
    .slice(0, 5)
    .map((p) => `  - ${p.project}: ${p.count} prompts (${p.percent}%)`)
    .join("\n");

  const qualityLine = data.currentWeek.avgQualityScore !== null
    ? `Avg Quality Score: ${data.currentWeek.avgQualityScore}${data.comparisons.qualityDelta !== null ? ` (${data.comparisons.qualityDelta > 0 ? "+" : ""}${data.comparisons.qualityDelta}%)` : ""}\n`
    : "";

  return `${greeting}

Here is your weekly Oh My Prompt digest for ${data.weekRange.from} - ${data.weekRange.to}.

STATS THIS WEEK
---------------
Prompts:        ${data.currentWeek.totalPrompts} (${data.comparisons.promptDelta > 0 ? "+" : ""}${data.comparisons.promptDelta}% vs last week)
Total Tokens:   ${formatNumber(data.currentWeek.totalTokens + data.currentWeek.totalResponseTokens)} (${data.comparisons.tokenDelta > 0 ? "+" : ""}${data.comparisons.tokenDelta}%)
Projects:       ${data.currentWeek.uniqueProjects} (${data.comparisons.projectDelta > 0 ? "+" : ""}${data.comparisons.projectDelta}%)
Sessions:       ${data.currentWeek.uniqueSessions} (${data.comparisons.sessionDelta > 0 ? "+" : ""}${data.comparisons.sessionDelta}%)
${qualityLine}
TOP PROJECTS
------------
${projectLines || "  No projects recorded."}

HIGHLIGHTS
----------
Most active project: ${data.topProject ?? "N/A"}
Peak day: ${data.peakDay ?? "N/A"}
Avg prompt length: ${data.currentWeek.avgPromptLength} chars

View full analytics: ${appUrl}/analytics

---
Oh My Prompt - Weekly Digest
Unsubscribe: ${appUrl}/api/digest/unsubscribe
`;
}

// ---------------------------------------------------------------------------
// Convenience: send digest for a user
// ---------------------------------------------------------------------------

export async function sendUserDigest(userId: string): Promise<{ sent: boolean; error?: string }> {
  const data = await generateWeeklyDigest(userId);
  if (!data) {
    return { sent: false };
  }

  const { sendEmail } = await import("@/lib/email");
  const html = generateDigestHtml(data);
  const text = generateDigestText(data);

  const result = await sendEmail({
    to: data.userEmail,
    subject: `Your Weekly Oh My Prompt Digest - ${data.weekRange.from}`,
    html,
    text,
  });

  if (result.success) {
    logger.info({ userId, provider: result.provider }, "Weekly digest sent");
    return { sent: true };
  }

  logger.error({ userId, error: result.error }, "Weekly digest failed to send");
  return { sent: false, error: result.error };
}
