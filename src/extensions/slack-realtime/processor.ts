/**
 * Slack realtime notifications are handled by the notifySlack() helper
 * in src/lib/slack.ts, which is called from src/services/upload.ts
 * after new prompts are inserted.
 *
 * This file exists only to satisfy the extension pattern if a handler
 * is ever needed for batch/backfill operations.
 */

import type { ProcessorInput, InsightResult } from "../types";

export async function handler(_input: ProcessorInput): Promise<InsightResult> {
  return {
    title: "Slack Realtime",
    summary: "Realtime Slack notifications are fired from the upload pipeline.",
    highlights: [],
    confidence: 1,
    generatedAt: new Date().toISOString(),
  };
}
