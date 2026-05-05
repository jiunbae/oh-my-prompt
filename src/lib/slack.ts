import { env } from "@/env";
import { logger } from "@/lib/logger";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, sql, gte, lt, isNull } from "drizzle-orm";

const SLACK_TIMEOUT_MS = env.SLACK_WEBHOOK_TIMEOUT_MS;

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
}

interface SlackPayload {
  text?: string;
  blocks?: SlackBlock[];
  channel?: string;
}

/**
 * POST a JSON payload to a Slack incoming webhook URL.
 * Gracefully handles failed deliveries (logs but does not throw).
 */
export async function sendSlackMessage(
  webhookUrl: string,
  payload: SlackPayload,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status >= 200 && response.status < 300) {
      return { success: true, statusCode: response.status };
    }

    const body = await response.text().catch(() => "unknown");
    logger.warn(
      { status: response.status, body, url: webhookUrl.slice(0, 40) },
      "Slack webhook returned non-2xx",
    );
    return { success: false, statusCode: response.status, error: body };
  } catch (error) {
    clearTimeout(timeoutId);
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.warn({ err: error, url: webhookUrl.slice(0, 40) }, "Slack webhook delivery failed");
    return { success: false, error: msg };
  }
}

interface DailySummaryData {
  totalPrompts: number;
  totalProjects: number;
  totalTokens: number;
  topProjects: Array<{ name: string; count: number }>;
}

/**
 * Build a Slack Block Kit message for a daily summary.
 */
export function buildDailySummary(data: DailySummaryData): SlackPayload {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Daily Prompt Summary",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total Prompts*\n${data.totalPrompts}` },
        { type: "mrkdwn", text: `*Projects*\n${data.totalProjects}` },
        { type: "mrkdwn", text: `*Tokens Used*\n${data.totalTokens}` },
      ],
    },
    { type: "divider" },
  ];

  if (data.topProjects.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Top Projects*\n${data.topProjects
          .map((p, i) => `${i + 1}. ${p.name} — ${p.count} prompt${p.count !== 1 ? "s" : ""}`)
          .join("\n")}`,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No project activity to report today.",
      },
    });
  }

  return { blocks };
}

interface PromptAlertData {
  id: string;
  promptText: string;
  projectName?: string | null;
  timestamp: string;
}

/**
 * Build a compact alert for a newly captured prompt.
 */
export function buildPromptAlert(prompt: PromptAlertData): SlackPayload {
  const preview = prompt.promptText.slice(0, 120);
  const ellipsis = prompt.promptText.length > 120 ? "..." : "";
  const projectInfo = prompt.projectName ? ` | *Project:* ${prompt.projectName}` : "";

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New Prompt Captured*${projectInfo}\n>${preview.replace(/\n/g, "\n>")}${ellipsis}`,
        },
      },
    ],
  };
}

/**
 * Query daily stats for a user and build a summary object.
 */
export async function queryDailySummaryData(
  userId: string,
  teamId?: string | null,
): Promise<DailySummaryData> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

  const baseWhere = teamId
    ? and(
        eq(schema.prompts.teamId, teamId),
        gte(schema.prompts.timestamp, todayStart),
        lt(schema.prompts.timestamp, tomorrowStart),
        isNull(schema.prompts.deletedAt),
      )
    : and(
        eq(schema.prompts.userId, userId),
        gte(schema.prompts.timestamp, todayStart),
        lt(schema.prompts.timestamp, tomorrowStart),
        isNull(schema.prompts.deletedAt),
      );

  const [overview, projects] = await Promise.all([
    db
      .select({
        totalPrompts: sql<number>`count(*)`,
        totalTokens: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        uniqueProjects: sql<number>`count(distinct project_name)`,
      })
      .from(schema.prompts)
      .where(baseWhere),

    db
      .select({
        project: schema.prompts.projectName,
        count: sql<number>`count(*)`,
      })
      .from(schema.prompts)
      .where(and(baseWhere, sql`project_name IS NOT NULL`))
      .groupBy(schema.prompts.projectName)
      .orderBy(sql`count(*) DESC`)
      .limit(3),
  ]);

  const row = overview[0];

  return {
    totalPrompts: Number(row?.totalPrompts ?? 0),
    totalProjects: Number(row?.uniqueProjects ?? 0),
    totalTokens: Number(row?.totalTokens ?? 0),
    topProjects: projects
      .filter((p) => p.project !== null)
      .map((p) => ({ name: p.project as string, count: Number(p.count) })),
  };
}

/**
 * Notify Slack for realtime events (e.g. new_prompt).
 * Called from upload.ts after prompt insertion.
 */
export async function notifySlack(
  userId: string,
  prompt: {
    id: string;
    promptText: string;
    projectName?: string | null;
    timestamp: Date;
    teamId?: string | null;
  },
): Promise<void> {
  try {
    const hooks = await db
      .select()
      .from(schema.slackWebhooks)
      .where(
        and(
          eq(schema.slackWebhooks.userId, userId),
          eq(schema.slackWebhooks.isActive, true),
          sql`'new_prompt' = ANY(${schema.slackWebhooks.events})`,
        ),
      );

    if (hooks.length === 0) return;

    const payload = buildPromptAlert({
      id: prompt.id,
      promptText: prompt.promptText,
      projectName: prompt.projectName,
      timestamp: prompt.timestamp.toISOString(),
    });

    for (const hook of hooks) {
      // If the webhook has a team_id, only fire if the prompt matches
      if (hook.teamId && hook.teamId !== prompt.teamId) continue;

      await sendSlackMessage(hook.webhookUrl, {
        ...payload,
        channel: hook.channel ?? undefined,
      });
    }
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to send Slack realtime notification");
  }
}
