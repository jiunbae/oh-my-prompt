import type { Extension } from "./types";

/**
 * Central extension registry.
 * Import and register all extensions here.
 * Extensions are statically imported — no dynamic loader.
 */

import { dailySummary } from "./daily-summary/manifest";
import { weeklyTrends } from "./weekly-trends/manifest";
import { promptQuality } from "./prompt-quality/manifest";
import { sessionStory } from "./session-story/manifest";
import { emailDigest } from "./email-digest/manifest";
import { slackDaily } from "./slack-daily/manifest";
import { slackRealtime } from "./slack-realtime/manifest";

export const extensions: Extension[] = [
  dailySummary,
  weeklyTrends,
  promptQuality,
  sessionStory,
  emailDigest,
  slackDaily,
  slackRealtime,
];

/** Look up an extension by name */
export function getExtension(name: string): Extension | undefined {
  return extensions.find((e) => e.name === name);
}

/** Get all extensions with batch processors */
export function getScheduledExtensions(): Extension[] {
  return extensions.filter((e) => e.processor?.schedule);
}

/** Get all extensions with dashboard cards */
export function getDashboardExtensions(): Extension[] {
  return extensions.filter((e) => e.dashboardCard);
}
