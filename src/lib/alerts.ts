import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, gte, lt, sql, isNull } from "drizzle-orm";
import { sendEmail } from "@/lib/email";
import { sendSlackMessage } from "@/lib/slack";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertMetric =
  | "daily_prompt_count"
  | "avg_quality"
  | "token_usage"
  | "session_count"
  | "project_activity";

export type AlertCondition = "above" | "below" | "equals" | "changes_by";

export interface MetricResult {
  value: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Comparison period helpers
// ---------------------------------------------------------------------------

/** Duration of a comparison period in milliseconds. */
function getPeriodMs(period: string): number {
  const DAY = 24 * 60 * 60 * 1000;
  switch (period) {
    case "1_hour":
      return 60 * 60 * 1000;
    case "1_day":
      return DAY;
    case "7_days":
      return 7 * DAY;
    case "30_days":
      return 30 * DAY;
    default:
      return DAY;
  }
}

/**
 * Current rolling window [from, to). Rolling millisecond windows are absolute
 * (timezone-independent) and DST-safe, so no APP_TIME_ZONE calendar helper is
 * needed here — the comparison is anchored to `now`.
 */
function getPeriodDates(period: string): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime() - getPeriodMs(period));
  return { from, to };
}

/** The period immediately preceding [from, to) of equal length. */
function getPreviousPeriodDates(from: Date, to: Date): { from: Date; to: Date } {
  const durationMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - durationMs), to: from };
}

// ---------------------------------------------------------------------------
// Metric queries
// ---------------------------------------------------------------------------

async function queryMetric(
  rule: schema.AlertRule
): Promise<MetricResult | null> {
  const { from, to } = getPeriodDates(rule.comparisonPeriod ?? "1_day");
  return queryMetricForRange(rule, from, to);
}

/**
 * Query a rule's metric over an explicit [from, to) window.
 *
 * Returns null when the metric has NO meaningful data for the window (e.g.
 * avg_quality with zero scored prompts) so callers skip evaluation instead of
 * treating a missing average as 0 (which produces false "below" alarms).
 * Count-based metrics legitimately return 0.
 */
async function queryMetricForRange(
  rule: schema.AlertRule,
  from: Date,
  to: Date
): Promise<MetricResult | null> {
  const baseWhere = rule.teamId
    ? and(
        eq(schema.prompts.teamId, rule.teamId),
        gte(schema.prompts.timestamp, from),
        lt(schema.prompts.timestamp, to),
        isNull(schema.prompts.deletedAt)
      )
    : and(
        eq(schema.prompts.userId, rule.userId),
        gte(schema.prompts.timestamp, from),
        lt(schema.prompts.timestamp, to),
        isNull(schema.prompts.deletedAt)
      );

  switch (rule.metric) {
    case "daily_prompt_count": {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.prompts)
        .where(baseWhere);
      return { value: Number(row?.count ?? 0), label: "Daily prompt count" };
    }

    case "avg_quality": {
      const [row] = await db
        .select({
          avg: sql<number>`coalesce(avg(quality_score), 0)`,
          scored: sql<number>`count(quality_score)`,
        })
        .from(schema.prompts)
        .where(and(baseWhere, sql`quality_score IS NOT NULL`));
      // No scored prompts in this window — skip rather than report avg 0.
      if (Number(row?.scored ?? 0) === 0) {
        return null;
      }
      return { value: Math.round(Number(row?.avg ?? 0)), label: "Average quality score" };
    }

    case "token_usage": {
      const [row] = await db
        .select({
          sum: sql<number>`coalesce(sum(coalesce(token_estimate, 0) + coalesce(token_estimate_response, 0)), 0)`,
        })
        .from(schema.prompts)
        .where(baseWhere);
      return { value: Number(row?.sum ?? 0), label: "Token usage" };
    }

    case "session_count": {
      const [row] = await db
        .select({ count: sql<number>`count(distinct session_id)` })
        .from(schema.prompts)
        .where(baseWhere);
      return { value: Number(row?.count ?? 0), label: "Session count" };
    }

    case "project_activity": {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.prompts)
        .where(and(baseWhere, sql`project_name IS NOT NULL`));
      return { value: Number(row?.count ?? 0), label: "Project activity" };
    }

    default:
      logger.warn({ metric: rule.metric }, "Unknown alert metric");
      return null;
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(
  condition: AlertCondition,
  value: number,
  threshold: number,
  previousValue?: number | null
): boolean {
  switch (condition) {
    case "above":
      return value > threshold;
    case "below":
      return value < threshold;
    case "equals":
      return value === threshold;
    case "changes_by": {
      // Real previous-vs-current delta: trigger when the absolute change
      // between the previous period and the current period meets the
      // threshold. Requires a comparable previous-period value.
      if (previousValue == null) return false;
      return Math.abs(value - previousValue) >= threshold;
    }
    default:
      return false;
  }
}

function buildAlertMessage(
  rule: schema.AlertRule,
  metricValue: number,
  metricLabel: string
): string {
  const conditionText: Record<string, string> = {
    above: "above",
    below: "below",
    equals: "equal to",
    changes_by: "changed by",
  };

  return `Alert: ${metricLabel} (${metricValue}) is ${conditionText[rule.condition] ?? rule.condition} threshold (${rule.threshold})`;
}

// ---------------------------------------------------------------------------
// Notification senders
// ---------------------------------------------------------------------------

async function sendEmailNotification(
  userId: string,
  message: string,
  ruleName: string
): Promise<boolean> {
  try {
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.email) return false;

    const result = await sendEmail({
      to: user.email,
      subject: `Oh My Prompt Alert: ${ruleName}`,
      html: `<p>${message}</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/alerts">View Alerts</a></p>`,
      text: `${message}\n\nView alerts: ${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/alerts`,
    });

    return result.success;
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to send alert email");
    return false;
  }
}

async function sendSlackNotification(
  userId: string,
  message: string,
  ruleName: string
): Promise<boolean> {
  try {
    const hooks = await db
      .select()
      .from(schema.slackWebhooks)
      .where(
        and(
          eq(schema.slackWebhooks.userId, userId),
          eq(schema.slackWebhooks.isActive, true)
        )
      )
      .limit(1);

    if (hooks.length === 0) return false;

    const hook = hooks[0];
    const result = await sendSlackMessage(hook.webhookUrl, {
      text: `*Oh My Prompt Alert: ${ruleName}*\n${message}`,
      channel: hook.channel ?? undefined,
    });

    return result.success;
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to send alert Slack message");
    return false;
  }
}

async function createInAppNotification(
  rule: schema.AlertRule,
  metricValue: number,
  message: string,
  channelsSent: string[]
): Promise<void> {
  await db.insert(schema.alertNotifications).values({
    alertRuleId: rule.id,
    userId: rule.userId,
    metricValue: String(metricValue),
    threshold: String(rule.threshold),
    message,
    channelsSent,
  });
}

// ---------------------------------------------------------------------------
// Cooldown check
// ---------------------------------------------------------------------------

function isCooldownElapsed(rule: schema.AlertRule): boolean {
  if (!rule.lastTriggeredAt) return true;
  const cooldownMs = (rule.cooldownMinutes ?? 60) * 60 * 1000;
  return Date.now() - rule.lastTriggeredAt.getTime() >= cooldownMs;
}

// ---------------------------------------------------------------------------
// Single rule evaluation
// ---------------------------------------------------------------------------

export async function evaluateAlertRule(
  rule: schema.AlertRule
): Promise<{ triggered: boolean; channelsSent: string[] }> {
  const { from, to } = getPeriodDates(rule.comparisonPeriod ?? "1_day");
  const metricResult = await queryMetricForRange(rule, from, to);
  if (!metricResult) {
    return { triggered: false, channelsSent: [] };
  }

  // For changes_by, fetch the immediately-preceding period to compare against.
  let previousValue: number | null = null;
  if (rule.condition === "changes_by") {
    const prev = getPreviousPeriodDates(from, to);
    const prevResult = await queryMetricForRange(rule, prev.from, prev.to);
    if (!prevResult) {
      // No comparable baseline — cannot compute a delta, so do not trigger.
      return { triggered: false, channelsSent: [] };
    }
    previousValue = prevResult.value;
  }

  const triggered = evaluateCondition(
    rule.condition as AlertCondition,
    metricResult.value,
    Number(rule.threshold),
    previousValue
  );

  if (!triggered || !isCooldownElapsed(rule)) {
    return { triggered: false, channelsSent: [] };
  }

  const message = buildAlertMessage(rule, metricResult.value, metricResult.label);
  const channelsSent: string[] = [];
  const channels = rule.notificationChannels ?? ["in_app"];

  if (channels.includes("email")) {
    const sent = await sendEmailNotification(rule.userId, message, rule.name);
    if (sent) channelsSent.push("email");
  }

  if (channels.includes("slack")) {
    const sent = await sendSlackNotification(rule.userId, message, rule.name);
    if (sent) channelsSent.push("slack");
  }

  if (channels.includes("in_app")) {
    await createInAppNotification(rule, metricResult.value, message, channelsSent);
    channelsSent.push("in_app");
  }

  // Update lastTriggeredAt
  await db
    .update(schema.alertRules)
    .set({ lastTriggeredAt: new Date() })
    .where(eq(schema.alertRules.id, rule.id));

  return { triggered: true, channelsSent };
}

// ---------------------------------------------------------------------------
// Main entry point: evaluate all active alert rules
// ---------------------------------------------------------------------------

export async function evaluateAlertRules(): Promise<{
  evaluated: number;
  triggered: number;
  errors: number;
}> {
  const rules = await db
    .select()
    .from(schema.alertRules)
    .where(eq(schema.alertRules.isActive, true));

  let triggeredCount = 0;
  let errorCount = 0;

  for (const rule of rules) {
    try {
      const result = await evaluateAlertRule(rule);
      if (result.triggered) {
        triggeredCount++;
        logger.info(
          { ruleId: rule.id, ruleName: rule.name, channels: result.channelsSent },
          "Alert triggered"
        );
      }
    } catch (error) {
      errorCount++;
      logger.error({ err: error, ruleId: rule.id }, "Failed to evaluate alert rule");
    }
  }

  logger.info(
    { evaluated: rules.length, triggered: triggeredCount, errors: errorCount },
    "Alert evaluation complete"
  );

  return {
    evaluated: rules.length,
    triggered: triggeredCount,
    errors: errorCount,
  };
}

// ---------------------------------------------------------------------------
// Test alert (simulate trigger without cooldown check)
// ---------------------------------------------------------------------------

export async function testAlertRule(
  rule: schema.AlertRule
): Promise<{ triggered: boolean; message: string; channelsSent: string[] }> {
  const metricResult = await queryMetric(rule);
  if (!metricResult) {
    return { triggered: false, message: "Could not query metric", channelsSent: [] };
  }

  const message = buildAlertMessage(rule, metricResult.value, metricResult.label);
  const channelsSent: string[] = [];
  const channels = rule.notificationChannels ?? ["in_app"];

  if (channels.includes("email")) {
    const sent = await sendEmailNotification(rule.userId, `[TEST] ${message}`, rule.name);
    if (sent) channelsSent.push("email");
  }

  if (channels.includes("slack")) {
    const sent = await sendSlackNotification(rule.userId, `[TEST] ${message}`, rule.name);
    if (sent) channelsSent.push("slack");
  }

  if (channels.includes("in_app")) {
    await createInAppNotification(rule, metricResult.value, `[TEST] ${message}`, channelsSent);
    channelsSent.push("in_app");
  }

  return {
    triggered: true,
    message: `[TEST] ${message}`,
    channelsSent,
  };
}
