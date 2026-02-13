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

export const extensions: Extension[] = [
  dailySummary,
  weeklyTrends,
  promptQuality,
  sessionStory,
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
